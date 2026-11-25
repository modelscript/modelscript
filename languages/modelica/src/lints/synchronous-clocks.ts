// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/synchronous-clocks
 *
 * CST-level `CompilerLint` rules for Modelica 3.3+ Synchronous Language Elements (MLS Chapter 16),
 * Hierarchical State Machines (MLS Chapter 17), and Function Purity (MLS §12.3).
 */

import type { CodeGraph, CompilerLint, u32 } from "@modelscript/dsl";
import {
  getCallCalleeNode,
  getInvalidTransitionPriorityNode,
  getNonClockedOperatorArgNode,
  hasMixedClockDomains,
  hasNonPositiveSampleFactor,
  isDescendantOfInnerClass,
  isImpureCalledInEquationSection,
  isImpureCalledInPureFunction,
  isPreviousOnNonClocked,
  type ModelicaGrammarSymbols,
} from "./helpers.js";

/**
 * Registry of Modelica CST lint rules for synchronous clocks, state machines, and function purity (M6xxx).
 */
export const modelicaSyncLints: Record<string, CompilerLint> = {
  /**
   * M6001: Mixed clock domains without synchronous operator (MLS §16.5).
   * Enforces that all clocked operands in a binary expression belong to the same clock partition
   * unless explicitly converted via `subSample`, `superSample`, `shiftSample`, or `backSample`.
   */
  mixedClockDomains: {
    nodes: ["expression"],
    severity: "error",
    code: 6001,
    message: (target) => `Clocked expression '${target.text}' mixes signals from different clock domains.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Check if left and right sub-expressions reference distinct Clock(...) definitions or mix sample() and previous()
      if (hasMixedClockDomains(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M6002: Sample factor must be positive integer constant (MLS §16.5.2).
   * Enforces that the resolution factor $n \ge 1$ in `subSample(u, n)`, `superSample(u, n)`,
   * `shiftSample(u, n)`, and `backSample(u, n)` is strictly positive.
   */
  sampleFactorNotPositive: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6002,
    message: () => `Sub-clock factor must be a non-negative integer (or 0 for inferred factor).`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Inspect calls to synchronous multi-rate clock conversion operators
      const name = getCallCalleeNode(db, node, $);
      if (
        name != 0 &&
        (db.ast.textEquals(name, "subSample") ||
          db.ast.textEquals(name, "superSample") ||
          db.ast.textEquals(name, "shiftSample") ||
          db.ast.textEquals(name, "backSample"))
      ) {
        // Verify that the 2nd positional argument (factor) is not negative (0 means inferred)
        if (hasNonPositiveSampleFactor(db, node, $)) {
          db.diagnosticAt(name, node);
        }
      }
    },
  },

  /**
   * M6003: `previous()` called on non-clocked variable (MLS §16.4.1).
   * Enforces that `previous(u)` is only applied to clocked discrete-time variables,
   * rejecting continuous `time`, `parameter`, or `constant` operands.
   */
  previousOutsideClocked: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6003,
    message: (target) =>
      `Operator 'previous()' may only be applied to clocked discrete-time variables in '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "previous")) {
        // Reject `previous(time)` or `previous(paramOrConst)` per MLS §16.4.1
        if (isPreviousOnNonClocked(db, node, $)) {
          db.diagnosticAt(name, node);
        }
      }
    },
  },

  /**
   * M6004: `hold()` called inside a clocked or continuous derivative operator (MLS §16.3.2).
   * `hold(u)` converts a clocked signal to piecewise-constant continuous-time; it cannot be
   * differentiated directly via `der(hold(u))` or nested inside clocked operators.
   */
  holdInContinuous: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6004,
    message: (target) =>
      `Operator 'hold()' converts a clocked signal to continuous-time and cannot be used inside a clocked partition: '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "hold")) {
        // Walk ancestor call expressions to detect illegal nesting inside der(), previous(), subSample(), or superSample()
        for (const anc of db.ast.getAncestors(node, 0)) {
          if (anc != node) {
            const t = db.ast.getType(anc);
            if (t == $.primary && db.ast.startsWith(anc, "der(")) {
              db.diagnosticAt(name, node);
              break;
            }
            if (t == $.function_call || t == $.primary) {
              const outerName = getCallCalleeNode(db, anc, $);
              if (
                outerName != 0 &&
                (db.ast.textEquals(outerName, "previous") ||
                  db.ast.textEquals(outerName, "subSample") ||
                  db.ast.textEquals(outerName, "superSample") ||
                  db.ast.textEquals(outerName, "der"))
              ) {
                db.diagnosticAt(name, node);
                break;
              }
            }
          }
        }
      }
    },
  },

  /**
   * M6010: More than one `initialState` in state machine (MLS §17.1).
   * Enforces that each hierarchical state machine cluster designates at most one initial state
   * via `initialState(s)` or `initialState = true`.
   */
  duplicateInitialState: {
    nodes: ["class_definition"],
    severity: "error",
    code: 6010,
    message: (target) =>
      `More than one state marked as initialState in state machine '${target["name"] || target.text}'.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      let targetNode = node;
      for (const spec of db.ast.getDescendants(node, $.long_class_specifier)) {
        const nameId = db.ast.getChildByFieldId(spec, "name");
        if (nameId != 0) targetNode = nameId;
        break;
      }
      for (const spec of db.ast.getDescendants(node, $.short_class_specifier)) {
        const nameId = db.ast.getChildByFieldId(spec, "name");
        if (nameId != 0) targetNode = nameId;
        break;
      }

      // Count component declarations with modifier `initialState = true` in the immediate class scope
      let compInitCount = 0;
      for (const comp of db.ast.getDescendants(node, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, node, $)) continue;
        for (const mod of db.ast.getDescendants(comp, $.modification)) {
          if (db.ast.textEquals(mod, "initialState = true") || db.ast.textEquals(mod, "initialState=true")) {
            compInitCount++;
          }
        }
      }
      if (compInitCount > 1) {
        db.diagnostic(targetNode);
        return;
      }

      // In each equation section, cluster states connected by `transition(from, to, ...)` calls so
      // multiple disjoint parallel state machines in one equation section may each have one initialState().
      if ($.equation_section != 0) {
        const getCallArgIdNode = (callNode: u32, targetIndex: u32): u32 => {
          let argList: u32 = 0;
          for (const fa of db.ast.getDescendants(callNode, $.function_arguments)) {
            if (fa != callNode) {
              argList = fa;
              break;
            }
          }
          if (argList == 0) return 0;
          let posIdx: u32 = 0;
          for (const fa of db.ast.getDescendants(argList, $.function_argument)) {
            let nestedCall = false;
            for (const anc of db.ast.getAncestors(fa, 0, argList)) {
              const at = db.ast.getType(anc);
              if (at == $.function_call || at == $.function_call_args) {
                nestedCall = true;
                break;
              }
            }
            if (nestedCall) continue;
            if (posIdx == targetIndex) {
              for (const cr of db.ast.getDescendants(fa, $.component_reference)) {
                return cr;
              }
              for (const id of db.ast.getDescendants(fa, $.identifier)) {
                return id;
              }
              return fa;
            }
            posIdx++;
          }
          return 0;
        };

        for (const eqSec of db.ast.getDescendants(node, $.equation_section)) {
          if (isDescendantOfInnerClass(db, eqSec, node, $)) continue;
          const initArgNodes = new Array<u32>();
          const edgeFromNodes = new Array<u32>();
          const edgeToNodes = new Array<u32>();

          for (const fc of db.ast.getDescendants(eqSec, $.function_call)) {
            if (isDescendantOfInnerClass(db, fc, eqSec, $)) continue;
            const fnName = getCallCalleeNode(db, fc, $);
            if (fnName == 0) continue;
            if (db.ast.textEquals(fnName, "initialState")) {
              const sNode = getCallArgIdNode(fc, 0);
              let already = false;
              for (let k: u32 = 0; k < (initArgNodes.length as u32); k++) {
                if ((initArgNodes[k] as u32) == sNode) {
                  already = true;
                  break;
                }
              }
              if (!already) initArgNodes.push(sNode);
            } else if (db.ast.textEquals(fnName, "transition")) {
              const fromN = getCallArgIdNode(fc, 0);
              const toN = getCallArgIdNode(fc, 1);
              if (fromN != 0 && toN != 0) {
                edgeFromNodes.push(fromN);
                edgeToNodes.push(toN);
              }
            }
          }
          if ($.primary != 0) {
            for (const pr of db.ast.getDescendants(eqSec, $.primary)) {
              if (isDescendantOfInnerClass(db, pr, eqSec, $)) continue;
              const fnName = getCallCalleeNode(db, pr, $);
              if (fnName == 0) continue;
              if (db.ast.textEquals(fnName, "initialState")) {
                const sNode = getCallArgIdNode(pr, 0);
                // Avoid double-counting when primary wraps function_call
                let already = false;
                for (let k: u32 = 0; k < (initArgNodes.length as u32); k++) {
                  if ((initArgNodes[k] as u32) == sNode) {
                    already = true;
                    break;
                  }
                }
                if (!already) initArgNodes.push(sNode);
              } else if (db.ast.textEquals(fnName, "transition")) {
                const fromN = getCallArgIdNode(pr, 0);
                const toN = getCallArgIdNode(pr, 1);
                if (fromN != 0 && toN != 0) {
                  edgeFromNodes.push(fromN);
                  edgeToNodes.push(toN);
                }
              }
            }
          }

          if (initArgNodes.length <= 1) continue;

          // If no transition(...) edges exist at all, multiple initialState() calls belong to one ambiguous scope
          if (edgeFromNodes.length == 0) {
            db.diagnostic(targetNode);
            return;
          }

          // Check whether any pair of initialState(s_i), initialState(s_j) are in the same undirected transition component
          let conflict = false;
          for (let i: u32 = 0; i < (initArgNodes.length as u32) && !conflict; i++) {
            const si = initArgNodes[i] as u32;
            if (si == 0) {
              conflict = true;
              break;
            }
            // BFS reachable state nodes starting from si
            const reached = new Array<u32>();
            reached.push(si);
            let head: u32 = 0;
            while (head < (reached.length as u32)) {
              const cur = reached[head++] as u32;
              for (let e: u32 = 0; e < (edgeFromNodes.length as u32); e++) {
                const ef = edgeFromNodes[e] as u32;
                const et = edgeToNodes[e] as u32;
                if (db.ast.textEqualsNode(cur, ef)) {
                  let seenT = false;
                  for (let r: u32 = 0; r < (reached.length as u32); r++) {
                    if (db.ast.textEqualsNode(reached[r] as u32, et)) {
                      seenT = true;
                      break;
                    }
                  }
                  if (!seenT) reached.push(et);
                } else if (db.ast.textEqualsNode(cur, et)) {
                  let seenF = false;
                  for (let r: u32 = 0; r < (reached.length as u32); r++) {
                    if (db.ast.textEqualsNode(reached[r] as u32, ef)) {
                      seenF = true;
                      break;
                    }
                  }
                  if (!seenF) reached.push(ef);
                }
              }
            }

            for (let j: u32 = i + 1; j < (initArgNodes.length as u32); j++) {
              const sj = initArgNodes[j] as u32;
              if (sj == 0) {
                conflict = true;
                break;
              }
              for (let r: u32 = 0; r < (reached.length as u32); r++) {
                if (db.ast.textEqualsNode(reached[r] as u32, sj)) {
                  conflict = true;
                  break;
                }
              }
              if (conflict) break;
            }
          }

          if (conflict) {
            db.diagnostic(targetNode);
            return;
          }
        }
      }
    },
  },

  /**
   * M6020: Pure function calls impure function (MLS §12.3).
   * Enforces that a `pure function` (or unprefixed function, which is pure by default in Modelica 3.3+)
   * may not call a function declared `impure`.
   */
  impureCalledInPure: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6020,
    message: (target) => `Impure function '${target.text}' cannot be called inside a pure function.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Verify that the enclosing function is pure and the target callee is declared impure
      if (isImpureCalledInPureFunction(db, node, $)) {
        const callee = db.ast.getFirstChild(node);
        db.diagnostic(callee != 0 ? callee : node);
      }
    },
  },

  /**
   * M6021: Impure function called in continuous equation section (MLS §12.3).
   * Enforces that `impure` functions are only called inside `when`-equations, `when`-statements,
   * or `algorithm` sections, never in continuous-time equations.
   */
  impureInEquationSection: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6021,
    message: (target) =>
      `Impure function '${target.text}' may only be called inside a when-equation or when-statement.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      // Check if an impure function is invoked directly inside an equation_section outside any when_equation
      if (isImpureCalledInEquationSection(db, node, $)) {
        const callee = db.ast.getFirstChild(node);
        db.diagnostic(callee != 0 ? callee : node);
      }
    },
  },

  /**
   * M6050: State machine `transition()` priority must be a positive integer (>= 1) and unique per source state (MLS §17.3.2).
   */
  transitionPriorityInvalid: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6050,
    message: (target) =>
      `Transition priority '${target.text}' must be a positive integer (>= 1) and unique among transitions exiting the same state.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      if (db.ast.getType(node) == $.primary) {
        const fc = db.ast.getFirstChild(node);
        if (fc != 0 && db.ast.getType(fc) == $.function_call) return;
      }
      const badPrio = getInvalidTransitionPriorityNode(db, node, $);
      if (badPrio != 0) {
        db.diagnostic(badPrio);
      }
    },
  },

  /**
   * M6051: `firstTick()` called on continuous-time `time` or non-clocked constant/parameter (MLS §16.4.2).
   */
  firstTickInvalidArgument: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6051,
    message: (target) =>
      `Operator 'firstTick(${target.text})' cannot be applied to continuous-time 'time' or non-clocked constant/parameter expressions.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      if (db.ast.getType(node) == $.primary) {
        const fc = db.ast.getFirstChild(node);
        if (fc != 0 && db.ast.getType(fc) == $.function_call) return;
      }
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "firstTick")) {
        const badArg = getNonClockedOperatorArgNode(db, node, $);
        if (badArg != 0) {
          db.diagnostic(badArg);
        }
      }
    },
  },

  /**
   * M6052: `interval()` called on continuous-time `time` or non-clocked constant/parameter (MLS §16.9).
   */
  intervalInvalidArgument: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6052,
    message: (target) =>
      `Operator 'interval(${target.text})' cannot be applied to continuous-time 'time' or non-clocked constant/parameter expressions.`,
    query: (db: CodeGraph, node: u32, $: ModelicaGrammarSymbols) => {
      if (db.ast.getType(node) == $.primary) {
        const fc = db.ast.getFirstChild(node);
        if (fc != 0 && db.ast.getType(fc) == $.function_call) return;
      }
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "interval")) {
        const badArg = getNonClockedOperatorArgNode(db, node, $);
        if (badArg != 0) {
          db.diagnostic(badArg);
        }
      }
    },
  },
};
