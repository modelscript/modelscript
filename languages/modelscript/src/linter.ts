// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelScriptErrorCode, type ModelScriptDiagnostic } from "./errors.js";
import {
  ModelScriptQueryEngine,
  parseTypeName,
  unwrapNode,
  type ModelScriptCstNode,
  type ModelScriptType,
} from "./queries.js";

/**
 * Lexical scope entry representing a declared variable, function, struct, parameter, or FLWOR variable.
 */
interface SymbolInfo {
  name: string;
  kind: "variable" | "function" | "struct" | "parameter" | "flwor-var";
  type?: string | undefined;
  semanticType?: ModelScriptType | undefined;
}

/**
 * Recorded signature metadata for a top-level function declaration.
 */
interface FunctionSig {
  paramCount: number;
  paramTypes: (string | undefined)[];
  returnType?: string | undefined;
}

/**
 * Recorded field set for a declared `struct` type.
 */
interface StructSig {
  fields: Set<string>;
  fieldTypes: Map<string, ModelScriptType>;
}

const PRIMITIVE_TYPES = new Set(["i32", "u32", "i64", "u64", "f32", "f64", "bool", "string", "usize", "void"]);

function formatModelScriptType(type: ModelScriptType): string {
  switch (type.kind) {
    case "struct":
      return type.name;
    case "array":
      return `Array<${formatModelScriptType(type.element)}>`;
    default:
      return type.kind;
  }
}

function isNumericType(type: ModelScriptType): boolean {
  return type.kind === "i32" || type.kind === "u32" || type.kind === "i64" || type.kind === "f64";
}

function isIntegerType(type: ModelScriptType): boolean {
  return type.kind === "i32" || type.kind === "u32" || type.kind === "i64";
}

function isTypeCompatible(target: ModelScriptType, source: ModelScriptType): boolean {
  if (target.kind === "unknown" || source.kind === "unknown") return true;
  if (target.kind === source.kind) {
    if (target.kind === "struct" && source.kind === "struct") {
      return target.name === source.name;
    }
    if (target.kind === "array" && source.kind === "array") {
      return isTypeCompatible(target.element, source.element);
    }
    return true;
  }
  if (isIntegerType(target) && isIntegerType(source)) return true;
  if (target.kind === "f64" && isNumericType(source)) return true;
  return false;
}

/**
 * Semantic CST linter for ModelScript that validates lexical scoping, duplicate
 * declarations, type annotations, type compatibility, binary operator operands,
 * FLWOR comprehension variable bindings, function call arity, and struct field access.
 */
export class ModelScriptLinter {
  private diagnostics: ModelScriptDiagnostic[] = [];
  private scopes: Map<string, SymbolInfo>[] = [];
  private functions = new Map<string, FunctionSig>();
  private structs = new Map<string, StructSig>();
  private queries = new ModelScriptQueryEngine();
  private currentFunctionReturnType: ModelScriptType | undefined = undefined;
  private inFlworClauseDepth = 0;

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
  private declareSymbol(
    name: string,
    kind: SymbolInfo["kind"],
    node: ModelScriptCstNode | null | undefined,
    type?: string,
    semanticType?: ModelScriptType,
  ): boolean {
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
    const resolvedSemantic = semanticType ?? (type && this.isKnownType(type) ? parseTypeName(type) : undefined);
    scope.set(name, { name, kind, type, semanticType: resolvedSemantic });
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
   * Checks whether a type string refers to a built-in primitive, generic container of known type,
   * declared struct, or imported type symbol.
   */
  private isKnownType(typeStr: string): boolean {
    const trimmed = typeStr.trim();
    if (!trimmed) return true;
    if (PRIMITIVE_TYPES.has(trimmed)) return true;
    if ((trimmed.startsWith("Array<") || trimmed.startsWith("Slice<")) && trimmed.endsWith(">")) {
      return this.isKnownType(trimmed.slice(6, -1));
    }
    if (trimmed.startsWith("ptr<") && trimmed.endsWith(">")) {
      return this.isKnownType(trimmed.slice(4, -1));
    }
    if (this.structs.has(trimmed)) return true;
    const sym = this.lookupSymbol(trimmed);
    return sym !== undefined;
  }

  /**
   * Extracts the leaf unrecognized type name from a potentially generic type annotation.
   */
  private extractUnknownTypeName(typeStr: string): string {
    const trimmed = typeStr.trim();
    if ((trimmed.startsWith("Array<") || trimmed.startsWith("Slice<")) && trimmed.endsWith(">")) {
      return this.extractUnknownTypeName(trimmed.slice(6, -1));
    }
    if (trimmed.startsWith("ptr<") && trimmed.endsWith(">")) {
      return this.extractUnknownTypeName(trimmed.slice(4, -1));
    }
    return trimmed;
  }

  /**
   * Validates a type annotation CST node, emitting `2003` (`UNKNOWN_TYPE`) if unrecognized.
   */
  private validateTypeAnnotation(typeNode: ModelScriptCstNode | null | undefined): boolean {
    if (!typeNode) return true;
    const typeText = typeNode.text?.trim();
    if (!typeText) return true;
    if (!this.isKnownType(typeText)) {
      const badName = this.extractUnknownTypeName(typeText);
      this.addDiagnostic(
        ModelScriptErrorCode.UNKNOWN_TYPE.code,
        ModelScriptErrorCode.UNKNOWN_TYPE.rule,
        "error",
        ModelScriptErrorCode.UNKNOWN_TYPE.message(badName),
        typeNode,
      );
      return false;
    }
    return true;
  }

  /**
   * Builds a flat `Map<string, ModelScriptType>` from all active lexical scopes for `ModelScriptQueryEngine`.
   */
  private buildSemanticScope(): Map<string, ModelScriptType> {
    const map = new Map<string, ModelScriptType>();
    for (const scope of this.scopes) {
      for (const [name, info] of scope.entries()) {
        if (info.semanticType) {
          map.set(name, info.semanticType);
        }
      }
    }
    return map;
  }

  /**
   * Infers the `ModelScriptType` of an expression CST node using `ModelScriptQueryEngine`
   * and hoisted function/struct signatures.
   */
  private inferExprType(rawNode: ModelScriptCstNode | null | undefined): ModelScriptType {
    const node = unwrapNode(rawNode);
    if (!node) return { kind: "unknown" };

    if (node.type === "PostfixExpression") {
      const calleeNode = node.childForFieldName?.("callee");
      if (calleeNode) {
        const fnSig = this.functions.get(calleeNode.text);
        if (fnSig?.returnType && this.isKnownType(fnSig.returnType)) {
          return parseTypeName(fnSig.returnType);
        }
        return { kind: "unknown" };
      }

      const objNode = node.childForFieldName?.("object");
      const propNode = node.childForFieldName?.("property");
      if (objNode && propNode) {
        const objType = this.inferExprType(objNode);
        const propName = propNode.text || "";
        if (objType.kind === "struct") {
          const structSig = this.structs.get(objType.name);
          return structSig?.fieldTypes.get(propName) ?? { kind: "unknown" };
        }
        if ((objType.kind === "array" || objType.kind === "string") && propName === "length") {
          return { kind: "i32" };
        }
        return { kind: "unknown" };
      }

      const arrNode = node.childForFieldName?.("array");
      const idxNode = node.childForFieldName?.("index");
      if (arrNode && idxNode) {
        const arrType = this.inferExprType(arrNode);
        return arrType.kind === "array" ? arrType.element : { kind: "unknown" };
      }
      return { kind: "unknown" };
    }

    if (node.type === "BinaryExpression") {
      const left = node.childForFieldName?.("left");
      const op = node.childForFieldName?.("operator")?.text || "";
      const right = node.childForFieldName?.("right");
      if (["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(op)) {
        return { kind: "bool" };
      }
      const lType = this.inferExprType(left);
      const rType = this.inferExprType(right);
      if (lType.kind === "unknown" || rType.kind === "unknown") {
        return { kind: "unknown" };
      }
      if (lType.kind === "f64" || rType.kind === "f64") {
        return { kind: "f64" };
      }
      return lType;
    }

    return this.queries.inferExpressionType(node, this.buildSemanticScope());
  }

  /**
   * Attempts to resolve the struct type name of an object receiver expression
   * (either via variable type annotation or `new StructName(...)` construction).
   */
  private resolveObjectStructName(node: ModelScriptCstNode | null | undefined): string | undefined {
    const cur = unwrapNode(node);
    if (!cur) return undefined;
    if (cur.type === "IDENTIFIER") {
      const sym = this.lookupSymbol(cur.text);
      if (sym?.type && this.structs.has(sym.type)) {
        return sym.type;
      }
      if (sym?.semanticType?.kind === "struct" && this.structs.has(sym.semanticType.name)) {
        return sym.semanticType.name;
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
    node: ModelScriptCstNode | null | undefined,
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
  lint(rootNode: ModelScriptCstNode | null | undefined): ModelScriptDiagnostic[] {
    this.diagnostics = [];
    this.scopes = [];
    this.functions.clear();
    this.structs.clear();
    this.queries.clear();
    this.currentFunctionReturnType = undefined;
    this.inFlworClauseDepth = 0;

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
  private collectDeclarations(node: ModelScriptCstNode | null | undefined): void {
    if (!node) return;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "TopLevelDeclaration" || child.type === "Statement") {
        this.collectDeclarations(child);
        continue;
      }

      if (child.type === "ImportDeclaration") {
        const specsList = child.childForFieldName?.("specifiers");
        if (specsList) {
          for (let j = 0; j < specsList.childCount; j++) {
            const spec = specsList.child(j);
            if (spec?.type === "ImportSpecifier") {
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
          this.declareSymbol(name, "struct", idNode, name, { kind: "struct", name });
          this.queries.structLayout(child);
          const fields = new Set<string>();
          const fieldTypes = new Map<string, ModelScriptType>();
          for (let j = 0; j < child.childCount; j++) {
            const f = child.child(j);
            if (f?.type === "StructField") {
              const fName = f.childForFieldName?.("name")?.text;
              const fTypeText = f.childForFieldName?.("type")?.text?.trim();
              if (fName) {
                fields.add(fName);
                if (fTypeText) {
                  fieldTypes.set(fName, parseTypeName(fTypeText));
                }
              }
            }
          }
          this.structs.set(name, { fields, fieldTypes });
        }
      } else if (child.type === "FunctionDeclaration") {
        const idNode = child.childForFieldName?.("name");
        const name = idNode?.text;
        if (name) {
          this.declareSymbol(name, "function", idNode);
          const paramsNode = child.childForFieldName?.("parameters");
          let paramCount = 0;
          const paramTypes: (string | undefined)[] = [];
          if (paramsNode) {
            for (let j = 0; j < paramsNode.childCount; j++) {
              const p = paramsNode.child(j);
              if (p?.type === "Parameter") {
                paramCount++;
                paramTypes.push(p.childForFieldName?.("type")?.text?.trim());
              }
            }
          }
          const retType = child.childForFieldName?.("returnType")?.text?.trim();
          this.functions.set(name, { paramCount, paramTypes, returnType: retType });
        }
      }
    }
  }

  /**
   * Second pass: recursively traverses statements and expressions, managing lexical scopes
   * and checking identifier resolution, types, operators, FLWOR clauses, call arities, and struct fields.
   */
  private walk(node: ModelScriptCstNode | null | undefined): void {
    if (!node) return;

    switch (node.type) {
      case "StructDeclaration": {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child?.type === "StructField") {
            this.validateTypeAnnotation(child.childForFieldName?.("type"));
          }
        }
        return;
      }

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

        const isTypeValid = this.validateTypeAnnotation(typeNode);

        // Lint initializer expression before binding the variable in scope
        if (valNode) {
          this.walk(valNode);
        }

        const declaredTypeStr = typeNode?.text?.trim();
        let semanticType: ModelScriptType | undefined;

        if (declaredTypeStr && isTypeValid) {
          semanticType = parseTypeName(declaredTypeStr);
          if (valNode) {
            const valType = this.inferExprType(valNode);
            if (!isTypeCompatible(semanticType, valType)) {
              this.addDiagnostic(
                ModelScriptErrorCode.TYPE_MISMATCH.code,
                ModelScriptErrorCode.TYPE_MISMATCH.rule,
                "error",
                ModelScriptErrorCode.TYPE_MISMATCH.message(
                  formatModelScriptType(semanticType),
                  formatModelScriptType(valType),
                ),
                valNode,
              );
            }
          }
        } else if (valNode) {
          semanticType = this.inferExprType(valNode);
        }

        let resolvedType = declaredTypeStr;
        if (!resolvedType && valNode) {
          resolvedType = this.resolveObjectStructName(valNode);
        }

        if (name) {
          this.declareSymbol(name, "variable", idNode, resolvedType, semanticType);
        }
        return;
      }

      case "AssignmentStatement": {
        const targetNode = node.childForFieldName?.("target");
        const valNode = node.childForFieldName?.("value");
        this.walk(targetNode);
        this.walk(valNode);

        if (targetNode && valNode) {
          const targetType = this.inferExprType(targetNode);
          const valType = this.inferExprType(valNode);
          if (!isTypeCompatible(targetType, valType)) {
            this.addDiagnostic(
              ModelScriptErrorCode.TYPE_MISMATCH.code,
              ModelScriptErrorCode.TYPE_MISMATCH.rule,
              "error",
              ModelScriptErrorCode.TYPE_MISMATCH.message(
                formatModelScriptType(targetType),
                formatModelScriptType(valType),
              ),
              valNode,
            );
          }
        }
        return;
      }

      case "ReturnStatement": {
        const valNode = node.childForFieldName?.("value");
        if (valNode) {
          this.walk(valNode);
          if (this.currentFunctionReturnType) {
            const valType = this.inferExprType(valNode);
            if (!isTypeCompatible(this.currentFunctionReturnType, valType)) {
              this.addDiagnostic(
                ModelScriptErrorCode.TYPE_MISMATCH.code,
                ModelScriptErrorCode.TYPE_MISMATCH.rule,
                "error",
                ModelScriptErrorCode.TYPE_MISMATCH.message(
                  formatModelScriptType(this.currentFunctionReturnType),
                  formatModelScriptType(valType),
                ),
                valNode,
              );
            }
          }
        }
        return;
      }

      case "FunctionDeclaration": {
        const idNode = node.childForFieldName?.("name");
        const fnName = idNode?.text;
        // Register nested functions if not at top level
        if (fnName && !this.functions.has(fnName)) {
          this.declareSymbol(fnName, "function", idNode);
          const paramsNode = node.childForFieldName?.("parameters");
          let paramCount = 0;
          const paramTypes: (string | undefined)[] = [];
          if (paramsNode) {
            for (let j = 0; j < paramsNode.childCount; j++) {
              const p = paramsNode.child(j);
              if (p?.type === "Parameter") {
                paramCount++;
                paramTypes.push(p.childForFieldName?.("type")?.text?.trim());
              }
            }
          }
          const retType = node.childForFieldName?.("returnType")?.text?.trim();
          this.functions.set(fnName, { paramCount, paramTypes, returnType: retType });
        }

        const returnTypeNode = node.childForFieldName?.("returnType");
        const isRetValid = this.validateTypeAnnotation(returnTypeNode);
        const prevReturnType = this.currentFunctionReturnType;
        if (returnTypeNode?.text && isRetValid) {
          const retStr = returnTypeNode.text.trim();
          this.currentFunctionReturnType = retStr === "void" ? undefined : parseTypeName(retStr);
        } else {
          this.currentFunctionReturnType = undefined;
        }

        const bodyNode = node.childForFieldName?.("body");
        const paramsNode = node.childForFieldName?.("parameters");

        this.enterScope();
        if (paramsNode) {
          for (let i = 0; i < paramsNode.childCount; i++) {
            const p = paramsNode.child(i);
            if (p?.type === "Parameter") {
              const pId = p.childForFieldName?.("name");
              const pTypeNode = p.childForFieldName?.("type");
              const isParamTypeValid = this.validateTypeAnnotation(pTypeNode);
              const pType = pTypeNode?.text?.trim();
              if (pId) {
                const semType = pType && isParamTypeValid ? parseTypeName(pType) : undefined;
                this.declareSymbol(pId.text, "parameter", pId, pType, semType);
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
        this.currentFunctionReturnType = prevReturnType;
        return;
      }

      case "NewExpression": {
        const ctorNode = node.childForFieldName?.("constructor");
        if (ctorNode?.text && !this.isKnownType(ctorNode.text)) {
          this.addDiagnostic(
            ModelScriptErrorCode.UNKNOWN_TYPE.code,
            ModelScriptErrorCode.UNKNOWN_TYPE.rule,
            "error",
            ModelScriptErrorCode.UNKNOWN_TYPE.message(ctorNode.text),
            ctorNode,
          );
        }
        const argsNode = node.childForFieldName?.("arguments");
        if (argsNode) {
          this.walk(argsNode);
        }
        return;
      }

      case "BinaryExpression": {
        const leftNode = node.childForFieldName?.("left");
        const opNode = node.childForFieldName?.("operator");
        const rightNode = node.childForFieldName?.("right");

        this.walk(leftNode);
        this.walk(rightNode);

        const op = opNode?.text || "";
        const lType = this.inferExprType(leftNode);
        const rType = this.inferExprType(rightNode);

        if (lType.kind !== "unknown" && rType.kind !== "unknown") {
          if (["-", "*", "/", "%"].includes(op)) {
            if (!isNumericType(lType)) {
              this.addDiagnostic(
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.code,
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.rule,
                "error",
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.message(op, formatModelScriptType(lType)),
                node,
              );
            } else if (!isNumericType(rType)) {
              this.addDiagnostic(
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.code,
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.rule,
                "error",
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.message(op, formatModelScriptType(rType)),
                node,
              );
            }
          } else if (op === "+") {
            const bothNum = isNumericType(lType) && isNumericType(rType);
            const bothStr = lType.kind === "string" && rType.kind === "string";
            if (!bothNum && !bothStr) {
              const badType =
                !isNumericType(lType) && lType.kind !== "string"
                  ? formatModelScriptType(lType)
                  : !isNumericType(rType) && rType.kind !== "string"
                    ? formatModelScriptType(rType)
                    : `${formatModelScriptType(lType)} and ${formatModelScriptType(rType)}`;
              this.addDiagnostic(
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.code,
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.rule,
                "error",
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.message(op, badType),
                node,
              );
            }
          } else if (["<", "<=", ">", ">="].includes(op)) {
            const bothNum = isNumericType(lType) && isNumericType(rType);
            const bothStr = lType.kind === "string" && rType.kind === "string";
            if (!bothNum && !bothStr) {
              const badType = !isNumericType(lType) ? formatModelScriptType(lType) : formatModelScriptType(rType);
              this.addDiagnostic(
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.code,
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.rule,
                "error",
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.message(op, badType),
                node,
              );
            }
          } else if (["&&", "||"].includes(op)) {
            if (lType.kind !== "bool" || rType.kind !== "bool") {
              const badType = lType.kind !== "bool" ? formatModelScriptType(lType) : formatModelScriptType(rType);
              this.addDiagnostic(
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.code,
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.rule,
                "error",
                ModelScriptErrorCode.INVALID_BINARY_OPERAND.message(op, badType),
                node,
              );
            }
          }
        }
        return;
      }

      case "FLWORExpression": {
        // Sequential clause scoping: variables bound in `for`/`let` are visible in subsequent clauses
        this.enterScope();
        for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i);
          if (!c) continue;
          if (c.type === "ForClause") {
            const coll = c.childForFieldName?.("collection");
            this.walk(coll);
            const collType = this.inferExprType(coll);
            if (collType.kind !== "unknown" && collType.kind !== "array") {
              this.addDiagnostic(
                ModelScriptErrorCode.NON_ITERABLE_COLLECTION.code,
                ModelScriptErrorCode.NON_ITERABLE_COLLECTION.rule,
                "error",
                ModelScriptErrorCode.NON_ITERABLE_COLLECTION.message(coll?.text || ""),
                coll || c,
              );
            }
            const varId = c.childForFieldName?.("variable");
            if (varId) {
              const elemType: ModelScriptType = collType.kind === "array" ? collType.element : { kind: "unknown" };
              this.declareSymbol(varId.text, "flwor-var", varId, undefined, elemType);
            }
          } else if (c.type === "LetClause") {
            const val = c.childForFieldName?.("value");
            this.inFlworClauseDepth++;
            this.walk(val);
            this.inFlworClauseDepth--;
            const valType = this.inferExprType(val);
            const varId = c.childForFieldName?.("variable");
            if (varId) {
              this.declareSymbol(varId.text, "flwor-var", varId, undefined, valType);
            }
          } else if (c.type === "WhereClause") {
            this.inFlworClauseDepth++;
            this.walk(c.childForFieldName?.("condition"));
            this.inFlworClauseDepth--;
          } else if (c.type === "OrderByClause") {
            this.inFlworClauseDepth++;
            this.walk(c.childForFieldName?.("criteria"));
            this.inFlworClauseDepth--;
          } else if (c.type === "ReturnClause") {
            this.inFlworClauseDepth++;
            this.walk(c.childForFieldName?.("value"));
            this.inFlworClauseDepth--;
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
              if (argsNode.child(i)?.type === "Argument") argCount++;
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
        // Skip identifiers that sit in declaration-name, field-key, named-arg, constructor, or type-reference positions
        const isDeclarationName =
          ((parent?.type === "VariableDeclaration" ||
            parent?.type === "StructDeclaration" ||
            parent?.type === "StructField" ||
            parent?.type === "FunctionDeclaration" ||
            parent?.type === "Parameter") &&
            parent.childForFieldName?.("name") === node) ||
          ((parent?.type === "ForClause" || parent?.type === "LetClause") &&
            parent.childForFieldName?.("variable") === node) ||
          (parent?.type === "NewExpression" && parent.childForFieldName?.("constructor") === node) ||
          (parent?.type === "ObjectField" && parent.childForFieldName?.("key") === node) ||
          (parent?.type === "Argument" && parent.childForFieldName?.("name") === node) ||
          parent?.type === "CustomType" ||
          parent?.type === "Type" ||
          parent?.type === "PrimitiveType" ||
          parent?.type === "ImportSpecifier";

        const isFieldAccess = parent?.type === "PostfixExpression" && parent.childForFieldName?.("property") === node;

        if (!isDeclarationName && !isFieldAccess) {
          if (!this.isDeclared(name)) {
            if (this.inFlworClauseDepth > 0) {
              this.addDiagnostic(
                ModelScriptErrorCode.FLWOR_UNBOUND_VARIABLE.code,
                ModelScriptErrorCode.FLWOR_UNBOUND_VARIABLE.rule,
                "error",
                ModelScriptErrorCode.FLWOR_UNBOUND_VARIABLE.message(name),
                node,
              );
            }
            if (!name.startsWith("$")) {
              this.addDiagnostic(
                ModelScriptErrorCode.UNDEFINED_VARIABLE.code,
                ModelScriptErrorCode.UNDEFINED_VARIABLE.rule,
                "error",
                ModelScriptErrorCode.UNDEFINED_VARIABLE.message(name),
                node,
              );
            }
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
