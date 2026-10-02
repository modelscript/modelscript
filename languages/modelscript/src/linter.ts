// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelScriptErrorCode, type ModelScriptDiagnostic } from "./errors.js";

interface SymbolInfo {
  name: string;
  kind: "variable" | "function" | "struct" | "parameter" | "flwor-var";
  type?: string;
}

interface FunctionSig {
  paramCount: number;
  returnType?: string;
}

interface StructSig {
  fields: Set<string>;
}

export class ModelScriptLinter {
  private diagnostics: ModelScriptDiagnostic[] = [];
  private scopes: Map<string, SymbolInfo>[] = [];
  private functions = new Map<string, FunctionSig>();
  private structs = new Map<string, StructSig>();

  private enterScope(): void {
    this.scopes.push(new Map());
  }

  private exitScope(): void {
    this.scopes.pop();
  }

  private currentScope(): Map<string, SymbolInfo> {
    return this.scopes[this.scopes.length - 1];
  }

  private declareSymbol(name: string, kind: SymbolInfo["kind"], node: any, type?: string): boolean {
    const scope = this.currentScope();
    if (scope.has(name)) {
      this.addDiagnostic(
        ModelScriptErrorCode.DUPLICATE_DECLARATION.code,
        ModelScriptErrorCode.DUPLICATE_DECLARATION.rule,
        "error",
        ModelScriptErrorCode.DUPLICATE_DECLARATION.message(name),
        node,
      );
      return false;
    }
    scope.set(name, { name, kind, type });
    return true;
  }

  private isDeclared(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return true;
    }
    return false;
  }

  private addDiagnostic(
    code: number,
    rule: string,
    severity: "error" | "warning" | "info",
    message: string,
    node: any,
  ): void {
    const pos = node?.startPosition || { row: 0, column: 0 };
    const endPos = node?.endPosition || { row: 0, column: 0 };
    this.diagnostics.push({
      code,
      rule,
      severity,
      message,
      range: {
        startLine: pos.row + 1,
        startColumn: pos.column + 1,
        endLine: endPos.row + 1,
        endColumn: endPos.column + 1,
      },
    });
  }

  lint(rootNode: any): ModelScriptDiagnostic[] {
    this.diagnostics = [];
    this.scopes = [];
    this.functions.clear();
    this.structs.clear();

    this.enterScope();

    // Built-in globals & mathematical primitives
    this.declareSymbol("Math", "variable", null);
    this.declareSymbol("console", "variable", null);
    this.declareSymbol("print", "function", null);

    this.collectDeclarations(rootNode);
    this.walk(rootNode);

    this.exitScope();
    return this.diagnostics;
  }

  private collectDeclarations(node: any): void {
    if (!node) return;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);

      if (child.type === "TopLevelDeclaration" || child.type === "Statement") {
        this.collectDeclarations(child);
        continue;
      }

      if (child.type === "StructDeclaration") {
        const idNode = child.childForFieldName?.("name");
        const name = idNode?.text;
        if (name) {
          this.declareSymbol(name, "struct", idNode);
          const fields = new Set<string>();
          for (let j = 0; j < child.childCount; j++) {
            const f = child.child(j);
            if (f.type === "StructField") {
              const fName = f.childForFieldName?.("name")?.text;
              if (fName) fields.add(fName);
            }
          }
          this.structs.set(name, { fields });
        }
      } else if (child.type === "FunctionDeclaration") {
        const idNode = child.childForFieldName?.("name");
        const name = idNode?.text;
        if (name) {
          this.declareSymbol(name, "function", idNode);
          const paramsNode = child.childForFieldName?.("parameters");
          let paramCount = 0;
          if (paramsNode) {
            for (let j = 0; j < paramsNode.childCount; j++) {
              if (paramsNode.child(j).type === "Parameter") paramCount++;
            }
          }
          const retType = child.childForFieldName?.("returnType")?.text;
          this.functions.set(name, { paramCount, returnType: retType });
        }
      }
    }
  }

  private walk(node: any): void {
    if (!node) return;

    switch (node.type) {
      case "BlockStatement": {
        this.enterScope();
        for (let i = 0; i < node.childCount; i++) {
          this.walk(node.child(i));
        }
        this.exitScope();
        return;
      }

      case "VariableDeclaration": {
        const idNode = node.childForFieldName?.("name");
        const typeNode = node.childForFieldName?.("type");
        const valNode = node.childForFieldName?.("value");
        const name = idNode?.text;

        if (valNode) {
          this.walk(valNode);
        }

        if (name) {
          this.declareSymbol(name, "variable", idNode, typeNode?.text);
        }
        return;
      }

      case "FunctionDeclaration": {
        const bodyNode = node.childForFieldName?.("body");
        const paramsNode = node.childForFieldName?.("parameters");

        this.enterScope();
        if (paramsNode) {
          for (let i = 0; i < paramsNode.childCount; i++) {
            const p = paramsNode.child(i);
            if (p.type === "Parameter") {
              const pId = p.childForFieldName?.("name");
              const pType = p.childForFieldName?.("type")?.text;
              if (pId) {
                this.declareSymbol(pId.text, "parameter", pId, pType);
              }
            }
          }
        }

        if (bodyNode) {
          // Walk body statements within the function's parameter scope
          for (let i = 0; i < bodyNode.childCount; i++) {
            this.walk(bodyNode.child(i));
          }
        }
        this.exitScope();
        return;
      }

      case "FLWORExpression": {
        this.enterScope();
        const forClauses: any[] = [];
        const letClauses: any[] = [];
        let whereClause: any = null;
        let orderByClause: any = null;
        let returnClause: any = null;

        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "ForClause") forClauses.push(c);
          else if (c.type === "LetClause") letClauses.push(c);
          else if (c.type === "WhereClause") whereClause = c;
          else if (c.type === "OrderByClause") orderByClause = c;
          else if (c.type === "ReturnClause") returnClause = c;
        }

        for (const fc of forClauses) {
          const coll = fc.childForFieldName?.("collection");
          this.walk(coll);
          const varId = fc.childForFieldName?.("variable");
          if (varId) {
            this.declareSymbol(varId.text, "flwor-var", varId);
          }
        }

        for (const lc of letClauses) {
          const val = lc.childForFieldName?.("value");
          this.walk(val);
          const varId = lc.childForFieldName?.("variable");
          if (varId) {
            this.declareSymbol(varId.text, "flwor-var", varId);
          }
        }

        if (whereClause) {
          this.walk(whereClause.childForFieldName?.("condition"));
        }

        if (orderByClause) {
          this.walk(orderByClause.childForFieldName?.("criteria"));
        }

        if (returnClause) {
          this.walk(returnClause.childForFieldName?.("value"));
        }

        this.exitScope();
        return;
      }

      case "PostfixExpression": {
        const calleeNode = node.childForFieldName?.("callee");
        if (calleeNode) {
          const fnName = calleeNode.text;
          const fnSig = this.functions.get(fnName);
          const argsNode = node.childForFieldName?.("arguments");
          let argCount = 0;
          if (argsNode) {
            for (let i = 0; i < argsNode.childCount; i++) {
              if (argsNode.child(i).type === "Argument") argCount++;
            }
          }
          if (fnSig && fnSig.paramCount !== argCount) {
            this.addDiagnostic(
              ModelScriptErrorCode.ARGUMENT_COUNT_MISMATCH.code,
              ModelScriptErrorCode.ARGUMENT_COUNT_MISMATCH.rule,
              "error",
              ModelScriptErrorCode.ARGUMENT_COUNT_MISMATCH.message(fnName, String(fnSig.paramCount), String(argCount)),
              node,
            );
          }
        }

        // Walk children
        for (let i = 0; i < node.childCount; i++) {
          this.walk(node.child(i));
        }
        return;
      }

      case "IDENTIFIER": {
        const name = node.text;
        const parent = node.parent;
        const isDeclarationName =
          ((parent?.type === "VariableDeclaration" ||
            parent?.type === "StructDeclaration" ||
            parent?.type === "StructField" ||
            parent?.type === "FunctionDeclaration" ||
            parent?.type === "Parameter" ||
            parent?.type === "ForClause" ||
            parent?.type === "LetClause") &&
            parent.childForFieldName?.("name") === node) ||
          parent?.type === "CustomType" ||
          parent?.type === "Type" ||
          parent?.type === "PrimitiveType" ||
          parent?.type === "ImportSpecifier";

        const isFieldAccess = parent?.type === "PostfixExpression" && parent.childForFieldName?.("property") === node;

        if (!isDeclarationName && !isFieldAccess) {
          if (!this.isDeclared(name)) {
            this.addDiagnostic(
              ModelScriptErrorCode.UNDEFINED_VARIABLE.code,
              ModelScriptErrorCode.UNDEFINED_VARIABLE.rule,
              "error",
              ModelScriptErrorCode.UNDEFINED_VARIABLE.message(name),
              node,
            );
          }
        }
        return;
      }

      default: {
        for (let i = 0; i < node.childCount; i++) {
          this.walk(node.child(i));
        }
      }
    }
  }
}
