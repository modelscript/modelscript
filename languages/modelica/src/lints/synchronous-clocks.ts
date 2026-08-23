import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";

export const modelicaSyncLints: Record<string, CompilerLint> = {
  /**
   * M6001: Mixed clock domains without synchronous operator.
   */
  mixedClockDomains: {
    nodes: ["expression"],
    severity: "error",
    code: 6001,
    message: "Mixed clock domains without explicit conversion operator.",
    query: (db: CodeGraph, node: u32) => {
      const left = db.ast.getChildByFieldId(node, "left");
      const right = db.ast.getChildByFieldId(node, "right");
      if (left != 0 && right != 0) {
        const leftSym = db.scope.resolve(left);
        const rightSym = db.scope.resolve(right);
        if (leftSym != 0 && rightSym != 0) {
          const clockL = db.model.getProperty(leftSym, "clockId");
          const clockR = db.model.getProperty(rightSym, "clockId");
          if (clockL != 0 && clockR != 0 && clockL != clockR) {
            db.diagnostic(node);
          }
        }
      }
    },
  },

  /**
   * M6002: Sample factor must be positive integer constant.
   */
  sampleFactorNotPositive: {
    nodes: ["function_call"],
    severity: "error",
    code: 6002,
    message: "Sample factor must be a positive integer.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && (db.ast.textEquals(name, "subSample") || db.ast.textEquals(name, "superSample"))) {
        const factorArg = db.ast.getChildByFieldId(node, "factor");
        if (factorArg != 0) {
          if (
            db.ast.getType(factorArg) == $.unsigned_integer &&
            (db.ast.textEquals(factorArg, "0") || db.ast.textEquals(factorArg, "-1"))
          ) {
            db.diagnostic(factorArg);
          }
        }
      }
    },
  },

  /**
   * M6003: previous() called on non-clocked variable.
   */
  previousOutsideClocked: {
    nodes: ["function_call"],
    severity: "error",
    code: 6003,
    message: "previous() can only be called on clocked discrete variables.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "previous")) {
        let argNode: u32 = 0;
        for (const arg of db.ast.getDescendants(node, $.function_argument)) {
          argNode = arg;
          break;
        }
        if (argNode != 0) {
          const sym = db.scope.resolve(argNode);
          if (sym != 0 && !db.model.hasFlag(sym, "isClocked")) {
            db.diagnostic(argNode);
          }
        }
      }
    },
  },

  /**
   * M6004: hold() called in continuous equation without proper boundary.
   */
  holdInContinuous: {
    nodes: ["function_call"],
    severity: "error",
    code: 6004,
    message: "hold() called in continuous equation without boundary causality.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "hold")) {
        for (const sec of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(sec) == $.equation_section) {
            db.diagnostic(node);
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
    message: "More than one state marked as initialState in state machine.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let initCount = 0;
      for (const comp of db.ast.getDescendants(node, $.component_clause)) {
        for (const mod of db.ast.getDescendants(comp, $.modification)) {
          if (db.ast.textEquals(mod, "initialState = true")) {
            initCount++;
          }
        }
      }
      if (initCount > 1) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M6020: Pure function calls impure function.
   */
  impureCalledInPure: {
    nodes: ["function_call"],
    severity: "error",
    code: 6020,
    message: "Pure function cannot call impure function.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0) {
        const calledSym = db.scope.resolve(name);
        if (calledSym != 0 && db.model.hasFlag(calledSym, "isImpure")) {
          for (const cls of db.ast.getAncestors(node, $.class_definition)) {
            const callerSym = db.scope.resolve(cls);
            if (callerSym != 0 && !db.model.hasFlag(callerSym, "isImpure")) {
              db.diagnostic(node);
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M6021: Impure function called in equation section.
   */
  impureInEquationSection: {
    nodes: ["function_call"],
    severity: "error",
    code: 6021,
    message: "Impure functions may only be called in algorithm sections or when equations.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0) {
        const calledSym = db.scope.resolve(name);
        if (calledSym != 0 && db.model.hasFlag(calledSym, "isImpure")) {
          for (const sec of db.ast.getAncestors(node, $.class_definition)) {
            if (db.ast.getType(sec) == $.equation_section) {
              db.diagnostic(node);
            }
          }
        }
      }
    },
  },

  /**
   * M6040: Break connection not found in base classes.
   */
  breakConnectionNotFound: {
    nodes: ["inheritance_modification"],
    severity: "error",
    code: 6040,
    message: "Break connection does not exist in inherited base classes.",
    query: (db: CodeGraph, node: u32) => {
      const conn = db.ast.getChildByFieldId(node, "connect_equation");
      if (conn != 0) {
        const sym = db.scope.resolve(conn);
        if (sym == 0) {
          db.diagnostic(node);
        }
      }
    },
  },
};
