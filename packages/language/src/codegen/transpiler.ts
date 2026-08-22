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

  let queryStr: string;
  if (typeof queryFn === "object" && queryFn !== null && "kind" in queryFn && typeof queryFn.getText === "function") {
    const sf = typeof queryFn.getSourceFile === "function" ? queryFn.getSourceFile() : undefined;
    queryStr = queryFn.getText(sf);
  } else if (typeof queryFn === "function") {
    queryStr = queryFn.toString();
  } else {
    queryStr = String(queryFn);
  }

  // If it's already a string without arrow/function, just return it
  if (typeof queryFn === "string" && !queryStr.includes("=>") && !queryStr.startsWith("function")) {
    return { body: queryStr, params: ["queryArg"] };
  }

  let parseStr = queryStr.trim();
  if (parseStr.startsWith("(") && parseStr.includes("=>") && !parseStr.startsWith("((")) {
    parseStr = `(${parseStr})`;
  }

  const sourceFile = ts.createSourceFile("temp.ts", parseStr, ts.ScriptTarget.Latest, true);

  let dbName = "graph";
  let originalParams: string[] = [];
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isExpressionStatement(node)) {
      let expr: ts.Expression = node.expression;
      if (ts.isParenthesizedExpression(expr)) {
        expr = expr.expression;
      }
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        originalParams = expr.parameters.map((p) => p.name.getText(sourceFile));
      }
    } else if (ts.isFunctionDeclaration(node)) {
      originalParams = node.parameters.map((p) => p.name.getText(sourceFile));
    }
  });
  let hasDbParam = false;
  if (originalParams.length > 0) {
    const firstP = originalParams[0];
    if (firstP === "db" || firstP === "graph" || firstP === "cg") {
      dbName = firstP;
      hasDbParam = true;
    }
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

      // Syntactic Sugar: graph.unroll and graph.scope.enter at statement level
      if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
        const call = node.expression;
        if (ts.isPropertyAccessExpression(call.expression)) {
          const propAccess = call.expression;
          // 1. graph.unroll("i", 1, 3, (i) => { ... })
          if (
            (propAccess.expression.getText() === dbName || propAccess.expression.getText() === "graph") &&
            propAccess.name.getText() === "unroll" &&
            call.arguments.length >= 4
          ) {
            const iterVarArg = call.arguments[0];
            const startArg = call.arguments[1];
            const endArg = call.arguments[2];
            const fnArg = call.arguments[3];

            let iterName = "i";
            if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
              if (fnArg.parameters.length > 0) {
                iterName = fnArg.parameters[0].name.getText();
              }
            } else if (ts.isStringLiteral(iterVarArg)) {
              iterName = iterVarArg.text;
            }

            let bodyStmts: ts.Statement[] = [];
            if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
              if (ts.isBlock(fnArg.body)) {
                bodyStmts = fnArg.body.statements.map((s) => visitNode(s) as ts.Statement);
              } else {
                bodyStmts = [ts.factory.createExpressionStatement(visitNode(fnArg.body) as ts.Expression)];
              }
            }

            const loopInit = ts.factory.createVariableDeclarationList(
              [
                ts.factory.createVariableDeclaration(
                  ts.factory.createIdentifier(iterName),
                  undefined,
                  ts.factory.createTypeReferenceNode("i32"),
                  visitNode(startArg) as ts.Expression,
                ),
              ],
              ts.NodeFlags.Let,
            );

            const loopCond = ts.factory.createBinaryExpression(
              ts.factory.createIdentifier(iterName),
              ts.factory.createToken(ts.SyntaxKind.LessThanEqualsToken),
              visitNode(endArg) as ts.Expression,
            );

            const loopIncr = ts.factory.createPostfixUnaryExpression(
              ts.factory.createIdentifier(iterName),
              ts.SyntaxKind.PlusPlusToken,
            );

            return ts.factory.createForStatement(loopInit, loopCond, loopIncr, ts.factory.createBlock(bodyStmts, true));
          }

          // 2. graph.scope.enter(prefix, () => { ... })
          if (
            ts.isPropertyAccessExpression(propAccess.expression) &&
            (propAccess.expression.expression.getText() === dbName ||
              propAccess.expression.expression.getText() === "graph") &&
            propAccess.expression.name.text === "scope" &&
            propAccess.name.text === "enter" &&
            call.arguments.length >= 2
          ) {
            const prefixArg = call.arguments[0];
            const fnArg = call.arguments[1];

            let bodyStmts: ts.Statement[] = [];
            if (ts.isArrowFunction(fnArg) || ts.isFunctionExpression(fnArg)) {
              if (ts.isBlock(fnArg.body)) {
                bodyStmts = fnArg.body.statements.map((s) => visitNode(s) as ts.Statement);
              } else {
                bodyStmts = [ts.factory.createExpressionStatement(visitNode(fnArg.body) as ts.Expression)];
              }
            }

            let prefixExpr: ts.Expression;
            if (ts.isStringLiteral(prefixArg)) {
              prefixExpr = ts.factory.createNumericLiteral(getDJB2Hash(prefixArg.text));
            } else {
              prefixExpr = visitNode(prefixArg) as ts.Expression;
            }

            const pushStmt = ts.factory.createExpressionStatement(
              ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier("scope"),
                  ),
                  ts.factory.createIdentifier("push"),
                ),
                undefined,
                [prefixExpr],
              ),
            );

            const popStmt = ts.factory.createExpressionStatement(
              ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier("scope"),
                  ),
                  ts.factory.createIdentifier("pop"),
                ),
                undefined,
                [],
              ),
            );

            return ts.factory.createBlock([pushStmt, ...bodyStmts, popStmt], true);
          }
        }
      }

      // 1. $.RuleName -> <u16>SyntaxType.RULENAME or getDJB2Hash(RuleName)
      if (ts.isPropertyAccessExpression(node) && node.expression.getText() === "$") {
        const rawName = node.name.getText();
        const upper = rawName.toUpperCase();
        const rules = opts.rules;
        const existsInRules = rules ? Boolean(rules[rawName] || rules[upper]) : true;
        if (rules && !existsInRules) {
          return ts.factory.createTypeAssertion(
            ts.factory.createTypeReferenceNode("u16"),
            ts.factory.createNumericLiteral((getDJB2Hash(rawName) & 0xffff).toString()),
          );
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
        return ts.factory.createTypeAssertion(
          ts.factory.createTypeReferenceNode("u16"),
          ts.factory.createNumericLiteral((getDJB2Hash(rawName) & 0xffff).toString()),
        );
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
            const targetNodeExpr = targetArg ? (visitNode(targetArg) as ts.Expression) : undefined;
            const arg0 =
              args.length > 1
                ? (visitNode(args[1]) as ts.Expression)
                : targetNodeExpr || ts.factory.createNumericLiteral(0);
            const arg1 = args.length > 2 ? (visitNode(args[2]) as ts.Expression) : ts.factory.createNumericLiteral(0);
            const arg2 = args.length > 3 ? (visitNode(args[3]) as ts.Expression) : ts.factory.createNumericLiteral(0);
            const arg3 = args.length > 4 ? (visitNode(args[4]) as ts.Expression) : ts.factory.createNumericLiteral(0);

            let startExpr: ts.Expression = ts.factory.createIdentifier("nodeStart");
            let endExpr: ts.Expression = ts.factory.createIdentifier("nodeEnd");

            if (targetArg && targetNodeExpr) {
              if (!ts.isIdentifier(targetNodeExpr) || targetNodeExpr.text !== "node") {
                const createOffsetCall = () =>
                  ts.factory.createCallExpression(ts.factory.createIdentifier("lsp_findNodeOffset"), undefined, [
                    ts.factory.createIdentifier("globalAstRoot"),
                    targetNodeExpr,
                  ]);
                const startNodeOffset = ts.factory.createConditionalExpression(
                  ts.factory.createBinaryExpression(
                    createOffsetCall(),
                    ts.factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
                    ts.factory.createNumericLiteral("0"),
                  ),
                  ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                  ts.factory.createCallExpression(ts.factory.createIdentifier("u32"), undefined, [createOffsetCall()]),
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
                  startExpr,
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

                const typeArgs = node.typeArguments
                  ? node.typeArguments.map((t) => visitNode(t) as ts.TypeNode)
                  : [ts.factory.createTypeReferenceNode("u32")];

                return ts.factory.createCallExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createPropertyAccessExpression(
                      ts.factory.createIdentifier("graph"),
                      ts.factory.createIdentifier("model"),
                    ),
                    ts.factory.createIdentifier(methodName),
                  ),
                  typeArgs,
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
          } else if (namespace === "scope") {
            return ts.factory.createCallExpression(
              ts.factory.createPropertyAccessExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createIdentifier("graph"),
                  ts.factory.createIdentifier("scope"),
                ),
                ts.factory.createIdentifier(methodName),
              ),
              undefined,
              args.map((a) => visitNode(a) as ts.Expression),
            );
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
              return ts.factory.createCallExpression(
                ts.factory.createPropertyAccessExpression(
                  ts.factory.createPropertyAccessExpression(
                    ts.factory.createIdentifier("graph"),
                    ts.factory.createIdentifier("ast"),
                  ),
                  ts.factory.createIdentifier("textEquals"),
                ),
                undefined,
                [nodeArg, args[1]],
              );
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

      // 5. === -> == and !== -> != (AssemblyScript compatibility)
      if (context !== "subtyping" && ts.isBinaryExpression(node)) {
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
          return ts.factory.createBinaryExpression(
            visitNode(node.left) as ts.Expression,
            ts.SyntaxKind.EqualsEqualsToken,
            visitNode(node.right) as ts.Expression,
          );
        }
        if (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          return ts.factory.createBinaryExpression(
            visitNode(node.left) as ts.Expression,
            ts.SyntaxKind.ExclamationEqualsToken,
            visitNode(node.right) as ts.Expression,
          );
        }
      }

      // 6. Identifier db / dbName -> graph (only when dbName was a valid db parameter)
      if (ts.isIdentifier(node) && (node.text === "db" || (hasDbParam && node.text === dbName))) {
        return ts.factory.createIdentifier("graph");
      }

      // 7. Generic call expressions: drop dummy `$` and `db` arguments
      if (ts.isCallExpression(node)) {
        const filteredArgs = node.arguments
          .filter((arg) => {
            if (ts.isIdentifier(arg)) {
              if (arg.text === "$") return false;
              if (arg.text === "db") return false;
            }
            return true;
          })
          .map((arg) => visitNode(arg) as ts.Expression);
        const expr = visitNode(node.expression) as ts.Expression;
        return ts.factory.createCallExpression(expr, node.typeArguments, filteredArgs);
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
  let foundFunc = false;

  function extractFunc(node: ts.Node): void {
    if (foundFunc) return;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      foundFunc = true;
      params = node.parameters.map((p) => p.name.getText(transformedSource));
      const body = node.body;
      if (ts.isBlock(body)) {
        bodyStr = body.statements.map((s) => s.getText(transformedSource)).join("\n");
      } else {
        if (
          context === "lint" &&
          ts.isCallExpression(body) &&
          ts.isIdentifier(body.expression) &&
          body.expression.getText(transformedSource) === "lsp_allocDiagnostic"
        ) {
          bodyStr = body.getText(transformedSource) + ";";
        } else {
          bodyStr = "return " + body.getText(transformedSource) + ";";
        }
      }
      return;
    } else if (ts.isFunctionDeclaration(node)) {
      foundFunc = true;
      params = node.parameters.map((p) => p.name.getText(transformedSource));
      if (node.body) {
        bodyStr = node.body.statements.map((s) => s.getText(transformedSource)).join("\n");
      }
      return;
    }
    ts.forEachChild(node, extractFunc);
  }

  ts.forEachChild(transformedSource, extractFunc);

  if (!foundFunc && bodyStr === "") {
    bodyStr = printed;
  }

  return { body: bodyStr, params };
}

/**
 * Transpiles a TypeScript class definition into an AssemblyScript `@unmanaged export class`.
 */
export function transpileClass(
  classDef: (new (...args: any[]) => any) | ((...args: any[]) => any) | string | ts.Node,
  options: TranspileOptions | "query" | "lint" | "lsp" | "subtyping" | "dataflow" = "query",
): string {
  let classStr: string;
  if (
    typeof classDef === "object" &&
    classDef !== null &&
    "kind" in classDef &&
    typeof (classDef as any).getText === "function"
  ) {
    const sf = typeof (classDef as any).getSourceFile === "function" ? (classDef as any).getSourceFile() : undefined;
    classStr = (classDef as any).getText(sf);
  } else if (typeof classDef === "function") {
    classStr = classDef.toString();
  } else {
    classStr = String(classDef);
  }

  const sourceFile = ts.createSourceFile("temp_class.ts", classStr, ts.ScriptTarget.Latest, true);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (transformerContext) => {
    const visit: ts.Visitor = (node) => {
      // 0. Filter out static blocks injected by bundlers / tsx (e.g., static { __name(...) })
      if (ts.isClassStaticBlockDeclaration(node)) {
        return undefined;
      }

      // 1. Property declaration type defaulting
      if (ts.isPropertyDeclaration(node)) {
        let typeNode = node.type;
        if (!typeNode) {
          typeNode = ts.factory.createTypeReferenceNode("u32");
        }
        return ts.factory.updatePropertyDeclaration(
          node,
          node.modifiers,
          node.name,
          node.questionToken,
          typeNode,
          node.initializer,
        );
      }

      // 2. Method declaration parameter and return type defaulting
      if (ts.isMethodDeclaration(node)) {
        const methodName = node.name.getText(sourceFile);
        const updatedParams = node.parameters.map((p) => {
          let paramType = p.type;
          if (!paramType) {
            paramType = ts.factory.createTypeReferenceNode("u32");
          }
          return ts.factory.updateParameterDeclaration(
            p,
            p.modifiers,
            p.dotDotDotToken,
            p.name,
            p.questionToken,
            paramType,
            p.initializer,
          );
        });

        let returnType = node.type;
        if (!returnType) {
          if (methodName === "init" || methodName === "constructor") {
            returnType = ts.factory.createTypeReferenceNode("void");
          } else {
            returnType = ts.factory.createTypeReferenceNode("u32");
          }
        }

        const visitedBody = node.body ? (visitNode(node.body) as ts.Block) : undefined;

        return ts.factory.updateMethodDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.questionToken,
          node.typeParameters,
          updatedParams,
          returnType,
          visitedBody,
        );
      }

      // 3. x.is(y) -> x == y
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

      // 4. Optional property access a?.b -> a.b
      if (ts.isPropertyAccessChain(node)) {
        const obj = visitNode(node.expression) as ts.Expression;
        return ts.factory.createPropertyAccessExpression(obj, node.name);
      }

      // 5. Optional call a?.(...) -> a(...)
      if (ts.isCallChain(node)) {
        const expr = visitNode(node.expression) as ts.Expression;
        const args = node.arguments.map((arg) => visitNode(arg) as ts.Expression);
        return ts.factory.createCallExpression(expr, undefined, args);
      }

      return ts.visitEachChild(node, visit, transformerContext);
    };

    function visitNode(node: ts.Node): ts.Node {
      return ts.visitNode(node, visit) as ts.Node;
    }

    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };

  const result = ts.transform(sourceFile, [transformer]);
  let printed = ts.createPrinter().printFile(result.transformed[0]).trim();

  let formatted = printed.replace(/@unmanaged\s*/g, "");
  if (formatted.startsWith("export default class ")) {
    formatted = "@unmanaged\nexport class " + formatted.substring("export default class ".length);
  } else if (formatted.startsWith("export class ")) {
    formatted = "@unmanaged\nexport class " + formatted.substring("export class ".length);
  } else if (formatted.startsWith("class ")) {
    formatted = "@unmanaged\nexport class " + formatted.substring("class ".length);
  } else {
    formatted = "@unmanaged\nexport " + formatted;
  }

  return formatted;
}

/**
 * Transpiles a standalone TypeScript helper function into an exported AssemblyScript function.
 */
export function transpileHelperFunction(
  fn: ((...args: any[]) => any) | string | ts.Node,
  options: TranspileOptions | "query" | "lint" | "lsp" | "subtyping" | "dataflow" = "query",
): string {
  const opts: TranspileOptions = typeof options === "string" ? { context: options } : options;
  let fnStr: string;
  if (typeof fn === "object" && fn !== null && "kind" in fn && typeof (fn as any).getText === "function") {
    const sf = typeof (fn as any).getSourceFile === "function" ? (fn as any).getSourceFile() : undefined;
    fnStr = (fn as any).getText(sf);
  } else if (typeof fn === "function") {
    fnStr = fn.toString();
  } else {
    fnStr = String(fn);
  }

  const sourceFile = ts.createSourceFile("temp_fn.ts", fnStr, ts.ScriptTarget.Latest, true);

  const transformer: ts.TransformerFactory<ts.SourceFile> = (transformerContext) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isFunctionDeclaration(node)) {
        const updatedParams = node.parameters.map((p) => {
          let paramType = p.type;
          if (!paramType) {
            paramType = ts.factory.createTypeReferenceNode("u32");
          }
          return ts.factory.updateParameterDeclaration(
            p,
            p.modifiers,
            p.dotDotDotToken,
            p.name,
            p.questionToken,
            paramType,
            p.initializer,
          );
        });

        let returnType = node.type;
        if (!returnType) {
          returnType = ts.factory.createTypeReferenceNode("u32");
        }

        const visitedBody = node.body ? (visitNode(node.body) as ts.Block) : undefined;

        return ts.factory.updateFunctionDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          updatedParams,
          returnType,
          visitedBody,
        );
      }

      return ts.visitEachChild(node, visit, transformerContext);
    };

    function visitNode(node: ts.Node): ts.Node {
      return ts.visitNode(node, visit) as ts.Node;
    }

    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };

  const result = ts.transform(sourceFile, [transformer]);
  let printed = ts.createPrinter().printFile(result.transformed[0]).trim();

  if (!printed.startsWith("export function") && !printed.startsWith("function")) {
    const queryInfo = transpileQuery(fn, opts);
    return `export function helperFunction(${queryInfo.params.map((p) => p + ": u32").join(", ")}): u32 {\n${queryInfo.body}\n}`;
  }
  if (!printed.startsWith("export ")) {
    printed = "export " + printed;
  }
  return printed;
}
