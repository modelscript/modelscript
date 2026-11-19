// SPDX-License-Identifier: AGPL-3.0-or-later

import ts from "typescript";
import { LanguageOptions, SOURCE_PATH_SYMBOL, SOURCE_TEXT_SYMBOL } from "../../dsl/language.js";
import { graphCode } from "../../src-gen/runtime-templates.js";
import { extractLanguageAST } from "../transpiler/ast-loader.js";
import { transpileClass, transpileQuery as transpileQueryExternal } from "../transpiler/transpiler.js";

/**
 * Generates the CodeGraph AssemblyScript bridge, transpiling TypeScript user query functions
 * into zero-GC incremental arena queries with automatic cursor management and AST field lookups.
 *
 * @param grammar Language DSL options object containing query definitions.
 * @returns AssemblyScript source code string for the graph query bridge.
 */
export function generateCodeGraphBridge(grammar: LanguageOptions): string {
  const grammarExt = grammar as LanguageOptions & {
    sourceText?: string;
    sourcePath?: string;
    externals?: string[] | Set<string>;
    fieldToInt?: Map<string, number> | Set<string>;
    [SOURCE_TEXT_SYMBOL]?: string;
    [SOURCE_PATH_SYMBOL]?: string;
  };
  const sourceText = grammarExt.sourceText || grammarExt[SOURCE_TEXT_SYMBOL];
  const sourcePath = grammarExt.sourcePath || grammarExt[SOURCE_PATH_SYMBOL];
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

  // Compute transitive reachability closure of helper classes, constants, and functions
  // actually referenced by WASM queries, CompilerLints, pipelines, or explicit classes/functions.
  const reachableSymbols = new Set<string>();
  if (ast) {
    const worklist: Array<ts.Node | string> = [];
    const collectIdentsFromNode = (n: ts.Node) => {
      if (ts.isIdentifier(n)) {
        if (!reachableSymbols.has(n.text)) {
          reachableSymbols.add(n.text);
          worklist.push(n.text);
        }
      }
      ts.forEachChild(n, collectIdentsFromNode);
    };
    const collectIdentsFromUnknown = (val: unknown) => {
      if (!val) return;
      if (typeof val === "object" && "kind" in (val as object) && "forEachChild" in (val as object)) {
        collectIdentsFromNode(val as ts.Node);
        return;
      }
      const str = typeof val === "function" ? val.toString() : typeof val === "string" ? val : "";
      if (!str) return;
      const matches = str.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g);
      for (const m of matches) {
        const id = m[0]!;
        if (!reachableSymbols.has(id)) {
          reachableSymbols.add(id);
          worklist.push(id);
        }
      }
    };

    if (grammar.lints) {
      for (const [lintName, lint] of Object.entries(grammar.lints)) {
        collectIdentsFromUnknown(ast.lints.get(lintName));
        const lintObj = (typeof lint === "object" && lint !== null ? lint : null) as { query?: unknown } | null;
        collectIdentsFromUnknown(lintObj?.query ?? (typeof lint === "string" ? lint : null));
      }
    }
    if (grammar.queries) {
      for (const [queryName, rawQueryFn] of Object.entries(grammar.queries)) {
        collectIdentsFromUnknown(ast.queries.get(queryName) ?? rawQueryFn);
      }
    }
    if (grammar.pipelines) {
      for (const [pipelineName, pipeline] of Object.entries(grammar.pipelines)) {
        for (const p of ast.pipelines.get(pipelineName) ?? []) collectIdentsFromUnknown(p);
        for (const p of (pipeline as { passes?: unknown[] }).passes ?? []) collectIdentsFromUnknown(p);
      }
    }
    if (grammar.model) {
      for (const [, attrs] of Object.entries(grammar.model)) {
        for (const [, cfg] of Object.entries(attrs as Record<string, unknown>)) {
          if (typeof cfg === "function") collectIdentsFromUnknown(cfg);
          else if (cfg && typeof cfg === "object" && "compute" in cfg) {
            collectIdentsFromUnknown((cfg as { compute?: unknown }).compute);
          }
        }
      }
    }
    if (grammar.lsp?.definition) {
      collectIdentsFromUnknown(ast.definition ?? grammar.lsp.definition);
    }
    const explicitExtras = grammarExt as unknown as {
      classes?: unknown;
      functions?: unknown;
    };
    for (const extra of [explicitExtras.classes, explicitExtras.functions]) {
      if (Array.isArray(extra)) {
        for (const item of extra) {
          const nm = typeof item === "function" ? item.name : typeof item === "string" ? item : "";
          if (nm && !reachableSymbols.has(nm)) {
            reachableSymbols.add(nm);
            worklist.push(nm);
          }
        }
      } else if (extra && typeof extra === "object") {
        for (const nm of Object.keys(extra)) {
          if (!reachableSymbols.has(nm)) {
            reachableSymbols.add(nm);
            worklist.push(nm);
          }
        }
      }
    }

    while (worklist.length > 0) {
      const item = worklist.pop()!;
      if (typeof item === "string") {
        const fnDecl = ast.functions.get(item);
        if (fnDecl) collectIdentsFromNode(fnDecl);
        const clsDecl = ast.classes.get(item);
        if (clsDecl) collectIdentsFromNode(clsDecl);
        const constDecl = ast.constants.get(item);
        if (constDecl) collectIdentsFromNode(constDecl);
      } else {
        collectIdentsFromNode(item);
      }
    }
  }

  // 1.4. Emit Top-Level Helper Classes (e.g. SIUnit)
  if (ast && ast.classes) {
    for (const [clsName, clsDecl] of ast.classes.entries()) {
      if (!reachableSymbols.has(clsName)) continue;
      const clsStr = transpileClass(clsDecl);
      customQueries += clsStr + "\n\n";
    }
  }

  let outlineQueryWrapper = "";
  let queryTypeIdx = 1; // 0 is parse

  const attrIdMap = new Map<string, number>();
  let nextBlackboardId = 100;
  if (grammar.model) {
    for (const [, attrs] of Object.entries(grammar.model)) {
      for (const attrName of Object.keys(attrs as Record<string, unknown>)) {
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
    queryFn: unknown,
    context: "query" | "lint" | "lsp" = "query",
  ): { body: string; params: string[] } {
    return transpileQueryExternal(queryFn, {
      context,
      queryIdMap,
      hostQueryIdMap,
      attrIdMap,
      rules: grammar.rules,
      externals: grammarExt.externals,
      fieldToInt: grammarExt.fieldToInt,
    });
  }

  function isIgnoredQueryParam(p: string): boolean {
    return p === "$" || p === "_$" || p === "db" || p === "_db" || p === "graph" || p === "_graph" || p === "cg";
  }

  function getNodeSourceFile(node: ts.Node): ts.SourceFile {
    let curr: ts.Node = node;
    while (curr.parent) curr = curr.parent;
    if (ts.isSourceFile(curr)) return curr;
    if (node.getSourceFile && node.getSourceFile()) return node.getSourceFile();
    return ast!.sourceFile;
  }

  // 1. Emit Top-Level Constants (e.g. VARIABILITY_CONTINUOUS, TYPE_REAL, etc.)
  if (ast && ast.constants) {
    let emittedConst = false;
    for (const [constName, decl] of ast.constants.entries()) {
      if (!reachableSymbols.has(constName)) continue;
      const sf = getNodeSourceFile(decl);
      const typeStr = decl.type ? ": " + decl.type.getText(sf) : "";
      const initStr = decl.initializer ? decl.initializer.getText(sf) : "0";
      customQueries += `export const ${constName}${typeStr} = ${initStr};\n`;
      emittedConst = true;
    }
    if (emittedConst) {
      customQueries += "\n";
    }
  }

  // 2. Emit Top-Level Helper Functions (e.g. inferExprType, isTypeCompatible, etc.)
  if (ast && ast.functions) {
    for (const [fnName, fnDecl] of ast.functions.entries()) {
      if (fnName === "language" || fnName === "grammar" || fnName === "buildParser") continue;
      if (!reachableSymbols.has(fnName)) continue;
      const fnSf = getNodeSourceFile(fnDecl);
      const fnInfo = transpileQuery(fnDecl);
      let fnStr = fnInfo.body;
      if (!fnStr.startsWith("export function") && !fnStr.startsWith("function")) {
        const nonDollar = fnInfo.params.filter((p) => !isIgnoredQueryParam(p));
        const paramsStr = nonDollar
          .map((p) => {
            if (ts.isFunctionDeclaration(fnDecl)) {
              const originalP = fnDecl.parameters.find((orig) => orig.name.getText(fnSf) === p);
              if (originalP && originalP.type) {
                const pType = originalP.type.getText(fnSf);
                if (pType === "bool" || pType === "boolean") return `${p}: bool`;
                return `${p}: ${pType}`;
              }
            }
            return `${p}: u32`;
          })
          .join(", ");
        const returnTypeStr =
          ts.isFunctionDeclaration(fnDecl) && fnDecl.type
            ? ": " + (fnDecl.type.getText(fnSf) === "boolean" ? "bool" : fnDecl.type.getText(fnSf))
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
      const nonDollarParams = queryInfo.params.filter((p) => !isIgnoredQueryParam(p));
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
    const attrsByName = new Map<string, { nodeName: string; config: unknown }[]>();
    for (const [nodeName, attrs] of Object.entries(grammar.model)) {
      for (const [attrName, config] of Object.entries(attrs as Record<string, unknown>)) {
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
        const attrConfig = config as { compute?: unknown; default?: unknown };
        if (typeof config === "function") {
          queryInfo = transpileQuery(config);
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
          const firstParam = queryInfo.params.filter((p) => !isIgnoredQueryParam(p))[0];
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
      const lintObj = (typeof lint === "object" && lint !== null ? lint : null) as { query?: unknown } | null;
      const queryFn = astNode || (lintObj?.query ? lintObj.query : typeof lint === "string" ? lint : null);
      if (!queryFn) continue;
      let queryInfo = transpileQuery(queryFn, "lint");
      let asQueryStr = queryInfo.body;
      if (!asQueryStr.startsWith("export function") && !asQueryStr.startsWith("function")) {
        const nonDollar = queryInfo.params.filter((p) => !isIgnoredQueryParam(p));
        const firstParam = nonDollar[0];
        if (firstParam && firstParam !== "node") {
          asQueryStr = `let ${firstParam} = node;\n` + asQueryStr;
        }
        asQueryStr = `export function lint_${lintName}(node: u32, lintId: u32, nodeStart: u32, nodeEnd: u32): void {\n  currentLintNode = node;\n  currentLintNodeStart = nodeStart;\n${asQueryStr}\n  currentLintNode = 0;\n  currentLintNodeStart = 0;\n}`;
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
        const nonDollar = queryInfo.params.filter((p) => !isIgnoredQueryParam(p));
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
      const passes = (pipeline as { passes?: unknown[] }).passes || [];
      for (let i = 0; i < passes.length; i++) {
        const passFn = astPasses && astPasses[i] ? astPasses[i] : passes[i];
        const passInfo = transpileQuery(passFn);
        const passFuncName = `pipeline_${pipelineName}_pass_${passIdx}`;
        let body = passInfo.body;
        const nonDollar = passInfo.params.filter((p) => !isIgnoredQueryParam(p));
        const firstParam = nonDollar.length > 0 ? nonDollar[0] : "rootNode";
        if (!body.startsWith("export function") && !body.startsWith("function")) {
          body = `function ${passFuncName}(${firstParam}: u32): void {\n${body}\n}\n`;
        }
        customQueries += body + "\n\n";
        pipelinePassCode += `  ${passFuncName}(rootNode);\n`;
        passIdx++;
      }

      customQueries += `export function runPipeline_${pipelineName}(rootNode: u32 = 0): u32 {\n  if (rootNode != 0) globalAstRoot = rootNode;\n  graph.dae.reset();\n${pipelinePassCode}  return graph.dae.varCount;\n}\n\n`;
    }
  }

  let code = graphCode;

  code = code.replace(/__GRAPH_SWITCH_CODE__/g, () => switchCode);
  code = code.replace(/__CUSTOM_QUERIES__/g, () => customQueries);
  code = code.replace(/__OUTLINE_QUERY_WRAPPER__/g, () => outlineQueryWrapper);
  code = code.replace(/__MODEL_ACCESSORS__/g, () => "");

  return code;
}
