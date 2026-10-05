// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeCfdConfig } from "../materializer.js";
import type { CfdDialect, CfdMarker, CfdModelData, MaterializeOptions } from "../types.js";

interface FoamDict {
  [key: string]: string | FoamDict;
}

/**
 * OpenFOAM case dictionary dialect implementation.
 * Supports recursive hierarchical dictionary parsing, boundaryField extraction,
 * and solver directive extraction.
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

export class OpenFoamDialect implements CfdDialect {
  public readonly id = "openfoam";
  public readonly name = "OpenFOAM Case Dictionaries";
  public readonly extensions = [".foam", "controlDict", "fvSchemes", "fvSolution"];

  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeCfdConfig(templateText, options);
  }

  public parse(content: string): CfdModelData {
    const rawDirectives = new Map<string, string>();
    const directives = new Map<string, string>();
    const markers = new Map<string, CfdMarker>();
    const wallMarkers: string[] = [];

    const data: CfdModelData = {
      dialect: this.id,
      wallMarkers,
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
      for (const [patchName, patchVal] of Object.entries(boundaryField)) {
        if (typeof patchVal === "object" && patchVal !== null) {
          const pDict = patchVal as FoamDict;
          const patchType = typeof pDict["type"] === "string" ? (pDict["type"] as string).replace(/;$/, "").trim() : "";
          const pNameLower = patchName.toLowerCase();

          if (patchType === "fixedValue" || pNameLower.includes("inlet")) {
            data.inletMarker = patchName;
            markers.set(patchName, { name: patchName, type: "INLET", options: [patchType] });
            const valStr = typeof pDict["value"] === "string" ? pDict["value"] : "";
            const vecMatch = /\(\s*([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s*\)/.exec(valStr);
            if (vecMatch) {
              data.inletVelocity = [parseFloat(vecMatch[1]!), parseFloat(vecMatch[2]!), parseFloat(vecMatch[3]!)];
            }
          } else if (patchType === "zeroGradient" || patchType === "inletOutlet" || pNameLower.includes("outlet")) {
            data.outletMarker = patchName;
            markers.set(patchName, { name: patchName, type: "OUTLET", options: [patchType] });
          } else if (
            patchType === "noSlip" ||
            patchType === "slip" ||
            patchType === "wall" ||
            pNameLower.includes("wall") ||
            pNameLower.includes("obstacle")
          ) {
            wallMarkers.push(patchName);
            markers.set(patchName, { name: patchName, type: "WALL", options: [patchType] });
          } else {
            markers.set(patchName, { name: patchName, type: patchType.toUpperCase() || "GENERIC", options: [] });
          }
        }
      }
    }

    return data;
  }

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
