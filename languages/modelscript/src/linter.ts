// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelScriptErrorCode, type ModelScriptDiagnostic } from "./errors.js";

/**
 * Lexical scope entry representing a declared variable, function, struct, parameter, or FLWOR variable.
 */
interface SymbolInfo {
  name: string;
  kind: "variable" | "function" | "struct" | "parameter" | "flwor-var";
  type?: string | undefined;
}

/**
 * Recorded signature metadata for a top-level function declaration.
 */
interface FunctionSig {
  paramCount: number;
  returnType?: string | undefined;
}

/**
 * Recorded field set for a declared `struct` type.
 */
interface StructSig {
  fields: Set<string>;
}

/**
 * Semantic CST linter for ModelScript that validates lexical scoping, duplicate
 * declarations, FLWOR comprehension variable bindings, function call arity, and
 * struct field access.
 */
export class ModelScriptLinter {
  private diagnostics: ModelScriptDiagnostic[] = [];
  private scopes: Map<string, SymbolInfo>[] = [];
  private functions = new Map<string, FunctionSig>();
  private structs = new Map<string, StructSig>();

  /** Pushes a new lexical scope onto the scope stack. */
  private enterScope(): void {
    this.scopes.push(new Map());
  }

  /** Pops the innermost lexical scope from the scope stack. */
  private exitScope(): void {
    this.scopes.pop();
  }

  /** Returns the active innermost symbol table. */
  private currentScope(): Map<string, SymbolInfo> {
    return this.scopes[this.scopes.length - 1]!;
  }

  /**
   * Registers a symbol in the current lexical scope, emitting `DUPLICATE_DECLARATION`
   * if an identifier with the same name already exists in the same scope.
   */
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

  /** Searches the lexical scope stack from innermost to outermost for `name`. */
  private lookupSymbol(name: string): SymbolInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const sym = this.scopes[i]!.get(name);
      if (sym) return sym;
    }
    return undefined;
  }

  /** Returns `true` if `name` is bound in any enclosing lexical scope. */
  private isDeclared(name: string): boolean {
    return this.lookupSymbol(name) !== undefined;
  }

  /**
   * Attempts to resolve the struct type name of an object receiver expression
   * (either via variable type annotation or `new StructName(...)` construction).
   */
  private resolveObjectStructName(node: any): string | undefined {
    let cur = node;
    while (
      cur &&
      (cur.type === "Expression" || cur.type === "PrimaryExpression" || cur.type === "ParenthesizedExpression")
    ) {
      if (cur.type === "ParenthesizedExpression") {
        cur = cur.childForFieldName?.("expression") ?? cur.namedChildren?.[0];
      } else {
        cur = cur.namedChildren?.[0] ?? cur.child?.(0);
      }
    }
    if (!cur) return undefined;
    if (cur.type === "IDENTIFIER") {
      const sym = this.lookupSymbol(cur.text);
      if (sym?.type && this.structs.has(sym.type)) {
        return sym.type;
      }
    } else if (cur.type === "NewExpression") {
      const ctor = cur.childForFieldName?.("constructor")?.text;
      if (ctor && this.structs.has(ctor)) {
        return ctor;
      }
    }
    return undefined;
  }

  /** Appends a 1-indexed diagnostic anchored at `node`'s CST span. */
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

  /**
   * Runs two-pass semantic linting over a parsed ModelScript CST root node:
   * Pass 1 hoists top-level imports, structs, and functions; Pass 2 validates statements and expressions.
   */
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

  /**
   * First pass: hoists top-level `ImportDeclaration`, `StructDeclaration`, and
   * `FunctionDeclaration` symbols so forward references and member checks succeed.
   */
  private collectDeclarations(node: any): void {
    if (!node) return;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);

      if (child.type === "TopLevelDeclaration" || child.type === "Statement") {
        this.collectDeclarations(child);
        continue;
      }

      if (child.type === "ImportDeclaration") {
        const specsList = child.childForFieldName?.("specifiers");
        if (specsList) {
          for (let j = 0; j < specsList.childCount; j++) {
            const spec = specsList.child(j);
            if (spec.type === "ImportSpecifier") {
              const localNode =
                spec.childForFieldName?.("local") ??
                spec.childForFieldName?.("name") ??
                spec.childForFieldName?.("imported");
              if (localNode?.text) {
                this.declareSymbol(localNode.text, "variable", localNode);
              }
            }
          }
        }
      } else if (child.type === "StructDeclaration") {
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

  /**
   * Second pass: recursively traverses statements and expressions, managing lexical scopes
   * and checking identifier resolution, call arities, and struct member accesses.
   */
  private walk(node: any): void {
    if (!node) return;

    switch (node.type) {
      case "BlockStatement":
      case "ForStatement": {
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

        // Lint initializer expression before binding the variable in scope
        if (valNode) {
          this.walk(valNode);
        }

        let resolvedType = typeNode?.text?.trim();
        if (!resolvedType && valNode) {
          resolvedType = this.resolveObjectStructName(valNode);
        }

        if (name) {
          this.declareSymbol(name, "variable", idNode, resolvedType);
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
              const pType = p.childForFieldName?.("type")?.text?.trim();
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
        // Sequential clause scoping: variables bound in `for`/`let` are visible in subsequent clauses
        this.enterScope();
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (c.type === "ForClause") {
            const coll = c.childForFieldName?.("collection");
            this.walk(coll);
            const varId = c.childForFieldName?.("variable");
            if (varId) {
              this.declareSymbol(varId.text, "flwor-var", varId);
            }
          } else if (c.type === "LetClause") {
            const val = c.childForFieldName?.("value");
            this.walk(val);
            const varId = c.childForFieldName?.("variable");
            if (varId) {
              this.declareSymbol(varId.text, "flwor-var", varId);
            }
          } else if (c.type === "WhereClause") {
            this.walk(c.childForFieldName?.("condition"));
          } else if (c.type === "OrderByClause") {
            this.walk(c.childForFieldName?.("criteria"));
          } else if (c.type === "ReturnClause") {
            this.walk(c.childForFieldName?.("value"));
          }
        }

        this.exitScope();
        return;
      }

      case "PostfixExpression": {
        // Validate function call argument count against hoisted signature
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
              argsNode || calleeNode,
            );
          }
        }

        // Validate struct field existence when receiver resolves to a known struct
        const objNode = node.childForFieldName?.("object");
        const propNode = node.childForFieldName?.("property");
        if (objNode && propNode?.text) {
          const structName = this.resolveObjectStructName(objNode);
          if (structName) {
            const structSig = this.structs.get(structName);
            if (structSig && !structSig.fields.has(propNode.text)) {
              this.addDiagnostic(
                ModelScriptErrorCode.UNKNOWN_STRUCT_FIELD.code,
                ModelScriptErrorCode.UNKNOWN_STRUCT_FIELD.rule,
                "error",
                ModelScriptErrorCode.UNKNOWN_STRUCT_FIELD.message(structName, propNode.text),
                propNode,
              );
            }
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
        // Skip identifiers that sit in declaration-name, field-key, named-arg, or type-reference positions
        const isDeclarationName =
          ((parent?.type === "VariableDeclaration" ||
            parent?.type === "StructDeclaration" ||
            parent?.type === "StructField" ||
            parent?.type === "FunctionDeclaration" ||
            parent?.type === "Parameter") &&
            parent.childForFieldName?.("name") === node) ||
          ((parent?.type === "ForClause" || parent?.type === "LetClause") &&
            parent.childForFieldName?.("variable") === node) ||
          (parent?.type === "ObjectField" && parent.childForFieldName?.("key") === node) ||
          (parent?.type === "Argument" && parent.childForFieldName?.("name") === node) ||
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
