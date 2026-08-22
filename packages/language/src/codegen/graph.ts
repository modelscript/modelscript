import * as ts from "typescript";
import { graphCode } from "../../build/src-gen/runtime-templates.js";
import { LanguageOptions, SOURCE_PATH_SYMBOL, SOURCE_TEXT_SYMBOL } from "../dsl.js";
import { extractLanguageAST } from "./ast-loader.js";
import { transpileQuery as transpileQueryExternal } from "./transpiler.js";

/**
 * Generates the CodeGraph AssemblyScript bridge, transpiling TypeScript user query functions
 * into zero-GC incremental arena queries with automatic cursor management and AST field lookups.
 *
 * @param grammar Language DSL options object containing query definitions.
 * @returns AssemblyScript source code string for the graph query bridge.
 */
export function generateCodeGraphBridge(grammar: LanguageOptions<any>): string {
  const sourceText = (grammar as any).sourceText || (grammar as any)[SOURCE_TEXT_SYMBOL];
  const sourcePath = (grammar as any).sourcePath || (grammar as any)[SOURCE_PATH_SYMBOL];
  const hasQueries = !!(
    grammar.queries ||
    grammar.pipelines ||
    grammar.lints ||
    (grammar.lsp && grammar.lsp.definition)
  );
  const ast = hasQueries
    ? sourceText
      ? extractLanguageAST(sourceText)
      : sourcePath
        ? extractLanguageAST(sourcePath)
        : null
    : null;

  let switchCode = "";
  let customQueries = "";
  let outlineQueryWrapper = "";
  let queryTypeIdx = 1; // 0 is parse

  const attrIdMap = new Map<string, number>();
  let nextBlackboardId = 100;
  if (grammar.model) {
    for (const [nodeName, attrs] of Object.entries(grammar.model)) {
      for (const attrName of Object.keys(attrs as any)) {
        if (!attrIdMap.has(attrName)) {
          attrIdMap.set(attrName, nextBlackboardId++);
        }
      }
    }
  }

  const queryIdMap = new Map<string, number>();
  if (grammar.queries) {
    let tempQueryIdx = 1;
    for (const queryName of Object.keys(grammar.queries)) {
      queryIdMap.set(queryName, tempQueryIdx++);
    }
  }

  const hostQueryIdMap = new Map<string, number>();
  if (grammar.hostQueries) {
    let hostQueryIdx = 1;
    for (const queryName of Object.keys(grammar.hostQueries)) {
      hostQueryIdMap.set(queryName, hostQueryIdx++);
    }
  }

  function transpileQuery(
    queryFn: any,
    context: "query" | "lint" | "lsp" = "query",
  ): { body: string; params: string[] } {
    return transpileQueryExternal(queryFn, {
      context,
      queryIdMap,
      hostQueryIdMap,
      attrIdMap,
      rules: grammar.rules,
    });
  }

  // 1. Emit Top-Level Constants (e.g. VARIABILITY_CONTINUOUS, TYPE_REAL, etc.)
  if (ast && ast.constants) {
    for (const [constName, decl] of ast.constants.entries()) {
      const typeStr = decl.type ? ": " + decl.type.getText(ast.sourceFile) : "";
      const initStr = decl.initializer ? decl.initializer.getText(ast.sourceFile) : "0";
      customQueries += `export const ${constName}${typeStr} = ${initStr};\n`;
    }
    if (ast.constants.size > 0) {
      customQueries += "\n";
    }
  }

  // 2. Emit Top-Level Helper Functions (e.g. inferExprType, isTypeCompatible, etc.)
  if (ast && ast.functions) {
    for (const [fnName, fnDecl] of ast.functions.entries()) {
      const fnInfo = transpileQuery(fnDecl);
      let fnStr = fnInfo.body;
      if (!fnStr.startsWith("export function") && !fnStr.startsWith("function")) {
        const nonDollar = fnInfo.params.filter((p) => p !== "$" && p !== "db" && p !== "graph");
        const paramsStr = nonDollar
          .map((p) => {
            if (ts.isFunctionDeclaration(fnDecl)) {
              const originalP = fnDecl.parameters.find((orig) => orig.name.getText(ast.sourceFile) === p);
              if (originalP && originalP.type) {
                const pType = originalP.type.getText(ast.sourceFile);
                if (pType === "bool" || pType === "boolean") return `${p}: bool`;
                return `${p}: ${pType}`;
              }
            }
            return `${p}: u32`;
          })
          .join(", ");
        const returnTypeStr =
          ts.isFunctionDeclaration(fnDecl) && fnDecl.type
            ? ": " + (fnDecl.type.getText(ast.sourceFile) === "boolean" ? "bool" : fnDecl.type.getText(ast.sourceFile))
            : ": u32";
        fnStr = `export function ${fnName}(${paramsStr})${returnTypeStr} {\n${fnStr}\n}`;
      }
      customQueries += fnStr + "\n\n";
    }
  }

  if (grammar.queries) {
    for (const [queryName, rawQueryFn] of Object.entries(grammar.queries)) {
      const queryFn = ast?.queries?.get(queryName) || rawQueryFn;
      let queryInfo = transpileQuery(queryFn);
      let asQueryStr = queryInfo.body;
      const nonDollarParams = queryInfo.params.filter((p) => p !== "$");
      const actualArgNames = nonDollarParams;

      let signatureArgs =
        actualArgNames.length > 0 ? actualArgNames.map((p) => p + ": u32").join(", ") : "queryArg: u32";

      if (!asQueryStr.startsWith("export function") && !asQueryStr.startsWith("function")) {
        asQueryStr = `export function ${queryName}(${signatureArgs}): u32 {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";

      let extraCallArgs =
        actualArgNames.length > 1
          ? actualArgNames
              .slice(1)
              .map((_, idx) => "arg" + (idx + 2))
              .join(", ")
          : "";
      let callExpr = `${queryName}(arg1${extraCallArgs ? ", " + extraCallArgs : ""})`;
      switchCode += `
   else if (queryType == ${queryTypeIdx}) {
      result = ${callExpr};
   }`;

      if (queryName === "lsp_outline_query") {
        outlineQueryWrapper = `export function runOutlineQuery(node: u32): u32 { return runQuery(${queryTypeIdx}, node); }\n`;
      }
      queryTypeIdx++;
    }
  }

  if (grammar.model) {
    const attrsByName = new Map<string, { nodeName: string; config: any }[]>();
    for (const [nodeName, attrs] of Object.entries(grammar.model)) {
      for (const [attrName, config] of Object.entries(attrs as any)) {
        if (!attrsByName.has(attrName)) attrsByName.set(attrName, []);
        attrsByName.get(attrName)!.push({ nodeName, config });
      }
    }

    for (const [attrName, configs] of attrsByName.entries()) {
      let attrId = attrIdMap.get(attrName)!;
      let dispatcher = `export function compute_attr_${attrName}(queryArg: u32): u32 {\n  let type = getNodeType(queryArg);\n  switch(type) {\n`;

      for (const { nodeName, config } of configs) {
        let asQueryStr = "";
        let queryInfo: { body: string; params: string[] } | null = null;
        let attrConfig = config as any;
        if (typeof attrConfig === "function") {
          queryInfo = transpileQuery(attrConfig);
          asQueryStr = queryInfo.body;
        } else if (attrConfig.compute) {
          queryInfo = transpileQuery(attrConfig.compute);
          asQueryStr = queryInfo.body;
        } else if (attrConfig.default !== undefined) {
          asQueryStr = `return ${attrConfig.default};`;
        } else {
          asQueryStr = `return 0;`;
        }

        const funcName = `compute_attr_${attrName}_${nodeName}`;
        let innerBody = asQueryStr;
        if (queryInfo && !innerBody.startsWith("export function") && !innerBody.startsWith("function")) {
          const firstParam = queryInfo.params.filter((p) => p !== "$")[0];
          if (firstParam && firstParam !== "queryArg") {
            innerBody = `let ${firstParam} = queryArg;\n` + innerBody;
          }
        }
        customQueries += `function ${funcName}(queryArg: u32): u32 {\n${innerBody}\n}\n\n`;
        dispatcher += `    case <u16>SyntaxType.${nodeName.toUpperCase()}:\n      return ${funcName}(queryArg);\n`;
      }

      dispatcher += `    default:\n      return 0;\n  }\n}\n`;
      customQueries += dispatcher + "\n";

      switchCode += `
   else if (queryType == ${attrId}) {
      result = compute_attr_${attrName}(arg1);
   }`;
    }
  }

  if (grammar.lints) {
    for (const [lintName, lint] of Object.entries(grammar.lints)) {
      const astNode = ast?.lints?.get(lintName);
      const queryFn =
        astNode ||
        (typeof lint === "object" && lint !== null && (lint as any).query
          ? (lint as any).query
          : typeof lint === "string"
            ? lint
            : null);
      if (!queryFn) continue;
      let queryInfo = transpileQuery(queryFn, "lint");
      let asQueryStr = queryInfo.body;
      if (!asQueryStr.startsWith("export function") && !asQueryStr.startsWith("function")) {
        const nonDollar = queryInfo.params.filter((p) => p !== "$" && p !== "db" && p !== "graph");
        const firstParam = nonDollar[0];
        if (firstParam && firstParam !== "node") {
          asQueryStr = `let ${firstParam} = node;\n` + asQueryStr;
        }
        asQueryStr = `export function lint_${lintName}(node: u32, lintId: u32, nodeStart: u32, nodeEnd: u32): void {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";
    }
  }

  if (grammar.lsp && grammar.lsp.definition) {
    let asQueryStr = "";
    if (typeof grammar.lsp.definition === "string") {
      let attrId = attrIdMap.get(grammar.lsp.definition);
      if (attrId !== undefined) {
        asQueryStr = `return compute_attr_${grammar.lsp.definition}(node);`;
      } else {
        let queryId = queryIdMap.get(grammar.lsp.definition);
        if (queryId !== undefined) {
          asQueryStr = `return ${grammar.lsp.definition}(node);`;
        }
      }
      let queryInfo = transpileQuery(ast?.definition || grammar.lsp.definition, "lsp");
      asQueryStr = queryInfo.body;
      if (!asQueryStr.startsWith("export function") && !asQueryStr.startsWith("function")) {
        const nonDollar = queryInfo.params.filter((p) => p !== "$" && p !== "db" && p !== "graph");
        const firstParam = nonDollar[0];
        if (firstParam && firstParam !== "node") {
          asQueryStr = `let ${firstParam} = node;\n` + asQueryStr;
        }
      }
    }
    customQueries += `export function lsp_invokeDefinition(node: u32): u32 {\n${asQueryStr}\n}\n`;
  } else {
    customQueries += `export function lsp_invokeDefinition(node: u32): u32 { return 0; }\n`;
  }

  if (grammar.pipelines) {
    for (const [pipelineName, pipeline] of Object.entries(grammar.pipelines)) {
      let pipelinePassCode = "";
      let passIdx = 0;
      const astPasses = ast?.pipelines?.get(pipelineName);
      const passes = (pipeline as any).passes || [];
      for (let i = 0; i < passes.length; i++) {
        const passFn = astPasses && astPasses[i] ? astPasses[i] : passes[i];
        const passInfo = transpileQuery(passFn);
        const passFuncName = `pipeline_${pipelineName}_pass_${passIdx}`;
        let body = passInfo.body;
        const nonDollar = passInfo.params.filter((p) => p !== "$" && p !== "graph" && p !== "db");
        const firstParam = nonDollar.length > 0 ? nonDollar[0] : "rootNode";
        if (!body.startsWith("export function") && !body.startsWith("function")) {
          body = `function ${passFuncName}(${firstParam}: u32): void {\n${body}\n}\n`;
        }
        customQueries += body + "\n\n";
        pipelinePassCode += `  ${passFuncName}(rootNode);\n`;
        passIdx++;
      }

      customQueries += `export function runPipeline_${pipelineName}(rootNode: u32 = 0): u32 {\n${pipelinePassCode}  return graph.dae.varCount;\n}\n\n`;
    }
  }

  let code = graphCode;

  code = code.replace(/__GRAPH_SWITCH_CODE__/g, switchCode);
  code = code.replace(/__CUSTOM_QUERIES__/g, customQueries);
  code = code.replace(/__OUTLINE_QUERY_WRAPPER__/g, outlineQueryWrapper);
  code = code.replace(/__MODEL_ACCESSORS__/g, "");

  return code;
}
