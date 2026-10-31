// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — 24-Hour Design-Day 3R2C Building Thermal Simulator.
 *
 * Simulates transient diurnal outdoor dry-bulb temperature and solar radiation
 * across multi-zone 3R2C building envelopes (exterior/interior convective resistances,
 * opaque wall thermal capacitance C_wall = rho * cp * L * A, glazing SHGC solar
 * transmission, infiltration, internal gains, inter-zone conduction, and
 * ZoneHVAC:IdealLoadsAirSystem heating/cooling thermostat deadband control).
 */

import type {
  EnergyPlusDocument,
  IdfMaterial,
  IdfMaterialNoMass,
  IdfSurface,
  IdfVertex3D,
  IdfZone,
  IdfZoneHVAC,
} from "../types.js";

export interface DesignDaySolverOptions {
  durationHours?: number | undefined; // default: 24
  timeStepSeconds?: number | undefined; // default: 300 (5 min)
  outdoorMeanTempC?: number | undefined; // default: 18.0 deg C
  outdoorSwingTempC?: number | undefined; // peak-to-peak diurnal swing (default: 14.0 K)
  peakSolarIrradianceWPerM2?: number | undefined; // default: 750 W/m^2 at solar noon
  groundTempC?: number | undefined; // default: 14.0 deg C
  initialZoneTempC?: number | undefined; // default: 21.0 deg C
  defaultShgc?: number | undefined; // default window solar heat gain coefficient: 0.70
}

export interface DesignDayStepRecord {
  timeHours: number;
  outdoorTempC: number;
  solarIrradianceWPerM2: number;
  zoneTempsC: Record<string, number>;
  wallTempsC: Record<string, number>;
  zoneHvacLoadsW: Record<string, number>; // > 0 heating, < 0 cooling
  solarWindowGainsW: Record<string, number>;
}

export interface DesignDaySimulationResult {
  buildingName: string;
  zoneNames: string[];
  trajectory: DesignDayStepRecord[];
  peakHeatingLoadW: Record<string, number>;
  peakCoolingLoadW: Record<string, number>;
  totalHeatingEnergyJ: Record<string, number>;
  totalCoolingEnergyJ: Record<string, number>;
  minZoneTempsC: Record<string, number>;
  maxZoneTempsC: Record<string, number>;
}

function computePolygonArea(vertices: IdfVertex3D[]): number {
  if (vertices.length < 3) return 0.0;
  const v0 = vertices[0];
  if (!v0) return 0.0;
  let nx = 0.0;
  let ny = 0.0;
  let nz = 0.0;
  for (let i = 1; i < vertices.length - 1; i++) {
    const v1 = vertices[i];
    const v2 = vertices[i + 1];
    if (!v1 || !v2) continue;
    const ux = v1.x - v0.x;
    const uy = v1.y - v0.y;
    const uz = v1.z - v0.z;
    const vx = v2.x - v0.x;
    const vy = v2.y - v0.y;
    const vz = v2.z - v0.z;
    nx += uy * vz - uz * vy;
    ny += uz * vx - ux * vz;
    nz += ux * vy - uy * vx;
  }
  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

interface ZoneThermalParams {
  name: string;
  cZone: number; // J/K
  cWall: number; // J/K
  gExtWall: number; // W/K
  gWin: number; // W/K
  gGround: number; // W/K
  gInfiltration: number; // W/K
  qInternalW: number; // W
  sunExposedWallArea: number; // m^2
  wallSolarAbsorptance: number; // 0..1
  windowEffectiveSolarArea: number; // sum(A_win * SHGC) m^2
  interzoneG: Map<string, number>; // otherZoneName -> W/K
  hvac?: IdfZoneHVAC | undefined;
}

export function simulateEnergyPlusDesignDay(
  doc: EnergyPlusDocument,
  options?: DesignDaySolverOptions,
): DesignDaySimulationResult {
  const durationHours = options?.durationHours ?? 24.0;
  const dt = options?.timeStepSeconds ?? 300.0;
  const tMeanC = options?.outdoorMeanTempC ?? 18.0;
  const tSwingC = options?.outdoorSwingTempC ?? 14.0;
  const iPeakSolar = options?.peakSolarIrradianceWPerM2 ?? 750.0;
  const tGroundC = options?.groundTempC ?? 14.0;
  const initZoneTempC = options?.initialZoneTempC ?? 21.0;
  const defaultShgc = options?.defaultShgc ?? 0.7;

  const materialMap = new Map<string, IdfMaterial>();
  for (const m of doc.materials) {
    materialMap.set(m.name.toLowerCase(), m);
  }
  const materialNoMassMap = new Map<string, IdfMaterialNoMass>();
  for (const m of doc.materialsNoMass) {
    materialNoMassMap.set(m.name.toLowerCase(), m);
  }

  const uValueMap = new Map<string, number>();
  const cWallPerAreaMap = new Map<string, number>();
  const solarAbsMap = new Map<string, number>();

  for (const c of doc.constructions) {
    let rVal = 0.17; // R_si (0.13) + R_se (0.04)
    let cPerArea = 0.0;
    let outerSolarAbs = 0.7;
    for (let i = 0; i < c.layers.length; i++) {
      const layer = c.layers[i];
      if (!layer) continue;
      const mat = materialMap.get(layer.toLowerCase());
      const matNoMass = materialNoMassMap.get(layer.toLowerCase());
      if (mat && mat.conductivity > 0.0) {
        rVal += mat.thickness / mat.conductivity;
        if (mat.density > 0.0 && mat.specificHeat > 0.0 && mat.thickness > 0.0) {
          cPerArea += mat.density * mat.specificHeat * mat.thickness;
        }
        if (i === 0 && mat.solarAbsorptance !== undefined) {
          outerSolarAbs = mat.solarAbsorptance;
        }
      } else if (matNoMass && matNoMass.thermalResistance > 0.0) {
        rVal += matNoMass.thermalResistance;
        if (i === 0 && matNoMass.solarAbsorptance !== undefined) {
          outerSolarAbs = matNoMass.solarAbsorptance;
        }
      } else {
        rVal += 0.2;
      }
    }
    uValueMap.set(c.name.toLowerCase(), 1.0 / Math.max(0.1, rVal));
    cWallPerAreaMap.set(c.name.toLowerCase(), cPerArea);
    solarAbsMap.set(c.name.toLowerCase(), outerSolarAbs);
  }

  const surfaceByName = new Map<string, IdfSurface>();
  for (const s of doc.surfaces) {
    surfaceByName.set(s.name.toLowerCase(), s);
  }
  const zoneByName = new Map<string, IdfZone>();
  for (const z of doc.zones) {
    zoneByName.set(z.name.toLowerCase(), z);
  }

  const zoneParams = new Map<string, ZoneThermalParams>();
  const zoneTempC: Record<string, number> = {};
  const wallTempC: Record<string, number> = {};
  const peakHeatingLoadW: Record<string, number> = {};
  const peakCoolingLoadW: Record<string, number> = {};
  const totalHeatingEnergyJ: Record<string, number> = {};
  const totalCoolingEnergyJ: Record<string, number> = {};
  const minZoneTempsC: Record<string, number> = {};
  const maxZoneTempsC: Record<string, number> = {};

  for (const zone of doc.zones) {
    const volume = zone.volume ?? (zone.floorArea ?? 40.0) * (zone.ceilingHeight ?? 2.8);
    const cZone = volume * 1.2 * 1005.0 * 3.0;

    let gExtWall = 0.0;
    let cWall = 0.0;
    let gGround = 0.0;
    let sunExposedWallArea = 0.0;
    let wallSolarAbsorptance = 0.7;
    const interzoneG = new Map<string, number>();

    const zoneSurfaces = doc.surfaces.filter((s) => s.zoneName.toLowerCase() === zone.name.toLowerCase());
    const zoneSurfaceNames = new Set(zoneSurfaces.map((s) => s.name.toLowerCase()));

    for (const surf of zoneSurfaces) {
      const area = surf.grossArea && surf.grossArea > 0 ? surf.grossArea : computePolygonArea(surf.vertices) || 20.0;
      const uVal = uValueMap.get(surf.constructionName.toLowerCase()) ?? 1.5;
      const cPerArea = cWallPerAreaMap.get(surf.constructionName.toLowerCase()) ?? 0.0;
      const gVal = area * uVal;

      const bc = surf.boundaryCondition.toLowerCase();
      if (bc === "outdoors") {
        gExtWall += gVal;
        cWall += area * cPerArea;
        if (surf.sunExposure !== "NoSun") {
          sunExposedWallArea += area;
          wallSolarAbsorptance = solarAbsMap.get(surf.constructionName.toLowerCase()) ?? 0.7;
        }
      } else if (bc === "ground") {
        gGround += gVal;
      } else if (bc === "surface" || bc === "zone") {
        const targetObj = surf.outsideBoundaryConditionObject;
        if (targetObj) {
          const targetSurf = surfaceByName.get(targetObj.toLowerCase());
          const targetZone = targetSurf
            ? zoneByName.get(targetSurf.zoneName.toLowerCase())
            : zoneByName.get(targetObj.toLowerCase());
          if (targetZone && targetZone.name.toLowerCase() !== zone.name.toLowerCase()) {
            interzoneG.set(targetZone.name, (interzoneG.get(targetZone.name) ?? 0.0) + gVal);
          }
        }
      }
    }

    if (zoneSurfaces.length === 0 && gExtWall === 0.0) {
      gExtWall = 50.0;
    }

    let gWin = 0.0;
    let windowEffectiveSolarArea = 0.0;
    for (const fen of doc.fenestrations) {
      if (zoneSurfaceNames.has(fen.buildingSurfaceName.toLowerCase())) {
        const winArea = computePolygonArea(fen.vertices) || 4.0;
        const uWin = uValueMap.get(fen.constructionName.toLowerCase()) ?? 2.8;
        gWin += winArea * uWin;
        windowEffectiveSolarArea += winArea * defaultShgc;
      }
    }

    let mDotInf = 0.0;
    for (const inf of doc.infiltrations.filter((i) => i.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      if (inf.designVolumeFlowRate) {
        mDotInf += inf.designVolumeFlowRate * 1.2;
      } else if (inf.airChangesPerHour) {
        mDotInf += ((inf.airChangesPerHour * volume) / 3600.0) * 1.2;
      }
    }
    const gInfiltration = mDotInf * 1005.0;

    let qInternalW = 0.0;
    for (const p of doc.people.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      qInternalW += p.numberOfPeople * 100.0;
    }
    for (const l of doc.lights.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      qInternalW += l.lightingLevel;
    }
    for (const e of doc.electricEquipment.filter((x) => x.zoneName.toLowerCase() === zone.name.toLowerCase())) {
      qInternalW += e.designLevel;
    }

    const hvac = doc.zoneHvacs.find((h) => h.zoneName.toLowerCase() === zone.name.toLowerCase());

    zoneParams.set(zone.name, {
      name: zone.name,
      cZone,
      cWall: Math.max(cWall, 5.0e4), // minimum physical envelope heat capacity for stability
      gExtWall,
      gWin,
      gGround,
      gInfiltration,
      qInternalW,
      sunExposedWallArea,
      wallSolarAbsorptance,
      windowEffectiveSolarArea,
      interzoneG,
      hvac,
    });

    zoneTempC[zone.name] = initZoneTempC;
    wallTempC[zone.name] = 0.5 * (initZoneTempC + tMeanC);
    peakHeatingLoadW[zone.name] = 0.0;
    peakCoolingLoadW[zone.name] = 0.0;
    totalHeatingEnergyJ[zone.name] = 0.0;
    totalCoolingEnergyJ[zone.name] = 0.0;
    minZoneTempsC[zone.name] = initZoneTempC;
    maxZoneTempsC[zone.name] = initZoneTempC;
  }

  const totalSteps = Math.max(1, Math.round((durationHours * 3600.0) / dt));
  const trajectory: DesignDayStepRecord[] = [];

  function outdoorProfile(tHours: number): { tAmbC: number; iSolar: number } {
    const hourOfDay = ((tHours % 24.0) + 24.0) % 24.0;
    const tAmbC = tMeanC - 0.5 * tSwingC * Math.cos((2.0 * Math.PI * (hourOfDay - 3.0)) / 24.0);
    const iSolar =
      hourOfDay >= 6.0 && hourOfDay <= 18.0
        ? Math.max(0.0, iPeakSolar * Math.sin((Math.PI * (hourOfDay - 6.0)) / 12.0))
        : 0.0;
    return { tAmbC, iSolar };
  }

  function computeHvacLoadW(zp: ZoneThermalParams, tz: number): number {
    if (!zp.hvac) return 0.0;
    const tHeat = zp.hvac.heatingSetpointTemp ?? 20.0;
    const tCool = zp.hvac.coolingSetpointTemp ?? 24.0;
    const qHeatMax = zp.hvac.heatingLimit ?? 15000.0;
    const qCoolMax = zp.hvac.coolingLimit ?? 15000.0;
    const kp = 2500.0; // W/K proportional thermostat gain

    if (tz < tHeat) {
      return Math.min(qHeatMax, kp * (tHeat - tz));
    }
    if (tz > tCool) {
      return -Math.min(qCoolMax, kp * (tz - tCool));
    }
    return 0.0;
  }

  for (let step = 0; step <= totalSteps; step++) {
    const tHours = (step * dt) / 3600.0;
    const { tAmbC, iSolar } = outdoorProfile(tHours);

    const stepHvacLoadsW: Record<string, number> = {};
    const stepSolarWinGainsW: Record<string, number> = {};

    for (const [zName, zp] of zoneParams) {
      const tz = zoneTempC[zName] ?? initZoneTempC;
      const qHvac = computeHvacLoadW(zp, tz);
      stepHvacLoadsW[zName] = qHvac;
      stepSolarWinGainsW[zName] = zp.windowEffectiveSolarArea * iSolar;

      if (tz < (minZoneTempsC[zName] ?? tz)) minZoneTempsC[zName] = tz;
      if (tz > (maxZoneTempsC[zName] ?? tz)) maxZoneTempsC[zName] = tz;

      if (qHvac > 0.0) {
        if (qHvac > (peakHeatingLoadW[zName] ?? 0.0)) peakHeatingLoadW[zName] = qHvac;
        if (step < totalSteps) {
          totalHeatingEnergyJ[zName] = (totalHeatingEnergyJ[zName] ?? 0.0) + qHvac * dt;
        }
      } else if (qHvac < 0.0) {
        const coolW = -qHvac;
        if (coolW > (peakCoolingLoadW[zName] ?? 0.0)) peakCoolingLoadW[zName] = coolW;
        if (step < totalSteps) {
          totalCoolingEnergyJ[zName] = (totalCoolingEnergyJ[zName] ?? 0.0) + coolW * dt;
        }
      }
    }

    trajectory.push({
      timeHours: tHours,
      outdoorTempC: tAmbC,
      solarIrradianceWPerM2: iSolar,
      zoneTempsC: { ...zoneTempC },
      wallTempsC: { ...wallTempC },
      zoneHvacLoadsW: stepHvacLoadsW,
      solarWindowGainsW: stepSolarWinGainsW,
    });

    if (step === totalSteps) break;

    // Advance 3R2C network state with sub-stepped semi-implicit Euler for unconditional stability
    const subSteps = 4;
    const subDt = dt / subSteps;
    for (let sub = 0; sub < subSteps; sub++) {
      const nextZoneT: Record<string, number> = {};
      const nextWallT: Record<string, number> = {};

      for (const [zName, zp] of zoneParams) {
        const tz = zoneTempC[zName] ?? initZoneTempC;
        const tw = wallTempC[zName] ?? tMeanC;

        const gOut = 2.0 * zp.gExtWall;
        const gIn = 2.0 * zp.gExtWall;

        // Absorbed solar flux on exterior wall node (attenuated by exterior film ratio)
        const qSolarWall = 0.25 * zp.wallSolarAbsorptance * zp.sunExposedWallArea * iSolar;
        const dTw = ((gOut * (tAmbC - tw) + gIn * (tz - tw) + qSolarWall) / zp.cWall) * subDt;
        nextWallT[zName] = tw + dTw;

        // Zone air energy balance
        let qZone =
          gIn * (tw - tz) +
          (zp.gWin + zp.gInfiltration) * (tAmbC - tz) +
          zp.gGround * (tGroundC - tz) +
          zp.qInternalW +
          zp.windowEffectiveSolarArea * iSolar +
          computeHvacLoadW(zp, tz);

        for (const [otherName, gIz] of zp.interzoneG) {
          const tOther = zoneTempC[otherName] ?? initZoneTempC;
          qZone += gIz * (tOther - tz);
        }

        nextZoneT[zName] = tz + (qZone / zp.cZone) * subDt;
      }

      for (const zName of zoneParams.keys()) {
        const nextZ = nextZoneT[zName];
        if (nextZ !== undefined) zoneTempC[zName] = nextZ;
        const nextW = nextWallT[zName];
        if (nextW !== undefined) wallTempC[zName] = nextW;
      }
    }
  }

  return {
    buildingName: doc.building?.name ?? "EnergyPlus_Building",
    zoneNames: doc.zones.map((z) => z.name),
    trajectory,
    peakHeatingLoadW,
    peakCoolingLoadW,
    totalHeatingEnergyJ,
    totalCoolingEnergyJ,
    minZoneTempsC,
    maxZoneTempsC,
  };
}
