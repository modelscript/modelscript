import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export interface ExtractedLanguageAST {
  sourceFile: ts.SourceFile;
  lints: Map<string, ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration>;
  queries: Map<string, ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration>;
  classes: Map<string, ts.ClassDeclaration | ts.ClassExpression>;
  functions: Map<string, ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction>;
  constants: Map<string, ts.VariableDeclaration>;
  pipelines: Map<string, (ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration)[]>;
  definition?: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.Identifier;
}

/**
 * Extracts TypeScript AST nodes for lints, queries, classes, functions, and pipelines
 * directly from source code using TypeScript's own AST parser (`ts.createSourceFile`).
 *
 * This preserves all explicit type annotations (`: u32`, `: i32`, `: bool`, etc.),
 * comments, and syntactic structures without suffering from runtime JavaScript type erasure.
 *
 * @param sourcePathOrText File path on disk or raw TypeScript source text
 * @returns Extracted AST mapping container or null if extraction fails
 */
export function extractLanguageAST(sourcePathOrText: string): ExtractedLanguageAST | null {
  let sourceText = "";
  let filePath = "language.ts";

  if (
    typeof sourcePathOrText === "string" &&
    (sourcePathOrText.startsWith("/") ||
      sourcePathOrText.startsWith("./") ||
      sourcePathOrText.endsWith(".ts") ||
      sourcePathOrText.endsWith(".js")) &&
    fs.existsSync(sourcePathOrText)
  ) {
    try {
      sourceText = fs.readFileSync(sourcePathOrText, "utf-8");
      filePath = sourcePathOrText;
    } catch {
      return null;
    }
  } else if (typeof sourcePathOrText === "string" && sourcePathOrText.length > 0) {
    sourceText = sourcePathOrText;
  } else {
    return null;
  }

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  const result: ExtractedLanguageAST = {
    sourceFile,
    lints: new Map(),
    queries: new Map(),
    classes: new Map(),
    functions: new Map(),
    constants: new Map(),
    pipelines: new Map(),
  };

  // 1. Index top-level class, function, variable, and relative import declarations
  const topLevelClasses = new Map<string, ts.ClassDeclaration>();
  const topLevelFunctions = new Map<string, ts.FunctionDeclaration>();
  const topLevelVariables = new Map<string, ts.Expression>();
  const namedImports = new Map<string, { moduleSpecifier: string; importedName: string }>();

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      topLevelClasses.set(node.name.text, node);
      result.classes.set(node.name.text, node);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      topLevelFunctions.set(node.name.text, node);
      result.functions.set(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          topLevelVariables.set(decl.name.text, decl.initializer);
          if (
            ts.isNumericLiteral(decl.initializer) ||
            ts.isStringLiteral(decl.initializer) ||
            ts.isPrefixUnaryExpression(decl.initializer) ||
            decl.initializer.kind === ts.SyntaxKind.TrueKeyword ||
            decl.initializer.kind === ts.SyntaxKind.FalseKeyword ||
            ts.isBinaryExpression(decl.initializer)
          ) {
            result.constants.set(decl.name.text, decl);
          }
        }
      }
    } else if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
      const moduleSpecifier = node.moduleSpecifier.text;
      if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const spec of node.importClause.namedBindings.elements) {
          const importedName = spec.propertyName ? spec.propertyName.text : spec.name.text;
          const localName = spec.name.text;
          namedImports.set(localName, { moduleSpecifier, importedName });
        }
      }
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const spec of node.exportClause.elements) {
        const localName = spec.propertyName ? spec.propertyName.text : spec.name.text;
        const exportedName = spec.name.text;
        const cls = topLevelClasses.get(localName);
        if (cls) {
          result.classes.set(exportedName, cls);
        }
        const fn = topLevelFunctions.get(localName);
        if (fn) {
          result.functions.set(exportedName, fn);
        }
      }
    }
  });

  // Automatically resolve all relative named imports to collect helper functions and constants
  for (const [localName, imp] of namedImports.entries()) {
    if (imp.moduleSpecifier.startsWith("./") || imp.moduleSpecifier.startsWith("../")) {
      try {
        const baseDir =
          filePath !== "language.ts" && filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
        let targetPath = baseDir ? `${baseDir}/${imp.moduleSpecifier}` : imp.moduleSpecifier;
        if (targetPath.endsWith(".js")) {
          targetPath = targetPath.slice(0, -3);
        }
        const candidates = [targetPath + ".ts", targetPath + ".js", targetPath + "/index.ts", targetPath];
        for (const testPath of candidates) {
          const normalized = path.resolve(testPath);
          if (normalized.includes("/packages/language/src/") || normalized.includes("/node_modules/")) {
            continue;
          }
          if (fs.existsSync(normalized)) {
            const subAst = extractLanguageAST(normalized);
            if (subAst) {
              if (subAst.constants.has(imp.importedName)) {
                result.constants.set(localName, subAst.constants.get(imp.importedName)!);
              }
              if (subAst.functions.has(imp.importedName)) {
                result.functions.set(localName, subAst.functions.get(imp.importedName)!);
              }
              if (subAst.classes.has(imp.importedName)) {
                result.classes.set(localName, subAst.classes.get(imp.importedName)!);
              }
              for (const [k, v] of subAst.constants) {
                if (!result.constants.has(k)) result.constants.set(k, v);
              }
              for (const [k, v] of subAst.functions) {
                if (!result.functions.has(k)) result.functions.set(k, v);
              }
              break;
            }
          }
        }
      } catch {}
    }
  }

  function resolveClass(name: string): ts.ClassDeclaration | ts.ClassExpression | undefined {
    const topClass = topLevelClasses.get(name);
    if (topClass) return topClass;

    const imp = namedImports.get(name);
    if (imp && (imp.moduleSpecifier.startsWith("./") || imp.moduleSpecifier.startsWith("../"))) {
      try {
        const baseDir =
          filePath !== "language.ts" && filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
        let targetPath = baseDir ? `${baseDir}/${imp.moduleSpecifier}` : imp.moduleSpecifier;
        if (targetPath.endsWith(".js")) {
          targetPath = targetPath.slice(0, -3);
        }
        const candidates = [targetPath + ".ts", targetPath + ".js", targetPath + "/index.ts", targetPath];
        for (const testPath of candidates) {
          if (fs.existsSync(testPath)) {
            const subAst = extractLanguageAST(testPath);
            if (subAst) {
              const cls = subAst.classes.get(imp.importedName);
              if (cls) return cls;
            }
          }
        }
      } catch {}
    }
    return undefined;
  }

  function resolveFunction(
    name: string,
  ): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | undefined {
    const topFn = topLevelFunctions.get(name);
    if (topFn) return topFn;

    const imp = namedImports.get(name);
    if (imp && (imp.moduleSpecifier.startsWith("./") || imp.moduleSpecifier.startsWith("../"))) {
      try {
        const baseDir =
          filePath !== "language.ts" && filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
        let targetPath = baseDir ? `${baseDir}/${imp.moduleSpecifier}` : imp.moduleSpecifier;
        if (targetPath.endsWith(".js")) {
          targetPath = targetPath.slice(0, -3);
        }
        const candidates = [targetPath + ".ts", targetPath + ".js", targetPath + "/index.ts", targetPath];
        for (const testPath of candidates) {
          if (fs.existsSync(testPath)) {
            const subAst = extractLanguageAST(testPath);
            if (subAst) {
              const fn = subAst.functions.get(imp.importedName);
              if (fn) return fn;
            }
          }
        }
      } catch {}
    }
    return undefined;
  }

  function resolveObjectLiteral(name: string): ts.ObjectLiteralExpression | undefined {
    const topExpr = topLevelVariables.get(name);
    if (topExpr && ts.isObjectLiteralExpression(topExpr)) return topExpr;

    const imp = namedImports.get(name);
    if (imp && (imp.moduleSpecifier.startsWith("./") || imp.moduleSpecifier.startsWith("../"))) {
      try {
        const baseDir =
          filePath !== "language.ts" && filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
        let targetPath = baseDir ? `${baseDir}/${imp.moduleSpecifier}` : imp.moduleSpecifier;
        if (targetPath.endsWith(".js")) {
          targetPath = targetPath.slice(0, -3);
        }
        const candidates = [targetPath + ".ts", targetPath + ".js", targetPath + "/index.ts", targetPath];
        for (const testPath of candidates) {
          if (fs.existsSync(testPath)) {
            const subAst = extractLanguageAST(testPath);
            if (subAst) {
              for (const [k, v] of subAst.constants) {
                result.constants.set(k, v);
              }
              for (const [k, v] of subAst.lints) {
                result.lints.set(k, v);
              }
              for (const [k, v] of subAst.classes) {
                result.classes.set(k, v);
              }
              for (const [k, v] of subAst.functions) {
                result.functions.set(k, v);
              }
            }
          }
        }
      } catch {}
    }
    return undefined;
  }

  function extractLintsFromObject(objExpr: ts.ObjectLiteralExpression): void {
    for (const lintEntry of objExpr.properties) {
      if (ts.isSpreadAssignment(lintEntry)) {
        if (ts.isIdentifier(lintEntry.expression)) {
          const spreadName = lintEntry.expression.text;
          const resolvedObj = resolveObjectLiteral(spreadName);
          if (resolvedObj) {
            extractLintsFromObject(resolvedObj);
          }
        }
        continue;
      }
      if (!ts.isPropertyAssignment(lintEntry) && !ts.isShorthandPropertyAssignment(lintEntry)) continue;
      const lintName = lintEntry.name.getText(sourceFile);

      if (ts.isPropertyAssignment(lintEntry) && ts.isObjectLiteralExpression(lintEntry.initializer)) {
        for (const lintProp of lintEntry.initializer.properties) {
          if (
            ts.isPropertyAssignment(lintProp) &&
            lintProp.name.getText(sourceFile) === "query" &&
            (ts.isArrowFunction(lintProp.initializer) ||
              ts.isFunctionExpression(lintProp.initializer) ||
              ts.isFunctionDeclaration(lintProp.initializer))
          ) {
            result.lints.set(lintName, lintProp.initializer);
          }
        }
      }
    }
  }

  // 2. Locate language options object literal in AST
  function visitObjectLiteral(obj: ts.ObjectLiteralExpression): void {
    function unwrapExpr(expr: ts.Expression): ts.Expression {
      let cur = expr;
      while (
        ts.isAsExpression(cur) ||
        ts.isTypeAssertionExpression(cur) ||
        ts.isParenthesizedExpression(cur) ||
        ts.isNonNullExpression(cur)
      ) {
        cur = cur.expression;
      }
      return cur;
    }

    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
      const propName = prop.name.getText(sourceFile);
      const rawInit = ts.isPropertyAssignment(prop) ? prop.initializer : null;
      const init = rawInit ? unwrapExpr(rawInit) : null;

      // lints: { [lintName]: { query: (db, node, $) => { ... } }, ...spreadLints } or lints: allLints
      if (propName === "lints" && init) {
        if (ts.isObjectLiteralExpression(init)) {
          extractLintsFromObject(init);
        } else if (ts.isIdentifier(init)) {
          const resolvedObj = resolveObjectLiteral(init.text);
          if (resolvedObj) extractLintsFromObject(resolvedObj);
        }
      }

      // queries: { [queryName]: (db, arg) => { ... } }
      if (propName === "queries" && init && ts.isObjectLiteralExpression(init)) {
        for (const queryEntry of init.properties) {
          if (!ts.isPropertyAssignment(queryEntry) && !ts.isShorthandPropertyAssignment(queryEntry)) continue;
          const queryName = queryEntry.name.getText(sourceFile);

          if (ts.isPropertyAssignment(queryEntry)) {
            if (
              ts.isArrowFunction(queryEntry.initializer) ||
              ts.isFunctionExpression(queryEntry.initializer) ||
              ts.isFunctionDeclaration(queryEntry.initializer)
            ) {
              result.queries.set(queryName, queryEntry.initializer);
            }
          }
        }
      }

      // classes: [ClassA, ClassB] or classes: { ClassA, ClassB }
      if (propName === "classes" && init) {
        if (ts.isArrayLiteralExpression(init)) {
          for (const elem of init.elements) {
            const unwrappedElem = unwrapExpr(elem);
            if (ts.isIdentifier(unwrappedElem)) {
              const name = unwrappedElem.text;
              const resolvedCls = resolveClass(name);
              if (resolvedCls) result.classes.set(name, resolvedCls);
            } else if (ts.isClassExpression(unwrappedElem) && unwrappedElem.name) {
              result.classes.set(unwrappedElem.name.text, unwrappedElem);
            }
          }
        } else if (ts.isObjectLiteralExpression(init)) {
          for (const entry of init.properties) {
            const name = entry.name?.getText(sourceFile) || "";
            if (ts.isShorthandPropertyAssignment(entry)) {
              const resolvedCls = resolveClass(name);
              if (resolvedCls) result.classes.set(name, resolvedCls);
            } else if (ts.isPropertyAssignment(entry)) {
              const entryInit = unwrapExpr(entry.initializer);
              if (ts.isIdentifier(entryInit)) {
                const resolvedCls = resolveClass(entryInit.text);
                if (resolvedCls) result.classes.set(name, resolvedCls);
              } else if (ts.isClassExpression(entryInit)) {
                result.classes.set(name, entryInit);
              }
            }
          }
        }
      }

      // functions: [fnA, fnB] or functions: { fnA, fnB }
      if (propName === "functions" && init) {
        if (ts.isArrayLiteralExpression(init)) {
          for (const elem of init.elements) {
            const unwrappedElem = unwrapExpr(elem);
            if (ts.isIdentifier(unwrappedElem)) {
              const name = unwrappedElem.text;
              const resolvedFn = resolveFunction(name);
              if (resolvedFn) result.functions.set(name, resolvedFn);
            } else if (ts.isFunctionExpression(unwrappedElem) && unwrappedElem.name) {
              result.functions.set(unwrappedElem.name.text, unwrappedElem);
            }
          }
        } else if (ts.isObjectLiteralExpression(init)) {
          for (const entry of init.properties) {
            const name = entry.name?.getText(sourceFile) || "";
            if (ts.isShorthandPropertyAssignment(entry)) {
              const resolvedFn = resolveFunction(name);
              if (resolvedFn) result.functions.set(name, resolvedFn);
            } else if (ts.isPropertyAssignment(entry)) {
              const entryInit = unwrapExpr(entry.initializer);
              if (ts.isIdentifier(entryInit)) {
                const resolvedFn = resolveFunction(entryInit.text);
                if (resolvedFn) result.functions.set(name, resolvedFn);
              } else if (ts.isFunctionExpression(entryInit) || ts.isArrowFunction(entryInit)) {
                result.functions.set(name, entryInit);
              }
            }
          }
        }
      }

      // pipelines: { [pipelineName]: { passes: [...] } }
      if (propName === "pipelines" && init && ts.isObjectLiteralExpression(init)) {
        for (const pipeEntry of init.properties) {
          if (!ts.isPropertyAssignment(pipeEntry) || !ts.isObjectLiteralExpression(pipeEntry.initializer)) continue;
          const pipeName = pipeEntry.name.getText(sourceFile);
          for (const pipeProp of pipeEntry.initializer.properties) {
            if (
              ts.isPropertyAssignment(pipeProp) &&
              pipeProp.name.getText(sourceFile) === "passes" &&
              ts.isArrayLiteralExpression(pipeProp.initializer)
            ) {
              const passFns: (ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration)[] = [];
              for (const passElem of pipeProp.initializer.elements) {
                if (
                  ts.isArrowFunction(passElem) ||
                  ts.isFunctionExpression(passElem) ||
                  ts.isFunctionDeclaration(passElem)
                ) {
                  passFns.push(passElem);
                } else if (ts.isIdentifier(passElem)) {
                  const topFn = topLevelFunctions.get(passElem.text);
                  if (topFn) passFns.push(topFn);
                }
              }
              if (passFns.length > 0) {
                result.pipelines.set(pipeName, passFns);
              }
            }
          }
        }
      }

      // lsp: { definition: (db, node, $) => { ... } }
      if (propName === "lsp" && ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const lspProp of prop.initializer.properties) {
          if (ts.isPropertyAssignment(lspProp) && lspProp.name.getText(sourceFile) === "definition") {
            if (
              ts.isArrowFunction(lspProp.initializer) ||
              ts.isFunctionExpression(lspProp.initializer) ||
              ts.isFunctionDeclaration(lspProp.initializer) ||
              ts.isIdentifier(lspProp.initializer)
            ) {
              result.definition = lspProp.initializer;
            }
          }
        }
      }
    }
  }

  function findLanguageCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const fnName = node.expression.getText(sourceFile);
      if (fnName === "language" || fnName === "grammar" || fnName.endsWith(".language")) {
        if (node.arguments.length > 0 && ts.isObjectLiteralExpression(node.arguments[0])) {
          visitObjectLiteral(node.arguments[0]);
        }
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      // Also inspect root object literals with 'rules' and 'name'
      let hasRules = false;
      let hasName = false;
      for (const p of node.properties) {
        const pName = p.name?.getText(sourceFile);
        if (pName === "rules") hasRules = true;
        if (pName === "name") hasName = true;
      }
      if (hasRules || hasName) {
        visitObjectLiteral(node);
      }
    }
    ts.forEachChild(node, findLanguageCalls);
  }

  for (const [varName, expr] of topLevelVariables) {
    if (ts.isObjectLiteralExpression(expr)) {
      extractLintsFromObject(expr);
    }
  }

  findLanguageCalls(sourceFile);
  return result;
}
