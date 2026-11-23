// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from ISO/ITU-T X.680 ASN.1 schemas to ITU-T Z.100 SDL-88 `NEWTYPE` / `SYNTYPE` definitions.
 */

import { parseAsn1 } from "../parser/asn1-parser.js";
import type { Asn1Module, Asn1TypeExpr } from "../types.js";

function sdlId(name: string): string {
  return name.replace(/-/g, "_");
}

function mapExprToSdlSort(expr: Asn1TypeExpr): string {
  switch (expr.kind) {
    case "primitive":
      switch (expr.primitive) {
        case "BOOLEAN":
          return "Boolean";
        case "INTEGER":
          return "Integer";
        case "REAL":
          return "Real";
        case "NULL":
          return "Boolean";
        case "OCTET STRING":
        case "BIT STRING":
        case "OBJECT IDENTIFIER":
        case "UTF8String":
        case "IA5String":
        case "PrintableString":
        case "VisibleString":
        case "NumericString":
        case "UTCTime":
        case "GeneralizedTime":
          return "Charstring";
      }
      break;
    case "reference":
      return sdlId(expr.name);
    case "tagged":
      return mapExprToSdlSort(expr.inner);
    case "sequenceOf":
    case "setOf":
      return `String(${mapExprToSdlSort(expr.elementType)})`;
    case "sequence":
    case "set":
    case "choice":
    case "enumerated":
      return "Charstring";
  }
}

/**
 * Projects an ASN.1 module into ITU-T Z.100 SDL-88 `NEWTYPE` and `SYNTYPE` declarations.
 */
export function asn1ToSdl(input: string | Asn1Module): string {
  const mod = typeof input === "string" ? parseAsn1(input) : input;
  const lines: string[] = [];
  lines.push(`/* Generated from ASN.1 module ${mod.name} (ITU-T Z.105 / SDL-88 NEWTYPE projection) */`);
  lines.push(`PACKAGE ${sdlId(mod.name)};`);
  lines.push("");

  for (const t of mod.types) {
    const typeName = sdlId(t.name);
    const expr = t.type.kind === "tagged" ? t.type.inner : t.type;

    if (expr.kind === "sequence" || expr.kind === "set") {
      lines.push(`NEWTYPE ${typeName}`);
      lines.push("  STRUCT");
      for (const f of expr.fields) {
        const optComment = f.optional ? " /* OPTIONAL */" : "";
        lines.push(`    ${sdlId(f.name)} ${mapExprToSdlSort(f.type)};${optComment}`);
      }
      lines.push(`ENDNEWTYPE ${typeName};`);
      lines.push("");
    } else if (expr.kind === "choice") {
      lines.push(`NEWTYPE ${typeName}`);
      lines.push("  STRUCT");
      lines.push("    present Integer;");
      for (const alt of expr.alternatives) {
        lines.push(`    ${sdlId(alt.name)} ${mapExprToSdlSort(alt.type)}; /* CHOICE alternative */`);
      }
      lines.push(`ENDNEWTYPE ${typeName};`);
      lines.push("");
    } else if (expr.kind === "enumerated") {
      const lits = expr.items.map((it) => sdlId(it.name)).join(", ");
      lines.push(`NEWTYPE ${typeName}`);
      lines.push(`  LITERALS ${lits || "none"};`);
      lines.push(`ENDNEWTYPE ${typeName};`);
      lines.push("");
    } else if (expr.kind === "sequenceOf" || expr.kind === "setOf") {
      lines.push(`NEWTYPE ${typeName}`);
      lines.push(`  String(${mapExprToSdlSort(expr.elementType)}, empty);`);
      lines.push(`ENDNEWTYPE ${typeName};`);
      lines.push("");
    } else {
      const baseSort = mapExprToSdlSort(expr);
      if (
        expr.kind === "primitive" &&
        expr.constraint?.kind === "range" &&
        expr.constraint.min !== undefined &&
        expr.constraint.max !== undefined
      ) {
        lines.push(`SYNTYPE ${typeName} = ${baseSort}`);
        lines.push(`  CONSTANTS ${expr.constraint.min}:${expr.constraint.max};`);
        lines.push(`ENDSYNTYPE ${typeName};`);
      } else {
        lines.push(`SYNTYPE ${typeName} = ${baseSort} ENDSYNTYPE ${typeName};`);
      }
      lines.push("");
    }
  }

  lines.push(`ENDPACKAGE ${sdlId(mod.name)};`);
  return lines.join("\n");
}
