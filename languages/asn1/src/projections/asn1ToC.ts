// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from ISO/ITU-T X.680 ASN.1 schemas to C99 header (`typedef struct` / `enum` / tagged `union`).
 */

import { parseAsn1 } from "../parser/asn1-parser.js";
import { buildAsn1TypeGraph } from "../solver/wire-analyzer.js";
import type { Asn1Module, Asn1TypeExpr } from "../types.js";

function cId(name: string): string {
  return name.replace(/-/g, "_");
}

function mapExprToCType(expr: Asn1TypeExpr): string {
  switch (expr.kind) {
    case "primitive":
      switch (expr.primitive) {
        case "BOOLEAN":
          return "bool";
        case "INTEGER":
          return "int64_t";
        case "REAL":
          return "double";
        case "NULL":
          return "uint8_t";
        case "OCTET STRING":
        case "BIT STRING":
          return "asn1_bytes_t";
        case "OBJECT IDENTIFIER":
          return "asn1_oid_t";
        case "UTF8String":
        case "IA5String":
        case "PrintableString":
        case "VisibleString":
        case "NumericString":
        case "UTCTime":
        case "GeneralizedTime":
          return "const char *";
      }
      break;
    case "reference":
      return `${cId(expr.name)}_t`;
    case "tagged":
      return mapExprToCType(expr.inner);
    case "sequenceOf":
    case "setOf":
      return `${mapExprToCType(expr.elementType)} *`;
    case "sequence":
    case "set":
    case "choice":
    case "enumerated":
      return "void *";
  }
}

/**
 * Projects an ASN.1 module into a self-contained C99 header file.
 */
export function asn1ToC(input: string | Asn1Module): string {
  const mod = typeof input === "string" ? parseAsn1(input) : input;
  const guard = `ASN1_${cId(mod.name).toUpperCase()}_H`;
  const graph = buildAsn1TypeGraph(mod);
  const typeByName = new Map(mod.types.map((t) => [t.name, t]));

  const lines: string[] = [
    `/* Generated from ASN.1 module ${mod.name} (C99 projection) */`,
    `#ifndef ${guard}`,
    `#define ${guard}`,
    "",
    "#include <stdbool.h>",
    "#include <stddef.h>",
    "#include <stdint.h>",
    "",
    "typedef struct { const uint8_t *data; size_t len; } asn1_bytes_t;",
    "typedef struct { const uint32_t *arcs; size_t len; } asn1_oid_t;",
    "",
  ];

  for (const name of graph.topologicalOrder) {
    const t = typeByName.get(name);
    if (!t) continue;
    const cname = cId(t.name);
    const expr = t.type.kind === "tagged" ? t.type.inner : t.type;

    if (expr.kind === "enumerated") {
      lines.push(`typedef enum ${cname} {`);
      for (const item of expr.items) {
        lines.push(`  ${cname.toUpperCase()}_${cId(item.name).toUpperCase()} = ${item.value},`);
      }
      lines.push(`} ${cname}_t;`);
      lines.push("");
    } else if (expr.kind === "sequence" || expr.kind === "set") {
      lines.push(`typedef struct ${cname} {`);
      for (const f of expr.fields) {
        if (f.optional) {
          lines.push(`  bool has_${cId(f.name)};`);
        }
        lines.push(`  ${mapExprToCType(f.type)} ${cId(f.name)};`);
      }
      lines.push(`} ${cname}_t;`);
      lines.push("");
    } else if (expr.kind === "choice") {
      lines.push(`typedef enum ${cname}_present {`);
      expr.alternatives.forEach((alt, idx) => {
        lines.push(`  ${cname.toUpperCase()}_PR_${cId(alt.name).toUpperCase()} = ${idx + 1},`);
      });
      lines.push(`} ${cname}_present_t;`);
      lines.push("");
      lines.push(`typedef struct ${cname} {`);
      lines.push(`  ${cname}_present_t present;`);
      lines.push("  union {");
      for (const alt of expr.alternatives) {
        lines.push(`    ${mapExprToCType(alt.type)} ${cId(alt.name)};`);
      }
      lines.push("  } choice;");
      lines.push(`} ${cname}_t;`);
      lines.push("");
    } else if (expr.kind === "sequenceOf" || expr.kind === "setOf") {
      lines.push(`typedef struct ${cname} {`);
      lines.push(`  ${mapExprToCType(expr.elementType)} *items;`);
      lines.push("  size_t count;");
      lines.push(`} ${cname}_t;`);
      lines.push("");
    } else {
      lines.push(`typedef ${mapExprToCType(expr)} ${cname}_t;`);
      lines.push("");
    }
  }

  lines.push(`#endif /* ${guard} */`);
  return lines.join("\n");
}
