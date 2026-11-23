// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — ASHRAE Heat-Balance Load, Composite Wall & 24-Hour Thermal Solver.
 *
 * Implements:
 * 1. Exact ASHRAE multi-layer composite wall R-value, U-value, and areal thermal capacitance.
 * 2. Steady-state design-day heating/cooling load: Q = (UA + m_dot * c_p) * dT - Q_int - Q_solar.
 * 3. Transient 24-hour RK4 zone RC / 3R2C thermal-capacitance & HVAC energy simulation.
 */

import type { Doe2Document, Doe2GlassType, Doe2Layers, Doe2Material, Doe2Space, Doe2System } from "../types.js";

// ─── ASHRAE Exact Unit Conversion Constants (IP <-> SI) ──────────────────────

export const FT_TO_M = 0.3048;
export const FT2_TO_M2 = 0.09290304;
export const FT3_TO_M3 = 0.028316846592;
export const K_IP_TO_SI = 1.730734666; // Btu/(hr*ft*F) -> W/(m*K)
export const U_IP_TO_SI = 5.678263337; // Btu/(hr*ft^2*F) -> W/(m^2*K)
export const R_IP_TO_SI = 0.1761101838; // hr*ft^2*F/Btu -> m^2*K/W
export const RHO_IP_TO_SI = 16.01846337; // lb/ft^3 -> kg/m^3
export const CP_IP_TO_SI = 4186.8; // Btu/(lb*F) -> J/(kg*K)
export const BTUH_TO_W = 0.29307107; // Btu/hr -> W
export const CFM_TO_M3S = 0.0004719474432; // ft^3/min -> m^3/s

export const AIR_DENSITY_SI = 1.2; // kg/m^3
export const AIR_CP_SI = 1005.0; // J/(kg*K)
export const ASHRAE_R_SI_DEFAULT = 0.13; // m^2*K/W (interior still air film)
export const ASHRAE_R_SE_DEFAULT = 0.04; // m^2*K/W (exterior 6.7 m/s wind film)

export function fahrenheitToCelsius(tempF: number): number {
  return ((tempF - 32.0) * 5.0) / 9.0;
}

export function celsiusToFahrenheit(tempC: number): number {
  return (tempC * 9.0) / 5.0 + 32.0;
}

export interface ConstructionThermalProps {
  name: string;
  rTotalSi: number; // m^2*K/W
  rTotalIp: number; // hr*ft^2*F/Btu
  uValueSi: number; // W/(m^2*K)
  uValueIp: number; // Btu/(hr*ft^2*F)
  capacitancePerAreaSi: number; // J/(m^2*K)
  absorptance: number;
  layerRValuesSi: number[];
}

export interface ConstructionCalcOptions {
  rFilmIntSi?: number | undefined;
  rFilmExtSi?: number | undefined;
}

/**
 * Computes exact ASHRAE multi-layer composite R-value, U-value, and areal thermal capacitance
 * for all constructions in a `Doe2Document`.
 */
export function computeAllConstructionProps(
  doc: Doe2Document,
  options?: ConstructionCalcOptions,
): Map<string, ConstructionThermalProps> {
  const isIp = doc.units === "IP";
  const defaultRsi = options?.rFilmIntSi ?? ASHRAE_R_SI_DEFAULT;
  const defaultRse = options?.rFilmExtSi ?? ASHRAE_R_SE_DEFAULT;

  const matMap = new Map<string, Doe2Material>();
  for (const m of doc.materials) {
    matMap.set(m.name.toLowerCase(), m);
  }
  const layMap = new Map<string, Doe2Layers>();
  for (const l of doc.layers) {
    layMap.set(l.name.toLowerCase(), l);
  }

  const materialRAndCSi = (mat: Doe2Material): { rSi: number; cSi: number } => {
    if (mat.type === "RESISTANCE" || (mat.resistance !== undefined && mat.conductivity === undefined)) {
      const rRaw = mat.resistance ?? 0.0;
      return { rSi: isIp ? rRaw * R_IP_TO_SI : rRaw, cSi: 0.0 };
    }
    const thickSi = (mat.thickness ?? 0.0) * (isIp ? FT_TO_M : 1.0);
    const kSi = (mat.conductivity ?? 0.0) * (isIp ? K_IP_TO_SI : 1.0);
    const rhoSi = (mat.density ?? 0.0) * (isIp ? RHO_IP_TO_SI : 1.0);
    const cpSi = (mat.specificHeat ?? 0.0) * (isIp ? CP_IP_TO_SI : 1.0);
    const rSi = kSi > 0.0 && thickSi > 0.0 ? thickSi / kSi : 0.0;
    const cSi = rhoSi > 0.0 && cpSi > 0.0 && thickSi > 0.0 ? rhoSi * cpSi * thickSi : 0.0;
    return { rSi, cSi };
  };

  const result = new Map<string, ConstructionThermalProps>();

  for (const con of doc.constructions) {
    const absorptance = con.absorptance ?? 0.7;

    if (con.type === "U-VALUE" && con.uValue !== undefined && con.uValue > 0) {
      const uSi = isIp ? con.uValue * U_IP_TO_SI : con.uValue;
      const rSi = 1.0 / uSi;
      result.set(con.name.toLowerCase(), {
        name: con.name,
        rTotalSi: rSi,
        rTotalIp: rSi / R_IP_TO_SI,
        uValueSi: uSi,
        uValueIp: uSi / U_IP_TO_SI,
        capacitancePerAreaSi: 0.0,
        absorptance,
        layerRValuesSi: [rSi],
      });
      continue;
    }

    const layerRValuesSi: number[] = [];
    let cPerAreaSi = 0.0;
    let rSiFilm = defaultRsi;
    let rSeFilm = defaultRse;

    if (con.layersName) {
      const lay = layMap.get(con.layersName.toLowerCase());
      if (lay) {
        if (lay.insideFilmRes !== undefined) {
          rSiFilm = isIp ? lay.insideFilmRes * R_IP_TO_SI : lay.insideFilmRes;
        }
        if (lay.outsideFilmRes !== undefined) {
          rSeFilm = isIp ? lay.outsideFilmRes * R_IP_TO_SI : lay.outsideFilmRes;
        }
        for (const mName of lay.materials) {
          const mat = matMap.get(mName.toLowerCase());
          if (mat) {
            const { rSi, cSi } = materialRAndCSi(mat);
            layerRValuesSi.push(rSi);
            cPerAreaSi += cSi;
          }
        }
      }
    } else if (con.materialName) {
      const mat = matMap.get(con.materialName.toLowerCase());
      if (mat) {
        const { rSi, cSi } = materialRAndCSi(mat);
        layerRValuesSi.push(rSi);
        cPerAreaSi += cSi;
      }
    }

    const rLayersSum = layerRValuesSi.reduce((a, b) => a + b, 0.0);
    const rTotalSi = Math.max(1e-6, rSeFilm + rLayersSum + rSiFilm);
    const uValueSi = 1.0 / rTotalSi;

    result.set(con.name.toLowerCase(), {
      name: con.name,
      rTotalSi,
      rTotalIp: rTotalSi / R_IP_TO_SI,
      uValueSi,
      uValueIp: uValueSi / U_IP_TO_SI,
      capacitancePerAreaSi: cPerAreaSi,
      absorptance,
      layerRValuesSi,
    });
  }

  return result;
}

export interface SpaceThermalSummary {
  spaceName: string;
  volumeM3: number;
  floorAreaM2: number;
  cZoneJPerK: number;
  cWallJPerK: number;
  uaWallWPerK: number;
  uaRoofWPerK: number;
  uaWindowWPerK: number;
  uaDoorWPerK: number;
  uaGroundWPerK: number;
  uaExteriorTotalWPerK: number;
  mDotInfKgPerS: number;
  gInfiltrationWPerK: number;
  qInternalW: number;
  windowEffectiveSolarAreaM2: number;
  sunExposedWallAreaM2: number;
  wallSolarAbsorptance: number;
  heatSetpointC: number;
  coolSetpointC: number;
  systemType?: string | undefined;
  coolingCop: number;
  heatingEff: number;
  hasHvac: boolean;
}

function getDefaultSystemPerf(sysType?: string): { coolingCop: number; heatingEff: number; fanFraction: number } {
  switch ((sysType ?? "").toUpperCase()) {
    case "VAVS":
      return { coolingCop: 3.4, heatingEff: 0.85, fanFraction: 0.08 };
    case "PIU":
      return { coolingCop: 3.2, heatingEff: 0.85, fanFraction: 0.1 };
    case "FC":
      return { coolingCop: 3.6, heatingEff: 0.88, fanFraction: 0.05 };
    case "PTAC":
      return { coolingCop: 2.8, heatingEff: 0.8, fanFraction: 0.06 };
    case "PSZ":
    default:
      return { coolingCop: 3.0, heatingEff: 0.82, fanFraction: 0.07 };
  }
}

export interface ThermalBuildOptions {
  rFilmIntSi?: number | undefined;
  rFilmExtSi?: number | undefined;
  thermalMassMultiplier?: number | undefined; // default 1.0 (pure air) or 3.0 (air + furniture)
}

/**
 * Extracts SI lumped thermal parameters for every `SPACE` in a `Doe2Document`.
 */
export function buildSpaceThermalSummaries(doc: Doe2Document, options?: ThermalBuildOptions): SpaceThermalSummary[] {
  const isIp = doc.units === "IP";
  const areaScale = isIp ? FT2_TO_M2 : 1.0;
  const volScale = isIp ? FT3_TO_M3 : 1.0;
  const lenScale = isIp ? FT_TO_M : 1.0;
  const uScale = isIp ? U_IP_TO_SI : 1.0;
  const massMult = options?.thermalMassMultiplier ?? 3.0;

  const conProps = computeAllConstructionProps(doc, {
    rFilmIntSi: options?.rFilmIntSi,
    rFilmExtSi: options?.rFilmExtSi,
  });

  const glassMap = new Map<string, Doe2GlassType>();
  for (const g of doc.glassTypes) {
    glassMap.set(g.name.toLowerCase(), g);
  }

  const sysMap = new Map<string, Doe2System>();
  for (const s of doc.systems) {
    sysMap.set(s.name.toLowerCase(), s);
  }

  const zoneBySpace = new Map<string, (typeof doc.zones)[number]>();
  for (const z of doc.zones) {
    if (z.spaceName) {
      zoneBySpace.set(z.spaceName.toLowerCase(), z);
    }
  }

  const summaries: SpaceThermalSummary[] = [];

  for (const sp of doc.spaces) {
    const floorAreaM2 = (sp.area ?? 100.0) * areaScale;
    const heightM = (sp.height ?? (isIp ? 10.0 : 3.0)) * lenScale;
    const volumeM3 = sp.volume !== undefined ? sp.volume * volScale : floorAreaM2 * heightM;
    const cZoneJPerK = volumeM3 * AIR_DENSITY_SI * AIR_CP_SI * massMult;

    let uaWall = 0.0;
    let uaRoof = 0.0;
    let uaGround = 0.0;
    let cWall = 0.0;
    let sunExposedWallAreaM2 = 0.0;
    let absWeightedSum = 0.0;

    // Track window areas per parent surface so opaque wall area is net of glazing
    const winAreaBySurface = new Map<string, number>();
    let uaWindow = 0.0;
    let windowEffectiveSolarAreaM2 = 0.0;

    const spaceWindows = doc.windows.filter((w) => w.spaceName?.toLowerCase() === sp.name.toLowerCase());
    for (const win of spaceWindows) {
      const mult = win.multiplier ?? 1.0;
      const wAreaM2 = (win.area ?? (win.width ?? 0) * (win.height ?? 0)) * areaScale * mult;
      if (wAreaM2 <= 0) continue;

      if (win.parentSurfaceName) {
        const key = win.parentSurfaceName.toLowerCase();
        winAreaBySurface.set(key, (winAreaBySurface.get(key) ?? 0.0) + wAreaM2);
      }

      const glz = win.glassTypeName ? glassMap.get(win.glassTypeName.toLowerCase()) : undefined;
      const uWinSi = glz?.glassConductance !== undefined ? glz.glassConductance * uScale : 2.8;
      const shgc = glz?.shgc ?? (glz?.shadingCoeff !== undefined ? glz.shadingCoeff * 0.87 : 0.65);

      uaWindow += uWinSi * wAreaM2;
      windowEffectiveSolarAreaM2 += wAreaM2 * shgc;
    }

    let uaDoor = 0.0;
    const doorAreaBySurface = new Map<string, number>();
    const spaceDoors = doc.doors.filter((d) => d.spaceName?.toLowerCase() === sp.name.toLowerCase());
    for (const door of spaceDoors) {
      const dAreaM2 = (door.area ?? (door.width ?? 0) * (door.height ?? 0)) * areaScale;
      if (dAreaM2 <= 0) continue;
      if (door.parentSurfaceName) {
        const key = door.parentSurfaceName.toLowerCase();
        doorAreaBySurface.set(key, (doorAreaBySurface.get(key) ?? 0.0) + dAreaM2);
      }
      const cProp = door.constructionName ? conProps.get(door.constructionName.toLowerCase()) : undefined;
      const uDoorSi = cProp ? cProp.uValueSi : 2.0;
      uaDoor += uDoorSi * dAreaM2;
    }

    const spaceSurfaces = doc.surfaces.filter((s) => s.spaceName?.toLowerCase() === sp.name.toLowerCase());
    for (const surf of spaceSurfaces) {
      const grossAreaM2 = (surf.area ?? (surf.width ?? 0) * (surf.height ?? 0)) * areaScale;
      if (grossAreaM2 <= 0) continue;
      const openingArea =
        (winAreaBySurface.get(surf.name.toLowerCase()) ?? 0.0) +
        (doorAreaBySurface.get(surf.name.toLowerCase()) ?? 0.0);
      const netAreaM2 = Math.max(0.0, grossAreaM2 - openingArea);

      const cProp = surf.constructionName ? conProps.get(surf.constructionName.toLowerCase()) : undefined;
      const uSi = cProp ? cProp.uValueSi : 1.2;
      const cPerArea = cProp ? cProp.capacitancePerAreaSi : 0.0;
      const abs = cProp ? cProp.absorptance : 0.7;

      if (surf.kind === "EXTERIOR-WALL") {
        uaWall += uSi * netAreaM2;
        cWall += cPerArea * netAreaM2;
        sunExposedWallAreaM2 += netAreaM2;
        absWeightedSum += abs * netAreaM2;
      } else if (surf.kind === "ROOF") {
        uaRoof += uSi * netAreaM2;
        cWall += cPerArea * netAreaM2;
        sunExposedWallAreaM2 += netAreaM2;
        absWeightedSum += abs * netAreaM2;
      } else if (surf.kind === "UNDERGROUND-WALL") {
        uaGround += uSi * netAreaM2;
      }
    }

    // Infiltration: ACH or CFM/area
    let mDotInfKgPerS = 0.0;
    if (sp.infiltrationAch !== undefined && sp.infiltrationAch > 0) {
      mDotInfKgPerS += ((sp.infiltrationAch * volumeM3) / 3600.0) * AIR_DENSITY_SI;
    }
    if (sp.infiltrationCfmPerArea !== undefined && sp.infiltrationCfmPerArea > 0) {
      const rawFloor = sp.area ?? floorAreaM2 / areaScale;
      const volFlowM3S = isIp
        ? sp.infiltrationCfmPerArea * rawFloor * CFM_TO_M3S
        : sp.infiltrationCfmPerArea * floorAreaM2;
      mDotInfKgPerS += volFlowM3S * AIR_DENSITY_SI;
    }
    const gInfiltrationWPerK = mDotInfKgPerS * AIR_CP_SI;

    // Internal gains (W)
    const rawArea = sp.area ?? floorAreaM2 / areaScale;
    const qPeople = (sp.people ?? 0.0) * 100.0;
    const qLighting = (sp.lightingWPerArea ?? 0.0) * (isIp ? rawArea : floorAreaM2);
    const qEquipment = (sp.equipmentWPerArea ?? 0.0) * (isIp ? rawArea : floorAreaM2);
    const qInternalW = qPeople + qLighting + qEquipment;

    // Linked ZONE / SYSTEM
    const zone = zoneBySpace.get(sp.name.toLowerCase());
    const sys = zone?.systemName ? sysMap.get(zone.systemName.toLowerCase()) : doc.systems[0];
    const hasHvac = zone !== undefined && zone.type !== "UNCONDITIONED" && zone.type !== "PLENUM";

    const defaultHeatC = 20.0;
    const defaultCoolC = 24.0;
    const heatSetpointC =
      zone?.designHeatT !== undefined
        ? isIp
          ? fahrenheitToCelsius(zone.designHeatT)
          : zone.designHeatT
        : sp.temperature !== undefined
          ? isIp
            ? fahrenheitToCelsius(sp.temperature)
            : sp.temperature
          : defaultHeatC;
    const coolSetpointC =
      zone?.designCoolT !== undefined
        ? isIp
          ? fahrenheitToCelsius(zone.designCoolT)
          : zone.designCoolT
        : Math.max(heatSetpointC + 2.0, defaultCoolC);

    const perf = getDefaultSystemPerf(sys?.type);
    const coolingCop = sys?.coolingCop ?? perf.coolingCop;
    const heatingEff = sys?.heatingEff ?? perf.heatingEff;

    summaries.push({
      spaceName: sp.name,
      volumeM3,
      floorAreaM2,
      cZoneJPerK,
      cWallJPerK: cWall,
      uaWallWPerK: uaWall,
      uaRoofWPerK: uaRoof,
      uaWindowWPerK: uaWindow,
      uaDoorWPerK: uaDoor,
      uaGroundWPerK: uaGround,
      uaExteriorTotalWPerK: uaWall + uaRoof + uaWindow + uaDoor,
      mDotInfKgPerS,
      gInfiltrationWPerK,
      qInternalW,
      windowEffectiveSolarAreaM2,
      sunExposedWallAreaM2,
      wallSolarAbsorptance: sunExposedWallAreaM2 > 0 ? absWeightedSum / sunExposedWallAreaM2 : 0.7,
      heatSetpointC,
      coolSetpointC,
      systemType: sys?.type,
      coolingCop,
      heatingEff,
      hasHvac,
    });
  }

  return summaries;
}

// ─── Steady-State Design-Day Load Solver ─────────────────────────────────────

export interface SteadyStateLoadOptions extends ThermalBuildOptions {
  outdoorTempC: number;
  zoneTempC?: number | undefined;
  groundTempC?: number | undefined;
  solarIrradianceWPerM2?: number | undefined;
  includeInternalGains?: boolean | undefined;
}

export interface SpaceSteadyStateResult {
  spaceName: string;
  uaExteriorWPerK: number;
  uaGroundWPerK: number;
  gInfiltrationWPerK: number;
  totalConductanceWPerK: number;
  qEnvelopeW: number;
  qInfiltrationW: number;
  qInternalW: number;
  qSolarW: number;
  netLoadW: number; // > 0 heating required, < 0 cooling required
  netLoadBtuHr: number;
  hvacInputPowerW: number;
}

export interface SteadyStateLoadResult {
  outdoorTempC: number;
  spaces: SpaceSteadyStateResult[];
  totalNetLoadW: number;
  totalHeatingLoadW: number;
  totalCoolingLoadW: number;
}

/**
 * Computes exact steady-state ASHRAE heat-balance load:
 *   Q_loss = (UA_ext + m_dot_inf * c_p) * (T_zone - T_out) + UA_gnd * (T_zone - T_gnd)
 *   Q_net  = Q_loss - Q_int - Q_solar
 */
export function solveDoe2SteadyState(doc: Doe2Document, options: SteadyStateLoadOptions): SteadyStateLoadResult {
  const summaries = buildSpaceThermalSummaries(doc, options);
  const tOut = options.outdoorTempC;
  const tGnd = options.groundTempC ?? 12.0;
  const iSolar = options.solarIrradianceWPerM2 ?? 0.0;
  const includeInt = options.includeInternalGains ?? true;

  const spaces: SpaceSteadyStateResult[] = [];
  let totalNetLoadW = 0.0;
  let totalHeatingLoadW = 0.0;
  let totalCoolingLoadW = 0.0;

  for (const s of summaries) {
    const tZone = options.zoneTempC ?? s.heatSetpointC;
    const dT = tZone - tOut;
    const qEnvelopeW = s.uaExteriorTotalWPerK * dT + s.uaGroundWPerK * (tZone - tGnd);
    const qInfiltrationW = s.gInfiltrationWPerK * dT;
    const qInternalW = includeInt ? s.qInternalW : 0.0;
    const qSolarW = s.windowEffectiveSolarAreaM2 * iSolar;
    const netLoadW = qEnvelopeW + qInfiltrationW - qInternalW - qSolarW;
    const hvacInputPowerW =
      netLoadW > 0 ? netLoadW / Math.max(0.1, s.heatingEff) : Math.abs(netLoadW) / Math.max(0.1, s.coolingCop);

    totalNetLoadW += netLoadW;
    if (netLoadW > 0) totalHeatingLoadW += netLoadW;
    else totalCoolingLoadW += Math.abs(netLoadW);

    spaces.push({
      spaceName: s.spaceName,
      uaExteriorWPerK: s.uaExteriorTotalWPerK,
      uaGroundWPerK: s.uaGroundWPerK,
      gInfiltrationWPerK: s.gInfiltrationWPerK,
      totalConductanceWPerK: s.uaExteriorTotalWPerK + s.gInfiltrationWPerK,
      qEnvelopeW,
      qInfiltrationW,
      qInternalW,
      qSolarW,
      netLoadW,
      netLoadBtuHr: netLoadW / BTUH_TO_W,
      hvacInputPowerW,
    });
  }

  return {
    outdoorTempC: tOut,
    spaces,
    totalNetLoadW,
    totalHeatingLoadW,
    totalCoolingLoadW,
  };
}

// ─── Transient 24-Hour ASHRAE Heat-Balance Solver ────────────────────────────

export interface Doe2TransientOptions extends ThermalBuildOptions {
  durationHours?: number | undefined; // default 24
  timeStepSeconds?: number | undefined; // default 300 (5 min)
  outdoorMeanTempC?: number | undefined; // default 15.0
  outdoorSwingTempC?: number | undefined; // peak-to-peak swing, default 10.0
  peakSolarIrradianceWPerM2?: number | undefined; // default 600.0
  groundTempC?: number | undefined; // default 12.0
  initialZoneTempC?: number | undefined; // default 20.0
  useWallMass?: boolean | undefined; // default true (3R2C when cWall > 0)
  enableHvac?: boolean | undefined; // default true (false = free-floating)
  hvacGainWPerK?: number | undefined; // default 2500 W/K proportional thermostat
}

export interface Doe2TransientStep {
  timeHours: number;
  outdoorTempC: number;
  solarIrradianceWPerM2: number;
  zoneTempsC: Record<string, number>;
  wallTempsC: Record<string, number>;
  zoneHvacLoadsW: Record<string, number>; // > 0 heating, < 0 cooling
  hvacElectricW: Record<string, number>;
  hvacFuelW: Record<string, number>;
}

export interface Doe2TransientResult {
  title: string;
  spaceNames: string[];
  trajectory: Doe2TransientStep[];
  peakHeatingLoadW: Record<string, number>;
  peakCoolingLoadW: Record<string, number>;
  totalHeatingEnergyKWh: Record<string, number>;
  totalCoolingEnergyKWh: Record<string, number>;
  totalElectricEnergyKWh: Record<string, number>;
  totalFuelEnergyKWh: Record<string, number>;
  minZoneTempsC: Record<string, number>;
  maxZoneTempsC: Record<string, number>;
}

/**
 * Simulates transient 24-hour (or multi-day) building thermal response using 4th-order Runge-Kutta (RK4).
 */
export function simulateDoe2Thermal(doc: Doe2Document, options?: Doe2TransientOptions): Doe2TransientResult {
  const durationHours = options?.durationHours ?? 24.0;
  const dt = options?.timeStepSeconds ?? 300.0;
  const tMean = options?.outdoorMeanTempC ?? 15.0;
  const tSwing = options?.outdoorSwingTempC ?? 10.0;
  const iPeak = options?.peakSolarIrradianceWPerM2 ?? 600.0;
  const tGround = options?.groundTempC ?? 12.0;
  const initT = options?.initialZoneTempC ?? 20.0;
  const useWallMass = options?.useWallMass ?? true;
  const enableHvac = options?.enableHvac ?? true;
  const hvacKp = options?.hvacGainWPerK ?? 2500.0;

  const summaries = buildSpaceThermalSummaries(doc, options);
  const spaceNames = summaries.map((s) => s.spaceName);

  const nSteps = Math.max(1, Math.round((durationHours * 3600.0) / dt));

  const outdoorTempAt = (tSec: number): number => {
    const h = (tSec / 3600.0) % 24.0;
    // Minimum at 04:00, maximum at 16:00
    return tMean - 0.5 * tSwing * Math.cos((2.0 * Math.PI * (h - 4.0)) / 24.0);
  };

  const solarAt = (tSec: number): number => {
    const h = (tSec / 3600.0) % 24.0;
    if (h < 6.0 || h > 18.0) return 0.0;
    return iPeak * Math.sin((Math.PI * (h - 6.0)) / 12.0);
  };

  // Optional first fractional day schedule multiplier for internal gains
  const fracSched = doc.daySchedules.find((d) => (d.type ?? "FRACTION") === "FRACTION" && d.values.length > 0);
  const schedMultAt = (tSec: number): number => {
    if (!fracSched) return 1.0;
    const hIdx = Math.floor((tSec / 3600.0) % 24.0);
    return fracSched.values[hIdx] ?? fracSched.values[fracSched.values.length - 1] ?? 1.0;
  };

  const tZone = summaries.map(() => initT);
  const tWall = summaries.map(() => initT);

  const peakHeatingLoadW: Record<string, number> = {};
  const peakCoolingLoadW: Record<string, number> = {};
  const totalHeatingEnergyKWh: Record<string, number> = {};
  const totalCoolingEnergyKWh: Record<string, number> = {};
  const totalElectricEnergyKWh: Record<string, number> = {};
  const totalFuelEnergyKWh: Record<string, number> = {};
  const minZoneTempsC: Record<string, number> = {};
  const maxZoneTempsC: Record<string, number> = {};

  for (const name of spaceNames) {
    peakHeatingLoadW[name] = 0.0;
    peakCoolingLoadW[name] = 0.0;
    totalHeatingEnergyKWh[name] = 0.0;
    totalCoolingEnergyKWh[name] = 0.0;
    totalElectricEnergyKWh[name] = 0.0;
    totalFuelEnergyKWh[name] = 0.0;
    minZoneTempsC[name] = Infinity;
    maxZoneTempsC[name] = -Infinity;
  }

  const evalSpaceDerivs = (
    idx: number,
    tz: number,
    tw: number,
    tSec: number,
  ): { dTz: number; dTw: number; qHvac: number } => {
    const s = summaries[idx]!;
    const tOut = outdoorTempAt(tSec);
    const iSol = solarAt(tSec);
    const mult = schedMultAt(tSec);

    const hasMass = useWallMass && s.cWallJPerK > 0.0 && s.uaWallWPerK + s.uaRoofWPerK > 0.0;
    const gOpaque = s.uaWallWPerK + s.uaRoofWPerK;
    let qEnvToZone: number;
    let dTw = 0.0;

    if (hasMass) {
      const gHalf = 2.0 * gOpaque;
      const qSolWall = s.sunExposedWallAreaM2 * s.wallSolarAbsorptance * iSol * 0.25;
      const qWallFromOut = gHalf * (tOut - tw) + qSolWall;
      const qWallFromZone = gHalf * (tz - tw);
      dTw = (qWallFromOut + qWallFromZone) / s.cWallJPerK;
      qEnvToZone = gHalf * (tw - tz) + (s.uaWindowWPerK + s.uaDoorWPerK) * (tOut - tz);
    } else {
      qEnvToZone = s.uaExteriorTotalWPerK * (tOut - tz);
    }

    const qGnd = s.uaGroundWPerK * (tGround - tz);
    const qInf = s.gInfiltrationWPerK * (tOut - tz);
    const qSolWin = s.windowEffectiveSolarAreaM2 * iSol;
    const qInt = s.qInternalW * mult;

    let qHvac = 0.0;
    if (enableHvac && s.hasHvac) {
      if (tz < s.heatSetpointC) {
        qHvac = hvacKp * (s.heatSetpointC - tz);
      } else if (tz > s.coolSetpointC) {
        qHvac = hvacKp * (s.coolSetpointC - tz);
      }
    }

    const dTz = (qEnvToZone + qGnd + qInf + qSolWin + qInt + qHvac) / Math.max(1.0, s.cZoneJPerK);
    return { dTz, dTw, qHvac };
  };

  const trajectory: Doe2TransientStep[] = [];

  for (let step = 0; step <= nSteps; step++) {
    const tSec = step * dt;
    const tOut = outdoorTempAt(tSec);
    const iSol = solarAt(tSec);

    const stepZoneTemps: Record<string, number> = {};
    const stepWallTemps: Record<string, number> = {};
    const stepHvacLoads: Record<string, number> = {};
    const stepElec: Record<string, number> = {};
    const stepFuel: Record<string, number> = {};

    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i]!;
      const tz = tZone[i]!;
      const tw = tWall[i]!;
      const { qHvac } = evalSpaceDerivs(i, tz, tw, tSec);

      stepZoneTemps[s.spaceName] = tz;
      stepWallTemps[s.spaceName] = tw;
      stepHvacLoads[s.spaceName] = qHvac;

      const elecW = qHvac < 0 ? Math.abs(qHvac) / Math.max(0.1, s.coolingCop) : 0.0;
      const fuelW = qHvac > 0 ? qHvac / Math.max(0.1, s.heatingEff) : 0.0;
      stepElec[s.spaceName] = elecW;
      stepFuel[s.spaceName] = fuelW;

      if (tz < minZoneTempsC[s.spaceName]!) minZoneTempsC[s.spaceName] = tz;
      if (tz > maxZoneTempsC[s.spaceName]!) maxZoneTempsC[s.spaceName] = tz;

      if (qHvac > peakHeatingLoadW[s.spaceName]!) peakHeatingLoadW[s.spaceName] = qHvac;
      if (qHvac < 0 && Math.abs(qHvac) > peakCoolingLoadW[s.spaceName]!) {
        peakCoolingLoadW[s.spaceName] = Math.abs(qHvac);
      }

      if (step < nSteps) {
        const dtHours = dt / 3600.0;
        if (qHvac > 0) totalHeatingEnergyKWh[s.spaceName]! += (qHvac * dtHours) / 1000.0;
        if (qHvac < 0) totalCoolingEnergyKWh[s.spaceName]! += (Math.abs(qHvac) * dtHours) / 1000.0;
        totalElectricEnergyKWh[s.spaceName]! += (elecW * dtHours) / 1000.0;
        totalFuelEnergyKWh[s.spaceName]! += (fuelW * dtHours) / 1000.0;
      }
    }

    trajectory.push({
      timeHours: tSec / 3600.0,
      outdoorTempC: tOut,
      solarIrradianceWPerM2: iSol,
      zoneTempsC: stepZoneTemps,
      wallTempsC: stepWallTemps,
      zoneHvacLoadsW: stepHvacLoads,
      hvacElectricW: stepElec,
      hvacFuelW: stepFuel,
    });

    if (step === nSteps) break;

    // RK4 advance
    for (let i = 0; i < summaries.length; i++) {
      const tz0 = tZone[i]!;
      const tw0 = tWall[i]!;

      const k1 = evalSpaceDerivs(i, tz0, tw0, tSec);
      const k2 = evalSpaceDerivs(i, tz0 + 0.5 * dt * k1.dTz, tw0 + 0.5 * dt * k1.dTw, tSec + 0.5 * dt);
      const k3 = evalSpaceDerivs(i, tz0 + 0.5 * dt * k2.dTz, tw0 + 0.5 * dt * k2.dTw, tSec + 0.5 * dt);
      const k4 = evalSpaceDerivs(i, tz0 + dt * k3.dTz, tw0 + dt * k3.dTw, tSec + dt);

      tZone[i] = tz0 + (dt / 6.0) * (k1.dTz + 2.0 * k2.dTz + 2.0 * k3.dTz + k4.dTz);
      tWall[i] = tw0 + (dt / 6.0) * (k1.dTw + 2.0 * k2.dTw + 2.0 * k3.dTw + k4.dTw);
    }
  }

  return {
    title: doc.title ?? "DOE2_Building",
    spaceNames,
    trajectory,
    peakHeatingLoadW,
    peakCoolingLoadW,
    totalHeatingEnergyKWh,
    totalCoolingEnergyKWh,
    totalElectricEnergyKWh,
    totalFuelEnergyKWh,
    minZoneTempsC,
    maxZoneTempsC,
  };
}

/**
 * Helper to look up a single construction's thermal properties by name.
 */
export function getConstructionThermalProps(
  doc: Doe2Document,
  constructionName: string,
  options?: ConstructionCalcOptions,
): ConstructionThermalProps | undefined {
  return computeAllConstructionProps(doc, options).get(constructionName.toLowerCase());
}

/**
 * Helper to get a space's summary by name.
 */
export function getSpaceThermalSummary(
  doc: Doe2Document,
  spaceName: string,
  options?: ThermalBuildOptions,
): SpaceThermalSummary | undefined {
  return buildSpaceThermalSummaries(doc, options).find((s) => s.spaceName.toLowerCase() === spaceName.toLowerCase());
}

export type { Doe2Space };
