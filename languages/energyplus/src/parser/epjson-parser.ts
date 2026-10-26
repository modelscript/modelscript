// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/energyplus — Zero-Copy epJSON Parser.
 *
 * Ingests EnergyPlus modern JSON schemas (.epJSON) into the unified EnergyPlusDocument AST.
 */

import type { EnergyPlusDocument, IdfBoundaryCondition, IdfRange, IdfSurfaceType, IdfVertex3D } from "../types.js";

const DEFAULT_RANGE: IdfRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

export function parseEpJson(jsonStr: string, filename?: string): EnergyPlusDocument {
  const data = JSON.parse(jsonStr);

  const doc: EnergyPlusDocument = {
    zones: [],
    materials: [],
    materialsNoMass: [],
    constructions: [],
    surfaces: [],
    fenestrations: [],
    people: [],
    lights: [],
    electricEquipment: [],
    infiltrations: [],
    zoneHvacs: [],
    schedules: [],
    filename,
  };

  // 1. Building
  if (data.Building) {
    const bldgNames = Object.keys(data.Building);
    if (bldgNames.length > 0) {
      const bldgName = bldgNames[0]!;
      const bObj = data.Building[bldgName];
      doc.building = {
        name: bldgName,
        northAxis: bObj.north_axis ?? 0.0,
        terrain: bObj.terrain ?? "Suburbs",
        loadsConvergenceTolerance: bObj.loads_convergence_tolerance_value ?? 0.04,
        temperatureConvergenceTolerance: bObj.temperature_convergence_tolerance_value ?? 0.4,
        solarDistribution: bObj.solar_distribution ?? "FullExterior",
        maximumNumberOfWarmupDays: bObj.maximum_number_of_warmup_days ?? 25,
        minimumNumberOfWarmupDays: bObj.minimum_number_of_warmup_days ?? 6,
        range: DEFAULT_RANGE,
      };
    }
  }

  // 2. Zones
  if (data.Zone) {
    for (const [zoneName, zObj] of Object.entries<any>(data.Zone)) {
      doc.zones.push({
        name: zoneName,
        direction: zObj.direction_of_relative_north ?? 0.0,
        xOrigin: zObj.x_origin ?? 0.0,
        yOrigin: zObj.y_origin ?? 0.0,
        zOrigin: zObj.z_origin ?? 0.0,
        type: zObj.type ?? 1,
        multiplier: zObj.multiplier ?? 1,
        ceilingHeight: zObj.ceiling_height,
        volume: zObj.volume,
        floorArea: zObj.floor_area,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 3. Materials
  if (data.Material) {
    for (const [matName, mObj] of Object.entries<any>(data.Material)) {
      doc.materials.push({
        name: matName,
        roughness: mObj.roughness ?? "MediumRough",
        thickness: mObj.thickness ?? 0.1,
        conductivity: mObj.conductivity ?? 1.0,
        density: mObj.density ?? 2000.0,
        specificHeat: mObj.specific_heat ?? 800.0,
        thermalAbsorptance: mObj.thermal_absorptance,
        solarAbsorptance: mObj.solar_absorptance,
        visibleAbsorptance: mObj.visible_absorptance,
        range: DEFAULT_RANGE,
      });
    }
  }

  if (data["Material:NoMass"]) {
    for (const [matName, mObj] of Object.entries<any>(data["Material:NoMass"])) {
      doc.materialsNoMass.push({
        name: matName,
        roughness: mObj.roughness ?? "Rough",
        thermalResistance: mObj.thermal_resistance ?? 1.0,
        thermalAbsorptance: mObj.thermal_absorptance,
        solarAbsorptance: mObj.solar_absorptance,
        visibleAbsorptance: mObj.visible_absorptance,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 4. Constructions
  if (data.Construction) {
    for (const [constName, cObj] of Object.entries<any>(data.Construction)) {
      const layers: string[] = [];
      if (cObj.outside_layer) layers.push(cObj.outside_layer);
      for (let i = 2; i <= 10; i++) {
        const layerKey = `layer_${i}`;
        if (cObj[layerKey]) layers.push(cObj[layerKey]);
      }
      doc.constructions.push({
        name: constName,
        layers,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 5. Surfaces
  const surfaceTables = [
    data["BuildingSurface:Detailed"],
    data["Wall:Detailed"],
    data["RoofCeiling:Detailed"],
    data["Floor:Detailed"],
  ];
  for (const sTable of surfaceTables) {
    if (!sTable) continue;
    for (const [surfName, sObj] of Object.entries<any>(sTable)) {
      const rawType = sObj.surface_type ?? "Wall";
      let surfaceType: IdfSurfaceType = "Wall";
      if (rawType.toLowerCase() === "roof") surfaceType = "Roof";
      else if (rawType.toLowerCase() === "floor") surfaceType = "Floor";
      else if (rawType.toLowerCase() === "ceiling") surfaceType = "Ceiling";

      const vertices: IdfVertex3D[] = [];
      if (Array.isArray(sObj.vertices)) {
        for (const v of sObj.vertices) {
          vertices.push({
            x: v.vertex_x_coordinate ?? 0.0,
            y: v.vertex_y_coordinate ?? 0.0,
            z: v.vertex_z_coordinate ?? 0.0,
          });
        }
      }

      doc.surfaces.push({
        name: surfName,
        surfaceType,
        constructionName: sObj.construction_name ?? "",
        zoneName: sObj.zone_name ?? "",
        boundaryCondition: (sObj.outside_boundary_condition ?? "Outdoors") as IdfBoundaryCondition,
        outsideBoundaryConditionObject: sObj.outside_boundary_condition_object,
        sunExposure: sObj.sun_exposure === "NoSun" ? "NoSun" : "SunExposed",
        windExposure: sObj.wind_exposure === "NoWind" ? "NoWind" : "WindExposed",
        viewFactorToGround: sObj.view_factor_to_ground,
        vertices,
        range: DEFAULT_RANGE,
      });
    }
  }

  // 6. People, Lights, Equipment
  if (data.People) {
    for (const [pName, pObj] of Object.entries<any>(data.People)) {
      doc.people.push({
        name: pName,
        zoneName: pObj.zone_or_zonelist_or_space_or_spacelist_name ?? pObj.zone_name ?? "",
        numberOfPeopleScheduleName: pObj.number_of_people_schedule_name,
        numberCalculationMethod: pObj.number_of_people_calculation_method ?? "People",
        numberOfPeople: pObj.number_of_people ?? 1.0,
        fractionRadiant: pObj.fraction_radiant ?? 0.3,
        range: DEFAULT_RANGE,
      });
    }
  }

  if (data.Lights) {
    for (const [lName, lObj] of Object.entries<any>(data.Lights)) {
      doc.lights.push({
        name: lName,
        zoneName: lObj.zone_or_zonelist_or_space_or_spacelist_name ?? lObj.zone_name ?? "",
        scheduleName: lObj.schedule_name,
        designLevelCalculationMethod: lObj.design_level_calculation_method ?? "LightingLevel",
        lightingLevel: lObj.lighting_level ?? 100.0,
        fractionRadiant: lObj.fraction_radiant ?? 0.7,
        range: DEFAULT_RANGE,
      });
    }
  }

  if (data.ElectricEquipment) {
    for (const [eName, eObj] of Object.entries<any>(data.ElectricEquipment)) {
      doc.electricEquipment.push({
        name: eName,
        zoneName: eObj.zone_or_zonelist_or_space_or_spacelist_name ?? eObj.zone_name ?? "",
        scheduleName: eObj.schedule_name,
        designLevelCalculationMethod: eObj.design_level_calculation_method ?? "EquipmentLevel",
        designLevel: eObj.design_level ?? 200.0,
        fractionRadiant: eObj.fraction_radiant ?? 0.5,
        range: DEFAULT_RANGE,
      });
    }
  }

  return doc;
}
