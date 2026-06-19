import { salsaCode } from "../../build/src-gen/runtime-templates.js";
import { LanguageOptions } from "../dsl.js";

export function generateSalsaBridge(grammar: LanguageOptions<any>): string {
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

  function transpileQuery(queryFn: any, isLint: boolean = false): string {
    const queryStr = typeof queryFn === "function" ? queryFn.toString() : queryFn;
    let asQueryStr = queryStr as string;
    let paramNames: string[] = [];
    if (typeof queryFn === "function") {
      let matchParams = asQueryStr.match(/(?:\(([^)]*)\)|([^\s=]+))\s*=>/);
      if (matchParams) {
        let pStr = matchParams[1] || matchParams[2];
        paramNames = pStr.split(",").map((p) => p.trim());
      }
      let matchBlock = asQueryStr.match(/^[^{]*\{([\s\S]*)\}\s*$/);
      if (matchBlock) {
        asQueryStr = matchBlock[1];
      } else {
        let matchExpr = asQueryStr.match(/=>\s*([\s\S]+)$/);
        if (matchExpr) asQueryStr = `return ${matchExpr[1]};`;
      }
    }

    const argName = isLint ? "node" : "queryArg";
    if (paramNames.length >= 2 && paramNames[1] && paramNames[1] !== argName) {
      asQueryStr = `let ${paramNames[1]} = ${argName};\n` + asQueryStr;
    }

    asQueryStr = asQueryStr.replace(
      /db\.modelAttribute(?:<[^>]+>)?\(([^,]+),\s*(['"])([^'"]+)\2\)/g,
      (match, nodeArg, quote, attrName) => {
        let id = attrIdMap.get(attrName);
        if (id === undefined) throw new Error(`Model attribute ${attrName} is not defined in grammar.model`);
        return `runQuery(${id}, ${nodeArg})`;
      },
    );

    asQueryStr = asQueryStr.replace(
      /db\.getChild(ren)?ByFieldId\(([^,]+),\s*(['"])([^'"]+)\3\)/g,
      (_, ren, ptr, quote, fieldName) => {
        let safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
        return `getChild${ren || ""}ByFieldId(${ptr}, FieldId.${safeName})`;
      },
    );

    asQueryStr = asQueryStr.replace(
      /db\.runQuery\(\s*(['"])([^'"]+)\1\s*,\s*([^)]+)\)/g,
      (_, quote, queryName, queryArg) => {
        let id = queryIdMap.get(queryName);
        if (id === undefined) throw new Error(`Query ${queryName} is not defined in grammar.queries`);
        return `runQuery(${id}, ${queryArg})`;
      },
    );

    asQueryStr = asQueryStr.replace(/db\.diagnostic\(([^,]+)(?:,\s*([^)]+))?\)/g, (_, targetNode, contextNode) => {
      return `lsp_allocDiagnostic(getNodeStartIndex(${targetNode}), getNodeEndIndex(${targetNode}), lintId, ${contextNode || targetNode})`;
    });

    asQueryStr = asQueryStr.replace(/\$\.([a-zA-Z0-9_]+)/g, (_, group) => `<u16>SyntaxType.${group.toUpperCase()}`);
    return asQueryStr;
  }

  if (grammar.queries) {
    for (const [queryName, queryFn] of Object.entries(grammar.queries)) {
      let asQueryStr = transpileQuery(queryFn);
      if (!asQueryStr.startsWith("export function")) {
        asQueryStr = `export function ${queryName}(queryArg: u32): u32 {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";

      let callExpr = queryName === "lsp_outline_query" ? `${queryName}(queryArg)` : `${queryName}(queryArg)`;
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
        let attrConfig = config as any;
        if (attrConfig.compute) {
          asQueryStr = transpileQuery(attrConfig.compute);
        } else if (attrConfig.default !== undefined) {
          asQueryStr = `return ${attrConfig.default};`;
        } else {
          asQueryStr = `return 0;`;
        }

        const funcName = `compute_attr_${attrName}_${nodeName}`;
        customQueries += `function ${funcName}(queryArg: u32): u32 {\n${asQueryStr}\n}\n\n`;
        dispatcher += `    case <u16>SyntaxType.${nodeName.toUpperCase()}:\n      return ${funcName}(queryArg);\n`;
      }

      dispatcher += `    default:\n      return 0;\n  }\n}\n`;
      customQueries += dispatcher + "\n";

      switchCode += `
   else if (queryType == ${attrId}) {
      result = compute_attr_${attrName}(queryArg);
   }`;
    }
  }

  if (grammar.lints) {
    for (const [lintName, lint] of Object.entries(grammar.lints)) {
      let asQueryStr = transpileQuery((lint as any).query, true);
      if (!asQueryStr.startsWith("export function")) {
        asQueryStr = `export function lint_${lintName}(node: u32, lintId: u32, nodeStart: u32, nodeEnd: u32): bool {\n${asQueryStr}\n  return false;\n}`;
      }
      customQueries += asQueryStr + "\n\n";
    }
  }

  let code = salsaCode;

  code = code.replace(/__SALSA_SWITCH_CODE__/g, switchCode);
  code = code.replace(/__CUSTOM_QUERIES__/g, customQueries);
  code = code.replace(/__OUTLINE_QUERY_WRAPPER__/g, outlineQueryWrapper);
  code = code.replace(/__MODEL_ACCESSORS__/g, "");

  return code;
}
