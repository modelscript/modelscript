import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";

export const modelicaSyntaxLints: Record<string, CompilerLint> = {
  /**
   * M1003: Empty array constructors are not valid in Modelica.
   */
  emptyArrayConstructor: {
    nodes: ["array_constructor", "array_comprehension"],
    severity: "error",
    code: 1003,
    message: "Parse error: Empty array constructors are not valid in Modelica.",
    query: (db: CodeGraph, node: u32) => {
      if (db.ast.getChildCount(node) == 0) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M2005: Identifier at start and end of class must match.
   */
  identifierMismatch: {
    nodes: ["class_definition"],
    severity: "error",
    code: 2005,
    message: "The identifier at start and end are different.",
    query: (db: CodeGraph, node: u32) => {
      const startId = db.ast.getChildByFieldId(node, "name");
      const endId = db.ast.getChildByFieldId(node, "end_name");
      if (startId != 0 && endId != 0) {
        if (!db.ast.textEqualsNode(startId, endId)) {
          db.diagnostic(endId);
        }
      }
    },
  },

  /**
   * M4005: Protected element may not be modified from outside.
   */
  protectedModification: {
    nodes: ["modification"],
    severity: "error",
    code: 4005,
    message: "Protected element may not be modified.",
    query: (db: CodeGraph, node: u32) => {
      const targetId = db.scope.resolve(node);
      if (targetId != 0 && db.model.hasFlag(targetId, "isProtected")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4006: Function cannot have both external and algorithm sections.
   */
  externalWithAlgorithm: {
    nodes: ["external_clause"],
    severity: "error",
    code: 4006,
    message: "Element is not allowed in function context: algorithm.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const sec of db.ast.getDescendants(cls, $.algorithm_section)) {
          if (sec != 0) {
            db.diagnostic(node);
            return;
          }
        }
        break;
      }
    },
  },

  /**
   * M4007: Non-input/output variable declared in public section of function.
   */
  functionPublicVariable: {
    nodes: ["public_element_list"],
    severity: "warning",
    code: 4007,
    message: "Invalid public variable, function variables that are not input/output must be protected.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
          if (db.ast.textEquals(pfx, "function")) {
            for (const comp of db.ast.getDescendants(node, $.component_clause)) {
              let hasIO = false;
              for (const tp of db.ast.getDescendants(comp, $.type_prefix)) {
                if (db.ast.textEquals(tp, "input") || db.ast.textEquals(tp, "output")) {
                  hasIO = true;
                }
              }
              if (!hasIO) {
                db.diagnostic(comp);
              }
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4011: Function variables that are input/output must be public.
   */
  functionProtectedIO: {
    nodes: ["protected_element_list"],
    severity: "error",
    code: 4011,
    message: "Invalid protected variable, function variables that are input/output must be public.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
          if (db.ast.textEquals(pfx, "function")) {
            for (const comp of db.ast.getDescendants(node, $.component_clause)) {
              for (const tp of db.ast.getDescendants(comp, $.type_prefix)) {
                if (db.ast.textEquals(tp, "input") || db.ast.textEquals(tp, "output")) {
                  db.diagnostic(tp);
                }
              }
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4013: Nested when statements are forbidden.
   */
  nestedWhen: {
    nodes: ["when_statement", "when_equation"],
    severity: "error",
    code: 4013,
    message: "Nested when statements are not allowed.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, $.class_definition)) {
        if (anc != node && (db.ast.getType(anc) == $.when_statement || db.ast.getType(anc) == $.when_equation)) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4014: Tuple expressions only allowed on LHS of assignment/equation.
   */
  tupleExpressionContext: {
    nodes: ["tuple_expression"],
    severity: "error",
    code: 4014,
    message:
      "Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const parent = db.ast.getFirstChild(node);
      if (parent != 0 && db.ast.getType(parent) != $.statement && db.ast.getType(parent) != $.equation) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4017: Restriction violation (e.g. equations in record).
   */
  restrictionViolation: {
    nodes: ["equation_section"],
    severity: "error",
    code: 4017,
    message: "Equations are not allowed in records or connectors.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
          if (db.ast.textEquals(pfx, "record") || db.ast.textEquals(pfx, "connector")) {
            db.diagnostic(node);
          }
        }
        break;
      }
    },
  },

  /**
   * M4018: Partial class instantiation is illegal.
   */
  partialInstantiation: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4018,
    message: "Illegal to instantiate partial class.",
    query: (db: CodeGraph, node: u32) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const symId = db.scope.resolve(typeSpec);
        if (symId != 0 && db.model.hasFlag(symId, "isPartial")) {
          db.diagnostic(typeSpec);
        }
      }
    },
  },

  /**
   * M4019: Redeclare on non-replaceable element.
   */
  redeclareNonReplaceable: {
    nodes: ["element"],
    severity: "error",
    code: 4019,
    message: "Trying to redeclare element but it is not declared as replaceable.",
    query: (db: CodeGraph, node: u32) => {
      const redeclarePfx = db.ast.getChildByFieldId(node, "redeclare");
      if (redeclarePfx != 0) {
        const symId = db.scope.resolve(node);
        if (symId != 0 && !db.model.hasFlag(symId, "isReplaceable")) {
          db.diagnostic(node);
        }
      }
    },
  },

  /**
   * M4020: 'time' variable is only available in models and blocks.
   */
  builtinTimeInvalid: {
    nodes: ["identifier"],
    severity: "error",
    code: 4020,
    message: "The built-in variable 'time' is only available in models and blocks, not in functions or records.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "time")) {
        for (const cls of db.ast.getAncestors(node, $.class_definition)) {
          for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
            if (db.ast.textEquals(pfx, "function")) {
              db.diagnostic(node);
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4022: Enumeration range cannot have a step size.
   */
  enumRangeWithStep: {
    nodes: ["range_expression"],
    severity: "error",
    code: 4022,
    message: "Range of type enumeration may not specify a step size.",
    query: (db: CodeGraph, node: u32) => {
      const stepChild = db.ast.getChildByFieldId(node, "step");
      const startChild = db.ast.getChildByFieldId(node, "start");
      if (stepChild != 0 && startChild != 0) {
        const startType = db.model.getProperty(db.scope.resolve(startChild), "baseType");
        if (startType == 4 /* Enum */) {
          db.diagnostic(stepChild);
        }
      }
    },
  },

  /**
   * M4023: connect() may not be used inside when-equations.
   */
  connectInWhen: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4023,
    message: "connect may not be used inside when-equations.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, $.class_definition)) {
        if (db.ast.getType(anc) == $.when_equation || db.ast.getType(anc) == $.when_statement) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4024: connect() equations are not allowed in initial equation sections.
   */
  connectInInitial: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4024,
    message: "Connect equations are not allowed in initial equation sections.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, $.class_definition)) {
        if (db.ast.getType(anc) == $.initial_equation_section) {
          db.diagnostic(node);
          return;
        }
      }
    },
  },

  /**
   * M4026: Trying to override a final element.
   */
  finalOverride: {
    nodes: ["modification"],
    severity: "error",
    code: 4026,
    message: "Trying to override final element with modifier.",
    query: (db: CodeGraph, node: u32) => {
      const symId = db.scope.resolve(node);
      if (symId != 0 && db.model.hasFlag(symId, "isFinal")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4032: Invalid prefix on function formal parameter.
   */
  functionInvalidPrefix: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4032,
    message: "Invalid prefix on formal parameter.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
          if (db.ast.textEquals(pfx, "function")) {
            for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
              if (db.ast.textEquals(tp, "flow") || db.ast.textEquals(tp, "stream")) {
                db.diagnostic(tp);
              }
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4033: Function has more than one algorithm or external section.
   */
  functionMultipleAlgorithm: {
    nodes: ["class_definition"],
    severity: "error",
    code: 4033,
    message: "Function has more than one algorithm section or external declaration.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      let count = 0;
      for (const sec of db.ast.getDescendants(node, $.algorithm_section)) {
        if (sec != 0) count++;
      }
      for (const ext of db.ast.getDescendants(node, $.external_clause)) {
        if (ext != 0) count++;
      }
      if (count > 1) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4036: Variable in package is not constant.
   */
  packageVariableNotConstant: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4036,
    message: "Variable in package is not constant.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, $.class_definition)) {
        for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
          if (db.ast.textEquals(pfx, "package")) {
            let isConst = false;
            for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
              if (db.ast.textEquals(tp, "constant")) isConst = true;
            }
            if (!isConst) {
              db.diagnostic(node);
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4038: Prefix 'flow' used outside connector declaration.
   */
  flowOutsideConnector: {
    nodes: ["type_prefix"],
    severity: "warning",
    code: 4038,
    message: "Prefix 'flow' used outside connector declaration.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "flow")) {
        for (const cls of db.ast.getAncestors(node, $.class_definition)) {
          let inConnector = false;
          for (const pfx of db.ast.getDescendants(cls, $.class_prefixes)) {
            if (db.ast.textEquals(pfx, "connector")) inConnector = true;
          }
          if (!inConnector) {
            db.diagnostic(node);
          }
          break;
        }
      }
    },
  },

  /**
   * M4042: Constant declaration has no value.
   */
  constantHasNoValue: {
    nodes: ["component_declaration"],
    severity: "error",
    code: 4042,
    message: "Constant has no value.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, $.component_clause)) {
        for (const pfx of db.ast.getDescendants(comp, $.type_prefix)) {
          if (db.ast.textEquals(pfx, "constant")) {
            let hasBinding = false;
            for (const mod of db.ast.getDescendants(node, $.modification_expression)) {
              if (mod) {
                hasBinding = true;
                break;
              }
            }
            if (!hasBinding) {
              db.diagnostic(node);
            }
          }
        }
        break;
      }
    },
  },

  /**
   * M4047: cardinality() used in invalid context.
   */
  cardinalityInvalidContext: {
    nodes: ["function_call"],
    severity: "error",
    code: 4047,
    message: "cardinality may only be used in the condition of an if-statement/equation or an assert.",
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "cardinality")) {
        for (const anc of db.ast.getAncestors(node, $.class_definition)) {
          const type = db.ast.getType(anc);
          if (type == $.if_equation || type == $.if_statement) return;
        }
        db.diagnostic(node);
      }
    },
  },
};
