// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Wavefront MTL (Material Template Library) Parser.
 *
 * Supports:
 *   - `newmtl <name>`
 *   - Color properties: `Ka`, `Kd`, `Ks`, `Ke` (RGB triplets or single grayscale value)
 *   - Scalar properties: `Ns` (shininess), `d` (dissolve/opacity), `Tr` (transparency),
 *     `Ni` (index of refraction), `illum` (illumination model 0..10)
 *   - Texture maps: `map_Kd`, `map_Ka`, `map_Ks`, `map_Bump` / `bump`
 *   - Comments (`#`)
 */

import type { MtlDocument, MtlMaterial, ObjParseError, RgbColor } from "../types.js";

function parseNumberStrict(token: string): number {
  const v = Number(token);
  return Number.isFinite(v) ? v : Number.NaN;
}

function parseRgb(args: string[]): RgbColor | null {
  if (args.length === 1) {
    const g = parseNumberStrict(args[0]!);
    if (Number.isNaN(g)) return null;
    return [g, g, g];
  }
  if (args.length >= 3) {
    const r = parseNumberStrict(args[0]!);
    const g = parseNumberStrict(args[1]!);
    const b = parseNumberStrict(args[2]!);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

/**
 * Parse a Wavefront MTL text document into an `MtlDocument`.
 */
export function parseMtl(source: string): MtlDocument {
  const rawLines = source.split(/\r?\n/);
  const materials = new Map<string, MtlMaterial>();
  const errors: ObjParseError[] = [];

  let current: MtlMaterial | null = null;
  let offset = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? "";
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1;

    const lineNum = i + 1;
    const hashIdx = raw.indexOf("#");
    const stripped = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim();
    if (!stripped) continue;

    const parts = stripped.split(/\s+/);
    const keyword = parts[0] ?? "";
    const args = parts.slice(1);

    if (keyword === "newmtl") {
      const name = args.join(" ").trim();
      if (!name) {
        errors.push({
          line: lineNum,
          column: 1,
          message: `MTL directive 'newmtl' requires a material name`,
          raw,
        });
        continue;
      }
      current = {
        name,
        propertyLines: {},
        line: lineNum,
        startOffset,
        endOffset,
      };
      materials.set(name, current);
      continue;
    }

    if (!current) {
      errors.push({
        line: lineNum,
        column: 1,
        message: `MTL property '${keyword}' appears before any 'newmtl' declaration`,
        raw,
      });
      continue;
    }

    current.endOffset = endOffset;

    switch (keyword) {
      case "Ka":
      case "Kd":
      case "Ks":
      case "Ke": {
        const rgb = parseRgb(args);
        if (!rgb) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `MTL color directive '${keyword}' expects 1 or 3 numeric components`,
            raw,
          });
          break;
        }
        current[keyword] = rgb;
        current.propertyLines[keyword] = lineNum;
        break;
      }

      case "Ns":
      case "Ni": {
        const val = args[0] !== undefined ? parseNumberStrict(args[0]) : Number.NaN;
        if (Number.isNaN(val)) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `MTL directive '${keyword}' expects a numeric value`,
            raw,
          });
          break;
        }
        current[keyword] = val;
        current.propertyLines[keyword] = lineNum;
        break;
      }

      case "d": {
        // Optional `-halo` flag before numeric dissolve value
        const token = args[0] === "-halo" ? args[1] : args[0];
        const val = token !== undefined ? parseNumberStrict(token) : Number.NaN;
        if (Number.isNaN(val)) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `MTL directive 'd' expects a numeric dissolve value`,
            raw,
          });
          break;
        }
        current.d = val;
        current.Tr = 1 - val;
        current.propertyLines["d"] = lineNum;
        break;
      }

      case "Tr": {
        const val = args[0] !== undefined ? parseNumberStrict(args[0]) : Number.NaN;
        if (Number.isNaN(val)) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `MTL directive 'Tr' expects a numeric transparency value`,
            raw,
          });
          break;
        }
        current.Tr = val;
        current.d = 1 - val;
        current.propertyLines["Tr"] = lineNum;
        break;
      }

      case "illum": {
        const val = args[0] !== undefined && /^\d+$/.test(args[0]) ? Number.parseInt(args[0], 10) : Number.NaN;
        if (Number.isNaN(val) || val < 0 || val > 10) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `MTL directive 'illum' expects an integer between 0 and 10`,
            raw,
          });
          break;
        }
        current.illum = val;
        current.propertyLines["illum"] = lineNum;
        break;
      }

      case "map_Kd":
        current.mapKd = args.join(" ");
        break;
      case "map_Ka":
        current.mapKa = args.join(" ");
        break;
      case "map_Ks":
        current.mapKs = args.join(" ");
        break;
      case "map_Bump":
      case "bump":
        current.mapBump = args.join(" ");
        break;

      default: {
        // Unknown optional MTL extension directives (e.g. Tf, Pr, Pm) are tolerated unless malformed
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyword)) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Invalid MTL directive '${keyword}'`,
            raw,
          });
        }
        break;
      }
    }
  }

  return {
    materials,
    errors,
    rawLines,
  };
}
