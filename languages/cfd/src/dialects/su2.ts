// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeCfdConfig } from "../materializer.js";
import type { CfdDialect, CfdMarker, CfdModelData, MaterializeOptions } from "../types.js";

/**
 * SU2 (.cfg) CFD configuration dialect implementation.
 */
export class Su2Dialect implements CfdDialect {
  public readonly id = "su2";
  public readonly name = "SU2 CFD Configuration";
  public readonly extensions = [".cfg"];

  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeCfdConfig(templateText, options);
  }

  public parse(cfgText: string): CfdModelData {
    const lines = cfgText.split(/\r?\n/);

    const rawDirectives = new Map<string, string>();
    const markers = new Map<string, CfdMarker>();

    const data: CfdModelData = {
      dialect: this.id,
      wallMarkers: [],
      directives: rawDirectives,
      rawDirectives,
      markers,
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("%") || trimmed.startsWith("#")) {
        continue;
      }

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;

      const key = trimmed.substring(0, eqIdx).trim().toUpperCase();
      const val = trimmed.substring(eqIdx + 1).trim();

      data.rawDirectives.set(key, val);

      if (key === "MATH_PROBLEM") {
        data.mathProblem = val;
      } else if (key === "MACH_NUMBER") {
        data.machNumber = parseFloat(val);
      } else if (key === "AOA") {
        data.aoa = parseFloat(val);
      } else if (key === "REYNOLDS_NUMBER") {
        data.reynoldsNumber = parseFloat(val);
      } else if (key === "MESH_FILENAME") {
        data.meshFilename = val.replace(/^["']|["']$/g, "");
      } else if (key === "FREESTREAM_DENSITY") {
        data.density = parseFloat(val);
      } else if (key === "FREESTREAM_VISCOSITY") {
        data.viscosity = parseFloat(val);
      } else if (key === "FREESTREAM_VELOCITY") {
        const tupleMatch = val.match(/\(\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*\)/);
        if (tupleMatch) {
          const vx = parseFloat(tupleMatch[1]);
          const vy = parseFloat(tupleMatch[2]);
          const vz = parseFloat(tupleMatch[3]);
          data.inletVelocity = [vx, vy, vz];
          data.freestreamVelocity = Math.sqrt(vx * vx + vy * vy + vz * vz);
        }
      } else if (key.startsWith("MARKER_")) {
        const type = key.replace(/^MARKER_/, "");
        const tupleMatch = val.match(/\(\s*([^)]+)\s*\)/);
        if (tupleMatch) {
          const parts = tupleMatch[1].split(",").map((s) => s.trim());
          const markerName = parts[0];
          const options = parts.slice(1).map((s) => (!isNaN(Number(s)) ? Number(s) : s));
          markers.set(markerName, { name: markerName, type, options });

          if (key === "MARKER_INLET") {
            data.inletMarker = markerName;
          } else if (key === "MARKER_OUTLET") {
            data.outletMarker = markerName;
          } else if (key === "MARKER_HEATFLUX" || key === "MARKER_ISOTHERMAL" || key === "MARKER_EULER") {
            if (!data.wallMarkers.includes(markerName)) {
              data.wallMarkers.push(markerName);
            }
          }
        }
      }
    }

    return data;
  }
}

/**
 * Convenience helper to parse an SU2 (.cfg) CFD configuration deck.
 */
export function parseSu2Config(cfgText: string): CfdModelData {
  return new Su2Dialect().parse(cfgText);
}

/**
 * Convenience helper to materialize an SU2 (.cfg) CFD configuration template.
 */
export function materializeSu2Config(templateText: string, options?: MaterializeOptions): string {
  return new Su2Dialect().materialize(templateText, options);
}

export type Su2ConfigData = CfdModelData;
