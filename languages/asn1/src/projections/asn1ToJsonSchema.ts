// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from ISO/ITU-T X.680 ASN.1 schemas to JSON Schema (Draft 2020-12).
 */

import { parseAsn1 } from "../parser/asn1-parser.js";
import type { Asn1Module, Asn1TypeExpr } from "../types.js";

function mapExprToJsonSchema(expr: Asn1TypeExpr): Record<string, unknown> {
  switch (expr.kind) {
    case "tagged":
      return {
        ...mapExprToJsonSchema(expr.inner),
        "x-asn1-tag": `[${expr.tag.tagClass === "CONTEXT" ? "" : `${expr.tag.tagClass} `}${expr.tag.number}]`,
      };
    case "reference":
      return { $ref: `#/$defs/${expr.name}` };
    case "primitive": {
      switch (expr.primitive) {
        case "BOOLEAN":
          return { type: "boolean" };
        case "INTEGER": {
          const out: Record<string, unknown> = { type: "integer" };
          if (expr.constraint?.kind === "range" || expr.constraint?.kind === "singleValue") {
            if (expr.constraint.min !== undefined) out["minimum"] = expr.constraint.min;
            if (expr.constraint.max !== undefined) out["maximum"] = expr.constraint.max;
          }
          return out;
        }
        case "REAL":
          return { type: "number" };
        case "NULL":
          return { type: "null" };
        case "OBJECT IDENTIFIER":
          return { type: "string", pattern: "^[0-2](\\.[0-9]+)+$" };
        case "OCTET STRING":
        case "BIT STRING": {
          const out: Record<string, unknown> = { type: "string", contentEncoding: "base64" };
          if (expr.constraint?.kind === "size") {
            if (expr.constraint.min !== undefined) out["x-asn1-min-size"] = expr.constraint.min;
            if (expr.constraint.max !== undefined) out["x-asn1-max-size"] = expr.constraint.max;
          }
          return out;
        }
        case "UTF8String":
        case "IA5String":
        case "PrintableString":
        case "VisibleString":
        case "NumericString":
        case "UTCTime":
        case "GeneralizedTime": {
          const out: Record<string, unknown> = { type: "string" };
          if (expr.constraint?.kind === "size") {
            if (expr.constraint.min !== undefined) out["minLength"] = expr.constraint.min;
            if (expr.constraint.max !== undefined) out["maxLength"] = expr.constraint.max;
          }
          return out;
        }
      }
      break;
    }
    case "enumerated":
      return { type: "string", enum: expr.items.map((it) => it.name) };
    case "sequence":
    case "set": {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const f of expr.fields) {
        properties[f.name] = mapExprToJsonSchema(f.type);
        if (!f.optional) required.push(f.name);
      }
      const out: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: Boolean(expr.extensible),
      };
      if (required.length > 0) out["required"] = required;
      return out;
    }
    case "choice":
      return {
        oneOf: expr.alternatives.map((alt) => ({
          type: "object",
          properties: { [alt.name]: mapExprToJsonSchema(alt.type) },
          required: [alt.name],
          additionalProperties: false,
        })),
      };
    case "sequenceOf":
    case "setOf": {
      const out: Record<string, unknown> = {
        type: "array",
        items: mapExprToJsonSchema(expr.elementType),
      };
      if (expr.kind === "setOf") out["uniqueItems"] = true;
      if (expr.constraint?.kind === "size") {
        if (expr.constraint.min !== undefined) out["minItems"] = expr.constraint.min;
        if (expr.constraint.max !== undefined) out["maxItems"] = expr.constraint.max;
      }
      return out;
    }
  }
}

/**
 * Projects an ASN.1 module into a JSON Schema Draft 2020-12 object.
 */
export function asn1ToJsonSchema(input: string | Asn1Module): Record<string, unknown> {
  const mod = typeof input === "string" ? parseAsn1(input) : input;
  const defs: Record<string, unknown> = {};
  for (const t of mod.types) {
    defs[t.name] = mapExprToJsonSchema(t.type);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: mod.name,
    $defs: defs,
  };
}
