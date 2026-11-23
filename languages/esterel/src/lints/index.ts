// SPDX-License-Identifier: AGPL-3.0-or-later

import { EsterelErrorCode } from "../errors.js";
import { parseEsterel } from "../parser/esterel-parser.js";
import type {
  EsterelDiagnostic,
  EsterelModule,
  EsterelProgram,
  EsterelSignalDirection,
  EsterelSignalExpr,
  EsterelStatement,
  SourceSpan,
} from "../types.js";

export { EsterelErrorCode } from "../errors.js";

interface DependencyEdge {
  from: string;
  to: string;
  polarity: "positive" | "negative";
  span: SourceSpan;
}

function collectExprSignals(expr: EsterelSignalExpr, out: Array<{ name: string; span: SourceSpan }>): void {
  switch (expr.kind) {
    case "signal":
      out.push({ name: expr.name, span: expr.span });
      break;
    case "not":
      collectExprSignals(expr.operand, out);
      break;
    case "and":
    case "or":
      collectExprSignals(expr.left, out);
      collectExprSignals(expr.right, out);
      break;
    case "tick":
      break;
  }
}

/**
 * Returns true if the statement can terminate in 0 ticks (instantaneously) without
 * executing `pause`, `halt`, `sustain`, or a non-immediate `await`.
 */
export function mayTerminateInstantaneously(stmt: EsterelStatement): boolean {
  switch (stmt.kind) {
    case "nothing":
    case "emit":
      return true;
    case "pause":
    case "halt":
    case "sustain":
    case "exit":
      return false;
    case "await":
      if (stmt.cases && stmt.cases.length > 0) {
        return stmt.cases.some((c) => c.immediate && (!c.body || mayTerminateInstantaneously(c.body)));
      }
      return stmt.immediate && (!stmt.body || mayTerminateInstantaneously(stmt.body));
    case "present":
      return (
        mayTerminateInstantaneously(stmt.thenBranch) ||
        (stmt.elseBranch ? mayTerminateInstantaneously(stmt.elseBranch) : true)
      );
    case "seq":
      return stmt.statements.every((s) => mayTerminateInstantaneously(s));
    case "par":
      return stmt.branches.every((b) => mayTerminateInstantaneously(b));
    case "loop":
      // `loop ... each E` pauses until E occurs on a subsequent tick.
      // Plain `loop ... end` never terminates normally (only via `exit`).
      return false;
    case "every":
      return false;
    case "abort":
      return (
        mayTerminateInstantaneously(stmt.body) ||
        (stmt.immediate && (!stmt.handler || mayTerminateInstantaneously(stmt.handler)))
      );
    case "suspend":
      return mayTerminateInstantaneously(stmt.body);
    case "trap":
      return mayTerminateInstantaneously(stmt.body) || canExitTrapInstantaneously(stmt.body, new Set(stmt.traps));
    case "signal":
      return mayTerminateInstantaneously(stmt.body);
    case "run":
      return false;
  }
}

function canExitTrapInstantaneously(stmt: EsterelStatement, traps: Set<string>): boolean {
  switch (stmt.kind) {
    case "exit":
      return traps.has(stmt.trapName);
    case "nothing":
    case "emit":
    case "pause":
    case "halt":
    case "sustain":
    case "run":
      return false;
    case "await":
      return stmt.immediate && stmt.body !== undefined && canExitTrapInstantaneously(stmt.body, traps);
    case "present":
      return (
        canExitTrapInstantaneously(stmt.thenBranch, traps) ||
        (stmt.elseBranch !== undefined && canExitTrapInstantaneously(stmt.elseBranch, traps))
      );
    case "seq":
      for (const s of stmt.statements) {
        if (canExitTrapInstantaneously(s, traps)) return true;
        if (!mayTerminateInstantaneously(s)) return false;
      }
      return false;
    case "par":
      return stmt.branches.some((b) => canExitTrapInstantaneously(b, traps));
    case "loop":
      return canExitTrapInstantaneously(stmt.body, traps);
    case "every":
      return stmt.immediate && canExitTrapInstantaneously(stmt.body, traps);
    case "abort":
      return (
        canExitTrapInstantaneously(stmt.body, traps) ||
        (stmt.immediate && stmt.handler !== undefined && canExitTrapInstantaneously(stmt.handler, traps))
      );
    case "suspend":
      return canExitTrapInstantaneously(stmt.body, traps);
    case "trap": {
      const innerTraps = new Set(traps);
      for (const t of stmt.traps) innerTraps.delete(t);
      return (
        canExitTrapInstantaneously(stmt.body, innerTraps) ||
        stmt.handlers.some((h) => canExitTrapInstantaneously(h.body, traps))
      );
    }
    case "signal":
      return canExitTrapInstantaneously(stmt.body, traps);
  }
}

/**
 * Collects signals that can be emitted instantaneously (in the same tick as entering `stmt`).
 */
function collectInstantaneousEmissions(stmt: EsterelStatement, out: Array<{ signal: string; span: SourceSpan }>): void {
  switch (stmt.kind) {
    case "emit":
    case "sustain":
      out.push({ signal: stmt.signal, span: stmt.span });
      break;
    case "nothing":
    case "pause":
    case "halt":
    case "exit":
    case "run":
      break;
    case "await":
      if (stmt.immediate && stmt.body) {
        collectInstantaneousEmissions(stmt.body, out);
      }
      if (stmt.cases) {
        for (const c of stmt.cases) {
          if (c.immediate && c.body) collectInstantaneousEmissions(c.body, out);
        }
      }
      break;
    case "present":
      collectInstantaneousEmissions(stmt.thenBranch, out);
      if (stmt.elseBranch) collectInstantaneousEmissions(stmt.elseBranch, out);
      break;
    case "seq":
      for (const s of stmt.statements) {
        collectInstantaneousEmissions(s, out);
        if (!mayTerminateInstantaneously(s)) break;
      }
      break;
    case "par":
      for (const b of stmt.branches) {
        collectInstantaneousEmissions(b, out);
      }
      break;
    case "loop":
    case "signal":
    case "suspend":
      collectInstantaneousEmissions(stmt.body, out);
      break;
    case "every":
      if (stmt.immediate) collectInstantaneousEmissions(stmt.body, out);
      break;
    case "abort":
      collectInstantaneousEmissions(stmt.body, out);
      if (stmt.immediate && stmt.handler) collectInstantaneousEmissions(stmt.handler, out);
      break;
    case "trap":
      collectInstantaneousEmissions(stmt.body, out);
      for (const h of stmt.handlers) collectInstantaneousEmissions(h.body, out);
      break;
  }
}

/**
 * Collects instantaneous test -> emit dependency edges for Berry's constructive causality analysis.
 */
function collectCausalityEdges(stmt: EsterelStatement, edges: DependencyEdge[]): void {
  switch (stmt.kind) {
    case "present": {
      const tested: Array<{ name: string; span: SourceSpan }> = [];
      collectExprSignals(stmt.expr, tested);
      const isNegatedTop = stmt.expr.kind === "not";

      const thenEmits: Array<{ signal: string; span: SourceSpan }> = [];
      collectInstantaneousEmissions(stmt.thenBranch, thenEmits);
      for (const t of tested) {
        for (const e of thenEmits) {
          edges.push({
            from: t.name,
            to: e.signal,
            polarity: isNegatedTop ? "negative" : "positive",
            span: stmt.span,
          });
        }
      }

      if (stmt.elseBranch) {
        const elseEmits: Array<{ signal: string; span: SourceSpan }> = [];
        collectInstantaneousEmissions(stmt.elseBranch, elseEmits);
        for (const t of tested) {
          for (const e of elseEmits) {
            edges.push({
              from: t.name,
              to: e.signal,
              polarity: isNegatedTop ? "positive" : "negative",
              span: stmt.span,
            });
          }
        }
      }

      collectCausalityEdges(stmt.thenBranch, edges);
      if (stmt.elseBranch) collectCausalityEdges(stmt.elseBranch, edges);
      break;
    }
    case "seq":
      for (const s of stmt.statements) collectCausalityEdges(s, edges);
      break;
    case "par":
      for (const b of stmt.branches) collectCausalityEdges(b, edges);
      break;
    case "loop":
    case "every":
    case "suspend":
    case "signal":
      collectCausalityEdges(stmt.body, edges);
      break;
    case "abort":
      collectCausalityEdges(stmt.body, edges);
      if (stmt.handler) collectCausalityEdges(stmt.handler, edges);
      break;
    case "trap":
      collectCausalityEdges(stmt.body, edges);
      for (const h of stmt.handlers) collectCausalityEdges(h.body, edges);
      break;
    case "await":
      if (stmt.body) collectCausalityEdges(stmt.body, edges);
      if (stmt.cases) {
        for (const c of stmt.cases) {
          if (c.body) collectCausalityEdges(c.body, edges);
        }
      }
      break;
    default:
      break;
  }
}

function detectCausalityCycles(edges: DependencyEdge[], modName: string, diags: EsterelDiagnostic[]): void {
  const adj = new Map<string, DependencyEdge[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }

  const reported = new Set<string>();

  for (const startNode of adj.keys()) {
    const stack: Array<{ node: string; path: string[]; hasNeg: boolean; firstSpan: SourceSpan | undefined }> = [
      { node: startNode, path: [startNode], hasNeg: false, firstSpan: undefined },
    ];

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const outgoing = adj.get(cur.node) ?? [];
      for (const edge of outgoing) {
        const nextHasNeg = cur.hasNeg || edge.polarity === "negative";
        const span = cur.firstSpan ?? edge.span;
        if (edge.to === startNode) {
          const cycleKey = `${nextHasNeg ? "neg" : "pos"}:${[...cur.path].sort().join(",")}`;
          if (!reported.has(cycleKey)) {
            reported.add(cycleKey);
            const cyclePath = [...cur.path, startNode].join(" -> ");
            if (nextHasNeg) {
              diags.push({
                id: EsterelErrorCode.CAUSALITY_CYCLE_NEGATIVE.code,
                rule: EsterelErrorCode.CAUSALITY_CYCLE_NEGATIVE.rule,
                severity: EsterelErrorCode.CAUSALITY_CYCLE_NEGATIVE.severity,
                message: EsterelErrorCode.CAUSALITY_CYCLE_NEGATIVE.message(cyclePath),
                line: span.startLine,
                column: span.startColumn,
                endLine: span.endLine,
                endColumn: span.endColumn,
                moduleName: modName,
                symbol: startNode,
              });
            } else {
              diags.push({
                id: EsterelErrorCode.CAUSALITY_CYCLE_POSITIVE.code,
                rule: EsterelErrorCode.CAUSALITY_CYCLE_POSITIVE.rule,
                severity: EsterelErrorCode.CAUSALITY_CYCLE_POSITIVE.severity,
                message: EsterelErrorCode.CAUSALITY_CYCLE_POSITIVE.message(cyclePath),
                line: span.startLine,
                column: span.startColumn,
                endLine: span.endLine,
                endColumn: span.endColumn,
                moduleName: modName,
                symbol: startNode,
              });
            }
          }
        } else if (!cur.path.includes(edge.to) && cur.path.length < 16) {
          stack.push({
            node: edge.to,
            path: [...cur.path, edge.to],
            hasNeg: nextHasNeg,
            firstSpan: span,
          });
        }
      }
    }
  }
}

function lintModule(mod: EsterelModule, allModuleNames: Set<string>, diags: EsterelDiagnostic[]): void {
  const signalScope = new Map<string, EsterelSignalDirection>();

  // 1. Check duplicate signals in interface
  for (const sig of mod.signals) {
    if (signalScope.has(sig.name)) {
      diags.push({
        id: EsterelErrorCode.DUPLICATE_SIGNAL.code,
        rule: EsterelErrorCode.DUPLICATE_SIGNAL.rule,
        severity: EsterelErrorCode.DUPLICATE_SIGNAL.severity,
        message: EsterelErrorCode.DUPLICATE_SIGNAL.message(sig.name, mod.name),
        line: sig.span.startLine,
        column: sig.span.startColumn,
        endLine: sig.span.endLine,
        endColumn: sig.span.endColumn,
        moduleName: mod.name,
        symbol: sig.name,
      });
    } else {
      signalScope.set(sig.name, sig.direction);
    }
  }

  // 2. Validate relations
  const exclusionPairs = new Set<string>();
  const implicationPairs = new Set<string>();

  for (const rel of mod.relations) {
    // Check declared signals and input direction
    for (const s of rel.signals) {
      const dir = signalScope.get(s);
      if (!dir) {
        diags.push({
          id: EsterelErrorCode.UNDECLARED_SIGNAL.code,
          rule: EsterelErrorCode.UNDECLARED_SIGNAL.rule,
          severity: EsterelErrorCode.UNDECLARED_SIGNAL.severity,
          message: EsterelErrorCode.UNDECLARED_SIGNAL.message(s, mod.name),
          line: rel.span.startLine,
          column: rel.span.startColumn,
          moduleName: mod.name,
          symbol: s,
        });
      } else if (dir === "output") {
        diags.push({
          id: EsterelErrorCode.RELATION_NON_INPUT.code,
          rule: EsterelErrorCode.RELATION_NON_INPUT.rule,
          severity: EsterelErrorCode.RELATION_NON_INPUT.severity,
          message: EsterelErrorCode.RELATION_NON_INPUT.message(s),
          line: rel.span.startLine,
          column: rel.span.startColumn,
          moduleName: mod.name,
          symbol: s,
        });
      }
    }

    if (rel.kind === "exclusion") {
      const seen = new Set<string>();
      for (const s of rel.signals) {
        if (seen.has(s)) {
          diags.push({
            id: EsterelErrorCode.INVALID_RELATION_CONFLICT.code,
            rule: EsterelErrorCode.INVALID_RELATION_CONFLICT.rule,
            severity: EsterelErrorCode.INVALID_RELATION_CONFLICT.severity,
            message: EsterelErrorCode.INVALID_RELATION_CONFLICT.message(
              `signal '${s}' cannot be exclusive with itself`,
            ),
            line: rel.span.startLine,
            column: rel.span.startColumn,
            moduleName: mod.name,
            symbol: s,
          });
        }
        seen.add(s);
      }
      for (let i = 0; i < rel.signals.length; i++) {
        for (let j = i + 1; j < rel.signals.length; j++) {
          const a = rel.signals[i]!;
          const b = rel.signals[j]!;
          const pairKey = a < b ? `${a}#${b}` : `${b}#${a}`;
          exclusionPairs.add(pairKey);
          if (implicationPairs.has(`${a}=>${b}`) || implicationPairs.has(`${b}=>${a}`)) {
            diags.push({
              id: EsterelErrorCode.INVALID_RELATION_CONFLICT.code,
              rule: EsterelErrorCode.INVALID_RELATION_CONFLICT.rule,
              severity: EsterelErrorCode.INVALID_RELATION_CONFLICT.severity,
              message: EsterelErrorCode.INVALID_RELATION_CONFLICT.message(
                `signals '${a}' and '${b}' are both mutually exclusive ('#') and linked by implication ('=>')`,
              ),
              line: rel.span.startLine,
              column: rel.span.startColumn,
              moduleName: mod.name,
            });
          }
        }
      }
    } else if (rel.kind === "implication" && rel.signals.length === 2) {
      const [lhs, rhs] = rel.signals as [string, string];
      if (lhs === rhs) {
        diags.push({
          id: EsterelErrorCode.INVALID_RELATION_CONFLICT.code,
          rule: EsterelErrorCode.INVALID_RELATION_CONFLICT.rule,
          severity: EsterelErrorCode.INVALID_RELATION_CONFLICT.severity,
          message: EsterelErrorCode.INVALID_RELATION_CONFLICT.message(`trivial self-implication '${lhs} => ${rhs}'`),
          line: rel.span.startLine,
          column: rel.span.startColumn,
          moduleName: mod.name,
          symbol: lhs,
        });
      }
      implicationPairs.add(`${lhs}=>${rhs}`);
      const pairKey = lhs < rhs ? `${lhs}#${rhs}` : `${rhs}#${lhs}`;
      if (exclusionPairs.has(pairKey)) {
        diags.push({
          id: EsterelErrorCode.INVALID_RELATION_CONFLICT.code,
          rule: EsterelErrorCode.INVALID_RELATION_CONFLICT.rule,
          severity: EsterelErrorCode.INVALID_RELATION_CONFLICT.severity,
          message: EsterelErrorCode.INVALID_RELATION_CONFLICT.message(
            `implication '${lhs} => ${rhs}' conflicts with exclusion '${lhs} # ${rhs}'`,
          ),
          line: rel.span.startLine,
          column: rel.span.startColumn,
          moduleName: mod.name,
        });
      }
    }
  }

  // 3. Empty body warning
  if (mod.body.kind === "nothing" && mod.signals.length === 0) {
    diags.push({
      id: EsterelErrorCode.EMPTY_MODULE_BODY.code,
      rule: EsterelErrorCode.EMPTY_MODULE_BODY.rule,
      severity: EsterelErrorCode.EMPTY_MODULE_BODY.severity,
      message: EsterelErrorCode.EMPTY_MODULE_BODY.message(mod.name),
      line: mod.span.startLine,
      column: mod.span.startColumn,
      moduleName: mod.name,
    });
  }

  // 4. Walk statements for scoping, traps, reachability, instantaneous loops
  function checkSignalRef(name: string, span: SourceSpan, scope: Map<string, EsterelSignalDirection>): void {
    if (!scope.has(name)) {
      diags.push({
        id: EsterelErrorCode.UNDECLARED_SIGNAL.code,
        rule: EsterelErrorCode.UNDECLARED_SIGNAL.rule,
        severity: EsterelErrorCode.UNDECLARED_SIGNAL.severity,
        message: EsterelErrorCode.UNDECLARED_SIGNAL.message(name, mod.name),
        line: span.startLine,
        column: span.startColumn,
        endLine: span.endLine,
        endColumn: span.endColumn,
        moduleName: mod.name,
        symbol: name,
      });
    }
  }

  function checkSignalExpr(expr: EsterelSignalExpr, scope: Map<string, EsterelSignalDirection>): void {
    const refs: Array<{ name: string; span: SourceSpan }> = [];
    collectExprSignals(expr, refs);
    for (const r of refs) checkSignalRef(r.name, r.span, scope);
  }

  function walk(stmt: EsterelStatement, scope: Map<string, EsterelSignalDirection>, traps: Set<string>): void {
    switch (stmt.kind) {
      case "nothing":
      case "pause":
      case "halt":
        break;
      case "emit":
      case "sustain": {
        const dir = scope.get(stmt.signal);
        if (!dir) {
          checkSignalRef(stmt.signal, stmt.span, scope);
        } else if (dir === "input" || dir === "sensor") {
          diags.push({
            id: EsterelErrorCode.EMIT_INPUT_SIGNAL.code,
            rule: EsterelErrorCode.EMIT_INPUT_SIGNAL.rule,
            severity: EsterelErrorCode.EMIT_INPUT_SIGNAL.severity,
            message: EsterelErrorCode.EMIT_INPUT_SIGNAL.message(stmt.signal, dir),
            line: stmt.span.startLine,
            column: stmt.span.startColumn,
            moduleName: mod.name,
            symbol: stmt.signal,
          });
        }
        break;
      }
      case "present":
        checkSignalExpr(stmt.expr, scope);
        walk(stmt.thenBranch, scope, traps);
        if (stmt.elseBranch) walk(stmt.elseBranch, scope, traps);
        break;
      case "await":
        if (stmt.cases && stmt.cases.length > 0) {
          for (const c of stmt.cases) {
            checkSignalExpr(c.expr, scope);
            if (c.body) walk(c.body, scope, traps);
          }
        } else {
          checkSignalExpr(stmt.expr, scope);
          if (stmt.body) walk(stmt.body, scope, traps);
        }
        break;
      case "loop":
        if (stmt.eachExpr) {
          checkSignalExpr(stmt.eachExpr, scope);
        } else if (mayTerminateInstantaneously(stmt.body)) {
          diags.push({
            id: EsterelErrorCode.INSTANTANEOUS_LOOP.code,
            rule: EsterelErrorCode.INSTANTANEOUS_LOOP.rule,
            severity: EsterelErrorCode.INSTANTANEOUS_LOOP.severity,
            message: EsterelErrorCode.INSTANTANEOUS_LOOP.message(mod.name),
            line: stmt.span.startLine,
            column: stmt.span.startColumn,
            endLine: stmt.span.endLine,
            endColumn: stmt.span.endColumn,
            moduleName: mod.name,
          });
        }
        walk(stmt.body, scope, traps);
        break;
      case "every":
        checkSignalExpr(stmt.expr, scope);
        walk(stmt.body, scope, traps);
        break;
      case "abort":
        checkSignalExpr(stmt.expr, scope);
        walk(stmt.body, scope, traps);
        if (stmt.handler) walk(stmt.handler, scope, traps);
        break;
      case "suspend":
        checkSignalExpr(stmt.expr, scope);
        walk(stmt.body, scope, traps);
        break;
      case "trap": {
        const innerTraps = new Set(traps);
        const localTraps = new Set<string>();
        for (const t of stmt.traps) {
          if (localTraps.has(t)) {
            diags.push({
              id: EsterelErrorCode.DUPLICATE_TRAP.code,
              rule: EsterelErrorCode.DUPLICATE_TRAP.rule,
              severity: EsterelErrorCode.DUPLICATE_TRAP.severity,
              message: EsterelErrorCode.DUPLICATE_TRAP.message(t),
              line: stmt.span.startLine,
              column: stmt.span.startColumn,
              moduleName: mod.name,
              symbol: t,
            });
          }
          localTraps.add(t);
          innerTraps.add(t);
        }
        walk(stmt.body, scope, innerTraps);
        const seenHandlers = new Set<string>();
        for (const h of stmt.handlers) {
          if (!localTraps.has(h.trapName)) {
            diags.push({
              id: EsterelErrorCode.UNDEFINED_TRAP.code,
              rule: EsterelErrorCode.UNDEFINED_TRAP.rule,
              severity: EsterelErrorCode.UNDEFINED_TRAP.severity,
              message: EsterelErrorCode.UNDEFINED_TRAP.message(h.trapName),
              line: h.span.startLine,
              column: h.span.startColumn,
              moduleName: mod.name,
              symbol: h.trapName,
            });
          }
          if (seenHandlers.has(h.trapName)) {
            diags.push({
              id: EsterelErrorCode.DUPLICATE_HANDLER.code,
              rule: EsterelErrorCode.DUPLICATE_HANDLER.rule,
              severity: EsterelErrorCode.DUPLICATE_HANDLER.severity,
              message: EsterelErrorCode.DUPLICATE_HANDLER.message(h.trapName),
              line: h.span.startLine,
              column: h.span.startColumn,
              moduleName: mod.name,
              symbol: h.trapName,
            });
          }
          seenHandlers.add(h.trapName);
          walk(h.body, scope, traps);
        }
        break;
      }
      case "exit":
        if (!traps.has(stmt.trapName)) {
          diags.push({
            id: EsterelErrorCode.UNDEFINED_TRAP.code,
            rule: EsterelErrorCode.UNDEFINED_TRAP.rule,
            severity: EsterelErrorCode.UNDEFINED_TRAP.severity,
            message: EsterelErrorCode.UNDEFINED_TRAP.message(stmt.trapName),
            line: stmt.span.startLine,
            column: stmt.span.startColumn,
            moduleName: mod.name,
            symbol: stmt.trapName,
          });
        }
        break;
      case "signal": {
        const innerScope = new Map(scope);
        const localSeen = new Set<string>();
        for (const s of stmt.signals) {
          if (localSeen.has(s.name)) {
            diags.push({
              id: EsterelErrorCode.DUPLICATE_SIGNAL.code,
              rule: EsterelErrorCode.DUPLICATE_SIGNAL.rule,
              severity: EsterelErrorCode.DUPLICATE_SIGNAL.severity,
              message: EsterelErrorCode.DUPLICATE_SIGNAL.message(s.name, "signal block"),
              line: s.span.startLine,
              column: s.span.startColumn,
              moduleName: mod.name,
              symbol: s.name,
            });
          }
          localSeen.add(s.name);
          innerScope.set(s.name, "inputoutput");
        }
        walk(stmt.body, innerScope, traps);
        break;
      }
      case "run":
        if (!allModuleNames.has(stmt.moduleName)) {
          diags.push({
            id: EsterelErrorCode.UNKNOWN_RUN_MODULE.code,
            rule: EsterelErrorCode.UNKNOWN_RUN_MODULE.rule,
            severity: EsterelErrorCode.UNKNOWN_RUN_MODULE.severity,
            message: EsterelErrorCode.UNKNOWN_RUN_MODULE.message(stmt.moduleName),
            line: stmt.span.startLine,
            column: stmt.span.startColumn,
            moduleName: mod.name,
            symbol: stmt.moduleName,
          });
        }
        for (const ren of stmt.renamings) {
          checkSignalRef(ren.actual, stmt.span, scope);
        }
        break;
      case "seq":
        for (let i = 0; i < stmt.statements.length; i++) {
          const cur = stmt.statements[i]!;
          walk(cur, scope, traps);
          if ((cur.kind === "halt" || cur.kind === "exit") && i + 1 < stmt.statements.length) {
            const next = stmt.statements[i + 1]!;
            diags.push({
              id: EsterelErrorCode.UNREACHABLE_STATEMENT.code,
              rule: EsterelErrorCode.UNREACHABLE_STATEMENT.rule,
              severity: EsterelErrorCode.UNREACHABLE_STATEMENT.severity,
              message: EsterelErrorCode.UNREACHABLE_STATEMENT.message(cur.kind),
              line: next.span.startLine,
              column: next.span.startColumn,
              moduleName: mod.name,
            });
          }
        }
        break;
      case "par":
        for (const b of stmt.branches) walk(b, scope, traps);
        break;
    }
  }

  walk(mod.body, signalScope, new Set());

  // 5. Constructive causality cycle analysis
  const edges: DependencyEdge[] = [];
  collectCausalityEdges(mod.body, edges);
  detectCausalityCycles(edges, mod.name, diags);
}

/**
 * Runs all static syntax, scope, relation, instantaneous loop, and constructive causality checks.
 */
export function lintEsterel(programOrSource: EsterelProgram | string): EsterelDiagnostic[] {
  const program = typeof programOrSource === "string" ? parseEsterel(programOrSource) : programOrSource;
  const diags: EsterelDiagnostic[] = [];

  for (const err of program.errors) {
    diags.push({
      id: err.code,
      rule: err.code === EsterelErrorCode.UNMATCHED_BLOCK.code ? "unmatched-block" : "syntax-error",
      severity: "error",
      message: err.message,
      line: err.line,
      column: err.column,
    });
  }

  const allModuleNames = new Set(program.modules.map((m) => m.name));
  const seenModules = new Set<string>();

  for (const mod of program.modules) {
    if (seenModules.has(mod.name)) {
      diags.push({
        id: EsterelErrorCode.DUPLICATE_MODULE.code,
        rule: EsterelErrorCode.DUPLICATE_MODULE.rule,
        severity: EsterelErrorCode.DUPLICATE_MODULE.severity,
        message: EsterelErrorCode.DUPLICATE_MODULE.message(mod.name),
        line: mod.span.startLine,
        column: mod.span.startColumn,
        moduleName: mod.name,
        symbol: mod.name,
      });
    }
    seenModules.add(mod.name);
    lintModule(mod, allModuleNames, diags);
  }

  return diags;
}
