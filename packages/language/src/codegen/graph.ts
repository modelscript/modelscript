import * as ts from "typescript";
import { graphCode } from "../../build/src-gen/runtime-templates.js";
import { LanguageOptions } from "../dsl.js";

export function generateCodeGraphBridge(grammar: LanguageOptions<any>): string {
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

    // If it's already a string without arrow/function, just return it
    if (typeof queryFn === "string" && !queryStr.includes("=>") && !queryStr.startsWith("function")) {
      return queryStr;
    }

    const sourceFile = ts.createSourceFile("temp.ts", queryStr, ts.ScriptTarget.Latest, true);

    const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
      const visit: ts.Visitor = (node) => {
        // 1. $.RuleName -> <u16>SyntaxType.RULENAME
        if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "$") {
          const ruleName = node.name.getText().toUpperCase();
          return ts.factory.createTypeAssertion(
            ts.factory.createTypeReferenceNode("u16"),
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier("SyntaxType"),
              ts.factory.createIdentifier(ruleName),
            ),
          );
        }

        // 2. Call expressions: graph.modelAttribute, graph.getChildByFieldId, graph.runQuery, graph.diagnostic
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const expr = node.expression;
          if (expr.expression.getText() === "graph") {
            const methodName = expr.name.getText();
            const args = node.arguments;

            if (methodName === "modelAttribute" && args.length >= 2) {
              const nodeArg = args[0];
              const attrArg = args[1];
              if (ts.isStringLiteral(attrArg)) {
                const attrName = attrArg.text;
                const id = attrIdMap.get(attrName);
                if (id === undefined) throw new Error(`Model attribute ${attrName} not defined`);
                return ts.factory.createCallExpression(ts.factory.createIdentifier("runQuery"), undefined, [
                  ts.factory.createNumericLiteral(id),
                  visitNode(nodeArg) as ts.Expression,
                ]);
              }
            }

            if ((methodName === "getChildByFieldId" || methodName === "getChildrenByFieldId") && args.length >= 2) {
              const nodeArg = args[0];
              const fieldArg = args[1];
              if (ts.isStringLiteral(fieldArg)) {
                const fieldName = fieldArg.text;
                const safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
                return ts.factory.createCallExpression(ts.factory.createIdentifier(methodName), undefined, [
                  visitNode(nodeArg) as ts.Expression,
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("FieldId"),
                    ts.factory.createIdentifier(safeName),
                  ),
                ]);
              }
            }

            if (methodName === "runQuery" && args.length >= 2) {
              const queryArg = args[0];
              const targetArg = args[1];
              if (ts.isStringLiteral(queryArg)) {
                const queryName = queryArg.text;
                const id = queryIdMap.get(queryName);
                if (id === undefined) throw new Error(`Query ${queryName} not defined`);
                return ts.factory.createCallExpression(ts.factory.createIdentifier("runQuery"), undefined, [
                  ts.factory.createNumericLiteral(id),
                  visitNode(targetArg) as ts.Expression,
                ]);
              }
            }

            if (methodName === "diagnostic" && args.length >= 1) {
              const targetArg = args[0];
              const contextArg = args.length > 1 ? args[1] : targetArg;
              return ts.factory.createCallExpression(ts.factory.createIdentifier("lsp_allocDiagnostic"), undefined, [
                ts.factory.createIdentifier("nodeStart"),
                ts.factory.createIdentifier("nodeEnd"),
                ts.factory.createIdentifier("lintId"),
                visitNode(contextArg) as ts.Expression,
              ]);
            }

            if (methodName === "createNode" && args.length >= 1) {
              const typeArg = args[0];
              if (ts.isStringLiteral(typeArg)) {
                let typeName = typeArg.text.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
                if (/^[0-9]/.test(typeName)) typeName = "_" + typeName;

                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier("createNode"),
                  ),
                  undefined,
                  [
                    ts.factory.createTypeAssertion(
                      ts.factory.createTypeReferenceNode("u16"),
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("SyntaxType"),
                        ts.factory.createIdentifier(typeName),
                      ),
                    ),
                  ],
                );
              }
            }

            if (
              (methodName === "setNodeFlag" || methodName === "clearNodeFlag" || methodName === "hasNodeFlag") &&
              args.length >= 2
            ) {
              const nodeArg = args[0];
              const flagArg = args[1];
              if (ts.isStringLiteral(flagArg)) {
                let flagName = flagArg.text.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
                flagName = flagName.replace(/[^A-Z0-9_]/g, "_");
                if (/^[0-9]/.test(flagName)) flagName = "_" + flagName;

                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier(methodName),
                  ),
                  undefined,
                  [
                    visitNode(nodeArg) as ts.Expression,
                    ts.factory.createTypeAssertion(
                      ts.factory.createTypeReferenceNode("u32"),
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("NodeFlag"),
                        ts.factory.createIdentifier(flagName),
                      ),
                    ),
                  ],
                );
              }
            }
          }
        }

        return ts.visitEachChild(node, visit, context);
      };

      function visitNode(node: ts.Node): ts.Node {
        return ts.visitNode(node, visit) as ts.Node;
      }

      return (node) => ts.visitNode(node, visit) as ts.SourceFile;
    };

    const result = ts.transform(sourceFile, [transformer]);
    const printed = ts.createPrinter().printFile(result.transformed[0]);

    // Parse again to extract body and parameters
    const transformedSource = ts.createSourceFile("temp.ts", printed, ts.ScriptTarget.Latest, true);
    let bodyStr = "";
    let params: string[] = [];

    ts.forEachChild(transformedSource, (node) => {
      if (ts.isExpressionStatement(node)) {
        if (ts.isArrowFunction(node.expression)) {
          params = node.expression.parameters.map((p) => p.name.getText());
          const body = node.expression.body;
          if (ts.isBlock(body)) {
            bodyStr = body.statements.map((s) => s.getText()).join("\n");
          } else {
            if (
              isLint &&
              ts.isCallExpression(body) &&
              ts.isIdentifier(body.expression) &&
              body.expression.getText() === "lsp_allocDiagnostic"
            ) {
              bodyStr = body.getText() + ";";
            } else {
              bodyStr = "return " + body.getText() + ";";
            }
          }
        }
      } else if (ts.isFunctionDeclaration(node)) {
        params = node.parameters.map((p) => p.name.getText());
        if (node.body) {
          bodyStr = node.body.statements.map((s) => s.getText()).join("\n");
        }
      }
    });

    if (bodyStr === "") {
      bodyStr = printed;
    }

    const argName = isLint ? "node" : "queryArg";
    if (params.length >= 2 && params[1] && params[1] !== argName) {
      bodyStr = `let ${params[1]} = ${argName};\n` + bodyStr;
    }

    return bodyStr;
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
        asQueryStr = `export function lint_${lintName}(node: u32, lintId: u32, nodeStart: u32, nodeEnd: u32): void {\n${asQueryStr}\n}`;
      }
      customQueries += asQueryStr + "\n\n";
    }
  }

  let code = graphCode;

  code = code.replace(/__GRAPH_SWITCH_CODE__/g, switchCode);
  code = code.replace(/__CUSTOM_QUERIES__/g, customQueries);
  code = code.replace(/__OUTLINE_QUERY_WRAPPER__/g, outlineQueryWrapper);
  code = code.replace(/__MODEL_ACCESSORS__/g, "");

  return code;
}
