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
  hasMixedClockDomains,
  hasNonPositiveSampleFactor,
  isDescendantOfInnerClass,
  isImpureCalledInEquationSection,
  isImpureCalledInPureFunction,
  isPreviousOnNonClocked,
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
    message: (target) => `Mixed clock domains in expression '${target.text}' without explicit conversion operator.`,
    query: (db: CodeGraph, node: u32, $: any) => {
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
    message: (target) => `Sample factor '${target.text}' must be a positive non-zero integer.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Inspect calls to synchronous multi-rate clock conversion operators
      const name = getCallCalleeNode(db, node, $);
      if (
        name != 0 &&
        (db.ast.textEquals(name, "subSample") ||
          db.ast.textEquals(name, "superSample") ||
          db.ast.textEquals(name, "shiftSample") ||
          db.ast.textEquals(name, "backSample"))
      ) {
        // Verify that the 2nd positional argument (factor) is not <= 0
        if (hasNonPositiveSampleFactor(db, node, $)) {
          db.diagnostic(node);
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
      `previous() can only be called on clocked discrete variables, but '${target.text}' is unclocked.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "previous")) {
        // Reject `previous(time)` or `previous(paramOrConst)` per MLS §16.4.1
        if (isPreviousOnNonClocked(db, node, $)) {
          db.diagnostic(node);
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
    message: () => `hold() operator cannot be called in continuous equation section without boundary causality.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "hold")) {
        // Walk ancestor call expressions to detect illegal nesting inside der(), previous(), subSample(), or superSample()
        for (const anc of db.ast.getAncestors(node, 0)) {
          if (anc != node) {
            const t = db.ast.getType(anc);
            if (t == $.primary && db.ast.startsWith(anc, "der(")) {
              db.diagnostic(node);
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
                db.diagnostic(node);
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
    query: (db: CodeGraph, node: u32, $: any) => {
      let initCount = 0;
      // Count component declarations with modifier `initialState = true` in the immediate class scope
      for (const comp of db.ast.getDescendants(node, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, node, $)) continue;
        for (const mod of db.ast.getDescendants(comp, $.modification)) {
          if (db.ast.textEquals(mod, "initialState = true") || db.ast.textEquals(mod, "initialState=true")) {
            initCount++;
          }
        }
      }
      // Count `initialState(...)` operator calls in equations of the immediate class scope
      for (const fc of db.ast.getDescendants(node, $.function_call)) {
        if (isDescendantOfInnerClass(db, fc, node, $)) continue;
        const fnName = getCallCalleeNode(db, fc, $);
        if (fnName != 0 && db.ast.textEquals(fnName, "initialState")) {
          initCount++;
        }
      }
      // Emit M6010 if multiple initial states are declared in the same state machine partition
      if (initCount > 1) {
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
        db.diagnostic(targetNode);
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
    message: (target) => `Pure function cannot call impure function '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Verify that the enclosing function is pure and the target callee is declared impure
      if (isImpureCalledInPureFunction(db, node, $)) {
        db.diagnostic(node);
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
    message: (target) => `Impure function '${target.text}' may only be called in algorithm sections or when equations.`,
    query: (db: CodeGraph, node: u32, $: any) => {
      // Check if an impure function is invoked directly inside an equation_section outside any when_equation
      if (isImpureCalledInEquationSection(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },
};
