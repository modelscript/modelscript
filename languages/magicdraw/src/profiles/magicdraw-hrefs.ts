// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room Interoperability Lookup Table for Well-Known OMG & MagicDraw `href` References.
 *
 * Resolves external `href` URIs pointing into standard OMG UML/SysML specifications or
 * well-known MagicDraw / Cameo standard profile fragment IDs into canonical primitive types
 * and QUDV units without requiring proprietary `.mdzip` standard library files on disk.
 */

import { lookupQudvUnit } from "./qudv-units.js";
import { lookupUmlPrimitive } from "./uml-standard.js";

export interface ResolvedHref {
  name: string;
  isPrimitive: boolean;
  unit?: string | undefined;
  source: "omg-spec" | "magicdraw-std-shim" | "qudv" | "workspace-module";
}

/**
 * Well-known fragment IDs observed in public OMG UML/SysML XMI & MagicDraw exports
 * for standard primitive types.
 */
const KNOWN_FRAGMENT_MAP: Readonly<Record<string, ResolvedHref>> = {
  // OMG UML 2.5 PrimitiveTypes.xmi fragments
  Real: { name: "Real", isPrimitive: true, source: "omg-spec" },
  Integer: { name: "Integer", isPrimitive: true, source: "omg-spec" },
  Boolean: { name: "Boolean", isPrimitive: true, source: "omg-spec" },
  String: { name: "String", isPrimitive: true, source: "omg-spec" },
  UnlimitedNatural: { name: "UnlimitedNatural", isPrimitive: true, source: "omg-spec" },

  // OMG SysML 1.x DataType fragments
  "SysML_dataType.Real": { name: "Real", isPrimitive: true, source: "omg-spec" },
  "SysML_dataType.Integer": { name: "Integer", isPrimitive: true, source: "omg-spec" },
  "SysML_dataType.Boolean": { name: "Boolean", isPrimitive: true, source: "omg-spec" },
  "SysML_dataType.String": { name: "String", isPrimitive: true, source: "omg-spec" },
  "SysML_dataType.Number": { name: "Real", isPrimitive: true, source: "omg-spec" },
  "SysML_dataType.Complex": { name: "Complex", isPrimitive: true, source: "omg-spec" },

  // Well-known MagicDraw UML_Standard_Profile / SysML primitive type fragment IDs
  _11_5EAPbeta_be00301_1147431819399_50461_1671: { name: "Real", isPrimitive: true, source: "magicdraw-std-shim" },
  _9_0_62a020a_1105704885343_144138_7929: { name: "Real", isPrimitive: true, source: "magicdraw-std-shim" },
  _9_0_62a020a_1105704885251_933969_7897: { name: "Integer", isPrimitive: true, source: "magicdraw-std-shim" },
  _9_0_62a020a_1105704884807_371561_7741: { name: "Boolean", isPrimitive: true, source: "magicdraw-std-shim" },
  _9_0_62a020a_1105704885419_608295_7953: { name: "String", isPrimitive: true, source: "magicdraw-std-shim" },
  _9_0_62a020a_1105704885130_859421_7853: {
    name: "UnlimitedNatural",
    isPrimitive: true,
    source: "magicdraw-std-shim",
  },
  _16_5_1_12c903cd_1245676177526_859436_110: { name: "Real", isPrimitive: true, source: "magicdraw-std-shim" },
};

/**
 * Attempts to resolve an external XMI `href` (e.g. `http://www.omg.org/spec/UML/...#Real`
 * or `SysML.mdzip#_11_5EAPbeta_...`) using clean-room OMG/QUDV/MagicDraw tables.
 */
export function resolveStandardHref(href: string): ResolvedHref | undefined {
  if (!href) return undefined;
  const hashIdx = href.indexOf("#");
  const fragment = hashIdx >= 0 ? href.slice(hashIdx + 1).trim() : href.trim();
  const baseUri = hashIdx >= 0 ? href.slice(0, hashIdx) : "";

  const direct = KNOWN_FRAGMENT_MAP[fragment];
  if (direct) return direct;

  // Check if fragment ends with a known primitive name (e.g. "PrimitiveTypes::Real" or "dataType.Real")
  const tail = fragment.split(/[.:/]/).pop() ?? fragment;
  const prim = lookupUmlPrimitive(tail);
  if (prim) {
    return {
      name: prim.name,
      isPrimitive: true,
      source: /omg\.org/i.test(baseUri) ? "omg-spec" : "magicdraw-std-shim",
    };
  }

  // Check QUDV / ISO-80000 unit references
  const unit = lookupQudvUnit(tail);
  if (unit && /(qudv|iso[-_]?80000|unit|sysml)/i.test(href)) {
    return {
      name: unit.name,
      isPrimitive: false,
      unit: unit.symbol,
      source: "qudv",
    };
  }

  return undefined;
}
