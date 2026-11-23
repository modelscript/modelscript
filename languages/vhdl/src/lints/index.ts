// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Static Analysis & Linter Engine for `@modelscript/vhdl` (`VHDL1001`–`VHDL5006`).
 */

import { VhdlErrorCode, type VhdlDiagnostic } from "../errors.js";
import { computeRangeWidth, parseVhdl } from "../parser/vhdl-parser.js";
import type {
  VhdlArchitecture,
  VhdlConcStmt,
  VhdlDesignFile,
  VhdlEntity,
  VhdlExpr,
  VhdlPortDecl,
  VhdlSeqStmt,
  VhdlSignalDecl,
  VhdlSpan,
  VhdlTypeRef,
} from "../types.js";

const BUILTIN_IDENTS = new Set([
  "others",
  "all",
  "open",
  "true",
  "false",
  "rising_edge",
  "falling_edge",
  "unsigned",
  "signed",
  "std_logic_vector",
  "to_integer",
  "to_unsigned",
  "to_signed",
  "to_bit",
  "to_stdlogicvector",
  "conv_integer",
  "conv_std_logic_vector",
  "resize",
]);

function makeDiag(
  spec: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
  message: string,
  span: VhdlSpan,
  entityName?: string,
): VhdlDiagnostic {
  return {
    code: spec.code,
    id: spec.id,
    rule: spec.rule,
    severity: spec.severity,
    message,
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    entityName,
  };
}

function collectExprReads(expr: VhdlExpr, reads: Array<{ name: string; span?: VhdlSpan | undefined }>): void {
  switch (expr.kind) {
    case "ident":
      reads.push({ name: expr.name, span: expr.span });
      break;
    case "index":
      reads.push({ name: expr.target, span: expr.span });
      collectExprReads(expr.index, reads);
      break;
    case "slice":
      reads.push({ name: expr.target, span: expr.span });
      collectExprReads(expr.range.left, reads);
      collectExprReads(expr.range.right, reads);
      break;
    case "attribute":
      reads.push({ name: expr.target, span: expr.span });
      break;
    case "unary":
      collectExprReads(expr.operand, reads);
      break;
    case "binary":
      collectExprReads(expr.left, reads);
      collectExprReads(expr.right, reads);
      break;
    case "call":
      for (const a of expr.args) collectExprReads(a, reads);
      break;
    case "others":
      collectExprReads(expr.value, reads);
      break;
    case "aggregate":
      for (const el of expr.elements) collectExprReads(el.value, reads);
      break;
    default:
      break;
  }
}

function inferExprWidth(expr: VhdlExpr, widths: Map<string, number>): number | undefined {
  switch (expr.kind) {
    case "charLiteral":
      return 1;
    case "bitString": {
      if (expr.base === "X") return expr.value.length * 4;
      if (expr.base === "O") return expr.value.length * 3;
      return expr.value.length;
    }
    case "ident":
      return widths.get(expr.name.toLowerCase());
    case "index":
      return 1;
    case "slice":
      return computeRangeWidth(expr.range);
    case "unary":
      return expr.op === "not" ? inferExprWidth(expr.operand, widths) : undefined;
    case "binary": {
      if (expr.op === "&") {
        const lw = inferExprWidth(expr.left, widths);
        const rw = inferExprWidth(expr.right, widths);
        return lw !== undefined && rw !== undefined ? lw + rw : undefined;
      }
      if (
        expr.op === "and" ||
        expr.op === "or" ||
        expr.op === "nand" ||
        expr.op === "nor" ||
        expr.op === "xor" ||
        expr.op === "xnor"
      ) {
        return inferExprWidth(expr.left, widths) ?? inferExprWidth(expr.right, widths);
      }
      return undefined;
    }
    case "call": {
      const lower = expr.name.toLowerCase();
      if ((lower === "to_unsigned" || lower === "to_signed" || lower === "resize") && expr.args.length >= 2) {
        const widthArg = expr.args[1];
        if (widthArg && widthArg.kind === "intLiteral") return widthArg.value;
      }
      if ((lower === "std_logic_vector" || lower === "unsigned" || lower === "signed") && expr.args.length === 1) {
        return inferExprWidth(expr.args[0]!, widths);
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function isClockCondition(expr: VhdlExpr): boolean {
  if (expr.kind === "call") {
    const n = expr.name.toLowerCase();
    return n === "rising_edge" || n === "falling_edge";
  }
  if (expr.kind === "attribute" && expr.attr.toLowerCase() === "event") {
    return true;
  }
  if (expr.kind === "binary" && expr.op === "and") {
    return isClockCondition(expr.left) || isClockCondition(expr.right);
  }
  return false;
}

function isClockedProcess(stmts: VhdlSeqStmt[]): boolean {
  for (const s of stmts) {
    if (s.kind === "if") {
      if (isClockCondition(s.condition)) return true;
      for (const ei of s.elsifs) {
        if (isClockCondition(ei.condition)) return true;
      }
      if (isClockedProcess(s.thenBranch)) return true;
      if (s.elseBranch && isClockedProcess(s.elseBranch)) return true;
    }
  }
  return false;
}

/**
 * Computes the set of signals unconditionally assigned across all paths of a statement list,
 * and the set of signals assigned in at least one path.
 */
function analyzeLatchPaths(stmts: VhdlSeqStmt[]): { mustAssign: Set<string>; mayAssign: Set<string> } {
  const mustAssign = new Set<string>();
  const mayAssign = new Set<string>();

  for (const s of stmts) {
    if (s.kind === "signalAssign") {
      const n = s.target.name.toLowerCase();
      mustAssign.add(n);
      mayAssign.add(n);
    } else if (s.kind === "if") {
      const branchResults = [analyzeLatchPaths(s.thenBranch)];
      for (const ei of s.elsifs) branchResults.push(analyzeLatchPaths(ei.body));
      if (s.elseBranch) {
        branchResults.push(analyzeLatchPaths(s.elseBranch));
      } else {
        // Missing else branch means no signal is unconditionally assigned by this if
        branchResults.push({ mustAssign: new Set(), mayAssign: new Set() });
      }
      for (const br of branchResults) {
        for (const sig of br.mayAssign) mayAssign.add(sig);
      }
      const first = branchResults[0]!;
      for (const sig of first.mustAssign) {
        if (branchResults.every((br) => br.mustAssign.has(sig))) {
          mustAssign.add(sig);
        }
      }
    } else if (s.kind === "case") {
      const hasOthers = s.alternatives.some((a) => a.choices.some((c) => c.toLowerCase() === "others"));
      const branchResults = s.alternatives.map((a) => analyzeLatchPaths(a.body));
      if (!hasOthers) {
        branchResults.push({ mustAssign: new Set(), mayAssign: new Set() });
      }
      for (const br of branchResults) {
        for (const sig of br.mayAssign) mayAssign.add(sig);
      }
      if (branchResults.length > 0) {
        const first = branchResults[0]!;
        for (const sig of first.mustAssign) {
          if (branchResults.every((br) => br.mustAssign.has(sig))) {
            mustAssign.add(sig);
          }
        }
      }
    }
  }

  return { mustAssign, mayAssign };
}

/**
 * Runs all static analysis & synthesis checks (`VHDL1001`–`VHDL5006`) on a VHDL design file or source text.
 */
export function lintVhdl(input: VhdlDesignFile | string): VhdlDiagnostic[] {
  const design = typeof input === "string" ? parseVhdl(input) : input;
  const diags: VhdlDiagnostic[] = [];

  // 1. VHDL1001: Syntax errors
  for (const err of design.parseErrors) {
    diags.push(makeDiag(VhdlErrorCode.SYNTAX_ERROR, VhdlErrorCode.SYNTAX_ERROR.message(err.message), err.span));
  }

  // Index entities
  const entitiesByLower = new Map<string, VhdlEntity>();
  for (const ent of design.entities) {
    entitiesByLower.set(ent.name.toLowerCase(), ent);

    // VHDL1002: Mismatched entity end name
    if (ent.endName && ent.endName.toLowerCase() !== ent.name.toLowerCase()) {
      diags.push(
        makeDiag(
          VhdlErrorCode.MISMATCHED_END_NAME,
          VhdlErrorCode.MISMATCHED_END_NAME.message("entity", ent.name, ent.endName),
          ent.span,
          ent.name,
        ),
      );
    }

    // VHDL2001: Duplicate generics & ports
    const seen = new Set<string>();
    for (const g of ent.generics) {
      const k = g.name.toLowerCase();
      if (seen.has(k)) {
        diags.push(
          makeDiag(
            VhdlErrorCode.DUPLICATE_DECLARATION,
            VhdlErrorCode.DUPLICATE_DECLARATION.message("generic", g.name, ent.name),
            g.span,
            ent.name,
          ),
        );
      }
      seen.add(k);
    }
    for (const p of ent.ports) {
      const k = p.name.toLowerCase();
      if (seen.has(k)) {
        diags.push(
          makeDiag(
            VhdlErrorCode.DUPLICATE_DECLARATION,
            VhdlErrorCode.DUPLICATE_DECLARATION.message("port", p.name, ent.name),
            p.span,
            ent.name,
          ),
        );
      }
      seen.add(k);
    }
  }

  // Package end-name checks
  for (const pkg of design.packages) {
    if (pkg.endName && pkg.endName.toLowerCase() !== pkg.name.toLowerCase()) {
      diags.push(
        makeDiag(
          VhdlErrorCode.MISMATCHED_END_NAME,
          VhdlErrorCode.MISMATCHED_END_NAME.message("package", pkg.name, pkg.endName),
          pkg.span,
        ),
      );
    }
  }
  for (const pb of design.packageBodies) {
    if (pb.endName && pb.endName.toLowerCase() !== pb.name.toLowerCase()) {
      diags.push(
        makeDiag(
          VhdlErrorCode.MISMATCHED_END_NAME,
          VhdlErrorCode.MISMATCHED_END_NAME.message("package body", pb.name, pb.endName),
          pb.span,
        ),
      );
    }
  }

  // Collect package enum/constant names
  const globalSymbols = new Set<string>();
  for (const pkg of design.packages) {
    for (const c of pkg.constants) globalSymbols.add(c.name.toLowerCase());
    for (const t of pkg.types) {
      globalSymbols.add(t.name.toLowerCase());
      for (const lit of t.enumLiterals ?? []) globalSymbols.add(lit.toLowerCase());
    }
  }

  // Analyze architectures
  for (const arch of design.architectures) {
    lintArchitecture(arch, entitiesByLower, globalSymbols, diags);
  }

  return diags;
}

function lintArchitecture(
  arch: VhdlArchitecture,
  entitiesByLower: Map<string, VhdlEntity>,
  globalSymbols: Set<string>,
  diags: VhdlDiagnostic[],
): void {
  // VHDL1002: Mismatched architecture end name
  if (arch.endName && arch.endName.toLowerCase() !== arch.name.toLowerCase()) {
    diags.push(
      makeDiag(
        VhdlErrorCode.MISMATCHED_END_NAME,
        VhdlErrorCode.MISMATCHED_END_NAME.message("architecture", arch.name, arch.endName),
        arch.span,
        arch.entityName,
      ),
    );
  }

  // VHDL2003: Architecture references unknown entity (only if file declares entities)
  const entity = entitiesByLower.get(arch.entityName.toLowerCase());
  if (!entity && entitiesByLower.size > 0) {
    diags.push(
      makeDiag(
        VhdlErrorCode.ENTITY_NOT_FOUND,
        VhdlErrorCode.ENTITY_NOT_FOUND.message(arch.name, arch.entityName),
        arch.span,
        arch.entityName,
      ),
    );
  }

  // Build symbol tables
  const ports = new Map<string, VhdlPortDecl>();
  const signals = new Map<string, VhdlSignalDecl>();
  const declared = new Set<string>(globalSymbols);
  const widths = new Map<string, number>();
  const typeByName = new Map<string, VhdlTypeRef>();

  if (entity) {
    for (const g of entity.generics) {
      const k = g.name.toLowerCase();
      declared.add(k);
      if (g.type.width !== undefined) widths.set(k, g.type.width);
    }
    for (const p of entity.ports) {
      const k = p.name.toLowerCase();
      ports.set(k, p);
      declared.add(k);
      typeByName.set(k, p.type);
      if (p.type.width !== undefined) widths.set(k, p.type.width);
    }
  }

  const seenArchDecls = new Set<string>();
  for (const s of arch.signals) {
    const k = s.name.toLowerCase();
    if (seenArchDecls.has(k) || ports.has(k)) {
      diags.push(
        makeDiag(
          VhdlErrorCode.DUPLICATE_DECLARATION,
          VhdlErrorCode.DUPLICATE_DECLARATION.message("signal", s.name, arch.name),
          s.span,
          arch.entityName,
        ),
      );
    }
    seenArchDecls.add(k);
    signals.set(k, s);
    declared.add(k);
    typeByName.set(k, s.type);
    if (s.type.width !== undefined) widths.set(k, s.type.width);
  }

  for (const c of arch.constants) {
    const k = c.name.toLowerCase();
    if (seenArchDecls.has(k)) {
      diags.push(
        makeDiag(
          VhdlErrorCode.DUPLICATE_DECLARATION,
          VhdlErrorCode.DUPLICATE_DECLARATION.message("constant", c.name, arch.name),
          c.span,
          arch.entityName,
        ),
      );
    }
    seenArchDecls.add(k);
    declared.add(k);
    if (c.type.width !== undefined) widths.set(k, c.type.width);
  }

  for (const t of arch.types) {
    declared.add(t.name.toLowerCase());
    for (const lit of t.enumLiterals ?? []) {
      declared.add(lit.toLowerCase());
    }
  }

  const componentsByLower = new Map(arch.components.map((c) => [c.name.toLowerCase(), c]));
  const driverCounts = new Map<string, { count: number; span: VhdlSpan; name: string }>();
  const readSignals = new Set<string>();

  const recordDriver = (name: string, span: VhdlSpan): void => {
    const k = name.toLowerCase();
    const cur = driverCounts.get(k);
    if (cur) {
      cur.count++;
    } else {
      driverCounts.set(k, { count: 1, span, name });
    }
  };

  const checkRead = (name: string, span: VhdlSpan, localScope: Set<string>): void => {
    const k = name.toLowerCase();
    if (BUILTIN_IDENTS.has(k) || localScope.has(k)) return;
    if (!declared.has(k)) {
      diags.push(
        makeDiag(
          VhdlErrorCode.UNDEFINED_IDENTIFIER,
          VhdlErrorCode.UNDEFINED_IDENTIFIER.message(name, arch.name),
          span,
          arch.entityName,
        ),
      );
      return;
    }
    readSignals.add(k);
    const port = ports.get(k);
    if (port && port.direction === "out") {
      diags.push(
        makeDiag(
          VhdlErrorCode.PORT_DIRECTION_VIOLATION,
          VhdlErrorCode.PORT_DIRECTION_VIOLATION.message(port.name, port.direction, "read"),
          span,
          arch.entityName,
        ),
      );
    }
  };

  const checkWrite = (
    targetName: string,
    targetWidth: number | undefined,
    value: VhdlExpr,
    span: VhdlSpan,
    localScope: Set<string>,
    isVar: boolean,
  ): void => {
    const k = targetName.toLowerCase();
    if (!localScope.has(k) && !declared.has(k)) {
      diags.push(
        makeDiag(
          VhdlErrorCode.UNDEFINED_IDENTIFIER,
          VhdlErrorCode.UNDEFINED_IDENTIFIER.message(targetName, arch.name),
          span,
          arch.entityName,
        ),
      );
    }
    if (!isVar) {
      const port = ports.get(k);
      if (port && port.direction === "in") {
        diags.push(
          makeDiag(
            VhdlErrorCode.PORT_DIRECTION_VIOLATION,
            VhdlErrorCode.PORT_DIRECTION_VIOLATION.message(port.name, port.direction, "driven"),
            span,
            arch.entityName,
          ),
        );
      }
    }
    // Width mismatch check (VHDL3002)
    if (targetWidth !== undefined && value.kind !== "others") {
      const srcWidth = inferExprWidth(value, widths);
      if (srcWidth !== undefined && srcWidth !== targetWidth) {
        diags.push(
          makeDiag(
            VhdlErrorCode.WIDTH_MISMATCH,
            VhdlErrorCode.WIDTH_MISMATCH.message(targetName, targetWidth, srcWidth),
            span,
            arch.entityName,
          ),
        );
      }
    }
  };

  const targetEffectiveWidth = (target: {
    name: string;
    index?: VhdlExpr | undefined;
    slice?: { left: VhdlExpr; direction: "downto" | "to"; right: VhdlExpr } | undefined;
  }): number | undefined => {
    if (target.index) return 1;
    if (target.slice) return computeRangeWidth(target.slice);
    return widths.get(target.name.toLowerCase());
  };

  // Walk concurrent statements
  for (const stmt of arch.statements) {
    lintConcurrentStmt(stmt);
  }

  function lintConcurrentStmt(stmt: VhdlConcStmt): void {
    const emptyLocal = new Set<string>();
    if (stmt.kind === "condSignalAssign") {
      recordDriver(stmt.target.name, stmt.span);
      const tWidth = targetEffectiveWidth(stmt.target);
      for (const br of stmt.branches) {
        const reads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
        collectExprReads(br.value, reads);
        if (br.condition) collectExprReads(br.condition, reads);
        for (const r of reads) checkRead(r.name, r.span ?? stmt.span, emptyLocal);
        checkWrite(stmt.target.name, tWidth, br.value, stmt.span, emptyLocal, false);
      }
    } else if (stmt.kind === "selectedSignalAssign") {
      recordDriver(stmt.target.name, stmt.span);
      const tWidth = targetEffectiveWidth(stmt.target);
      const selReads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
      collectExprReads(stmt.selector, selReads);
      for (const r of selReads) checkRead(r.name, r.span ?? stmt.span, emptyLocal);
      for (const alt of stmt.alternatives) {
        const reads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
        collectExprReads(alt.value, reads);
        for (const r of reads) checkRead(r.name, r.span ?? stmt.span, emptyLocal);
        checkWrite(stmt.target.name, tWidth, alt.value, stmt.span, emptyLocal, false);
      }
    } else if (stmt.kind === "componentInst") {
      const comp =
        componentsByLower.get(stmt.componentName.toLowerCase()) ??
        entitiesByLower.get(stmt.componentName.toLowerCase());
      const connectedFormals = new Set<string>();
      for (let i = 0; i < stmt.portMap.length; i++) {
        const assoc = stmt.portMap[i]!;
        const formalName = assoc.formal?.toLowerCase() ?? comp?.ports[i]?.name.toLowerCase();
        if (formalName) connectedFormals.add(formalName);
        const formalPort = comp?.ports.find((p) => p.name.toLowerCase() === formalName);
        if (
          assoc.actual.kind === "ident" &&
          formalPort &&
          (formalPort.direction === "out" || formalPort.direction === "inout")
        ) {
          recordDriver(assoc.actual.name, assoc.actual.span ?? stmt.span);
        } else if (
          assoc.actual.kind === "index" &&
          formalPort &&
          (formalPort.direction === "out" || formalPort.direction === "inout")
        ) {
          recordDriver(assoc.actual.target, assoc.actual.span ?? stmt.span);
        } else {
          const reads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
          collectExprReads(assoc.actual, reads);
          for (const r of reads) checkRead(r.name, r.span ?? stmt.span, emptyLocal);
        }
      }
      // VHDL5003: Unconnected required input port
      if (comp) {
        for (const p of comp.ports) {
          if (p.direction === "in" && !p.defaultValue && !connectedFormals.has(p.name.toLowerCase())) {
            diags.push(
              makeDiag(
                VhdlErrorCode.UNCONNECTED_PORT,
                VhdlErrorCode.UNCONNECTED_PORT.message(p.name, stmt.label),
                stmt.span,
                arch.entityName,
              ),
            );
          }
        }
      }
    } else if (stmt.kind === "process") {
      const procLabel = stmt.label ?? `process@${stmt.span.line}`;
      const localVars = new Set<string>();
      const localWidths = new Map(widths);

      for (const v of stmt.variables) {
        const k = v.name.toLowerCase();
        if (localVars.has(k)) {
          diags.push(
            makeDiag(
              VhdlErrorCode.DUPLICATE_DECLARATION,
              VhdlErrorCode.DUPLICATE_DECLARATION.message("variable", v.name, procLabel),
              v.span,
              arch.entityName,
            ),
          );
        }
        localVars.add(k);
        if (v.type.width !== undefined) localWidths.set(k, v.type.width);
      }
      for (const c of stmt.constants) {
        localVars.add(c.name.toLowerCase());
      }

      const procDriven = new Set<string>();
      const procReads = new Set<string>();

      const walkSeq = (seqStmts: VhdlSeqStmt[], loopVars: Set<string>): void => {
        const scope = new Set([...localVars, ...loopVars]);
        for (const s of seqStmts) {
          if (s.kind === "signalAssign") {
            procDriven.add(s.target.name.toLowerCase());
            const reads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
            collectExprReads(s.value, reads);
            if (s.target.index) collectExprReads(s.target.index, reads);
            for (const r of reads) {
              checkRead(r.name, r.span ?? s.span, scope);
              if (!scope.has(r.name.toLowerCase()) && !BUILTIN_IDENTS.has(r.name.toLowerCase())) {
                procReads.add(r.name.toLowerCase());
              }
            }
            checkWrite(s.target.name, targetEffectiveWidth(s.target), s.value, s.span, scope, false);
          } else if (s.kind === "varAssign") {
            const reads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
            collectExprReads(s.value, reads);
            for (const r of reads) {
              checkRead(r.name, r.span ?? s.span, scope);
              if (!scope.has(r.name.toLowerCase()) && !BUILTIN_IDENTS.has(r.name.toLowerCase())) {
                procReads.add(r.name.toLowerCase());
              }
            }
            checkWrite(s.target.name, localWidths.get(s.target.name.toLowerCase()), s.value, s.span, scope, true);
          } else if (s.kind === "if") {
            const condReads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
            collectExprReads(s.condition, condReads);
            for (const r of condReads) {
              checkRead(r.name, r.span ?? s.span, scope);
              if (!scope.has(r.name.toLowerCase()) && !BUILTIN_IDENTS.has(r.name.toLowerCase())) {
                procReads.add(r.name.toLowerCase());
              }
            }
            walkSeq(s.thenBranch, loopVars);
            for (const ei of s.elsifs) {
              const eiReads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
              collectExprReads(ei.condition, eiReads);
              for (const r of eiReads) {
                checkRead(r.name, r.span ?? s.span, scope);
                if (!scope.has(r.name.toLowerCase()) && !BUILTIN_IDENTS.has(r.name.toLowerCase())) {
                  procReads.add(r.name.toLowerCase());
                }
              }
              walkSeq(ei.body, loopVars);
            }
            if (s.elseBranch) walkSeq(s.elseBranch, loopVars);
          } else if (s.kind === "case") {
            const exprReads: Array<{ name: string; span?: VhdlSpan | undefined }> = [];
            collectExprReads(s.expr, exprReads);
            for (const r of exprReads) {
              checkRead(r.name, r.span ?? s.span, scope);
              if (!scope.has(r.name.toLowerCase()) && !BUILTIN_IDENTS.has(r.name.toLowerCase())) {
                procReads.add(r.name.toLowerCase());
              }
            }
            for (const alt of s.alternatives) walkSeq(alt.body, loopVars);
          } else if (s.kind === "forLoop") {
            const nextLoop = new Set(loopVars);
            nextLoop.add(s.iterator.toLowerCase());
            walkSeq(s.body, nextLoop);
          }
        }
      };

      walkSeq(stmt.body, new Set());

      // Record one concurrent driver per signal driven by this process
      for (const sigKey of procDriven) {
        recordDriver(sigKey, stmt.span);
      }

      const clocked = isClockedProcess(stmt.body);
      if (!clocked && stmt.sensitivity.length > 0) {
        const sensLower = new Set(stmt.sensitivity.map((s) => s.toLowerCase()));
        // VHDL4001: Incomplete sensitivity list
        for (const r of procReads) {
          const isSignalOrPort = signals.has(r) || ports.has(r);
          if (isSignalOrPort && !sensLower.has(r)) {
            diags.push(
              makeDiag(
                VhdlErrorCode.INCOMPLETE_SENSITIVITY_LIST,
                VhdlErrorCode.INCOMPLETE_SENSITIVITY_LIST.message(r, procLabel),
                stmt.span,
                arch.entityName,
              ),
            );
          }
        }

        // VHDL4002: Inferred latch in combinational process
        const { mustAssign, mayAssign } = analyzeLatchPaths(stmt.body);
        for (const sig of mayAssign) {
          if (!mustAssign.has(sig)) {
            diags.push(
              makeDiag(
                VhdlErrorCode.INFERRED_LATCH,
                VhdlErrorCode.INFERRED_LATCH.message(sig, procLabel),
                stmt.span,
                arch.entityName,
              ),
            );
          }
        }
      }
    }
  }

  // VHDL5001: Multiple concurrent drivers on unresolved signal
  for (const [sigKey, info] of driverCounts) {
    if (info.count > 1) {
      const tRef = typeByName.get(sigKey);
      if (tRef && tRef.resolved === false) {
        diags.push(
          makeDiag(
            VhdlErrorCode.MULTIPLE_DRIVERS_UNRESOLVED,
            VhdlErrorCode.MULTIPLE_DRIVERS_UNRESOLVED.message(info.name, tRef.name, info.count),
            info.span,
            arch.entityName,
          ),
        );
      }
    }
  }

  // VHDL5005: Unused internal signals
  for (const [sigKey, sig] of signals) {
    if (!readSignals.has(sigKey)) {
      diags.push(
        makeDiag(
          VhdlErrorCode.UNUSED_SIGNAL,
          VhdlErrorCode.UNUSED_SIGNAL.message(sig.name, arch.name),
          sig.span,
          arch.entityName,
        ),
      );
    }
  }
}

export { VhdlErrorCode, type VhdlDiagnostic } from "../errors.js";
