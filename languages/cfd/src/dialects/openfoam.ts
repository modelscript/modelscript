// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeCfdConfig } from "../materializer.js";
import type { CfdDialect, CfdMarker, CfdModelData, MaterializeOptions } from "../types.js";

/**
 * Recursive key-value tree representation of an OpenFOAM dictionary file.
 */
interface FoamDict {
  [key: string]: string | FoamDict;
}

/**
 * Strips C/C++ style line (`//`) and block (`/* ... *\/`) comments from an OpenFOAM dictionary string
 * while preserving quoted string literals.
 */
function stripComments(source: string): string {
  let result = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        const c = source[i];
        result += c;
        if (c === "\\") {
          i++;
          if (i < len) result += source[i];
        } else if (c === '"') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < len) {
      const next = source[i + 1];
      if (next === "/") {
        i += 2;
        while (i < len && source[i] !== "\n" && source[i] !== "\r") {
          i++;
        }
        continue;
      }
      if (next === "*") {
        i += 2;
        while (i + 1 < len && !(source[i] === "*" && source[i + 1] === "/")) {
          i++;
        }
        i += 2;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
}

/**
 * OpenFOAM case dictionary dialect implementation.
 * Supports recursive hierarchical dictionary parsing, `boundaryField` patch extraction,
 * and solver directive extraction.
 */
export class OpenFoamDialect implements CfdDialect {
  public readonly id = "openfoam";
  public readonly name = "OpenFOAM Case Dictionaries";
  public readonly extensions = [".foam", "controlDict", "fvSchemes", "fvSolution"];

  /**
   * Materializes an OpenFOAM dictionary template by evaluating embedded `{{ ... }}` expressions.
   */
  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeCfdConfig(templateText, options);
  }

  /**
   * Parses an OpenFOAM dictionary into flattened dot-notated directives and classified boundary patches.
   */
  public parse(content: string): CfdModelData {
    const rawDirectives = new Map<string, string>();
    const directives = new Map<string, string>();
    const markers = new Map<string, CfdMarker>();
    const wallMarkers: string[] = [];
    const inletMarkers: string[] = [];
    const outletMarkers: string[] = [];

    const data: CfdModelData = {
      dialect: this.id,
      wallMarkers,
      inletMarkers,
      outletMarkers,
      directives,
      rawDirectives,
      markers,
    };

    // Strip comments
    const stripped = stripComments(content);

    const rootDict = this.parseDictionary(stripped);

    // Flatten dictionary with dot notation and populate directives
    this.flattenDict(rootDict, "", directives, rawDirectives);

    // Extract common OpenFOAM solver directives
    if (typeof rootDict["application"] === "string") {
      data.mathProblem = (rootDict["application"] as string).replace(/;$/, "").trim();
    }

    // Inspect boundaryField for markers
    const boundaryField = rootDict["boundaryField"];
    if (typeof boundaryField === "object" && boundaryField !== null) {
      for (const [rawPatchName, patchVal] of Object.entries(boundaryField)) {
        if (typeof patchVal === "object" && patchVal !== null) {
          const pDict = patchVal as FoamDict;
          const patchName = rawPatchName.replace(/^["']|["']$/g, "").trim();
          const patchType = typeof pDict["type"] === "string" ? (pDict["type"] as string).replace(/;$/, "").trim() : "";
          const pNameLower = patchName.toLowerCase();
          const pTypeLower = patchType.toLowerCase();
          const valStr =
            typeof pDict["value"] === "string"
              ? pDict["value"]
              : typeof pDict["freestreamValue"] === "string"
                ? pDict["freestreamValue"]
                : typeof pDict["inletValue"] === "string"
                  ? pDict["inletValue"]
                  : "";
          const vecMatch = /\(\s*([0-9.eE+-]+)\s+([0-9.eE+-]+)(?:\s+([0-9.eE+-]+))?\s*\)/.exec(valStr);

          const extractVelocityIfPresent = () => {
            if (vecMatch) {
              const vx = parseFloat(vecMatch[1]!);
              const vy = parseFloat(vecMatch[2]!);
              const vz = vecMatch[3] !== undefined ? parseFloat(vecMatch[3]!) : 0.0;
              data.inletVelocity = [vx, vy, vz];
              data.freestreamVelocity = Math.hypot(vx, vy, vz);
            }
          };

          const isSymmetry =
            pTypeLower === "symmetry" ||
            pTypeLower === "symmetryplane" ||
            pTypeLower === "empty" ||
            pTypeLower === "wedge" ||
            pTypeLower === "cyclic" ||
            pTypeLower === "cyclicami" ||
            pNameLower.includes("symm") ||
            pNameLower.includes("frontandback");

          const isWall =
            pTypeLower === "noslip" ||
            pTypeLower === "slip" ||
            pTypeLower === "wall" ||
            pTypeLower === "movingwallvelocity" ||
            pTypeLower === "fixedfluxpressure" ||
            pNameLower.includes("wall") ||
            pNameLower.includes("obstacle") ||
            pNameLower.includes("wing") ||
            pNameLower.includes("airfoil") ||
            pNameLower.includes("body") ||
            pNameLower.includes("cylinder") ||
            pNameLower.includes("chassis") ||
            pNameLower.includes("hull") ||
            pNameLower.includes("rotor") ||
            pNameLower.includes("blade");

          const isExplicitOutlet =
            pNameLower.includes("outlet") ||
            pNameLower.includes("exit") ||
            pNameLower.includes("outflow") ||
            pTypeLower === "inletoutlet" ||
            pTypeLower === "pressureinletoutletvelocity" ||
            pTypeLower === "totalpressure" ||
            pTypeLower === "advective" ||
            pTypeLower === "wavetransmissive";

          const isExplicitInlet =
            pNameLower.includes("inlet") ||
            pNameLower.includes("inflow") ||
            pTypeLower === "surfacenormalfixedvalue" ||
            pTypeLower === "flowrateinletvelocity" ||
            pTypeLower === "turbulentinlet";

          const isFarfield =
            pNameLower.includes("farfield") ||
            pNameLower.includes("freestream") ||
            pTypeLower === "freestream" ||
            pTypeLower === "freestreamvelocity" ||
            pTypeLower === "freestreampressure";

          if (isSymmetry) {
            markers.set(patchName, { name: patchName, type: "SYMMETRY", options: [patchType] });
          } else if (isWall) {
            if (!wallMarkers.includes(patchName)) wallMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "WALL", options: [patchType] });
          } else if (isExplicitOutlet) {
            data.outletMarker = patchName;
            if (!outletMarkers.includes(patchName)) outletMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "OUTLET", options: [patchType] });
          } else if (isExplicitInlet) {
            data.inletMarker = patchName;
            if (!inletMarkers.includes(patchName)) inletMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "INLET", options: [patchType] });
            extractVelocityIfPresent();
          } else if (isFarfield) {
            markers.set(patchName, { name: patchName, type: "FARFIELD", options: [patchType] });
            if (data.freestreamVelocity === undefined) {
              extractVelocityIfPresent();
            }
          } else if (pTypeLower === "fixedvalue" && vecMatch) {
            // Vector fixedValue (velocity boundary) without an explicit outlet/wall/farfield name
            data.inletMarker = patchName;
            if (!inletMarkers.includes(patchName)) inletMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "INLET", options: [patchType] });
            extractVelocityIfPresent();
          } else if (pTypeLower === "zerogradient" && data.outletMarker === undefined) {
            data.outletMarker = patchName;
            if (!outletMarkers.includes(patchName)) outletMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "OUTLET", options: [patchType] });
          } else if (pTypeLower === "patch") {
            markers.set(patchName, { name: patchName, type: "PATCH", options: [patchType] });
          } else {
            markers.set(patchName, {
              name: patchName,
              type: patchType.toUpperCase() || "GENERIC",
              options: [patchType],
            });
          }
        }
      }
    }

    return data;
  }

  /**
   * Recursively parses nested `{ ... }` OpenFOAM sub-dictionaries and semicolon-terminated entries.
   */
  private parseDictionary(text: string, state: { pos: number } = { pos: 0 }): FoamDict {
    const dict: FoamDict = {};

    const skipWhitespace = () => {
      while (state.pos < text.length && /\s/.test(text[state.pos]!)) state.pos++;
    };

    while (state.pos < text.length) {
      skipWhitespace();
      if (state.pos >= text.length || text[state.pos] === "}") break;

      // Read key identifier
      const keyStart = state.pos;
      while (state.pos < text.length && !/\s|[;{}]/.test(text[state.pos]!)) state.pos++;
      const key = text.slice(keyStart, state.pos).trim();
      if (!key) {
        state.pos++;
        continue;
      }

      skipWhitespace();
      if (state.pos >= text.length) break;

      if (text[state.pos] === "{") {
        state.pos++; // skip '{'
        dict[key] = this.parseDictionary(text, state);
        skipWhitespace();
        if (state.pos < text.length && text[state.pos] === "}") {
          state.pos++; // skip '}'
        }
      } else {
        const valStart = state.pos;
        while (state.pos < text.length && text[state.pos] !== ";" && text[state.pos] !== "}") state.pos++;
        const val = text.slice(valStart, state.pos).trim();
        dict[key] = val;
        if (state.pos < text.length && text[state.pos] === ";") state.pos++;
      }
    }

    return dict;
  }

  /**
   * Flattens a hierarchical `FoamDict` into dot-separated key paths in `directives` and `rawDirectives`.
   */
  private flattenDict(
    dict: FoamDict,
    prefix: string,
    directives: Map<string, string>,
    rawDirectives: Map<string, string>,
  ): void {
    for (const [key, val] of Object.entries(dict)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (typeof val === "string") {
        directives.set(fullKey, val);
        rawDirectives.set(fullKey, val);
        if (prefix === "") {
          directives.set(key, val);
          rawDirectives.set(key, val);
        }
      } else if (typeof val === "object" && val !== null) {
        this.flattenDict(val as FoamDict, fullKey, directives, rawDirectives);
      }
    }
  }
}
