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
    const inletMarkers: string[] = [];
    const outletMarkers: string[] = [];
    const wallMarkers: string[] = [];

    const data: CfdModelData = {
      dialect: this.id,
      wallMarkers,
      inletMarkers,
      outletMarkers,
      directives: rawDirectives,
      rawDirectives,
      markers,
    };

    for (const line of lines) {
      // Strip comments (% or #)
      let cleanLine = line;
      const commentIdx = cleanLine.search(/[%#]/);
      if (commentIdx !== -1) {
        cleanLine = cleanLine.substring(0, commentIdx);
      }
      const trimmed = cleanLine.trim();
      if (!trimmed) continue;

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
        data.meshFilename = val.replace(/^["']|["']$/g, "").trim();
      } else if (key === "FREESTREAM_DENSITY") {
        data.density = parseFloat(val);
      } else if (key === "FREESTREAM_VISCOSITY") {
        data.viscosity = parseFloat(val);
      } else if (key === "FREESTREAM_VELOCITY") {
        const tupleMatch = val.match(/\(\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)(?:\s*,\s*([0-9.eE+-]+))?\s*\)/);
        if (tupleMatch) {
          const vx = parseFloat(tupleMatch[1]);
          const vy = parseFloat(tupleMatch[2]);
          const vz = tupleMatch[3] !== undefined ? parseFloat(tupleMatch[3]) : 0.0;
          data.inletVelocity = [vx, vy, vz];
          data.freestreamVelocity = Math.sqrt(vx * vx + vy * vy + vz * vz);
        }
      } else if (key.startsWith("MARKER_")) {
        const type = key.replace(/^MARKER_/, "");
        const openParen = val.indexOf("(");
        const closeParen = val.lastIndexOf(")");
        if (openParen !== -1 && closeParen > openParen) {
          const parts = val
            .substring(openParen + 1, closeParen)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          if (parts.length === 0) continue;

          if (key === "MARKER_EULER" || key === "MARKER_FARFIELD" || key === "MARKER_SYM") {
            // Can specify a list of marker names: ( name1, name2, ... )
            for (const markerName of parts) {
              markers.set(markerName, { name: markerName, type, options: [] });
              if (key === "MARKER_EULER" && !wallMarkers.includes(markerName)) {
                wallMarkers.push(markerName);
              }
            }
          } else if (key === "MARKER_HEATFLUX" || key === "MARKER_ISOTHERMAL") {
            // Can specify pairs: ( name1, val1, name2, val2 ) or single name, val
            if (parts.length >= 2) {
              for (let p = 0; p < parts.length; p += 2) {
                const markerName = parts[p];
                const optVal =
                  p + 1 < parts.length ? (!isNaN(Number(parts[p + 1])) ? Number(parts[p + 1]) : parts[p + 1]) : 0;
                markers.set(markerName, { name: markerName, type, options: [optVal] });
                if (!wallMarkers.includes(markerName)) {
                  wallMarkers.push(markerName);
                }
              }
            } else {
              const markerName = parts[0];
              markers.set(markerName, { name: markerName, type, options: [0] });
              if (!wallMarkers.includes(markerName)) {
                wallMarkers.push(markerName);
              }
            }
          } else {
            const markerName = parts[0];
            const options = parts.slice(1).map((s) => (!isNaN(Number(s)) ? Number(s) : s));
            markers.set(markerName, { name: markerName, type, options });

            if (key === "MARKER_INLET") {
              data.inletMarker = markerName;
              if (!inletMarkers.includes(markerName)) inletMarkers.push(markerName);
              if (options.length >= 1 && data.freestreamVelocity === undefined) {
                const velMag = typeof options[0] === "number" ? options[0] : parseFloat(String(options[0]));
                if (!isNaN(velMag)) {
                  data.freestreamVelocity = velMag;
                  if (options.length >= 4) {
                    const nx = Number(options[1]) || 0;
                    const ny = Number(options[2]) || 0;
                    const nz = Number(options[3]) || 0;
                    data.inletVelocity = [velMag * nx, velMag * ny, velMag * nz];
                  }
                }
              }
            } else if (key === "MARKER_OUTLET") {
              data.outletMarker = markerName;
              if (!outletMarkers.includes(markerName)) outletMarkers.push(markerName);
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
