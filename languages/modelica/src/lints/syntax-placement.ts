import type { CodeGraph, CompilerLint, u16, u32 } from "@modelscript/language";
import { getExpressionVariability, hasTypePrefix, isClassKind, VARIABILITY_CONTINUOUS } from "./helpers.js";

export const modelicaSyntaxLints: Record<string, CompilerLint> = {
  /**
   * M1003: Empty array constructors are not valid in Modelica.
   */
  emptyArrayConstructor: {
    nodes: ["primary"],
    severity: "error",
    code: 1003,
    message: (target) => `Empty array constructor '${target.text}' is not valid in Modelica.`,
    query: (db: CodeGraph, node: u32) => {
      if (db.ast.textEquals(node, "[]") || db.ast.textEquals(node, "{}")) {
        db.diagnostic(node);
      }
    },
  },

  /**
   * M2005: Identifier at start and end of class must match.
   */
  identifierMismatch: {
    nodes: ["long_class_specifier"],
    severity: "error",
    code: 2005,
    message: (target, startId, endId) =>
      `Identifier at end of class ('${endId.text}') does not match start ('${startId.text}').`,
    query: (db: CodeGraph, node: u32) => {
      const startId = db.ast.getChildByFieldId(node, "name");
      const endId = db.ast.getChildByFieldId(node, "end_name");
      if (startId != 0 && endId != 0) {
        if (!db.ast.textEqualsNode(startId, endId)) {
          db.diagnostic(endId, startId, endId);
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
    message: (target) => `Protected element '${target.text}' may not be modified from outside.`,
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
    message: (target) => `Element '${target.text}' is not allowed in function context with algorithm section.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          for (const sec of db.ast.getDescendants(cls, $.algorithm_section)) {
            if (sec != 0) {
              db.diagnostic(node);
              return;
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4007: Non-input/output variable declared in public section of function.
   */
  functionPublicVariable: {
    nodes: ["component_clause"],
    severity: "warning",
    code: 4007,
    message: (target) =>
      `Invalid public variable '${target.text}', function variables that are not input/output must be protected.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            const isIO = hasTypePrefix(db, node, "input") || hasTypePrefix(db, node, "output");
            if (!isIO) {
              for (const decl of db.ast.getDescendants(node, $.component_declaration)) {
                db.diagnostic(decl);
              }
            }
          }
          break;
        }
      }
    },
  },

  /**
   * M4011: Function variables that are input/output must be public.
   */
  functionProtectedIO: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4011,
    message: (target) =>
      `Invalid protected variable with prefix '${target.text}', function inputs/outputs must be public.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
              if (db.ast.textEquals(tp, "input") || db.ast.textEquals(tp, "output")) {
                db.diagnostic(tp);
              }
            }
          }
          break;
        }
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
    message: () => `Nested when statements are not allowed in Modelica.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
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
    nodes: ["output_expression_list"],
    severity: "error",
    code: 4014,
    message: () =>
      `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.statement || db.ast.getType(anc) == $.equation_or_procedure) {
          return;
        }
      }
      db.diagnostic(node);
    },
  },

  /**
   * M4017: Restriction violation (e.g. equations in record).
   */
  restrictionViolation: {
    nodes: ["equation_section"],
    severity: "error",
    code: 4017,
    message: () => `Equations are not allowed in records or connectors.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "record") || isClassKind(db, cls, "connector")) {
            db.diagnostic(node);
          }
          break;
        }
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
    message: (target) => `Illegal to instantiate partial class '${target.text}'.`,
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
    message: (target) => `Trying to redeclare element '${target.text}' but it is not declared as replaceable.`,
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
    message: (target) =>
      `The built-in variable '${target.text}' is only available in models and blocks, not in functions or records.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "time")) {
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (isClassKind(db, cls, "function")) {
              db.diagnostic(node);
            }
            break;
          }
        }
      }
    },
  },

  /**
   * M4022: Enumeration range cannot have a step size.
   */
  enumRangeWithStep: {
    nodes: ["expression"],
    severity: "error",
    code: 4022,
    message: (target) => `Range of type enumeration '${target.text}' may not specify a step size.`,
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
    message: (target) => `connect equation '${target.text}' may not be used inside when-equations.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
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
    message: (target) => `Connect equation '${target.text}' is not allowed in initial equation sections.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.equation_section) {
          if (db.ast.textEquals(anc, "initial")) {
            db.diagnostic(node);
            return;
          }
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
    message: (target) => `Trying to override final element '${target.text}' with modifier.`,
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
    message: (target) => `Invalid prefix '${target.text}' on formal parameter in function.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "function")) {
            for (const tp of db.ast.getDescendants(node, $.type_prefix)) {
              if (db.ast.textEquals(tp, "flow") || db.ast.textEquals(tp, "stream")) {
                db.diagnostic(tp);
              }
            }
          }
          break;
        }
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
    message: () => `Function has more than one algorithm section or external declaration.`,
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
    message: (target) => `Variable '${target.text}' in package must be declared as constant.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const cls of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(cls) == $.class_definition) {
          if (isClassKind(db, cls, "package")) {
            const isConst = hasTypePrefix(db, node, "constant");
            if (!isConst) {
              db.diagnostic(node);
            }
          }
          break;
        }
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
    message: (target) => `Prefix '${target.text}' used outside connector declaration.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      if (db.ast.textEquals(node, "flow")) {
        for (const cls of db.ast.getAncestors(node, 0)) {
          if (db.ast.getType(cls) == $.class_definition) {
            if (!isClassKind(db, cls, "connector")) {
              db.diagnostic(node);
            }
            break;
          }
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
    message: (target) => `Constant '${target.text}' has no value.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const comp of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(comp) == $.component_clause) {
          if (hasTypePrefix(db, comp, "constant")) {
            let hasMod = false;
            for (const mod of db.ast.getDescendants(node, $.modification)) {
              if (mod != 0) hasMod = true;
              break;
            }
            if (!hasMod) {
              db.diagnostic(node);
            }
          }
          break;
        }
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
    message: (target) =>
      `Operator '${target.text}' may only be used in the condition of an if-statement/equation or an assert.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "cardinality")) {
        for (const anc of db.ast.getAncestors(node, 0)) {
          const type = db.ast.getType(anc);
          if (type == $.if_equation || type == $.if_statement) return;
        }
        db.diagnostic(node);
      }
    },
  },

  /**
   * M4025: connect() inside if-equation with non-parametric condition.
   */
  connectInNonParamIf: {
    nodes: ["connect_equation"],
    severity: "error",
    code: 4025,
    message: (target) =>
      `connect equation '${target.text}' may not be used inside if-equations with non-parametric conditions.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      for (const anc of db.ast.getAncestors(node, 0)) {
        if (db.ast.getType(anc) == $.if_equation) {
          const cond = db.ast.getChildByFieldId(anc, "condition");
          if (cond != 0) {
            const varb = getExpressionVariability(db, cond, $);
            if (varb == VARIABILITY_CONTINUOUS) {
              db.diagnostic(node);
              return;
            }
          }
        }
      }
    },
  },

  /**
   * M4028: Component has partial type without replaceable declaration.
   */
  partialTypeComponent: {
    nodes: ["component_clause"],
    severity: "error",
    code: 4028,
    message: (target) => `Component '${target.text}' has partial type.`,
    query: (db: CodeGraph, node: u32) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        const sym = db.scope.resolve(typeSpec);
        if (sym != 0 && db.model.hasFlag(sym, "isPartial")) {
          const isReplaceable = db.ast.getChildByFieldId(node, "replaceable") != 0;
          if (!isReplaceable) {
            db.diagnostic(typeSpec);
          }
        }
      }
    },
  },

  /**
   * M4048: Expected component instance, but found class in cardinality().
   */
  cardinalityExpectedComponent: {
    nodes: ["function_call"],
    severity: "error",
    code: 4048,
    message: (target) => `Expected '${target.text}' to be a component instance, but found class instead.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const name = db.ast.getChildByFieldId(node, "name");
      if (name != 0 && db.ast.textEquals(name, "cardinality")) {
        for (const arg of db.ast.getDescendants(node, $.function_argument)) {
          const sym = db.scope.resolve(arg);
          if (sym != 0 && db.model.hasFlag(sym, "isClass")) {
            db.diagnostic(arg);
          }
          break;
        }
      }
    },
  },

  /**
   * M4051: Class extending builtin type may not have other elements.
   */
  builtinExtendsWithElements: {
    nodes: ["extends_clause"],
    severity: "error",
    code: 4051,
    message: (target) => `A class extending from builtin type '${target.text}' may not have other elements.`,
    query: (db: CodeGraph, node: u32, $: Record<string, u16>) => {
      const typeSpec = db.ast.getChildByFieldId(node, "type_specifier");
      if (typeSpec != 0) {
        if (
          db.ast.textEquals(typeSpec, "Real") ||
          db.ast.textEquals(typeSpec, "Integer") ||
          db.ast.textEquals(typeSpec, "Boolean") ||
          db.ast.textEquals(typeSpec, "String")
        ) {
          for (const cls of db.ast.getAncestors(node, 0)) {
            if (db.ast.getType(cls) == $.class_definition) {
              let compCount = 0;
              for (const comp of db.ast.getDescendants(cls, $.component_declaration)) {
                if (comp != 0) compCount++;
              }
              if (compCount > 0) {
                db.diagnostic(node);
              }
              break;
            }
          }
        }
      }
    },
  },
};
