// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Recursive-Descent MCNP Boolean CSG Expression Parser.
 *
 * MCNP CSG operator precedence (lowest to highest):
 *   1. Union (`:`)
 *   2. Intersection (whitespace juxtaposition)
 *   3. Complement (`#cellId` or `#(expr)`)
 *   4. Primary: signed surface integer (`-1`, `+2`, `3`) or parenthesized `(expr)`
 */

import type { McnpCsgExpr } from "../types.js";

interface CsgToken {
  kind: "int" | "colon" | "hash" | "lparen" | "rparen";
  raw: string;
  value?: number | undefined;
}

function tokenizeCsg(input: string): CsgToken[] {
  const tokens: CsgToken[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "colon", raw: ":" });
      i++;
      continue;
    }
    if (ch === "#") {
      tokens.push({ kind: "hash", raw: "#" });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", raw: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", raw: ")" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "+" || ch === "-") i++;
      const digitStart = i;
      while (i < n && input[i]! >= "0" && input[i]! <= "9") {
        i++;
      }
      if (i === digitStart) {
        throw new Error(`Unexpected sign '${ch}' in CSG expression '${input}'`);
      }
      const raw = input.slice(start, i);
      const val = parseInt(raw, 10);
      if (!Number.isFinite(val) || val === 0) {
        throw new Error(`Invalid surface ID '${raw}' in CSG expression`);
      }
      tokens.push({ kind: "int", raw, value: val });
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in CSG expression '${input}'`);
  }

  return tokens;
}

/**
 * Parses an MCNP Boolean CSG geometry string into a structured `McnpCsgExpr`.
 */
export function parseCsgExpression(input: string): McnpCsgExpr {
  const tokens = tokenizeCsg(input);
  if (tokens.length === 0) {
    throw new Error("Empty CSG expression");
  }

  let pos = 0;

  function peek(): CsgToken | undefined {
    return tokens[pos];
  }

  function consume(): CsgToken {
    const tok = tokens[pos++];
    if (!tok) {
      throw new Error("Unexpected end of CSG expression");
    }
    return tok;
  }

  function parseUnion(): McnpCsgExpr {
    const operands: McnpCsgExpr[] = [parseIntersection()];
    while (peek()?.kind === "colon") {
      consume();
      operands.push(parseIntersection());
    }
    return operands.length === 1 ? operands[0]! : { kind: "union", operands };
  }

  function parseIntersection(): McnpCsgExpr {
    const operands: McnpCsgExpr[] = [parseUnary()];
    while (pos < tokens.length) {
      const next = peek();
      if (!next || next.kind === "colon" || next.kind === "rparen") {
        break;
      }
      operands.push(parseUnary());
    }
    return operands.length === 1 ? operands[0]! : { kind: "intersection", operands };
  }

  function parseUnary(): McnpCsgExpr {
    const tok = peek();
    if (!tok) {
      throw new Error("Expected CSG term");
    }
    if (tok.kind === "hash") {
      consume();
      const next = peek();
      if (!next) {
        throw new Error("Expected cell ID or '(' after '#'");
      }
      if (next.kind === "lparen") {
        consume();
        const inner = parseUnion();
        const close = peek();
        if (!close || close.kind !== "rparen") {
          throw new Error("Unclosed '(' after '#(' in CSG expression");
        }
        consume();
        return { kind: "complement", expr: inner };
      }
      if (next.kind === "int" && next.value !== undefined && next.value > 0) {
        consume();
        return { kind: "complement", cellId: next.value };
      }
      throw new Error(`Invalid complement target '${next.raw}' after '#'`);
    }

    if (tok.kind === "lparen") {
      consume();
      const inner = parseUnion();
      const close = peek();
      if (!close || close.kind !== "rparen") {
        throw new Error("Unclosed '(' in CSG expression");
      }
      consume();
      return inner;
    }

    if (tok.kind === "int" && tok.value !== undefined) {
      consume();
      const sense: 1 | -1 = tok.value < 0 ? -1 : 1;
      return { kind: "surface", id: Math.abs(tok.value), sense };
    }

    throw new Error(`Unexpected token '${tok.raw}' in CSG expression`);
  }

  const expr = parseUnion();
  if (pos < tokens.length) {
    throw new Error(`Unexpected trailing token '${tokens[pos]!.raw}' in CSG expression`);
  }
  return expr;
}

/**
 * Extracts all unique surface IDs referenced in a CSG expression.
 */
export function extractCsgSurfaceRefs(expr: McnpCsgExpr | null): number[] {
  const out = new Set<number>();
  function visit(node: McnpCsgExpr | null | undefined): void {
    if (!node) return;
    if (node.kind === "surface") {
      out.add(node.id);
    } else if (node.kind === "complement") {
      if (node.expr) visit(node.expr);
    } else {
      for (const op of node.operands) visit(op);
    }
  }
  visit(expr);
  return Array.from(out);
}

/**
 * Extracts all unique cell IDs referenced via `#cellId` complement in a CSG expression.
 */
export function extractCsgCellRefs(expr: McnpCsgExpr | null): number[] {
  const out = new Set<number>();
  function visit(node: McnpCsgExpr | null | undefined): void {
    if (!node) return;
    if (node.kind === "complement") {
      if (node.cellId !== undefined) out.add(node.cellId);
      if (node.expr) visit(node.expr);
    } else if (node.kind === "union" || node.kind === "intersection") {
      for (const op of node.operands) visit(op);
    }
  }
  visit(expr);
  return Array.from(out);
}
