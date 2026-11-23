// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic, structural, and X.690 BER/DER canonicality linter for ASN.1 (`ASN11001`–`ASN15006`).
 */

import { Asn1ErrorCode, type Asn1Severity } from "../errors.js";
import { parseAsn1 } from "../parser/asn1-parser.js";
import { decodeBer } from "../parser/ber-der.js";
import { buildAsn1TypeGraph } from "../solver/wire-analyzer.js";
import type { Asn1Constraint, Asn1Field, Asn1Module, Asn1Span, Asn1TypeExpr } from "../types.js";

export interface Asn1Diagnostic {
  code: string;
  rule: string;
  severity: Asn1Severity;
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
}

const BUILTIN_PRIMITIVES = new Set([
  "BOOLEAN",
  "INTEGER",
  "REAL",
  "NULL",
  "OCTET STRING",
  "BIT STRING",
  "OBJECT IDENTIFIER",
  "UTF8String",
  "IA5String",
  "PrintableString",
  "VisibleString",
  "NumericString",
  "UTCTime",
  "GeneralizedTime",
]);

function outerTagSignature(field: Asn1Field, typeMap: Map<string, Asn1TypeExpr>): string {
  if (field.tag) {
    return `${field.tag.tagClass}:${field.tag.number}`;
  }
  return exprTagSignature(field.type, typeMap, new Set());
}

function exprTagSignature(expr: Asn1TypeExpr, typeMap: Map<string, Asn1TypeExpr>, seen: Set<string>): string {
  switch (expr.kind) {
    case "tagged":
      return `${expr.tag.tagClass}:${expr.tag.number}`;
    case "primitive":
      return `UNIVERSAL:${expr.primitive}`;
    case "enumerated":
      return "UNIVERSAL:ENUMERATED";
    case "sequence":
    case "sequenceOf":
      return "UNIVERSAL:SEQUENCE";
    case "set":
    case "setOf":
      return "UNIVERSAL:SET";
    case "choice":
      return "CHOICE";
    case "reference": {
      if (seen.has(expr.name)) return `REF:${expr.name}`;
      const target = typeMap.get(expr.name);
      if (!target) return `REF:${expr.name}`;
      seen.add(expr.name);
      return exprTagSignature(target, typeMap, seen);
    }
  }
}

/**
 * Runs all ASN.1 schema & optional BER/DER wire-sample diagnostics (`ASN11001`–`ASN15006`).
 */
export function lintAsn1(input: string | Asn1Module, berSamples?: Uint8Array[]): Asn1Diagnostic[] {
  const mod = typeof input === "string" ? parseAsn1(input) : input;
  const diags: Asn1Diagnostic[] = [];

  const push = (
    def: { readonly code: string; readonly rule: string; readonly severity: Asn1Severity },
    message: string,
    span?: Asn1Span,
  ): void => {
    diags.push({
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message,
      line: span?.startLine ?? 1,
      column: span?.startColumn ?? 1,
      endLine: span?.endLine,
      endColumn: span?.endColumn,
    });
  };

  // ASN11001: Syntax errors reported by parser
  for (const err of mod.parseErrors) {
    push(Asn1ErrorCode.SYNTAX_ERROR, Asn1ErrorCode.SYNTAX_ERROR.message(err.message), err.span);
  }

  // ASN11002: Missing BEGIN / END
  if (!mod.hasBegin || !mod.hasEnd) {
    push(Asn1ErrorCode.UNTERMINATED_MODULE, Asn1ErrorCode.UNTERMINATED_MODULE.message(mod.name), mod.span);
  }

  // Collect defined + imported symbols & check ASN12001 duplicate types
  const definedTypes = new Map<string, Asn1TypeExpr>();
  const importedSymbols = new Set<string>();
  for (const imp of mod.imports) {
    for (const sym of imp.symbols) importedSymbols.add(sym);
  }

  for (const t of mod.types) {
    if (definedTypes.has(t.name)) {
      push(Asn1ErrorCode.DUPLICATE_TYPE_DEFINITION, Asn1ErrorCode.DUPLICATE_TYPE_DEFINITION.message(t.name), t.span);
    } else {
      definedTypes.set(t.name, t.type);
    }
  }

  const checkConstraint = (c: Asn1Constraint | undefined, context: string): void => {
    if (!c) return;
    if (c.kind === "size") {
      if ((c.min !== undefined && c.min < 0) || (c.max !== undefined && c.max < 0)) {
        push(
          Asn1ErrorCode.INVALID_SIZE_CONSTRAINT,
          Asn1ErrorCode.INVALID_SIZE_CONSTRAINT.message("negative size bound", context),
          c.span,
        );
      } else if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
        push(
          Asn1ErrorCode.INVALID_SIZE_CONSTRAINT,
          Asn1ErrorCode.INVALID_SIZE_CONSTRAINT.message(`${c.min}..${c.max}`, context),
          c.span,
        );
      }
    } else if (c.kind === "range") {
      if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
        push(
          Asn1ErrorCode.INVALID_INTEGER_RANGE,
          Asn1ErrorCode.INVALID_INTEGER_RANGE.message(String(c.min), String(c.max), context),
          c.span,
        );
      }
    }
  };

  const inspectFields = (fields: Asn1Field[], container: string, kind: "sequence" | "set" | "choice"): void => {
    const seenNames = new Set<string>();
    const seenTags = new Map<string, string>();

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      // ASN12002: Duplicate field name
      if (seenNames.has(f.name)) {
        push(Asn1ErrorCode.DUPLICATE_FIELD_NAME, Asn1ErrorCode.DUPLICATE_FIELD_NAME.message(f.name, container), f.span);
      } else {
        seenNames.add(f.name);
      }

      // ASN13002: Duplicate context/explicit tag in CHOICE or SET (or explicit duplicate tags in SEQUENCE)
      if (f.tag) {
        const key = `${f.tag.tagClass}:${f.tag.number}`;
        if (seenTags.has(key)) {
          push(
            Asn1ErrorCode.DUPLICATE_CONTEXT_TAG,
            Asn1ErrorCode.DUPLICATE_CONTEXT_TAG.message(String(f.tag.number), container),
            f.tag.span,
          );
        } else {
          seenTags.set(key, f.name);
        }
      } else if (kind === "choice" || kind === "set") {
        // In CHOICE/SET, untagged alternatives with identical outer tag also collide unless AUTOMATIC TAGS is active
        if (mod.tagDefault !== "AUTOMATIC") {
          const sig = outerTagSignature(f, definedTypes);
          if (sig !== "CHOICE" && seenTags.has(sig)) {
            push(
              Asn1ErrorCode.DUPLICATE_CONTEXT_TAG,
              Asn1ErrorCode.DUPLICATE_CONTEXT_TAG.message(sig, container),
              f.span,
            );
          } else {
            seenTags.set(sig, f.name);
          }
        }
      }

      // ASN13003: Ambiguous consecutive untagged OPTIONAL fields in SEQUENCE (when not AUTOMATIC TAGS)
      if (kind === "sequence" && mod.tagDefault !== "AUTOMATIC" && f.optional && i + 1 < fields.length) {
        const next = fields[i + 1]!;
        if (next.optional && !f.tag && !next.tag) {
          const sig1 = outerTagSignature(f, definedTypes);
          const sig2 = outerTagSignature(next, definedTypes);
          if (sig1 === sig2) {
            push(
              Asn1ErrorCode.AMBIGUOUS_OPTIONAL_FIELDS,
              Asn1ErrorCode.AMBIGUOUS_OPTIONAL_FIELDS.message(f.name, next.name, container),
              next.span,
            );
          }
        }
      }

      inspectTypeExpr(f.type, `${container}.${f.name}`);
    }
  };

  const inspectTypeExpr = (expr: Asn1TypeExpr, context: string): void => {
    switch (expr.kind) {
      case "primitive":
        checkConstraint(expr.constraint, context);
        if (expr.namedNumbers) {
          const seenNames = new Set<string>();
          const seenVals = new Set<number>();
          for (const nn of expr.namedNumbers) {
            if (seenNames.has(nn.name)) {
              push(
                Asn1ErrorCode.DUPLICATE_ENUM_VALUE,
                Asn1ErrorCode.DUPLICATE_ENUM_VALUE.message(`name '${nn.name}'`, context),
                nn.span,
              );
            }
            if (seenVals.has(nn.value)) {
              push(
                Asn1ErrorCode.DUPLICATE_ENUM_VALUE,
                Asn1ErrorCode.DUPLICATE_ENUM_VALUE.message(`value ${nn.value}`, context),
                nn.span,
              );
            }
            seenNames.add(nn.name);
            seenVals.add(nn.value);
          }
        }
        break;
      case "reference":
        checkConstraint(expr.constraint, context);
        if (!definedTypes.has(expr.name) && !importedSymbols.has(expr.name) && !BUILTIN_PRIMITIVES.has(expr.name)) {
          push(
            Asn1ErrorCode.UNDEFINED_TYPE_REFERENCE,
            Asn1ErrorCode.UNDEFINED_TYPE_REFERENCE.message(expr.name, context),
            expr.span,
          );
        }
        break;
      case "tagged":
        inspectTypeExpr(expr.inner, context);
        break;
      case "sequence":
        inspectFields(expr.fields, context, "sequence");
        break;
      case "set":
        inspectFields(expr.fields, context, "set");
        break;
      case "choice":
        inspectFields(expr.alternatives, context, "choice");
        break;
      case "sequenceOf":
      case "setOf":
        checkConstraint(expr.constraint, context);
        inspectTypeExpr(expr.elementType, context);
        break;
      case "enumerated": {
        const seenNames = new Set<string>();
        const seenVals = new Set<number>();
        for (const item of expr.items) {
          if (seenNames.has(item.name)) {
            push(
              Asn1ErrorCode.DUPLICATE_ENUM_VALUE,
              Asn1ErrorCode.DUPLICATE_ENUM_VALUE.message(`name '${item.name}'`, context),
              item.span,
            );
          }
          if (seenVals.has(item.value)) {
            push(
              Asn1ErrorCode.DUPLICATE_ENUM_VALUE,
              Asn1ErrorCode.DUPLICATE_ENUM_VALUE.message(`value ${item.value}`, context),
              item.span,
            );
          }
          seenNames.add(item.name);
          seenVals.add(item.value);
        }
        break;
      }
    }
  };

  for (const t of mod.types) {
    inspectTypeExpr(t.type, t.name);
  }

  // Validate OID value assignments (ASN15004)
  const validateOidArcs = (arcs: number[] | undefined, context: string, span: Asn1Span): void => {
    if (!arcs) return;
    if (arcs.length < 2) {
      push(
        Asn1ErrorCode.INVALID_OID_ARCS,
        Asn1ErrorCode.INVALID_OID_ARCS.message(`'${context}' has fewer than 2 arcs`),
        span,
      );
      return;
    }
    const a0 = arcs[0]!;
    const a1 = arcs[1]!;
    if (a0 < 0 || a0 > 2 || a1 < 0 || (a0 < 2 && a1 > 39)) {
      push(
        Asn1ErrorCode.INVALID_OID_ARCS,
        Asn1ErrorCode.INVALID_OID_ARCS.message(`'${context}' has invalid root arcs (${a0}.${a1})`),
        span,
      );
    }
  };

  if (mod.oidArcs && mod.oidArcs.length > 0) {
    validateOidArcs(mod.oidArcs, mod.name, mod.span);
  }
  for (const v of mod.values) {
    if (v.type.kind === "primitive" && v.type.primitive === "OBJECT IDENTIFIER") {
      validateOidArcs(v.oidArcs, v.name, v.span);
    }
  }

  // ASN13001: Cyclic non-optional type dependency
  const graph = buildAsn1TypeGraph(mod);
  for (const cycle of graph.nonOptionalCycles) {
    push(
      Asn1ErrorCode.CYCLIC_TYPE_DEPENDENCY,
      Asn1ErrorCode.CYCLIC_TYPE_DEPENDENCY.message(cycle.join(" -> ")),
      mod.types.find((t) => t.name === cycle[0])?.span ?? mod.span,
    );
  }

  // Optional BER/DER sample wire validation (ASN15001–ASN15006)
  if (berSamples) {
    for (const sample of berSamples) {
      const res = decodeBer(sample);
      for (const issue of res.derIssues) {
        const def =
          issue.code === "ASN15001"
            ? Asn1ErrorCode.NON_CANONICAL_DER_LENGTH
            : issue.code === "ASN15002"
              ? Asn1ErrorCode.NON_CANONICAL_DER_BOOLEAN
              : issue.code === "ASN15003"
                ? Asn1ErrorCode.NON_CANONICAL_DER_INTEGER
                : issue.code === "ASN15004"
                  ? Asn1ErrorCode.INVALID_OID_ARCS
                  : issue.code === "ASN15005"
                    ? Asn1ErrorCode.TRUNCATED_TLV
                    : Asn1ErrorCode.TRAILING_TLV_BYTES;
        diags.push({
          code: def.code,
          rule: def.rule,
          severity: def.severity,
          message: issue.message,
          line: 1,
          column: issue.offset + 1,
        });
      }
    }
  }

  return diags;
}

export { Asn1ErrorCode } from "../errors.js";
