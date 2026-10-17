// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/dsl";
import {
  getCallCalleeNode,
  hasMixedClockDomains,
  hasNonPositiveSampleFactor,
  isDescendantOfInnerClass,
  isImpureCalledInEquationSection,
  isImpureCalledInPureFunction,
  isPreviousOnNonClocked,
} from "./helpers.js";

export const modelicaSyncLints: Record<string, CompilerLint> = {
  /**
   * M6001: Mixed clock domains without synchronous operator.
   */
  mixedClockDomains: {
    nodes: ["expression"],
    severity: "error",
    code: 6001,
    message: (target) => `Mixed clock domains in expression '${target.text}' without explicit conversion operator.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (hasMixedClockDomains(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M6002: Sample factor must be positive integer constant.
   */
  sampleFactorNotPositive: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6002,
    message: (target) => `Sample factor '${target.text}' must be a positive non-zero integer.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = getCallCalleeNode(db, node, $);
      if (
        name != 0 &&
        (db.ast.textEquals(name, "subSample") ||
          db.ast.textEquals(name, "superSample") ||
          db.ast.textEquals(name, "shiftSample") ||
          db.ast.textEquals(name, "backSample"))
      ) {
        if (hasNonPositiveSampleFactor(db, node, $)) {
          db.diagnostic(node);
        }
      }
    },
  },

  /**
   * M6003: previous() called on non-clocked variable.
   */
  previousOutsideClocked: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6003,
    message: (target) =>
      `previous() can only be called on clocked discrete variables, but '${target.text}' is unclocked.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "previous")) {
        if (isPreviousOnNonClocked(db, node, $)) {
          db.diagnostic(node);
        }
      }
    },
  },

  /**
   * M6004: hold() called inside a clocked or continuous derivative operator.
   */
  holdInContinuous: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6004,
    message: () => `hold() operator cannot be called in continuous equation section without boundary causality.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = getCallCalleeNode(db, node, $);
      if (name != 0 && db.ast.textEquals(name, "hold")) {
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
   * M6010: More than one initialState in state machine.
   */
  duplicateInitialState: {
    nodes: ["class_definition"],
    severity: "error",
    code: 6010,
    message: (target) => `More than one state marked as initialState in state machine '${target.name || target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let initCount = 0;
      for (const comp of db.ast.getDescendants(node, $.component_clause)) {
        if (isDescendantOfInnerClass(db, comp, node, $)) continue;
        for (const mod of db.ast.getDescendants(comp, $.modification)) {
          if (db.ast.textEquals(mod, "initialState = true") || db.ast.textEquals(mod, "initialState=true")) {
            initCount++;
          }
        }
      }
      for (const fc of db.ast.getDescendants(node, $.function_call)) {
        if (isDescendantOfInnerClass(db, fc, node, $)) continue;
        const fnName = getCallCalleeNode(db, fc, $);
        if (fnName != 0 && db.ast.textEquals(fnName, "initialState")) {
          initCount++;
        }
      }
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
   * M6020: Pure function calls impure function.
   */
  impureCalledInPure: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6020,
    message: (target) => `Pure function cannot call impure function '${target.text}'.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (isImpureCalledInPureFunction(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M6021: Impure function called in equation section.
   */
  impureInEquationSection: {
    nodes: ["function_call", "primary"],
    severity: "error",
    code: 6021,
    message: (target) => `Impure function '${target.text}' may only be called in algorithm sections or when equations.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (isImpureCalledInEquationSection(db, node, $)) {
        db.diagnostic(node);
      }
    },
  },
};
