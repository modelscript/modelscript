import type { QueryHooks } from "@modelscript/polyglot/runtime";

// Import the language definition to access query lambdas directly.
// The functions are NOT serialized — they execute from the original source.
import langDef from "./language.js";

/**
 * Query hooks extracted from language.ts def() rules.
 * Each entry maps a grammar rule name to its query functions.
 */
function buildQueryHooks(): Map<string, QueryHooks> {
  const hooks = new Map<string, QueryHooks>();
  if (!langDef.rules) return hooks;

  // ClassDefinition: members, nestedClasses, components, extendsClasses, imports, inputParameters, outputParameters, parameters, constants, connectEquations, allElements, isConnector, resolveModification, resolveSimpleName, resolveName, instantiate, lint__classNamingConvention, lint__emptyClass, lint__identifierMismatch, lint__duplicateElement, lint__functionPublicVariable, lint__externalWithAlgorithm, lint__functionInvalidVarType, lint__functionProtectedIo, lint__nestedWhen, lint__divisionByZero, lint__assignmentToConstant, lint__forIteratorNot1D, lint__classBodyTypeChecks, lint__tupleExpressionContext, lint__connectFlowMismatch, lint__nonConnectorType, lint__functionArgVariability, lint__functionDefaultArgCycle, lint__unusedInputVariable, lint__unbalancedModel, lint__missingInner, lint__nameNotFound, lint__binaryOpTypeMismatch, lint__withinInScript, lint__arrayDimensionMismatch
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ClassDefinition"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ClassDefinition", merged);
      }
    }
  }

  // ExtendsClause: modificationText, resolvedBaseClass, effectiveModification, lint__extendsCycle
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ExtendsClause"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ExtendsClause", merged);
      }
    }
  }

  // ComponentDeclaration: resolvedType, effectiveModification, isConnectorType, variability, causality, flowPrefix, isFinal, isRedeclare, isInner, isReplaceable, isProtected, isOuter, classInstance, arrayDimensions, lint__componentNamingConvention, lint__modifierNotFound, lint__duplicateModification, lint__implementsTargetUnresolved, lint__unresolvedTypeSpecifier, lint__recursiveDefinition, lint__typeMismatch, lint__bindingTypeMismatch, lint__arrayShapeMismatch, lint__arrayElementTypeMismatch, lint__unresolvedReference, lint__functionCallMismatch, lint__evolutionCheck
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ComponentDeclaration"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ComponentDeclaration", merged);
      }
    }
  }

  // ConnectEquation: validateConnect, lint__nonConnectorType
  {
    const $ = new Proxy(
      {},
      {
        get(_, p) {
          return { type: "sym", name: p };
        },
      },
    );
    const rule = (langDef.rules as Record<string, unknown>)["ConnectEquation"] as (args: unknown) => unknown;
    const ruleAst = rule ? rule($) : null;
    if (ruleAst && (ruleAst as Record<string, unknown>).type === "def") {
      const opts = (ruleAst as Record<string, unknown>).options as Record<string, unknown>;
      const merged = {} as QueryHooks;
      if (opts?.queries) Object.assign(merged, opts.queries);
      // Register lint functions as lint__<name> queries
      if (opts?.lints) {
        for (const [name, fn] of Object.entries(opts.lints as Record<string, unknown>)) {
          (merged as Record<string, unknown>)["lint__" + name] = fn;
        }
      }
      if (Object.keys(merged).length > 0) {
        hooks.set("ConnectEquation", merged);
      }
    }
  }

  return hooks;
}

export const QUERY_HOOKS = buildQueryHooks();
