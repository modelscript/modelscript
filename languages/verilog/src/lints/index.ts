// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic & RTL discipline linter for IEEE 1364 Verilog (`VLOG1001`–`VLOG5006`).
 */

import { VerilogErrorCode } from "../errors.js";
import type {
  SourceSpan,
  VerilogDesign,
  VerilogDiagnostic,
  VerilogExpr,
  VerilogModule,
  VerilogStmt,
} from "../types.js";

export { VerilogErrorCode };

function getWidthOfTarget(expr: VerilogExpr, mod: VerilogModule): number | undefined {
  if (expr.kind === "identifier") {
    const net = mod.nets.get(expr.name);
    if (net?.range) return Math.abs(net.range.msb - net.range.lsb) + 1;
    const port = mod.ports.get(expr.name);
    if (port?.range) return Math.abs(port.range.msb - port.range.lsb) + 1;
    if (net?.kind === "integer") return 32;
    if (net || port) return 1;
    return undefined;
  }
  if (expr.kind === "index") return 1;
  if (expr.kind === "slice") {
    if (
      expr.msb.kind === "number" &&
      expr.lsb.kind === "number" &&
      expr.msb.numericValue !== undefined &&
      expr.lsb.numericValue !== undefined
    ) {
      return Math.abs(expr.msb.numericValue - expr.lsb.numericValue) + 1;
    }
    return undefined;
  }
  if (expr.kind === "concat") {
    let total = 0;
    for (const el of expr.elements) {
      const w = inferExprWidth(el, mod);
      if (w === undefined) return undefined;
      total += w;
    }
    return total;
  }
  return undefined;
}

function inferExprWidth(expr: VerilogExpr, mod: VerilogModule): number | undefined {
  switch (expr.kind) {
    case "number": {
      if (expr.width !== undefined) return expr.width;
      if (expr.numericValue !== undefined) {
        if (expr.numericValue === 0) return 1;
        return Math.floor(Math.log2(Math.abs(expr.numericValue))) + 1;
      }
      return undefined;
    }
    case "identifier":
      return getWidthOfTarget(expr, mod);
    case "index":
      return 1;
    case "slice":
      return getWidthOfTarget(expr, mod);
    case "unary": {
      if (
        expr.op === "!" ||
        expr.op === "&" ||
        expr.op === "~&" ||
        expr.op === "|" ||
        expr.op === "~|" ||
        expr.op === "^" ||
        expr.op === "~^" ||
        expr.op === "^~"
      ) {
        return 1;
      }
      return inferExprWidth(expr.operand, mod);
    }
    case "binary": {
      if (
        expr.op === "==" ||
        expr.op === "!=" ||
        expr.op === "===" ||
        expr.op === "!==" ||
        expr.op === "<" ||
        expr.op === "<=" ||
        expr.op === ">" ||
        expr.op === ">=" ||
        expr.op === "&&" ||
        expr.op === "||"
      ) {
        return 1;
      }
      const lw = inferExprWidth(expr.left, mod);
      const rw = inferExprWidth(expr.right, mod);
      if (expr.op === "<<" || expr.op === ">>" || expr.op === "<<<" || expr.op === ">>>") {
        return lw;
      }
      if (lw !== undefined && rw !== undefined) return Math.max(lw, rw);
      return lw ?? rw;
    }
    case "ternary": {
      const cw = inferExprWidth(expr.consequent, mod);
      const aw = inferExprWidth(expr.alternate, mod);
      if (cw !== undefined && aw !== undefined) return Math.max(cw, aw);
      return cw ?? aw;
    }
    case "concat": {
      let total = 0;
      for (const el of expr.elements) {
        const w = inferExprWidth(el, mod);
        if (w === undefined) return undefined;
        total += w;
      }
      return total;
    }
    case "replicate": {
      if (expr.count.kind === "number" && expr.count.numericValue !== undefined) {
        let inner = 0;
        for (const el of expr.elements) {
          const w = inferExprWidth(el, mod);
          if (w === undefined) return undefined;
          inner += w;
        }
        return expr.count.numericValue * inner;
      }
      return undefined;
    }
  }
}

function extractRootIdentifiers(expr: VerilogExpr, out: Array<{ name: string; span: SourceSpan }>): void {
  switch (expr.kind) {
    case "identifier":
      out.push({ name: expr.name, span: expr.span });
      break;
    case "index":
      extractRootIdentifiers(expr.target, out);
      extractRootIdentifiers(expr.index, out);
      break;
    case "slice":
      extractRootIdentifiers(expr.target, out);
      extractRootIdentifiers(expr.msb, out);
      extractRootIdentifiers(expr.lsb, out);
      break;
    case "unary":
      extractRootIdentifiers(expr.operand, out);
      break;
    case "binary":
      extractRootIdentifiers(expr.left, out);
      extractRootIdentifiers(expr.right, out);
      break;
    case "ternary":
      extractRootIdentifiers(expr.condition, out);
      extractRootIdentifiers(expr.consequent, out);
      extractRootIdentifiers(expr.alternate, out);
      break;
    case "concat":
      for (const el of expr.elements) extractRootIdentifiers(el, out);
      break;
    case "replicate":
      extractRootIdentifiers(expr.count, out);
      for (const el of expr.elements) extractRootIdentifiers(el, out);
      break;
    case "number":
      break;
  }
}

function extractLValueTargets(expr: VerilogExpr): Array<{ name: string; span: SourceSpan }> {
  if (expr.kind === "identifier") return [{ name: expr.name, span: expr.span }];
  if (expr.kind === "index" || expr.kind === "slice") return extractLValueTargets(expr.target);
  if (expr.kind === "concat") {
    const out: Array<{ name: string; span: SourceSpan }> = [];
    for (const el of expr.elements) out.push(...extractLValueTargets(el));
    return out;
  }
  return [];
}

function isDeclared(name: string, mod: VerilogModule): boolean {
  return mod.ports.has(name) || mod.nets.has(name) || mod.parameters.has(name);
}

function isNetWire(name: string, mod: VerilogModule): boolean {
  const net = mod.nets.get(name);
  if (net) return net.kind === "wire" || net.kind === "tri";
  const port = mod.ports.get(name);
  if (port) {
    if (port.netKind === "reg" || port.netKind === "integer") return false;
    return true; // Default port net type in Verilog is wire
  }
  return false;
}

function isTriNet(name: string, mod: VerilogModule): boolean {
  const net = mod.nets.get(name);
  if (net?.kind === "tri") return true;
  const port = mod.ports.get(name);
  if (port?.netKind === "tri" || port?.direction === "inout") return true;
  return false;
}

/**
 * Lints a parsed `VerilogDesign` and returns all diagnostics (`VLOG1001`–`VLOG5006`).
 */
export function lintVerilog(design: VerilogDesign): VerilogDiagnostic[] {
  const diagnostics: VerilogDiagnostic[] = [...design.syntaxErrors];

  for (const mod of design.modules) {
    // 1. Duplicate ports/nets/parameters (VLOG2001 / VLOG2002)
    for (const dup of mod.duplicateDecls) {
      if (dup.kind === "port") {
        diagnostics.push({
          code: VerilogErrorCode.DUPLICATE_PORT.code,
          rule: VerilogErrorCode.DUPLICATE_PORT.rule,
          severity: VerilogErrorCode.DUPLICATE_PORT.severity,
          message: VerilogErrorCode.DUPLICATE_PORT.message(dup.name, mod.name),
          moduleName: mod.name,
          symbolName: dup.name,
          line: dup.span.line,
          column: dup.span.column,
          startOffset: dup.span.startOffset,
          endOffset: dup.span.endOffset,
        });
      } else {
        diagnostics.push({
          code: VerilogErrorCode.DUPLICATE_NET.code,
          rule: VerilogErrorCode.DUPLICATE_NET.rule,
          severity: VerilogErrorCode.DUPLICATE_NET.severity,
          message: VerilogErrorCode.DUPLICATE_NET.message(dup.name, mod.name),
          moduleName: mod.name,
          symbolName: dup.name,
          line: dup.span.line,
          column: dup.span.column,
          startOffset: dup.span.startOffset,
          endOffset: dup.span.endOffset,
        });
      }
    }

    const reportedUndeclared = new Set<string>();
    const checkIdentifiers = (expr: VerilogExpr): void => {
      const idents: Array<{ name: string; span: SourceSpan }> = [];
      extractRootIdentifiers(expr, idents);
      for (const id of idents) {
        if (!isDeclared(id.name, mod)) {
          const key = `${id.name}@${id.span.line}:${id.span.column}`;
          if (reportedUndeclared.has(key)) continue;
          reportedUndeclared.add(key);
          diagnostics.push({
            code: VerilogErrorCode.UNDECLARED_IDENTIFIER.code,
            rule: VerilogErrorCode.UNDECLARED_IDENTIFIER.rule,
            severity: VerilogErrorCode.UNDECLARED_IDENTIFIER.severity,
            message: VerilogErrorCode.UNDECLARED_IDENTIFIER.message(id.name, mod.name),
            moduleName: mod.name,
            symbolName: id.name,
            line: id.span.line,
            column: id.span.column,
            startOffset: id.span.startOffset,
            endOffset: id.span.endOffset,
          });
        }
      }
    };

    const checkTruncation = (lhs: VerilogExpr, rhs: VerilogExpr, span: SourceSpan): void => {
      const lhsWidth = getWidthOfTarget(lhs, mod);
      const rhsWidth = inferExprWidth(rhs, mod);
      if (lhsWidth !== undefined && rhsWidth !== undefined && rhsWidth > lhsWidth) {
        const targets = extractLValueTargets(lhs);
        const targetName = targets[0]?.name ?? "target";
        diagnostics.push({
          code: VerilogErrorCode.BIT_WIDTH_TRUNCATION.code,
          rule: VerilogErrorCode.BIT_WIDTH_TRUNCATION.rule,
          severity: VerilogErrorCode.BIT_WIDTH_TRUNCATION.severity,
          message: VerilogErrorCode.BIT_WIDTH_TRUNCATION.message(
            targetName,
            String(lhsWidth),
            String(rhsWidth),
            mod.name,
          ),
          moduleName: mod.name,
          symbolName: targetName,
          line: span.line,
          column: span.column,
          startOffset: span.startOffset,
          endOffset: span.endOffset,
        });
      }
    };

    // Track drivers per net/reg for VLOG4002
    const driverCounts = new Map<string, { count: number; span: SourceSpan }>();
    const recordDriver = (name: string, span: SourceSpan): void => {
      const prev = driverCounts.get(name);
      if (prev) {
        prev.count += 1;
        prev.span = span;
      } else {
        driverCounts.set(name, { count: 1, span });
      }
    };

    // Check parameter initializers
    for (const [, p] of mod.parameters) {
      checkIdentifiers(p.value);
    }
    for (const [, net] of mod.nets) {
      if (net.initialValue) checkIdentifiers(net.initialValue);
    }

    // Walk module items
    for (const item of mod.items) {
      if (item.kind === "assign") {
        checkIdentifiers(item.lhs);
        checkIdentifiers(item.rhs);
        checkTruncation(item.lhs, item.rhs, item.span);
        for (const t of extractLValueTargets(item.lhs)) {
          recordDriver(t.name, item.span);
        }
      } else if (item.kind === "gate") {
        for (const p of item.ports) checkIdentifiers(p);
        // First port is output for standard gates (and, nand, or, nor, xor, xnor, buf, not, bufif*, notif*)
        const outPort = item.ports[0];
        if (outPort) {
          for (const t of extractLValueTargets(outPort)) {
            recordDriver(t.name, item.span);
          }
        }
      } else if (item.kind === "instantiation") {
        for (const conn of item.connections) {
          checkIdentifiers(conn.expr);
        }
      } else if (item.kind === "always" || item.kind === "initial") {
        const isSequential =
          item.kind === "always" && item.sensitivity.some((s) => s.kind === "posedge" || s.kind === "negedge");
        const isCombinational = item.kind === "always" && !isSequential;

        if (item.kind === "always") {
          for (const sens of item.sensitivity) {
            if (sens.kind !== "wildcard" && !isDeclared(sens.signal, mod)) {
              diagnostics.push({
                code: VerilogErrorCode.UNDECLARED_IDENTIFIER.code,
                rule: VerilogErrorCode.UNDECLARED_IDENTIFIER.rule,
                severity: VerilogErrorCode.UNDECLARED_IDENTIFIER.severity,
                message: VerilogErrorCode.UNDECLARED_IDENTIFIER.message(sens.signal, mod.name),
                moduleName: mod.name,
                symbolName: sens.signal,
                line: sens.span.line,
                column: sens.span.column,
                startOffset: sens.span.startOffset,
                endOffset: sens.span.endOffset,
              });
            }
          }
        }

        const blockDrivenTargets = new Set<string>();
        const walkStmt = (stmt: VerilogStmt): void => {
          switch (stmt.kind) {
            case "block":
              for (const s of stmt.statements) walkStmt(s);
              break;
            case "if":
              checkIdentifiers(stmt.condition);
              walkStmt(stmt.consequent);
              if (stmt.alternate) walkStmt(stmt.alternate);
              break;
            case "case":
              checkIdentifiers(stmt.expression);
              for (const ci of stmt.items) {
                for (const pat of ci.patterns) checkIdentifiers(pat);
                walkStmt(ci.statement);
              }
              break;
            case "blocking_assign":
            case "nonblocking_assign": {
              checkIdentifiers(stmt.lhs);
              checkIdentifiers(stmt.rhs);
              checkTruncation(stmt.lhs, stmt.rhs, stmt.span);

              const targets = extractLValueTargets(stmt.lhs);
              for (const t of targets) {
                if (item.kind === "always") {
                  blockDrivenTargets.add(t.name);
                }
                // VLOG4001: assigning to wire inside always/initial
                if (isDeclared(t.name, mod) && isNetWire(t.name, mod)) {
                  diagnostics.push({
                    code: VerilogErrorCode.ASSIGN_TO_WIRE_IN_ALWAYS.code,
                    rule: VerilogErrorCode.ASSIGN_TO_WIRE_IN_ALWAYS.rule,
                    severity: VerilogErrorCode.ASSIGN_TO_WIRE_IN_ALWAYS.severity,
                    message: VerilogErrorCode.ASSIGN_TO_WIRE_IN_ALWAYS.message(t.name, mod.name),
                    moduleName: mod.name,
                    symbolName: t.name,
                    line: stmt.span.line,
                    column: stmt.span.column,
                    startOffset: stmt.span.startOffset,
                    endOffset: stmt.span.endOffset,
                  });
                }
                // VLOG3001: blocking assignment in sequential always
                if (isSequential && stmt.kind === "blocking_assign") {
                  diagnostics.push({
                    code: VerilogErrorCode.BLOCKING_IN_SEQUENTIAL.code,
                    rule: VerilogErrorCode.BLOCKING_IN_SEQUENTIAL.rule,
                    severity: VerilogErrorCode.BLOCKING_IN_SEQUENTIAL.severity,
                    message: VerilogErrorCode.BLOCKING_IN_SEQUENTIAL.message(t.name, mod.name),
                    moduleName: mod.name,
                    symbolName: t.name,
                    line: stmt.span.line,
                    column: stmt.span.column,
                    startOffset: stmt.span.startOffset,
                    endOffset: stmt.span.endOffset,
                  });
                }
                // VLOG3002: non-blocking assignment in combinational always
                if (isCombinational && stmt.kind === "nonblocking_assign") {
                  diagnostics.push({
                    code: VerilogErrorCode.NONBLOCKING_IN_COMBINATIONAL.code,
                    rule: VerilogErrorCode.NONBLOCKING_IN_COMBINATIONAL.rule,
                    severity: VerilogErrorCode.NONBLOCKING_IN_COMBINATIONAL.severity,
                    message: VerilogErrorCode.NONBLOCKING_IN_COMBINATIONAL.message(t.name, mod.name),
                    moduleName: mod.name,
                    symbolName: t.name,
                    line: stmt.span.line,
                    column: stmt.span.column,
                    startOffset: stmt.span.startOffset,
                    endOffset: stmt.span.endOffset,
                  });
                }
              }
              break;
            }
            case "empty":
              break;
          }
        };

        walkStmt(item.body);
        for (const name of blockDrivenTargets) {
          recordDriver(name, item.span);
        }
      }
    }

    // VLOG4002: Multiple drivers on non-tri net
    for (const [netName, info] of driverCounts) {
      if (info.count > 1 && !isTriNet(netName, mod)) {
        diagnostics.push({
          code: VerilogErrorCode.MULTIPLE_DRIVERS.code,
          rule: VerilogErrorCode.MULTIPLE_DRIVERS.rule,
          severity: VerilogErrorCode.MULTIPLE_DRIVERS.severity,
          message: VerilogErrorCode.MULTIPLE_DRIVERS.message(netName, String(info.count), mod.name),
          moduleName: mod.name,
          symbolName: netName,
          line: info.span.line,
          column: info.span.column,
          startOffset: info.span.startOffset,
          endOffset: info.span.endOffset,
        });
      }
    }
  }

  return diagnostics;
}
