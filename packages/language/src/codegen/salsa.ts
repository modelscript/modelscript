import { salsaCode } from "../../build/src-gen/runtime-templates.js";
import { LanguageOptions } from "../dsl.js";

export function generateSalsaBridge(grammar: LanguageOptions<any>): string {
  let switchCode = "";
  let customQueries = "";
  let outlineQueryWrapper = "";
  let queryTypeIdx = 1; // 0 is parse

  if (grammar.queries) {
    for (const [queryName, queryFn] of Object.entries(grammar.queries)) {
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

      if (paramNames.length >= 2 && paramNames[1] && paramNames[1] !== "queryArg") {
        asQueryStr = `let ${paramNames[1]} = queryArg;\n` + asQueryStr;
      }

      // Transpile db.getChildByFieldId(node, "field_name") to FieldId.FIELD_NAME
      asQueryStr = asQueryStr.replace(
        /db\.getChild(ren)?ByFieldId\(([^,]+),\s*(['"])([^'"]+)\3\)/g,
        (_, ren, ptr, quote, fieldName) => {
          let safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
          return `db.getChild${ren || ""}ByFieldId(${ptr}, FieldId.${safeName})`;
        },
      );

      // Transpile $.RuleName to SyntaxType.RuleName for the WASM engine
      asQueryStr = asQueryStr.replace(/\$\.([a-zA-Z0-9_]+)/g, "SyntaxType.$1");

      if (!asQueryStr.startsWith("export function")) {
        asQueryStr = `export function ${queryName}(queryArg: u32): u32 {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";

      let callExpr = queryName === "lsp_outline_query" ? `${queryName}(db, queryArg)` : `${queryName}(queryArg)`;
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

  // Inject Phase 4: Blackboard Auto-Wiring Routers
  let blackboardQueryOffset = 100;
  if (grammar.models) {
    for (const [attrName, attrConfig] of Object.entries(grammar.models)) {
      let asQueryStr = "";
      if (attrConfig.compute) {
        const queryFn = attrConfig.compute;
        const queryStr = typeof queryFn === "function" ? queryFn.toString() : queryFn;
        asQueryStr = queryStr as string;
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

        if (paramNames.length >= 2 && paramNames[1] && paramNames[1] !== "queryArg") {
          asQueryStr = `let ${paramNames[1]} = queryArg;\n` + asQueryStr;
        }

        asQueryStr = asQueryStr.replace(
          /db\.getChild(ren)?ByFieldId\(([^,]+),\s*(['"])([^'"]+)\3\)/g,
          (_, ren, ptr, quote, fieldName) => {
            let safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
            return `db.getChild${ren || ""}ByFieldId(${ptr}, FieldId.${safeName})`;
          },
        );

        asQueryStr = asQueryStr.replace(/\$\.([a-zA-Z0-9_]+)/g, "SyntaxType.$1");
      } else if (attrConfig.default !== undefined) {
        asQueryStr = `return ${attrConfig.default};`;
      } else {
        asQueryStr = `return 0;`;
      }

      if (!asQueryStr.startsWith("export function")) {
        asQueryStr = `export function compute_attr_${attrName}(queryArg: u32): u32 {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";

      switchCode += `
   else if (queryType == ${blackboardQueryOffset}) {
      result = compute_attr_${attrName}(queryArg);
   }`;
      blackboardQueryOffset++;
    }
  }

  let code = salsaCode;

  code = code.replace(/__SALSA_SWITCH_CODE__/g, switchCode);
  code = code.replace(/__CUSTOM_QUERIES__/g, customQueries);
  code = code.replace(/__OUTLINE_QUERY_WRAPPER__/g, outlineQueryWrapper);
  code = code.replace(/__MODEL_ACCESSORS__/g, "");

  return code;
}
