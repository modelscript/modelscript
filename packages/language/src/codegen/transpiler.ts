import * as ts from "typescript";
import { getDJB2Hash } from "./utils.js";

export interface TranspileOptions {
  context?: "query" | "lint" | "lsp" | "subtyping" | "dataflow";
  queryIdMap?: Map<string, number>;
  hostQueryIdMap?: Map<string, number>;
  attrIdMap?: Map<string, number>;
  rules?: Record<string, any>;
}

/**
 * Transpiles TypeScript user query functions or lambdas into AssemblyScript arena query logic.
 */
export function transpileQuery(
  queryFn: any,
  options: TranspileOptions | "query" | "lint" | "lsp" | "subtyping" | "dataflow" = "query",
): { body: string; params: string[] } {
  const opts: TranspileOptions = typeof options === "string" ? { context: options } : options;
  const context = opts.context || "query";
  const queryIdMap = opts.queryIdMap || new Map();
  const hostQueryIdMap = opts.hostQueryIdMap || new Map();
  const attrIdMap = opts.attrIdMap || new Map();

  const queryStr = typeof queryFn === "function" ? queryFn.toString() : queryFn;

  // If it's already a string without arrow/function, just return it
  if (typeof queryFn === "string" && !queryStr.includes("=>") && !queryStr.startsWith("function")) {
    return { body: queryStr, params: ["queryArg"] };
  }

  const sourceFile = ts.createSourceFile("temp.ts", queryStr, ts.ScriptTarget.Latest, true);

  let dbName = "graph";
  let originalParams: string[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExpressionStatement(node) && ts.isArrowFunction(node.expression)) {
      originalParams = node.expression.parameters.map((p) => p.name.getText());
    } else if (ts.isFunctionDeclaration(node)) {
      originalParams = node.parameters.map((p) => p.name.getText());
    }
  });
  if (originalParams.length > 0) {
    dbName = originalParams[0];
  }

  let cursorCounter = 0;
  const transformer: ts.TransformerFactory<ts.SourceFile> = (transformerContext) => {
    const visit: ts.Visitor = (node) => {
      // 3. Syntax Sugar: for...of loops over cursors
      if (ts.isForOfStatement(node)) {
        const iterExpr = visitNode(node.expression) as ts.Expression;

        let varName = "child";
        if (ts.isVariableDeclarationList(node.initializer)) {
          varName = node.initializer.declarations[0].name.getText();
        } else {
          varName = node.initializer.getText();
        }

        cursorCounter++;
        const cursorName = ts.factory.createIdentifier("_cursor_" + cursorCounter);

        const cursorDecl = ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(
            [ts.factory.createVariableDeclaration(cursorName, undefined, undefined, iterExpr)],
            ts.NodeFlags.Let,
          ),
        );

        const whileCondition = ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(cursorName, "hasNext"),
          undefined,
          [],
        );

        const nextDecl = ts.factory.createVariableStatement(
          undefined,
          ts.factory.createVariableDeclarationList(
            [
              ts.factory.createVariableDeclaration(
                ts.factory.createIdentifier(varName),
                undefined,
                undefined,
                ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(cursorName, "next"),
                  undefined,
                  [],
                ),
              ),
            ],
            ts.NodeFlags.Let,
          ),
        );

        let bodyStmts: ts.Statement[] = [nextDecl];
        const visitedBody = visitNode(node.statement) as ts.Statement;
        if (ts.isBlock(visitedBody)) {
          bodyStmts = bodyStmts.concat(visitedBody.statements);
        } else {
          bodyStmts.push(visitedBody);
        }

        const whileLoop = ts.factory.createWhileStatement(whileCondition, ts.factory.createBlock(bodyStmts, true));

        const releaseCall = ts.factory.createExpressionStatement(
          ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(cursorName, "release"),
            undefined,
            [],
          ),
        );

        return ts.factory.createBlock([cursorDecl, whileLoop, releaseCall], true);
      }

      // 1. $.RuleName -> <u16>SyntaxType.RULENAME or getDJB2Hash(RuleName)
      if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "$") {
        const rawName = node.name.getText();
        const upper = rawName.toUpperCase();
        const rules = opts.rules;
        const existsInRules = rules ? Boolean(rules[rawName] || rules[upper]) : true;
        if (rules && !existsInRules) {
          return ts.factory.createNumericLiteral(getDJB2Hash(rawName));
        }
        if (existsInRules) {
          return ts.factory.createTypeAssertion(
            ts.factory.createTypeReferenceNode("u16"),
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier("SyntaxType"),
              ts.factory.createIdentifier(upper),
            ),
          );
        }
        return ts.factory.createNumericLiteral(getDJB2Hash(rawName));
      }

      // 2. Call expressions: graph.modelAttribute, graph.getChildByFieldId, graph.runQuery, graph.diagnostic
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const expr = node.expression;
        if (expr.expression.getText() === dbName || expr.expression.getText() === "graph") {
          const methodName = expr.name.getText();
          const args = node.arguments;

          if (methodName === "runQuery" && args.length >= 1) {
            const queryArg = args[0];
            if (ts.isStringLiteral(queryArg)) {
              const queryName = queryArg.text;
              const id = queryIdMap.get(queryName);
              if (id === undefined) throw new Error(`Query '${queryName}' is not defined`);

              const callArgs: ts.Expression[] = [ts.factory.createNumericLiteral(id)];
              for (let i = 1; i < args.length; i++) {
                callArgs.push(visitNode(args[i]) as ts.Expression);
              }

              return ts.factory.createCallExpression(ts.factory.createIdentifier("runQuery"), undefined, callArgs);
            } else {
              throw new Error(
                `db.runQuery requires a string literal query name (e.g. db.runQuery('searchHash', node))`,
              );
            }
          }

          if (methodName === "runHostQuery" && args.length >= 1) {
            const queryArg = args[0];
            if (ts.isStringLiteral(queryArg)) {
              const queryName = queryArg.text;
              const id = hostQueryIdMap.get(queryName);
              if (id === undefined) throw new Error(`Host Query ${queryName} not defined`);

              const arg1 = args.length > 1 ? (visitNode(args[1]) as ts.Expression) : ts.factory.createNumericLiteral(0);
              const arg2 = args.length > 2 ? (visitNode(args[2]) as ts.Expression) : ts.factory.createNumericLiteral(0);
              const arg3 = args.length > 3 ? (visitNode(args[3]) as ts.Expression) : ts.factory.createNumericLiteral(0);

              return ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createIdentifier("graph"),
                  ts.factory.createIdentifier("runHostQuery"),
                ),
                undefined,
                [ts.factory.createNumericLiteral(id), arg1, arg2, arg3],
              );
            }
          }

          if (methodName === "diagnostic") {
            const targetArg = args.length > 0 ? args[0] : undefined;
            const arg0 = args.length > 1 ? (visitNode(args[1]) as ts.Expression) : ts.factory.createNumericLiteral(0);
            const arg1 = args.length > 2 ? (visitNode(args[2]) as ts.Expression) : ts.factory.createNumericLiteral(0);
            const arg2 = args.length > 3 ? (visitNode(args[3]) as ts.Expression) : ts.factory.createNumericLiteral(0);
            const arg3 = args.length > 4 ? (visitNode(args[4]) as ts.Expression) : ts.factory.createNumericLiteral(0);

            let startExpr: ts.Expression = ts.factory.createIdentifier("nodeStart");
            let endExpr: ts.Expression = ts.factory.createIdentifier("nodeEnd");

            if (targetArg) {
              const targetNodeExpr = visitNode(targetArg) as ts.Expression;
              if (!ts.isIdentifier(targetNodeExpr) || targetNodeExpr.text !== "node") {
                const foundOffset = ts.factory.createCallExpression(
                  ts.factory.createIdentifier("lsp_findNodeOffset"),
                  undefined,
                  [ts.factory.createIdentifier("globalAstRoot"), targetNodeExpr],
                );
                const startNodeOffset = ts.factory.createConditionalExpression(
                  ts.factory.createBinaryExpression(
                    foundOffset,
                    ts.factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
                    ts.factory.createNumericLiteral("0"),
                  ),
                  ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                  ts.factory.createCallExpression(ts.factory.createIdentifier("u32"), undefined, [foundOffset]),
                  ts.factory.createToken(ts.SyntaxKind.ColonToken),
                  ts.factory.createIdentifier("nodeStart"),
                );
                const nodeLen = ts.factory.createCallExpression(
                  ts.factory.createIdentifier("getNodeByteLength"),
                  undefined,
                  [targetNodeExpr],
                );

                startExpr = startNodeOffset;
                endExpr = ts.factory.createBinaryExpression(
                  startNodeOffset,
                  ts.factory.createToken(ts.SyntaxKind.PlusToken),
                  nodeLen,
                );
              }
            }

            return ts.factory.createCallExpression(ts.factory.createIdentifier("lsp_allocDiagnostic"), undefined, [
              startExpr,
              endExpr,
              ts.factory.createIdentifier("lintId"),
              arg0,
              arg1,
              arg2,
              arg3,
            ]);
          }
        } else if (
          ts.isPropertyAccessExpression(expr.expression) &&
          ts.isIdentifier(expr.expression.expression) &&
          (expr.expression.expression.text === dbName || expr.expression.expression.text === "graph")
        ) {
          const obj = expr.expression;
          const namespace = obj.name.text;
          const methodName = expr.name.text;
          const args = node.arguments;

          if (namespace === "model") {
            if (methodName === "create" && args.length >= 1) {
              const typeArg = args[0];
              if (ts.isStringLiteral(typeArg)) {
                let typeName = typeArg.text.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
                if (/^[0-9]/.test(typeName)) typeName = "_" + typeName;

                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("graph"),
                      ts.factory.createIdentifier("model"),
                    ),
                    ts.factory.createIdentifier("create"),
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
            } else if (methodName === "compute" && args.length >= 2) {
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
            } else if ((methodName === "getProperty" || methodName === "setProperty") && args.length >= 2) {
              const nodeArg = args[0];
              const propArg = args[1];
              if (ts.isStringLiteral(propArg)) {
                let propName = propArg.text.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
                propName = propName.replace(/[^A-Z0-9_]/g, "_");
                if (/^[0-9]/.test(propName)) propName = "_" + propName;

                const callArgs: ts.Expression[] = [
                  visitNode(nodeArg) as ts.Expression,
                  ts.factory.createTypeAssertion(
                    ts.factory.createTypeReferenceNode("u32"),
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("Property"),
                      ts.factory.createIdentifier(propName),
                    ),
                  ),
                ];
                if (args.length > 2) callArgs.push(visitNode(args[2]) as ts.Expression);

                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("graph"),
                      ts.factory.createIdentifier("model"),
                    ),
                    ts.factory.createIdentifier(methodName),
                  ),
                  undefined,
                  callArgs,
                );
              }
            } else if (
              (methodName === "setFlag" || methodName === "clearFlag" || methodName === "hasFlag") &&
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
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("graph"),
                      ts.factory.createIdentifier("model"),
                    ),
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
          } else if (namespace === "ast") {
            if ((methodName === "getChildByFieldId" || methodName === "getChildrenByFieldId") && args.length >= 2) {
              const nodeArg = args[0];
              const fieldArg = args[1];
              if (ts.isStringLiteral(fieldArg)) {
                const fieldName = fieldArg.text;
                const safeName = fieldName.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("graph"),
                      ts.factory.createIdentifier("ast"),
                    ),
                    ts.factory.createIdentifier(methodName),
                  ),
                  undefined,
                  [
                    visitNode(nodeArg) as ts.Expression,
                    ts.factory.createTypeAssertion(
                      ts.factory.createTypeReferenceNode("u32"),
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("FieldId"),
                        ts.factory.createIdentifier(safeName),
                      ),
                    ),
                  ],
                );
              }
            } else if (methodName === "textEquals" && args.length === 2 && ts.isStringLiteral(args[1])) {
              const nodeArg = visitNode(args[0]) as ts.Expression;
              const strVal = args[1].text;
              const len = strVal.length;

              let expr: ts.Expression = ts.factory.createBinaryExpression(
                ts.factory.createCallExpression(ts.factory.createIdentifier("getNodeByteLength"), undefined, [nodeArg]),
                ts.factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
                ts.factory.createNumericLiteral(len),
              );

              for (let i = 0; i < len; i++) {
                const charCode = strVal.charCodeAt(i);
                const offsetExpr = ts.factory.createBinaryExpression(
                  ts.factory.createCallExpression(ts.factory.createIdentifier("getInputBuffer"), undefined, []),
                  ts.factory.createToken(ts.SyntaxKind.PlusToken),
                  ts.factory.createCallExpression(ts.factory.createIdentifier("lsp_findNodeOffset"), undefined, [
                    ts.factory.createIdentifier("globalAstRoot"),
                    nodeArg,
                  ]),
                );
                const indexExpr = ts.factory.createBinaryExpression(
                  offsetExpr,
                  ts.factory.createToken(ts.SyntaxKind.PlusToken),
                  ts.factory.createNumericLiteral(i),
                );
                const loadExpr = ts.factory.createCallExpression(
                  ts.factory.createIdentifier("load"),
                  [ts.factory.createTypeReferenceNode("u8")],
                  [indexExpr],
                );
                const charEqExpr = ts.factory.createBinaryExpression(
                  loadExpr,
                  ts.factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
                  ts.factory.createNumericLiteral(charCode),
                );
                expr = ts.factory.createBinaryExpression(
                  expr,
                  ts.factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
                  charEqExpr,
                );
              }
              return ts.factory.createParenthesizedExpression(expr);
            } else {
              return ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier("ast"),
                  ),
                  ts.factory.createIdentifier(methodName),
                ),
                undefined,
                args.map((a) => visitNode(a) as ts.Expression),
              );
            }
          } else if (namespace === "tensor") {
            if (methodName === "create" && args.length === 2) {
              const typeArg = args[0];
              const dimsArg = args[1];
              if (ts.isArrayLiteralExpression(dimsArg)) {
                const rank = dimsArg.elements.length;

                let totalElementsExpr: ts.Expression = dimsArg.elements[0] || ts.factory.createNumericLiteral("0");
                for (let i = 1; i < rank; i++) {
                  totalElementsExpr = ts.factory.createBinaryExpression(
                    totalElementsExpr,
                    ts.SyntaxKind.AsteriskToken,
                    dimsArg.elements[i],
                  );
                }

                const handleVar = ts.factory.createIdentifier("_t");

                const createCall = ts.factory.createVariableStatement(
                  undefined,
                  ts.factory.createVariableDeclarationList(
                    [
                      ts.factory.createVariableDeclaration(
                        handleVar,
                        undefined,
                        ts.factory.createTypeReferenceNode("u32"),
                        ts.factory.createCallExpression(
                          ts.factory.createPropertyAccessExpression(
                            ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("graph"), "tensor"),
                            "create",
                          ),
                          undefined,
                          [typeArg, ts.factory.createNumericLiteral(rank.toString()), totalElementsExpr],
                        ),
                      ),
                    ],
                    ts.NodeFlags.Let,
                  ),
                );

                const setShapeStatements = dimsArg.elements.map((dimExpr, index) =>
                  ts.factory.createExpressionStatement(
                    ts.factory.createCallExpression(
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("graph"), "tensor"),
                        "setShape",
                      ),
                      undefined,
                      [handleVar, ts.factory.createNumericLiteral(index.toString()), dimExpr as ts.Expression],
                    ),
                  ),
                );

                const returnStatement = ts.factory.createReturnStatement(handleVar);

                const iifeBody = ts.factory.createBlock([createCall, ...setShapeStatements, returnStatement], true);

                const iife = ts.factory.createCallExpression(
                  ts.factory.createParenthesizedExpression(
                    ts.factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      ts.factory.createTypeReferenceNode("u32"),
                      ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                      iifeBody,
                    ),
                  ),
                  undefined,
                  [],
                );

                return iife;
              }
            }
          }
        }
      }

      // 4. x.is(y) -> x == y
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "is" &&
        node.arguments.length === 1
      ) {
        const targetObj = visitNode(node.expression.expression) as ts.Expression;
        const arg = visitNode(node.arguments[0]) as ts.Expression;
        return ts.factory.createBinaryExpression(targetObj, ts.SyntaxKind.EqualsEqualsToken, arg);
      }

      return ts.visitEachChild(node, visit, transformerContext);
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
            context === "lint" &&
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

  return { body: bodyStr, params };
}
