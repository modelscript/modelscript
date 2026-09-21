import { LanguageOptions as GrammarOptions } from "../../dsl/language.js";
import { typesysEngineCode } from "../../src-gen/runtime-templates.js";
import { getDJB2Hash } from "../shared/utils.js";
import { transpileQuery } from "../transpiler/transpiler.js";

/**
 * Generates an AssemblyScript Hindley-Milner type inference, unification, and subtyping engine.
 * Emits type tables, constructor helpers, occurs-check routines, and assignability logic.
 *
 * @param grammar Language configuration options.
 * @param customCode Supplemental AssemblyScript code provided by the DSL.
 * @returns AssemblyScript source code string for the type system engine.
 */
export function generateTypeSystem(grammar: GrammarOptions, customCode: string): string {
  let subtypingLogic = "";
  let subtypingHelpers = "";
  let predIdx = 0;
  if (grammar.typeSystem?.subtypingPredicates) {
    for (const pred of grammar.typeSystem.subtypingPredicates) {
      if (typeof pred === "string") {
        subtypingLogic += `  if (factExists(${getDJB2Hash(pred)}, sourceId, targetId)) return true;\n`;
      } else if (typeof pred === "function" || typeof pred === "object") {
        const anyPred = pred as any;
        if (anyPred && (anyPred.predicate === "subtype" || anyPred.isSubtypeHelper)) {
          const formatTypeVal = (val: any): string => {
            if (val === undefined || val === null) return "0";
            if (typeof val === "object") {
              val = val.value || val.name || val.id || JSON.stringify(val);
            }
            const sVal = String(val);
            if (/^\d+$/.test(sVal)) return sVal;
            if (sVal.startsWith("VarType.") || sVal.startsWith("SyntaxType.") || sVal.startsWith("<")) return sVal;
            if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(sVal)) {
              const upper = sVal.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
              if (grammar.rules && (grammar.rules[sVal] || grammar.rules[upper])) {
                return `<u16>SyntaxType.${upper}`;
              }
              return `${getDJB2Hash(sVal)}`;
            }
            return sVal;
          };

          const s = formatTypeVal(anyPred.args ? anyPred.args[0] : undefined);
          const t = formatTypeVal(anyPred.args ? anyPred.args[1] : undefined);
          subtypingLogic += `  if (sourceId == ${s} && targetId == ${t}) return true;\n`;
        } else {
          const queryInfo = transpileQuery(pred, { context: "subtyping", rules: grammar.rules });
          let body = queryInfo.body;
          let srcParamName = "";
          let tgtParamName = "";

          if (queryInfo.params.length >= 3) {
            srcParamName = queryInfo.params[1];
            tgtParamName = queryInfo.params[2];
          } else if (queryInfo.params.length === 2) {
            srcParamName = queryInfo.params[0];
            tgtParamName = queryInfo.params[1];
          } else if (queryInfo.params.length === 1) {
            srcParamName = queryInfo.params[0];
          }

          if (srcParamName && srcParamName !== "sourceId") {
            body = `let ${srcParamName} = sourceId;\n` + body;
          }
          if (tgtParamName && tgtParamName !== "targetId") {
            body = `let ${tgtParamName} = targetId;\n` + body;
          }

          const fnName = `check_subtype_pred_${predIdx++}`;
          subtypingHelpers += `function ${fnName}(sourceId: u32, targetId: u32): boolean {\n${body}\n}\n\n`;
          subtypingLogic += `  if (${fnName}(sourceId, targetId)) return true;\n`;
        }
      }
    }
  }

  if (!customCode) {
    customCode = `
// Default C-like Type Kinds
export const TYPE_PRIMITIVE: u16 = 0;
export const TYPE_POINTER: u16 = 1;
export const TYPE_ARRAY: u16 = 2;
export const TYPE_STRUCT: u16 = 3;
export const TYPE_FUNCTION: u16 = 4;
export const TYPE_ERROR: u16 = 5;

${subtypingHelpers}
// Basic assignability logic
export function isAssignableTo(targetId: u32, sourceId: u32): boolean {
  if (targetId == sourceId) return true;
${subtypingLogic}
  let tKind = getTypeKind(targetId);
  let sKind = getTypeKind(sourceId);
  if (tKind == TYPE_ERROR || sKind == TYPE_ERROR) return true;
  if (tKind == TYPE_POINTER && sKind == TYPE_POINTER) {
     return isAssignableTo(getTypeBase(targetId), getTypeBase(sourceId));
  }
  return false;
}
`;
  } else {
    let extraTypes = "";
    if (!customCode.includes("TYPE_POINTER")) extraTypes += "export const TYPE_POINTER: u16 = 901;\n";
    if (!customCode.includes("TYPE_ARRAY")) extraTypes += "export const TYPE_ARRAY: u16 = 902;\n";
    if (!customCode.includes("TYPE_FUNCTION")) extraTypes += "export const TYPE_FUNCTION: u16 = 903;\n";
    if (!customCode.includes("TYPE_ERROR")) extraTypes += "export const TYPE_ERROR: u16 = 904;\n";
    customCode = extraTypes + customCode;
  }

  let constraintCode = "";
  if (grammar.typeSystem && grammar.typeSystem.constraints) {
    constraintCode = `
export function inferTypes(astRoot: u32): void {
    if (astRoot == 0) return;
    unifyErrorCount = 0;
    
    let top: u32 = 0;
    inferStack[top++] = astRoot;
    
    while (top > 0) {
        let node = inferStack[--top];
        if (node == 0) continue;
        
        let type = getNodeType(node);
        generate_constraints(node, type);
        
        let child = getNodeFirstChild(node);
        while (child != 0) {
            inferStack[top++] = child;
            child = getNodeNextSibling(child);
        }
    }
}
`;
  }

  return `import { ChunkedUint32Array, UnmanagedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc, getNodeType, getNodeFirstChild, getNodeNextSibling, getNodePadding, getNodeByteLength, allocNode } from "./arena";
import { lsp_allocDiagnostic as allocDiagnostic } from "./lsp";
import { factExists } from "./reasoner";
import { resolveFqnSymbol } from "../shared/graph";
import { SyntaxType } from "../parser/parser";

// Semantic Analysis & Type System Engine
// Generated for language: ${grammar.name}

${typesysEngineCode.replace(/from "\.\.\//g, 'from "./')}

${customCode}

${constraintCode}
`;
}
