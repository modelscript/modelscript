// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for USACE HEC-HMS basin and project files (.basin, .hms).
 */

import type {
  HmsBasinModel,
  HmsJunction,
  HmsReach,
  HmsReservoir,
  HmsSink,
  HmsSubbasin,
  HmsUnitSystem,
} from "../types.js";

/**
 * Parses a HEC-HMS .basin model file.
 */
export function parseHmsBasin(content: string): HmsBasinModel {
  let basinName = "BasinModel";
  let unitSystem: HmsUnitSystem = "Metric";

  const subbasins = new Map<string, HmsSubbasin>();
  const reaches = new Map<string, HmsReach>();
  const junctions = new Map<string, HmsJunction>();
  const reservoirs = new Map<string, HmsReservoir>();
  const sinks = new Map<string, HmsSink>();

  // Normalize lines and parse blocks
  const lines = content.split(/\r?\n/);
  let currentBlockType: string | null = null;
  let currentBlockName: string | null = null;
  let currentProps = new Map<string, string>();

  function flushBlock(): void {
    if (!currentBlockType || !currentBlockName) return;

    const type = currentBlockType.trim();
    const name = currentBlockName.trim();

    if (type === "Basin") {
      basinName = name;
      const units = currentProps.get("Unit System");
      if (units && units.toLowerCase().includes("customary")) {
        unitSystem = "U.S. Customary";
      } else {
        unitSystem = "Metric";
      }
    } else if (type === "Subbasin") {
      const existing = subbasins.get(name) ?? {
        name,
        area: 0,
        downstream: "",
      };
      if (currentProps.has("Area")) {
        existing.area = Number.parseFloat(currentProps.get("Area")!) || 0;
      }
      if (currentProps.has("Downstream")) {
        existing.downstream = currentProps.get("Downstream")!;
      }
      if (currentProps.has("Loss")) {
        existing.lossMethod = currentProps.get("Loss")!;
      }
      if (currentProps.has("Transform")) {
        existing.transformMethod = currentProps.get("Transform")!;
      }
      if (currentProps.has("Baseflow")) {
        existing.baseflowMethod = currentProps.get("Baseflow")!;
      }
      subbasins.set(name, existing);
    } else if (type === "Subbasin-Loss") {
      const existing = subbasins.get(name) ?? { name, area: 0, downstream: "" };
      if (currentProps.has("Curve Number")) {
        existing.curveNumber = Number.parseFloat(currentProps.get("Curve Number")!);
      }
      if (currentProps.has("Initial Abstraction")) {
        existing.initialAbstraction = Number.parseFloat(currentProps.get("Initial Abstraction")!);
      }
      if (currentProps.has("Impervious")) {
        existing.imperviousPercent = Number.parseFloat(currentProps.get("Impervious")!);
      }
      subbasins.set(name, existing);
    } else if (type === "Subbasin-Transform") {
      const existing = subbasins.get(name) ?? { name, area: 0, downstream: "" };
      if (currentProps.has("Lag")) {
        existing.lagMinutes = Number.parseFloat(currentProps.get("Lag")!);
      }
      if (currentProps.has("Time of Concentration")) {
        existing.timeOfConcentrationHours = Number.parseFloat(currentProps.get("Time of Concentration")!);
      }
      if (currentProps.has("Storage Coefficient")) {
        existing.storageCoefficientHours = Number.parseFloat(currentProps.get("Storage Coefficient")!);
      }
      subbasins.set(name, existing);
    } else if (type === "Reach") {
      const existing = reaches.get(name) ?? {
        name,
        downstream: currentProps.get("Downstream") ?? "",
        routingMethod: currentProps.get("Route"),
      };
      reaches.set(name, existing);
    } else if (type === "Reach-Route") {
      const existing = reaches.get(name) ?? { name, downstream: "" };
      if (currentProps.has("Muskingum K")) {
        existing.muskingumK = Number.parseFloat(currentProps.get("Muskingum K")!);
      }
      if (currentProps.has("Muskingum X")) {
        existing.muskingumX = Number.parseFloat(currentProps.get("Muskingum X")!);
      }
      if (currentProps.has("Subreaches")) {
        existing.subreaches = Number.parseInt(currentProps.get("Subreaches")!, 10);
      }
      reaches.set(name, existing);
    } else if (type === "Junction") {
      junctions.set(name, {
        name,
        downstream: currentProps.get("Downstream") ?? "",
      });
    } else if (type === "Reservoir") {
      reservoirs.set(name, {
        name,
        downstream: currentProps.get("Downstream") ?? "",
      });
    } else if (type === "Sink") {
      sinks.set(name, {
        name,
      });
    }

    currentBlockType = null;
    currentBlockName = null;
    currentProps = new Map();
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    if (line === "End:" || line === "End") {
      flushBlock();
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();

      if (!currentBlockType) {
        // This is a block header: e.g. "Subbasin: Upper Watershed"
        currentBlockType = key;
        currentBlockName = val;
      } else {
        // Property inside a block: e.g. "Area: 12.5"
        currentProps.set(key, val);
      }
    }
  }

  flushBlock();

  return {
    name: basinName,
    unitSystem,
    subbasins,
    reaches,
    junctions,
    reservoirs,
    sinks,
  };
}
