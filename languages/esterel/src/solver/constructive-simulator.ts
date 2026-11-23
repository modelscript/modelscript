// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseEsterel } from "../parser/esterel-parser.js";
import type { EsterelModule, EsterelProgram, EsterelSignalExpr, EsterelStatement } from "../types.js";

export type SignalStatus = "unknown" | "present" | "absent";

export interface EsterelReactionResult {
  tick: number;
  inputs: string[];
  outputs: string[];
  signals: Record<string, boolean>;
  terminated: boolean;
  constructive: boolean;
  error?: string | undefined;
}

export interface EsterelTraceResult {
  moduleName: string;
  reactions: EsterelReactionResult[];
  allConstructive: boolean;
}

export interface EsterelSimulateOptions {
  moduleName?: string | undefined;
  maxFixpointIterations?: number | undefined;
}

/**
 * Runtime execution state for a statement tree node (pure JSON-cloneable structure
 * so speculative micro-steps within a constructive instant can roll back cleanly).
 */
type NodeState =
  | { kind: "idle" }
  | { kind: "paused" }
  | { kind: "seq"; index: number; child: NodeState }
  | { kind: "par"; done: boolean[]; children: NodeState[] }
  | { kind: "present"; branch: "then" | "else"; child: NodeState }
  | { kind: "await"; remaining: number; inBody: boolean; bodyState: NodeState; activeCase?: number | undefined }
  | { kind: "loop"; child: NodeState }
  | { kind: "every"; started: boolean; child: NodeState }
  | { kind: "abort"; active: boolean; remaining: number; inHandler: boolean; child: NodeState; handlerState: NodeState }
  | { kind: "suspend"; active: boolean; child: NodeState }
  | { kind: "trap"; inHandler: string | null; child: NodeState; handlerState: NodeState }
  | { kind: "signal"; localId: string; child: NodeState }
  | { kind: "run"; child: NodeState };

interface StepOutcome {
  /**
   * Completion code (Berry's encoding):
   * - `-1`: blocked on an `"unknown"` signal in constructive fixpoint evaluation
   * - `0`: terminated instantaneously
   * - `1`: paused for the current instant
   * - `>= 2`: exited trap at level `code`
   */
  code: number;
  nextState: NodeState;
}

function cloneState(s: NodeState): NodeState {
  return structuredClone(s);
}

function evalSignalExpr(
  expr: EsterelSignalExpr,
  statuses: Map<string, SignalStatus>,
  renameMap: Map<string, string>,
): SignalStatus {
  switch (expr.kind) {
    case "tick":
      return "present";
    case "signal": {
      const resolved = renameMap.get(expr.name) ?? expr.name;
      return statuses.get(resolved) ?? "absent";
    }
    case "not": {
      const inner = evalSignalExpr(expr.operand, statuses, renameMap);
      if (inner === "unknown") return "unknown";
      return inner === "present" ? "absent" : "present";
    }
    case "and": {
      const l = evalSignalExpr(expr.left, statuses, renameMap);
      const r = evalSignalExpr(expr.right, statuses, renameMap);
      if (l === "absent" || r === "absent") return "absent";
      if (l === "present" && r === "present") return "present";
      return "unknown";
    }
    case "or": {
      const l = evalSignalExpr(expr.left, statuses, renameMap);
      const r = evalSignalExpr(expr.right, statuses, renameMap);
      if (l === "present" || r === "present") return "present";
      if (l === "absent" && r === "absent") return "absent";
      return "unknown";
    }
  }
}

/**
 * Desugars `loop body each expr` into Esterel v5's canonical `loop abort (body; halt) when expr end`.
 */
function normalizeStatement(stmt: EsterelStatement): EsterelStatement {
  switch (stmt.kind) {
    case "loop": {
      const normBody = normalizeStatement(stmt.body);
      if (stmt.eachExpr) {
        const seqWithHalt: EsterelStatement = {
          kind: "seq",
          statements: [normBody, { kind: "halt", span: stmt.span }],
          span: stmt.span,
        };
        const abortNode: EsterelStatement = {
          kind: "abort",
          weak: false,
          body: seqWithHalt,
          immediate: false,
          expr: stmt.eachExpr,
          span: stmt.span,
        };
        return { kind: "loop", body: abortNode, span: stmt.span };
      }
      return { ...stmt, body: normBody };
    }
    case "seq":
      return { ...stmt, statements: stmt.statements.map(normalizeStatement) };
    case "par":
      return { ...stmt, branches: stmt.branches.map(normalizeStatement) };
    case "present":
      return {
        ...stmt,
        thenBranch: normalizeStatement(stmt.thenBranch),
        elseBranch: stmt.elseBranch ? normalizeStatement(stmt.elseBranch) : undefined,
      };
    case "await":
      return {
        ...stmt,
        body: stmt.body ? normalizeStatement(stmt.body) : undefined,
        cases: stmt.cases?.map((c) => ({
          ...c,
          body: c.body ? normalizeStatement(c.body) : undefined,
        })),
      };
    case "every":
      return { ...stmt, body: normalizeStatement(stmt.body) };
    case "abort":
      return {
        ...stmt,
        body: normalizeStatement(stmt.body),
        handler: stmt.handler ? normalizeStatement(stmt.handler) : undefined,
      };
    case "suspend":
      return { ...stmt, body: normalizeStatement(stmt.body) };
    case "trap":
      return {
        ...stmt,
        body: normalizeStatement(stmt.body),
        handlers: stmt.handlers.map((h) => ({ ...h, body: normalizeStatement(h.body) })),
      };
    case "signal":
      return { ...stmt, body: normalizeStatement(stmt.body) };
    default:
      return stmt;
  }
}

/**
 * Berry's constructive instant-by-instant reactive simulator for Esterel modules.
 */
export class EsterelSimulator {
  private readonly program: EsterelProgram;
  private readonly module: EsterelModule;
  private readonly normalizedBody: EsterelStatement;
  private readonly moduleMap: Map<string, EsterelModule>;
  private readonly inputNames: Set<string>;
  private readonly outputNames: Set<string>;
  private readonly allInterfaceSignals: string[];
  private readonly maxFixpointIterations: number;

  private rootState: NodeState = { kind: "idle" };
  private terminated = false;
  private tickCount = 0;

  constructor(programOrSource: EsterelProgram | string, options: EsterelSimulateOptions = {}) {
    this.program = typeof programOrSource === "string" ? parseEsterel(programOrSource) : programOrSource;
    this.moduleMap = new Map(this.program.modules.map((m) => [m.name, m]));

    const target = options.moduleName ? this.moduleMap.get(options.moduleName) : this.program.modules[0];

    if (!target) {
      throw new Error(
        options.moduleName
          ? `Esterel module '${options.moduleName}' not found.`
          : "No Esterel module found in program.",
      );
    }

    this.module = target;
    this.normalizedBody = normalizeStatement(target.body);
    this.maxFixpointIterations = options.maxFixpointIterations ?? 64;

    this.inputNames = new Set();
    this.outputNames = new Set();
    this.allInterfaceSignals = [];

    for (const sig of target.signals) {
      this.allInterfaceSignals.push(sig.name);
      if (sig.direction === "input" || sig.direction === "sensor" || sig.direction === "inputoutput") {
        this.inputNames.add(sig.name);
      }
      if (sig.direction === "output" || sig.direction === "inputoutput") {
        this.outputNames.add(sig.name);
      }
    }
  }

  reset(): void {
    this.rootState = { kind: "idle" };
    this.terminated = false;
    this.tickCount = 0;
  }

  /**
   * Executes a single synchronous reaction instant using Berry's 3-valued constructive fixpoint.
   */
  step(presentInputs: Iterable<string> = []): EsterelReactionResult {
    const tick = this.tickCount++;
    const inputSet = new Set(presentInputs);
    const inputs = [...inputSet].sort();

    if (this.terminated) {
      const signals: Record<string, boolean> = {};
      for (const s of this.allInterfaceSignals) {
        signals[s] = inputSet.has(s);
      }
      return {
        tick,
        inputs,
        outputs: [],
        signals,
        terminated: true,
        constructive: true,
      };
    }

    // Initialize 3-valued signal map
    const statuses = new Map<string, SignalStatus>();
    for (const sig of this.module.signals) {
      if (sig.direction === "input" || sig.direction === "sensor") {
        statuses.set(sig.name, inputSet.has(sig.name) ? "present" : "absent");
      } else if (sig.direction === "inputoutput") {
        statuses.set(sig.name, inputSet.has(sig.name) ? "present" : "unknown");
      } else {
        statuses.set(sig.name, "unknown");
      }
    }

    let finalOutcome: StepOutcome = { code: -1, nextState: this.rootState };
    let constructive = false;

    for (let iter = 0; iter < this.maxFixpointIterations; iter++) {
      const emittedThisPass = new Set<string>();
      const potentialEmits = new Set<string>();
      const snapshot = cloneState(this.rootState);
      const trapStack: string[] = [];
      const renameMap = new Map<string, string>();

      const outcome = this.execStmt(
        this.normalizedBody,
        snapshot,
        statuses,
        emittedThisPass,
        potentialEmits,
        trapStack,
        renameMap,
        0,
      );

      // Apply newly discovered emissions (monotone unknown -> present)
      let changed = false;
      for (const s of emittedThisPass) {
        if (statuses.get(s) !== "present") {
          statuses.set(s, "present");
          changed = true;
        }
      }

      if (changed) continue;

      // If no new emissions, resolve any unknown signals that CANNOT be emitted in this instant to absent
      let resolvedAbsent = false;
      for (const [sigName, st] of statuses) {
        if (st === "unknown" && !potentialEmits.has(sigName)) {
          statuses.set(sigName, "absent");
          resolvedAbsent = true;
        }
      }

      if (resolvedAbsent) continue;

      if (outcome.code !== -1) {
        finalOutcome = outcome;
        constructive = true;
        break;
      }

      // Neither new emissions nor new absences can be deduced while still blocked -> non-constructive cycle
      constructive = false;
      break;
    }

    if (constructive) {
      // Any remaining unknown signals that were never tested or emitted are absent
      for (const [sigName, st] of statuses) {
        if (st === "unknown") statuses.set(sigName, "absent");
      }
      this.rootState = finalOutcome.nextState;
      if (finalOutcome.code === 0) {
        this.terminated = true;
      }
    }

    const outputs: string[] = [];
    const signals: Record<string, boolean> = {};
    for (const s of this.allInterfaceSignals) {
      const isPresent = statuses.get(s) === "present";
      signals[s] = isPresent;
      if (this.outputNames.has(s) && isPresent) {
        outputs.push(s);
      }
    }
    outputs.sort();

    return {
      tick,
      inputs,
      outputs,
      signals,
      terminated: this.terminated,
      constructive,
      error: constructive ? undefined : "Non-constructive causality cycle prevented signal resolution.",
    };
  }

  /**
   * Collects all signals that could still be emitted in the current instant inside a blocked/unevaluated subtree.
   */
  private collectPotentialEmits(
    stmt: EsterelStatement,
    state: NodeState,
    renameMap: Map<string, string>,
    out: Set<string>,
  ): void {
    switch (stmt.kind) {
      case "emit":
      case "sustain":
        out.add(renameMap.get(stmt.signal) ?? stmt.signal);
        break;
      case "nothing":
      case "pause":
      case "halt":
      case "exit":
        break;
      case "seq": {
        const startIdx = state.kind === "seq" ? state.index : 0;
        for (let i = startIdx; i < stmt.statements.length; i++) {
          const childSt: NodeState = state.kind === "seq" && i === startIdx ? state.child : { kind: "idle" };
          this.collectPotentialEmits(stmt.statements[i]!, childSt, renameMap, out);
        }
        break;
      }
      case "par":
        for (let i = 0; i < stmt.branches.length; i++) {
          if (state.kind === "par" && state.done[i]) continue;
          const childSt: NodeState = state.kind === "par" ? state.children[i]! : { kind: "idle" };
          this.collectPotentialEmits(stmt.branches[i]!, childSt, renameMap, out);
        }
        break;
      case "present":
        if (state.kind === "present") {
          const b = state.branch === "then" ? stmt.thenBranch : stmt.elseBranch;
          if (b) this.collectPotentialEmits(b, state.child, renameMap, out);
        } else {
          this.collectPotentialEmits(stmt.thenBranch, { kind: "idle" }, renameMap, out);
          if (stmt.elseBranch) this.collectPotentialEmits(stmt.elseBranch, { kind: "idle" }, renameMap, out);
        }
        break;
      case "await":
        if (stmt.body) {
          this.collectPotentialEmits(
            stmt.body,
            state.kind === "await" && state.inBody ? state.bodyState : { kind: "idle" },
            renameMap,
            out,
          );
        }
        if (stmt.cases) {
          for (const c of stmt.cases) {
            if (c.body) this.collectPotentialEmits(c.body, { kind: "idle" }, renameMap, out);
          }
        }
        break;
      case "loop":
        this.collectPotentialEmits(stmt.body, state.kind === "loop" ? state.child : { kind: "idle" }, renameMap, out);
        break;
      case "every":
        this.collectPotentialEmits(stmt.body, state.kind === "every" ? state.child : { kind: "idle" }, renameMap, out);
        break;
      case "abort":
        this.collectPotentialEmits(stmt.body, state.kind === "abort" ? state.child : { kind: "idle" }, renameMap, out);
        if (stmt.handler) {
          this.collectPotentialEmits(
            stmt.handler,
            state.kind === "abort" && state.inHandler ? state.handlerState : { kind: "idle" },
            renameMap,
            out,
          );
        }
        break;
      case "suspend":
        this.collectPotentialEmits(
          stmt.body,
          state.kind === "suspend" ? state.child : { kind: "idle" },
          renameMap,
          out,
        );
        break;
      case "trap":
        this.collectPotentialEmits(stmt.body, state.kind === "trap" ? state.child : { kind: "idle" }, renameMap, out);
        for (const h of stmt.handlers) {
          this.collectPotentialEmits(h.body, { kind: "idle" }, renameMap, out);
        }
        break;
      case "signal": {
        const innerRename = new Map(renameMap);
        const localPrefix = state.kind === "signal" ? state.localId : `loc_${stmt.span.startOffset}`;
        for (const s of stmt.signals) {
          innerRename.set(s.name, `${localPrefix}:${s.name}`);
        }
        this.collectPotentialEmits(
          stmt.body,
          state.kind === "signal" ? state.child : { kind: "idle" },
          innerRename,
          out,
        );
        break;
      }
      case "run": {
        const sub = this.moduleMap.get(stmt.moduleName);
        if (sub) {
          const innerRename = new Map(renameMap);
          for (const r of stmt.renamings) {
            innerRename.set(r.formal, renameMap.get(r.actual) ?? r.actual);
          }
          this.collectPotentialEmits(
            normalizeStatement(sub.body),
            state.kind === "run" ? state.child : { kind: "idle" },
            innerRename,
            out,
          );
        }
        break;
      }
    }
  }

  private execStmt(
    stmt: EsterelStatement,
    state: NodeState,
    statuses: Map<string, SignalStatus>,
    emitted: Set<string>,
    potentialEmits: Set<string>,
    trapStack: string[],
    renameMap: Map<string, string>,
    loopDepth: number,
  ): StepOutcome {
    switch (stmt.kind) {
      case "nothing":
        return { code: 0, nextState: { kind: "idle" } };

      case "pause":
        if (state.kind === "paused") {
          return { code: 0, nextState: { kind: "idle" } };
        }
        return { code: 1, nextState: { kind: "paused" } };

      case "halt":
        return { code: 1, nextState: { kind: "paused" } };

      case "emit": {
        const sigName = renameMap.get(stmt.signal) ?? stmt.signal;
        emitted.add(sigName);
        return { code: 0, nextState: { kind: "idle" } };
      }

      case "sustain": {
        const sigName = renameMap.get(stmt.signal) ?? stmt.signal;
        emitted.add(sigName);
        return { code: 1, nextState: { kind: "paused" } };
      }

      case "exit": {
        // Innermost trap has code 2, next outer has 3, etc.
        // Outer traps have HIGHER priority (larger code).
        const idx = trapStack.lastIndexOf(stmt.trapName);
        if (idx === -1) {
          return { code: 0, nextState: { kind: "idle" } };
        }
        // Depth from outermost: idx === 0 is outermost -> highest code
        const code = 2 + (trapStack.length - 1 - idx);
        return { code, nextState: { kind: "idle" } };
      }

      case "seq": {
        let idx = state.kind === "seq" ? state.index : 0;
        let childState: NodeState = state.kind === "seq" ? state.child : { kind: "idle" };

        while (idx < stmt.statements.length) {
          const res = this.execStmt(
            stmt.statements[idx]!,
            childState,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (res.code === -1) {
            // Remaining statements in sequence might still emit if this one completes
            for (let j = idx + 1; j < stmt.statements.length; j++) {
              this.collectPotentialEmits(stmt.statements[j]!, { kind: "idle" }, renameMap, potentialEmits);
            }
            return { code: -1, nextState: { kind: "seq", index: idx, child: res.nextState } };
          }
          if (res.code === 0) {
            idx++;
            childState = { kind: "idle" };
            continue;
          }
          if (res.code === 1) {
            return { code: 1, nextState: { kind: "seq", index: idx, child: res.nextState } };
          }
          // Trap exit (>= 2)
          return { code: res.code, nextState: { kind: "idle" } };
        }
        return { code: 0, nextState: { kind: "idle" } };
      }

      case "par": {
        const n = stmt.branches.length;
        const done: boolean[] = state.kind === "par" ? [...state.done] : new Array<boolean>(n).fill(false);
        const children: NodeState[] =
          state.kind === "par"
            ? state.children.map((c) => cloneState(c))
            : Array.from({ length: n }, () => ({ kind: "idle" }) as NodeState);

        let maxCode = 0;
        let anyBlocked = false;

        for (let i = 0; i < n; i++) {
          if (done[i]) continue;
          const res = this.execStmt(
            stmt.branches[i]!,
            children[i]!,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (res.code === -1) {
            anyBlocked = true;
            children[i] = res.nextState;
          } else if (res.code === 0) {
            done[i] = true;
            children[i] = { kind: "idle" };
          } else {
            children[i] = res.nextState;
            if (res.code > maxCode) maxCode = res.code;
          }
        }

        if (anyBlocked) {
          return { code: -1, nextState: { kind: "par", done, children } };
        }
        if (maxCode >= 2) {
          return { code: maxCode, nextState: { kind: "idle" } };
        }
        if (maxCode === 1) {
          return { code: 1, nextState: { kind: "par", done, children } };
        }
        return { code: 0, nextState: { kind: "idle" } };
      }

      case "present": {
        if (state.kind === "present") {
          const branchStmt = state.branch === "then" ? stmt.thenBranch : stmt.elseBranch;
          if (!branchStmt) return { code: 0, nextState: { kind: "idle" } };
          const res = this.execStmt(
            branchStmt,
            state.child,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (res.code === 1 || res.code === -1) {
            return { code: res.code, nextState: { kind: "present", branch: state.branch, child: res.nextState } };
          }
          return { code: res.code, nextState: { kind: "idle" } };
        }

        const val = evalSignalExpr(stmt.expr, statuses, renameMap);
        if (val === "unknown") {
          this.collectPotentialEmits(stmt.thenBranch, { kind: "idle" }, renameMap, potentialEmits);
          if (stmt.elseBranch) {
            this.collectPotentialEmits(stmt.elseBranch, { kind: "idle" }, renameMap, potentialEmits);
          }
          return { code: -1, nextState: { kind: "idle" } };
        }

        const branch: "then" | "else" = val === "present" ? "then" : "else";
        const branchStmt = branch === "then" ? stmt.thenBranch : stmt.elseBranch;
        if (!branchStmt) return { code: 0, nextState: { kind: "idle" } };

        const res = this.execStmt(
          branchStmt,
          { kind: "idle" },
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          renameMap,
          loopDepth,
        );
        if (res.code === 1 || res.code === -1) {
          return { code: res.code, nextState: { kind: "present", branch, child: res.nextState } };
        }
        return { code: res.code, nextState: { kind: "idle" } };
      }

      case "await": {
        // Multi-case await
        if (stmt.cases && stmt.cases.length > 0) {
          if (state.kind === "await" && state.inBody && state.activeCase !== undefined) {
            const c = stmt.cases[state.activeCase];
            if (!c?.body) return { code: 0, nextState: { kind: "idle" } };
            const res = this.execStmt(
              c.body,
              state.bodyState,
              statuses,
              emitted,
              potentialEmits,
              trapStack,
              renameMap,
              loopDepth,
            );
            if (res.code === 1 || res.code === -1) {
              return {
                code: res.code,
                nextState: {
                  kind: "await",
                  remaining: 0,
                  inBody: true,
                  bodyState: res.nextState,
                  activeCase: state.activeCase,
                },
              };
            }
            return { code: res.code, nextState: { kind: "idle" } };
          }

          const isEntry = state.kind !== "await";
          for (let i = 0; i < stmt.cases.length; i++) {
            const c = stmt.cases[i]!;
            if (isEntry && !c.immediate) continue;
            const val = evalSignalExpr(c.expr, statuses, renameMap);
            if (val === "unknown") {
              for (const cc of stmt.cases) {
                if (cc.body) this.collectPotentialEmits(cc.body, { kind: "idle" }, renameMap, potentialEmits);
              }
              return { code: -1, nextState: state };
            }
            if (val === "present") {
              if (!c.body) return { code: 0, nextState: { kind: "idle" } };
              const res = this.execStmt(
                c.body,
                { kind: "idle" },
                statuses,
                emitted,
                potentialEmits,
                trapStack,
                renameMap,
                loopDepth,
              );
              if (res.code === 1 || res.code === -1) {
                return {
                  code: res.code,
                  nextState: {
                    kind: "await",
                    remaining: 0,
                    inBody: true,
                    bodyState: res.nextState,
                    activeCase: i,
                  },
                };
              }
              return { code: res.code, nextState: { kind: "idle" } };
            }
          }
          return {
            code: 1,
            nextState: { kind: "await", remaining: 1, inBody: false, bodyState: { kind: "idle" } },
          };
        }

        // Single-case await
        if (state.kind === "await" && state.inBody) {
          if (!stmt.body) return { code: 0, nextState: { kind: "idle" } };
          const res = this.execStmt(
            stmt.body,
            state.bodyState,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (res.code === 1 || res.code === -1) {
            return {
              code: res.code,
              nextState: { kind: "await", remaining: 0, inBody: true, bodyState: res.nextState },
            };
          }
          return { code: res.code, nextState: { kind: "idle" } };
        }

        const isEntry = state.kind !== "await";
        let remaining = state.kind === "await" ? state.remaining : (stmt.count ?? 1);

        if (isEntry && !stmt.immediate) {
          return {
            code: 1,
            nextState: { kind: "await", remaining, inBody: false, bodyState: { kind: "idle" } },
          };
        }

        const val = evalSignalExpr(stmt.expr, statuses, renameMap);
        if (val === "unknown") {
          if (stmt.body) this.collectPotentialEmits(stmt.body, { kind: "idle" }, renameMap, potentialEmits);
          return { code: -1, nextState: state };
        }

        if (val === "present") {
          remaining--;
          if (remaining <= 0) {
            if (!stmt.body) return { code: 0, nextState: { kind: "idle" } };
            const res = this.execStmt(
              stmt.body,
              { kind: "idle" },
              statuses,
              emitted,
              potentialEmits,
              trapStack,
              renameMap,
              loopDepth,
            );
            if (res.code === 1 || res.code === -1) {
              return {
                code: res.code,
                nextState: { kind: "await", remaining: 0, inBody: true, bodyState: res.nextState },
              };
            }
            return { code: res.code, nextState: { kind: "idle" } };
          }
        }

        return {
          code: 1,
          nextState: { kind: "await", remaining, inBody: false, bodyState: { kind: "idle" } },
        };
      }

      case "loop": {
        let childState: NodeState = state.kind === "loop" ? state.child : { kind: "idle" };
        let safety = 0;
        while (safety < 64) {
          safety++;
          const res = this.execStmt(
            stmt.body,
            childState,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth + 1,
          );
          if (res.code === -1) {
            return { code: -1, nextState: { kind: "loop", child: res.nextState } };
          }
          if (res.code === 1) {
            return { code: 1, nextState: { kind: "loop", child: res.nextState } };
          }
          if (res.code >= 2) {
            return { code: res.code, nextState: { kind: "idle" } };
          }
          // Body terminated (code === 0): immediately restart in the same instant!
          childState = { kind: "idle" };
        }
        // Instantaneous loop guard
        return { code: -1, nextState: { kind: "loop", child: childState } };
      }

      case "every": {
        const isEntry = state.kind !== "every";
        const started = state.kind === "every" ? state.started : false;
        const childState: NodeState = state.kind === "every" ? state.child : { kind: "idle" };

        if (isEntry && !stmt.immediate) {
          return { code: 1, nextState: { kind: "every", started: false, child: { kind: "idle" } } };
        }

        const val = evalSignalExpr(stmt.expr, statuses, renameMap);
        if (val === "unknown") {
          this.collectPotentialEmits(stmt.body, { kind: "idle" }, renameMap, potentialEmits);
          return { code: -1, nextState: state };
        }

        if (val === "present") {
          // Trigger / restart body in this instant
          const res = this.execStmt(
            stmt.body,
            { kind: "idle" },
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (res.code === -1) return { code: -1, nextState: { kind: "every", started: true, child: res.nextState } };
          if (res.code >= 2) return { code: res.code, nextState: { kind: "idle" } };
          return {
            code: 1,
            nextState: { kind: "every", started: res.code === 1, child: res.nextState },
          };
        }

        if (!started) {
          return { code: 1, nextState: { kind: "every", started: false, child: { kind: "idle" } } };
        }

        const res = this.execStmt(
          stmt.body,
          childState,
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          renameMap,
          loopDepth,
        );
        if (res.code === -1) return { code: -1, nextState: { kind: "every", started: true, child: res.nextState } };
        if (res.code >= 2) return { code: res.code, nextState: { kind: "idle" } };
        return {
          code: 1,
          nextState: { kind: "every", started: res.code === 1, child: res.nextState },
        };
      }

      case "abort": {
        if (state.kind === "abort" && state.inHandler) {
          if (!stmt.handler) return { code: 0, nextState: { kind: "idle" } };
          const hRes = this.execStmt(
            stmt.handler,
            state.handlerState,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (hRes.code === 1 || hRes.code === -1) {
            return {
              code: hRes.code,
              nextState: {
                kind: "abort",
                active: true,
                remaining: 0,
                inHandler: true,
                child: { kind: "idle" },
                handlerState: hRes.nextState,
              },
            };
          }
          return { code: hRes.code, nextState: { kind: "idle" } };
        }

        const isEntry = state.kind !== "abort" || !state.active;
        let remaining = state.kind === "abort" && state.active ? state.remaining : (stmt.count ?? 1);
        const childState: NodeState = state.kind === "abort" && state.active ? state.child : { kind: "idle" };

        const shouldCheckPreempt = !isEntry || stmt.immediate;

        if (shouldCheckPreempt) {
          const val = evalSignalExpr(stmt.expr, statuses, renameMap);
          if (val === "unknown") {
            this.collectPotentialEmits(stmt.body, childState, renameMap, potentialEmits);
            if (stmt.handler) this.collectPotentialEmits(stmt.handler, { kind: "idle" }, renameMap, potentialEmits);
            return { code: -1, nextState: state };
          }

          if (val === "present") {
            remaining--;
            if (remaining <= 0) {
              if (stmt.weak) {
                // Weak abort: execute body one final time in this instant, then run handler & terminate
                const bRes = this.execStmt(
                  stmt.body,
                  childState,
                  statuses,
                  emitted,
                  potentialEmits,
                  trapStack,
                  renameMap,
                  loopDepth,
                );
                if (bRes.code === -1) {
                  if (stmt.handler)
                    this.collectPotentialEmits(stmt.handler, { kind: "idle" }, renameMap, potentialEmits);
                  return { code: -1, nextState: state };
                }
                if (bRes.code >= 2) {
                  return { code: bRes.code, nextState: { kind: "idle" } };
                }
              }

              // Run abort handler if present
              if (stmt.handler) {
                const hRes = this.execStmt(
                  stmt.handler,
                  { kind: "idle" },
                  statuses,
                  emitted,
                  potentialEmits,
                  trapStack,
                  renameMap,
                  loopDepth,
                );
                if (hRes.code === 1 || hRes.code === -1) {
                  return {
                    code: hRes.code,
                    nextState: {
                      kind: "abort",
                      active: true,
                      remaining: 0,
                      inHandler: true,
                      child: { kind: "idle" },
                      handlerState: hRes.nextState,
                    },
                  };
                }
                return { code: hRes.code, nextState: { kind: "idle" } };
              }
              return { code: 0, nextState: { kind: "idle" } };
            }
          }
        }

        const bRes = this.execStmt(
          stmt.body,
          childState,
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          renameMap,
          loopDepth,
        );
        if (bRes.code === -1) {
          return {
            code: -1,
            nextState: {
              kind: "abort",
              active: !isEntry,
              remaining,
              inHandler: false,
              child: bRes.nextState,
              handlerState: { kind: "idle" },
            },
          };
        }
        if (bRes.code === 1) {
          return {
            code: 1,
            nextState: {
              kind: "abort",
              active: true,
              remaining,
              inHandler: false,
              child: bRes.nextState,
              handlerState: { kind: "idle" },
            },
          };
        }
        return { code: bRes.code, nextState: { kind: "idle" } };
      }

      case "suspend": {
        const isEntry = state.kind !== "suspend" || !state.active;
        const childState: NodeState = state.kind === "suspend" && state.active ? state.child : { kind: "idle" };

        if (!isEntry || stmt.immediate) {
          const val = evalSignalExpr(stmt.expr, statuses, renameMap);
          if (val === "unknown") {
            this.collectPotentialEmits(stmt.body, childState, renameMap, potentialEmits);
            return { code: -1, nextState: state };
          }
          if (val === "present") {
            // Freeze body state for this instant
            return { code: 1, nextState: { kind: "suspend", active: true, child: childState } };
          }
        }

        const res = this.execStmt(
          stmt.body,
          childState,
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          renameMap,
          loopDepth,
        );
        if (res.code === 1 || res.code === -1) {
          return { code: res.code, nextState: { kind: "suspend", active: true, child: res.nextState } };
        }
        return { code: res.code, nextState: { kind: "idle" } };
      }

      case "trap": {
        if (state.kind === "trap" && state.inHandler !== null) {
          const handler = stmt.handlers.find((h) => h.trapName === state.inHandler);
          if (!handler) return { code: 0, nextState: { kind: "idle" } };
          const hRes = this.execStmt(
            handler.body,
            state.handlerState,
            statuses,
            emitted,
            potentialEmits,
            trapStack,
            renameMap,
            loopDepth,
          );
          if (hRes.code === 1 || hRes.code === -1) {
            return {
              code: hRes.code,
              nextState: {
                kind: "trap",
                inHandler: state.inHandler,
                child: { kind: "idle" },
                handlerState: hRes.nextState,
              },
            };
          }
          return { code: hRes.code, nextState: { kind: "idle" } };
        }

        const baseLen = trapStack.length;
        const nextStack = [...trapStack, ...stmt.traps];
        const childState: NodeState = state.kind === "trap" ? state.child : { kind: "idle" };

        const res = this.execStmt(
          stmt.body,
          childState,
          statuses,
          emitted,
          potentialEmits,
          nextStack,
          renameMap,
          loopDepth,
        );

        if (res.code === -1) {
          return {
            code: -1,
            nextState: { kind: "trap", inHandler: null, child: res.nextState, handlerState: { kind: "idle" } },
          };
        }
        if (res.code === 1) {
          return {
            code: 1,
            nextState: { kind: "trap", inHandler: null, child: res.nextState, handlerState: { kind: "idle" } },
          };
        }
        if (res.code === 0) {
          return { code: 0, nextState: { kind: "idle" } };
        }

        // Check if res.code belongs to one of this trap block's traps
        const idxFromOutermost = nextStack.length - 1 - (res.code - 2);
        if (idxFromOutermost >= baseLen && idxFromOutermost < nextStack.length) {
          const caughtTrap = nextStack[idxFromOutermost]!;
          const handler = stmt.handlers.find((h) => h.trapName === caughtTrap);
          if (handler) {
            const hRes = this.execStmt(
              handler.body,
              { kind: "idle" },
              statuses,
              emitted,
              potentialEmits,
              trapStack,
              renameMap,
              loopDepth,
            );
            if (hRes.code === 1 || hRes.code === -1) {
              return {
                code: hRes.code,
                nextState: {
                  kind: "trap",
                  inHandler: caughtTrap,
                  child: { kind: "idle" },
                  handlerState: hRes.nextState,
                },
              };
            }
            return { code: hRes.code, nextState: { kind: "idle" } };
          }
          return { code: 0, nextState: { kind: "idle" } };
        }

        // Outer trap exit: re-adjust code for outer trapStack length
        const outerCode = 2 + (trapStack.length - 1 - idxFromOutermost);
        return { code: outerCode, nextState: { kind: "idle" } };
      }

      case "signal": {
        const localId = state.kind === "signal" ? state.localId : `loc_${stmt.span.startOffset}_${loopDepth}`;
        const innerRename = new Map(renameMap);
        for (const s of stmt.signals) {
          const key = `${localId}:${s.name}`;
          innerRename.set(s.name, key);
          if (!statuses.has(key)) {
            statuses.set(key, "unknown");
          }
        }
        const childState: NodeState = state.kind === "signal" ? state.child : { kind: "idle" };
        const res = this.execStmt(
          stmt.body,
          childState,
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          innerRename,
          loopDepth,
        );
        if (res.code === 1 || res.code === -1) {
          return { code: res.code, nextState: { kind: "signal", localId, child: res.nextState } };
        }
        return { code: res.code, nextState: { kind: "idle" } };
      }

      case "run": {
        const sub = this.moduleMap.get(stmt.moduleName);
        if (!sub) return { code: 0, nextState: { kind: "idle" } };
        const innerRename = new Map(renameMap);
        for (const r of stmt.renamings) {
          innerRename.set(r.formal, renameMap.get(r.actual) ?? r.actual);
        }
        const childState: NodeState = state.kind === "run" ? state.child : { kind: "idle" };
        const res = this.execStmt(
          normalizeStatement(sub.body),
          childState,
          statuses,
          emitted,
          potentialEmits,
          trapStack,
          innerRename,
          loopDepth,
        );
        if (res.code === 1 || res.code === -1) {
          return { code: res.code, nextState: { kind: "run", child: res.nextState } };
        }
        return { code: res.code, nextState: { kind: "idle" } };
      }
    }
  }
}

/**
 * Simulates an Esterel module over a trace of input signal sets (one set per synchronous instant).
 */
export function simulateEsterelTrace(
  programOrSource: EsterelProgram | string,
  inputTrace: ReadonlyArray<Iterable<string>>,
  options: EsterelSimulateOptions = {},
): EsterelTraceResult {
  const program = typeof programOrSource === "string" ? parseEsterel(programOrSource) : programOrSource;
  const sim = new EsterelSimulator(program, options);
  const targetName = options.moduleName ?? program.modules[0]?.name ?? "unknown";
  const reactions = inputTrace.map((inputs) => sim.step(inputs));
  return {
    moduleName: targetName,
    reactions,
    allConstructive: reactions.every((r) => r.constructive),
  };
}
