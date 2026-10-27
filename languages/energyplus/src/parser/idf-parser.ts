// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/energyplus — Zero-Regex EnergyPlus IDF Parser.
 *
 * Scans and parses EnergyPlus Input Data Files (.idf) with character-by-character
 * streaming, full line/col location tracking, and comment stripping.
 */

import type { EnergyPlusDocument, IdfBoundaryCondition, IdfRange, IdfSurfaceType, IdfVertex3D } from "../types.js";

interface RawIdfField {
  value: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface RawIdfObject {
  objectType: string;
  fields: RawIdfField[];
  range: IdfRange;
}

export function parseIdf(source: string, filename?: string): EnergyPlusDocument {
  const rawObjects = tokenizeIdf(source);

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

  for (const obj of rawObjects) {
    const typeUpper = obj.objectType.toUpperCase();
    const fields = obj.fields;

    switch (typeUpper) {
      case "BUILDING": {
        const name = getFieldStr(fields, 0, "Building");
        doc.building = {
          name,
          northAxis: getFieldNum(fields, 1, 0.0),
          terrain: getFieldStr(fields, 2, "Suburbs"),
          loadsConvergenceTolerance: getFieldNum(fields, 3, 0.04),
          temperatureConvergenceTolerance: getFieldNum(fields, 4, 0.4),
          solarDistribution: getFieldStr(fields, 5, "FullExterior"),
          maximumNumberOfWarmupDays: getFieldNum(fields, 6, 25),
          minimumNumberOfWarmupDays: getFieldNum(fields, 7, 6),
          range: obj.range,
        };
        break;
      }

      case "ZONE": {
        const name = getFieldStr(fields, 0, "Zone");
        doc.zones.push({
          name,
          direction: getFieldNum(fields, 1, 0.0),
          xOrigin: getFieldNum(fields, 2, 0.0),
          yOrigin: getFieldNum(fields, 3, 0.0),
          zOrigin: getFieldNum(fields, 4, 0.0),
          type: getFieldNum(fields, 5, 1),
          multiplier: getFieldNum(fields, 6, 1),
          ceilingHeight: getFieldNumOpt(fields, 7),
          volume: getFieldNumOpt(fields, 8),
          floorArea: getFieldNumOpt(fields, 9),
          range: obj.range,
        });
        break;
      }

      case "MATERIAL": {
        const name = getFieldStr(fields, 0, "Material");
        doc.materials.push({
          name,
          roughness: getFieldStr(fields, 1, "MediumRough"),
          thickness: getFieldNum(fields, 2, 0.1),
          conductivity: getFieldNum(fields, 3, 1.0),
          density: getFieldNum(fields, 4, 2000.0),
          specificHeat: getFieldNum(fields, 5, 800.0),
          thermalAbsorptance: getFieldNumOpt(fields, 6),
          solarAbsorptance: getFieldNumOpt(fields, 7),
          visibleAbsorptance: getFieldNumOpt(fields, 8),
          range: obj.range,
        });
        break;
      }

      case "MATERIAL:NOMASS": {
        const name = getFieldStr(fields, 0, "MaterialNoMass");
        doc.materialsNoMass.push({
          name,
          roughness: getFieldStr(fields, 1, "Rough"),
          thermalResistance: getFieldNum(fields, 2, 1.0),
          thermalAbsorptance: getFieldNumOpt(fields, 3),
          solarAbsorptance: getFieldNumOpt(fields, 4),
          visibleAbsorptance: getFieldNumOpt(fields, 5),
          range: obj.range,
        });
        break;
      }

      case "CONSTRUCTION": {
        const name = getFieldStr(fields, 0, "Construction");
        const layers: string[] = [];
        for (let i = 1; i < fields.length; i++) {
          const layerName = fields[i]?.value.trim();
          if (layerName && layerName.length > 0) {
            layers.push(layerName);
          }
        }
        doc.constructions.push({
          name,
          layers,
          range: obj.range,
        });
        break;
      }

      case "BUILDINGSURFACE:DETAILED":
      case "WALL:DETAILED":
      case "ROOFCEILING:DETAILED":
      case "FLOOR:DETAILED": {
        const name = getFieldStr(fields, 0, "Surface");
        const rawType = getFieldStr(fields, 1, "Wall");
        let surfaceType: IdfSurfaceType = "Wall";
        if (rawType.equalsIgnoreCase("Roof") || typeUpper === "ROOFCEILING:DETAILED") {
          surfaceType = "Roof";
        } else if (rawType.equalsIgnoreCase("Floor") || typeUpper === "FLOOR:DETAILED") {
          surfaceType = "Floor";
        } else if (rawType.equalsIgnoreCase("Ceiling")) {
          surfaceType = "Ceiling";
        }

        const constructionName = getFieldStr(fields, 2, "");
        const zoneName = getFieldStr(fields, 3, "");
        const boundaryCondition = getFieldStr(fields, 4, "Outdoors") as IdfBoundaryCondition;
        const outsideObj = getFieldStrOpt(fields, 5);
        const sunExpRaw = getFieldStr(fields, 6, "SunExposed");
        const windExpRaw = getFieldStr(fields, 7, "WindExposed");
        const sunExposure = sunExpRaw.equalsIgnoreCase("SunExposed") ? "SunExposed" : "NoSun";
        const windExposure = windExpRaw.equalsIgnoreCase("WindExposed") ? "WindExposed" : "NoWind";
        const viewFactorToGround = getFieldNumOpt(fields, 8);
        const numVertices = getFieldNum(fields, 9, 0);

        const vertices: IdfVertex3D[] = [];
        let vertIdx = 10;
        while (vertIdx + 2 < fields.length) {
          const vx = getFieldNum(fields, vertIdx, 0.0);
          const vy = getFieldNum(fields, vertIdx + 1, 0.0);
          const vz = getFieldNum(fields, vertIdx + 2, 0.0);
          vertices.push({ x: vx, y: vy, z: vz });
          vertIdx += 3;
          if (numVertices > 0 && vertices.length >= numVertices) break;
        }

        doc.surfaces.push({
          name,
          surfaceType,
          constructionName,
          zoneName,
          boundaryCondition,
          outsideBoundaryConditionObject: outsideObj,
          sunExposure,
          windExposure,
          viewFactorToGround,
          vertices,
          grossArea: computePolygonArea(vertices),
          range: obj.range,
        });
        break;
      }

      case "FENESTRATIONSURFACE:DETAILED":
      case "WINDOW":
      case "DOOR": {
        const name = getFieldStr(fields, 0, "SubSurface");
        const surfaceType = getFieldStr(fields, 1, "Window") as "Window" | "Door" | "GlassDoor";
        const constructionName = getFieldStr(fields, 2, "");
        const buildingSurfaceName = getFieldStr(fields, 3, "");
        const outsideObj = getFieldStrOpt(fields, 4);

        const vertices: IdfVertex3D[] = [];
        let vertIdx = 9;
        while (vertIdx + 2 < fields.length) {
          const vx = getFieldNum(fields, vertIdx, 0.0);
          const vy = getFieldNum(fields, vertIdx + 1, 0.0);
          const vz = getFieldNum(fields, vertIdx + 2, 0.0);
          vertices.push({ x: vx, y: vy, z: vz });
          vertIdx += 3;
        }

        doc.fenestrations.push({
          name,
          surfaceType,
          constructionName,
          buildingSurfaceName,
          outsideBoundaryConditionObject: outsideObj,
          vertices,
          range: obj.range,
        });
        break;
      }

      case "PEOPLE": {
        const name = getFieldStr(fields, 0, "People");
        const zoneName = getFieldStr(fields, 1, "");
        const scheduleName = getFieldStrOpt(fields, 2);
        const method = getFieldStr(fields, 3, "People") as "People" | "People/Area" | "Area/Person";
        const numberOfPeople = getFieldNum(fields, 4, 1.0);
        const peoplePerFloorArea = getFieldNumOpt(fields, 5);
        const fractionRadiant = getFieldNum(fields, 7, 0.3);

        doc.people.push({
          name,
          zoneName,
          numberOfPeopleScheduleName: scheduleName,
          numberCalculationMethod: method,
          numberOfPeople,
          peoplePerFloorArea,
          fractionRadiant,
          range: obj.range,
        });
        break;
      }

      case "LIGHTS": {
        const name = getFieldStr(fields, 0, "Lights");
        const zoneName = getFieldStr(fields, 1, "");
        const scheduleName = getFieldStrOpt(fields, 2);
        const method = getFieldStr(fields, 3, "LightingLevel") as "LightingLevel" | "Watts/Area" | "Watts/Person";
        const lightingLevel = getFieldNum(fields, 4, 100.0);
        const wattsPerZoneFloorArea = getFieldNumOpt(fields, 5);
        const fractionRadiant = getFieldNum(fields, 7, 0.7);

        doc.lights.push({
          name,
          zoneName,
          scheduleName,
          designLevelCalculationMethod: method,
          lightingLevel,
          wattsPerZoneFloorArea,
          fractionRadiant,
          range: obj.range,
        });
        break;
      }

      case "ELECTRICEQUIPMENT": {
        const name = getFieldStr(fields, 0, "ElectricEquipment");
        const zoneName = getFieldStr(fields, 1, "");
        const scheduleName = getFieldStrOpt(fields, 2);
        const method = getFieldStr(fields, 3, "EquipmentLevel") as "EquipmentLevel" | "Watts/Area" | "Watts/Person";
        const designLevel = getFieldNum(fields, 4, 200.0);
        const fractionRadiant = getFieldNum(fields, 7, 0.5);

        doc.electricEquipment.push({
          name,
          zoneName,
          scheduleName,
          designLevelCalculationMethod: method,
          designLevel,
          fractionRadiant,
          range: obj.range,
        });
        break;
      }

      case "ZONEINFILTRATION:DESIGNFLOWRATE": {
        const name = getFieldStr(fields, 0, "Infiltration");
        const zoneName = getFieldStr(fields, 1, "");
        const scheduleName = getFieldStrOpt(fields, 2);
        const method = getFieldStr(fields, 3, "Flow/Zone") as "Flow/Zone" | "Flow/Area" | "AirChanges/Hour";
        const flowRate = getFieldNumOpt(fields, 4);
        const flowPerArea = getFieldNumOpt(fields, 5);
        const ach = getFieldNumOpt(fields, 7);

        doc.infiltrations.push({
          name,
          zoneName,
          scheduleName,
          flowRateCalculationMethod: method,
          designVolumeFlowRate: flowRate,
          flowPerZoneFloorArea: flowPerArea,
          airChangesPerHour: ach,
          range: obj.range,
        });
        break;
      }

      case "ZONEHVAC:IDEALLOADSAIRSYSTEM":
      case "ZONEHVAC:IDEALLOADAIRSYSTEM":
      case "HVACTEMPLATE:ZONE:IDEALLOADSAIRSYSTEM":
      case "HVACTEMPLATE:ZONE:IDEALLOADAIRSYSTEM": {
        const name = getFieldStr(fields, 0, "IdealLoads");
        const zoneName = getFieldStr(fields, 1, "");
        const coolingLimit = getFieldNumOpt(fields, 4);
        const heatingLimit = getFieldNumOpt(fields, 5);

        doc.zoneHvacs.push({
          name,
          zoneName,
          type: "IdealLoadsAirSystem",
          coolingLimit,
          heatingLimit,
          range: obj.range,
        });
        break;
      }

      case "SCHEDULE:COMPACT":
      case "SCHEDULE:CONSTANT": {
        const name = getFieldStr(fields, 0, "Schedule");
        const limitsName = getFieldStrOpt(fields, 1);
        doc.schedules.push({
          name,
          scheduleTypeLimitsName: limitsName,
          range: obj.range,
        });
        break;
      }
    }
  }

  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenizer / Scanner
// ─────────────────────────────────────────────────────────────────────────────

export function tokenizeIdf(source: string): RawIdfObject[] {
  const objects: RawIdfObject[] = [];
  const len = source.length;
  let idx = 0;
  let line = 1;
  let col = 1;

  function advance(): string {
    const ch = source[idx++];
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch ?? "";
  }

  function peek(): string {
    return source[idx] ?? "";
  }

  while (idx < len) {
    // 1. Skip whitespace and comments
    while (idx < len) {
      const c = peek();
      if (c === "!") {
        // Comment until newline
        while (idx < len && peek() !== "\n") {
          advance();
        }
        if (idx < len && peek() === "\n") {
          advance();
        }
      } else if (/\s/.test(c)) {
        advance();
      } else {
        break;
      }
    }

    if (idx >= len) break;

    // 2. Read object fields separated by ',' and ended by ';'
    const objStartOffset = idx;
    const objStartLine = line;
    const objStartCol = col;

    const rawFields: RawIdfField[] = [];
    let currentFieldChars: string[] = [];
    let fieldStartOffset = idx;
    let fieldStartLine = line;
    let fieldStartCol = col;

    while (idx < len) {
      const c = peek();

      if (c === "!") {
        // Comment inside object
        while (idx < len && peek() !== "\n") {
          advance();
        }
        if (idx < len && peek() === "\n") {
          advance();
        }
        continue;
      }

      if (c === "," || c === ";") {
        advance();
        const fEndOffset = idx - 1;
        const fEndLine = line;
        const fEndCol = col - 1;

        rawFields.push({
          value: currentFieldChars.join("").trim(),
          startOffset: fieldStartOffset,
          endOffset: fEndOffset,
          startLine: fieldStartLine,
          startColumn: fieldStartCol,
          endLine: fEndLine,
          endColumn: fEndCol,
        });

        currentFieldChars = [];
        fieldStartOffset = idx;
        fieldStartLine = line;
        fieldStartCol = col;

        if (c === ";") {
          break; // End of object
        }
      } else {
        currentFieldChars.push(advance());
      }
    }

    if (rawFields.length > 0) {
      const firstField = rawFields[0];
      const objectType = firstField?.value ?? "";
      const objRange: IdfRange = {
        startLine: objStartLine,
        startColumn: objStartCol,
        endLine: line,
        endColumn: col,
        startOffset: objStartOffset,
        endOffset: idx,
      };

      // Remove the first field since it's the object type
      objects.push({
        objectType,
        fields: rawFields.slice(1),
        range: objRange,
      });
    }
  }

  return objects;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface String {
    equalsIgnoreCase(other: string): boolean;
  }
}

String.prototype.equalsIgnoreCase = function (other: string): boolean {
  return this.toLowerCase() === other.toLowerCase();
};

function getFieldStr(fields: RawIdfField[], index: number, defaultValue: string): string {
  const f = fields[index];
  if (!f || f.value.length === 0) return defaultValue;
  return f.value;
}

function getFieldStrOpt(fields: RawIdfField[], index: number): string | undefined {
  const f = fields[index];
  if (!f || f.value.length === 0) return undefined;
  return f.value;
}

function getFieldNum(fields: RawIdfField[], index: number, defaultValue: number): number {
  const f = fields[index];
  if (!f || f.value.length === 0) return defaultValue;
  const num = parseFloat(f.value);
  return isNaN(num) ? defaultValue : num;
}

function getFieldNumOpt(fields: RawIdfField[], index: number): number | undefined {
  const f = fields[index];
  if (!f || f.value.length === 0) return undefined;
  const num = parseFloat(f.value);
  return isNaN(num) ? undefined : num;
}

/**
 * Computes 3D planar polygon area via Newell's method.
 */
function computePolygonArea(vertices: IdfVertex3D[]): number {
  if (vertices.length < 3) return 0.0;
  let nx = 0.0;
  let ny = 0.0;
  let nz = 0.0;
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];
    if (!curr || !next) continue;
    nx += (curr.y - next.y) * (curr.z + next.z);
    ny += (curr.z - next.z) * (curr.x + next.x);
    nz += (curr.x - next.x) * (curr.y + next.y);
  }

  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return 0.5 * length;
}
