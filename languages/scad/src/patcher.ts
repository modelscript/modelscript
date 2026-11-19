// SPDX-License-Identifier: AGPL-3.0-or-later

import { invertAffineExpression } from "@modelscript/cad";

export interface ScadCstTree {
  sourceCode?: string | undefined;
  mem32?: Uint32Array | undefined;
  _encoding?: number | undefined;
  facade?:
    | {
        syntaxNames?: string[] | undefined;
        exports?:
          | {
              getFatPaddingPtr?: ((rPad: number) => number) | undefined;
            }
          | undefined;
        getInputEncoding?: (() => number) | undefined;
      }
    | undefined;
}

export interface ScadCstNode {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  child(index: number): ScadCstNode | null;
  namedChild?(index: number): ScadCstNode | null;
  readonly children?: readonly ScadCstNode[] | undefined;
  readonly startIndex?: number | undefined;
  readonly endIndex?: number | undefined;
  readonly startOffset?: number | undefined;
  readonly endOffset?: number | undefined;
  readonly ptr?: number | undefined;
  readonly _startOffset?: number | undefined;
  readonly _cachedPad?: number | undefined;
  readonly tree?: ScadCstTree | undefined;
}

export interface PatchResult {
  updatedSource: string;
  replacedRange: { startOffset: number; endOffset: number };
  oldValue: string;
  newValue: string;
  /** True when the target expression is compound multi-variable or non-affine and cannot be safely inverted. */
  locked?: boolean | undefined;
  /** Human-readable explanation when `locked` is true. */
  lockReason?: string | undefined;
  /** Variable identifier resolved via analytical single-variable affine inversion. */
  invertedVariable?: string | undefined;
  /** Variables involved in a locked compound expression. */
  lockedVariables?: string[] | undefined;
}

function isPlainNumericLiteral(text: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim());
}

function formatScalarNumber(val: number): string {
  return String(Number(val.toFixed(4)));
}

export class ScadPatcher {
  /**
   * Patches a specific CST node by replacing its exact byte slice in the source string.
   */
  public static patchNode(source: string, node: ScadCstNode, newValue: string | number): PatchResult {
    const startOffset = node.startIndex ?? node.startOffset ?? 0;
    const endOffset = node.endIndex ?? node.endOffset ?? 0;
    const oldValue = source.slice(startOffset, endOffset);
    const newStr = String(newValue);

    const updatedSource = source.slice(0, startOffset) + newStr + source.slice(endOffset);

    return {
      updatedSource,
      replacedRange: { startOffset, endOffset },
      oldValue,
      newValue: newStr,
    };
  }

  /**
   * Builds a non-mutating locked PatchResult when an expression cannot be analytically inverted.
   */
  public static createLockedResult(
    source: string,
    node: ScadCstNode,
    reason: string,
    variables?: string[],
  ): PatchResult {
    const startOffset = node.startIndex ?? node.startOffset ?? 0;
    const endOffset = node.endIndex ?? node.endOffset ?? 0;
    const exprText = source.slice(startOffset, endOffset);
    return {
      updatedSource: source,
      replacedRange: { startOffset, endOffset },
      oldValue: exprText,
      newValue: exprText,
      locked: true,
      lockReason: reason,
      lockedVariables: variables,
    };
  }

  /**
   * Finds a VariableDeclaration for `varName` in the CST and updates its RHS value.
   * If the RHS is itself a single-variable affine expression (`a*y + b`), analytically
   * inverts up to `maxDepth` hops; locks multi-variable or non-affine definitions.
   */
  public static patchVariable(
    source: string,
    rootNode: ScadCstNode,
    varName: string,
    newValue: number | string,
    depth = 0,
  ): PatchResult | null {
    const varDeclNode = this.findVariableDeclaration(rootNode, varName);
    if (!varDeclNode) return null;

    // Find the Expression node on the right hand side of '='
    let valueNode: ScadCstNode | null = null;
    let foundEquals = false;

    for (let i = 0; i < varDeclNode.childCount; i++) {
      const c = varDeclNode.child(i);
      if (!c) continue;
      if (c.text.trim() === "=") {
        foundEquals = true;
        continue;
      }
      if (foundEquals && (c.type === "Expression" || c.type.endsWith("Expression") || c.type === "NUMBER")) {
        valueNode = c;
        break;
      }
    }

    if (!valueNode) return null;

    const rhsText = valueNode.text.trim();
    if (typeof newValue === "number" && !isPlainNumericLiteral(rhsText)) {
      const inv = invertAffineExpression(rhsText, newValue);
      if (inv.locked) {
        return this.createLockedResult(
          source,
          valueNode,
          inv.reason ?? `Locked: variable '${varName}' has compound expression '${rhsText}'.`,
          inv.variables,
        );
      }
      if (inv.kind === "single_var_affine" && inv.variableName && inv.solvedValue !== undefined) {
        if (inv.variableName === varName || depth >= 4) {
          return this.createLockedResult(source, valueNode, `Locked: cyclical definition for variable '${varName}'.`, [
            varName,
          ]);
        }
        const upstream = this.patchVariable(source, rootNode, inv.variableName, inv.solvedValue, depth + 1);
        if (upstream) {
          return {
            ...upstream,
            invertedVariable: upstream.invertedVariable ?? inv.variableName,
          };
        }
      }
    }

    const res = this.patchNode(source, valueNode, newValue);
    return { ...res, invertedVariable: varName };
  }

  /**
   * Analytically inverts `exprNode` against `targetNumericValue` (`a * x + b = target`),
   * patching literal nodes directly, inverting single-variable affine expressions back to the
   * driving variable declaration, or returning `locked: true` for multi-variable / non-affine formulas.
   */
  public static patchExpressionTarget(
    source: string,
    rootNode: ScadCstNode,
    exprNode: ScadCstNode,
    targetNumericValue: number,
  ): PatchResult {
    const exprText = exprNode.text.trim();
    if (isPlainNumericLiteral(exprText)) {
      return this.patchNode(source, exprNode, formatScalarNumber(targetNumericValue));
    }

    const inv = invertAffineExpression(exprText, targetNumericValue);
    if (inv.locked) {
      return this.createLockedResult(
        source,
        exprNode,
        inv.reason ?? `Locked: expression '${exprText}' cannot be inverted.`,
        inv.variables,
      );
    }

    if (inv.kind === "single_var_affine" && inv.variableName && inv.solvedValue !== undefined) {
      const varPatch = this.patchVariable(source, rootNode, inv.variableName, Number(inv.solvedValue.toFixed(4)));
      if (varPatch) {
        return {
          ...varPatch,
          invertedVariable: varPatch.invertedVariable ?? inv.variableName,
        };
      }
      // Single free variable wasn't declared at top level (e.g. module arg / loop var) -> lock safely
      return this.createLockedResult(
        source,
        exprNode,
        `Locked: driving variable '${inv.variableName}' in '${exprText}' has no top-level declaration to patch.`,
        inv.variables,
      );
    }

    return this.patchNode(source, exprNode, formatScalarNumber(targetNumericValue));
  }

  /**
   * Finds a primary solid or transform method call (scoped to `targetRange` when provided)
   * and updates its numerical vector parameter.
   */
  public static patchTransformArgument(
    source: string,
    rootNode: ScadCstNode,
    targetMethod: string,
    argIndex: number,
    newVec: [number, number, number],
    targetRange?: { startOffset: number; endOffset: number },
  ): PatchResult | null {
    const callNode = this.findMethodOrOpCall(rootNode, targetMethod, targetRange);
    if (!callNode) return null;

    // Find ArgumentList
    const argListNode =
      this.findChildByType(callNode, "ArgumentList") ?? this.findDescendantByType(callNode, "ArgumentList");
    if (!argListNode) return null;

    let currentArgIdx = 0;
    const argNodes: ScadCstNode[] = [];
    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (arg && arg.type === "Argument") argNodes.push(arg);
    }

    if (targetMethod === "rotate" && argIndex === 0 && argNodes.length > 1) {
      const formattedVec = `[${Number(newVec[0].toFixed(4))}, ${Number(newVec[1].toFixed(4))}, ${Number(newVec[2].toFixed(4))}]`;
      return this.patchNode(source, argListNode, formattedVec);
    }

    for (const arg of argNodes) {
      if (currentArgIdx === argIndex) {
        const vecNode = this.findDescendantByType(arg, "VectorLiteral");
        if (vecNode) {
          const exprs = this.collectVectorElements(vecNode);
          const nonLiteralIndices = exprs
            .map((e, idx) => ({ e, idx }))
            .filter(({ e }) => !isPlainNumericLiteral(e.text.trim()));
          if (nonLiteralIndices.length > 0) {
            // Check if any non-literal element is locked or multi-variable; only invert if safe
            if (nonLiteralIndices.length === 1) {
              const only = nonLiteralIndices[0]!;
              const allOtherLiteralsUnchanged = exprs.every((e, idx) => {
                if (idx === only.idx) return true;
                const litVal = Number(e.text.trim());
                return Number.isFinite(litVal) && Math.abs(litVal - (newVec[idx] ?? litVal)) <= 1e-3;
              });
              if (allOtherLiteralsUnchanged) {
                return this.patchExpressionTarget(source, rootNode, only.e, newVec[only.idx] ?? 0);
              }
            }
            const firstNonLit = nonLiteralIndices[0]!;
            const inv = invertAffineExpression(firstNonLit.e.text.trim(), newVec[firstNonLit.idx] ?? 0);
            return this.createLockedResult(
              source,
              arg,
              inv.reason ??
                `Locked: transform vector '${arg.text.trim()}' contains compound parametric expressions. Edit in code.`,
              inv.variables,
            );
          }
        }
        const formattedVec = `[${Number(newVec[0].toFixed(4))}, ${Number(newVec[1].toFixed(4))}, ${Number(newVec[2].toFixed(4))}]`;
        return this.patchNode(source, arg, formattedVec);
      }
      currentArgIdx++;
    }

    return null;
  }

  /**
   * Patches a single component of a vector argument in a transform or method call
   * (scoped to `targetRange` when provided), analytically inverting single-variable affine expressions.
   */
  public static patchVectorComponent(
    source: string,
    rootNode: ScadCstNode,
    targetMethod: string,
    argIndex: number,
    compIndex: number,
    newValue: number,
    targetRange?: { startOffset: number; endOffset: number },
  ): PatchResult | null {
    const callNode = this.findMethodOrOpCall(rootNode, targetMethod, targetRange);
    if (!callNode) return null;

    const argListNode = this.findDescendantByType(callNode, "ArgumentList");
    if (!argListNode) return null;

    let currentArgIdx = 0;
    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (!arg || arg.type !== "Argument") continue;

      if (currentArgIdx === argIndex) {
        const vecNode = this.findDescendantByType(arg, "VectorLiteral");
        if (!vecNode) return null;

        const exprs = this.collectVectorElements(vecNode);
        if (compIndex >= 0 && compIndex < exprs.length) {
          return this.patchExpressionTarget(source, rootNode, exprs[compIndex]!, newValue);
        }
      }
      currentArgIdx++;
    }

    return null;
  }

  /**
   * Wraps an untransformed primitive at `primitiveRange` with a new prefix or fluent transform.
   */
  public static wrapPrimitiveWithTransform(
    source: string,
    primitiveRange: { startOffset: number; endOffset: number },
    transformMethod: "translate" | "rotate" | "scale",
    vec: [number, number, number],
    preferFluent = false,
  ): PatchResult {
    const { startOffset, endOffset } = primitiveRange;
    const oldValue = source.slice(startOffset, endOffset);
    const formattedVec = `[${Number(vec[0].toFixed(4))}, ${Number(vec[1].toFixed(4))}, ${Number(vec[2].toFixed(4))}]`;
    const existingPrefixRegex = new RegExp(`^(\\s*${transformMethod}\\s*\\()([^)]*)(\\))`);
    const existingMatch = oldValue.match(existingPrefixRegex);
    if (existingMatch) {
      const newStr = oldValue.replace(existingPrefixRegex, `$1${formattedVec}$3`);
      const updatedSource = source.slice(0, startOffset) + newStr + source.slice(endOffset);
      return {
        updatedSource,
        replacedRange: { startOffset, endOffset },
        oldValue,
        newValue: newStr,
      };
    }

    const trailingSlice = source.slice(endOffset, endOffset + 16).trimStart();
    const isFluentContext = preferFluent || trailingSlice.startsWith(".");

    const newStr = isFluentContext
      ? `${oldValue}.${transformMethod}(${formattedVec})`
      : `${transformMethod}(${formattedVec}) ${oldValue}`;

    const updatedSource = source.slice(0, startOffset) + newStr + source.slice(endOffset);
    return {
      updatedSource,
      replacedRange: { startOffset, endOffset },
      oldValue,
      newValue: newStr,
    };
  }

  /**
   * Wraps a solid statement at `targetRange` with a `tag_port("portName", "portType", [nx, ny, nz]) { ... }` block.
   */
  public static wrapSolidWithTagPort(
    source: string,
    targetRange: { startOffset: number; endOffset: number },
    portName: string,
    portType = "fixed_support",
    normal?: [number, number, number],
  ): PatchResult {
    const { startOffset, endOffset } = targetRange;
    const oldValue = source.slice(startOffset, endOffset).trim();
    const normalArg = normal
      ? `, [${Number(normal[0].toFixed(3))}, ${Number(normal[1].toFixed(3))}, ${Number(normal[2].toFixed(3))}]`
      : "";
    const newStr = `tag_port("${portName}", "${portType}"${normalArg}) {\n  ${oldValue}\n}`;

    const updatedSource = source.slice(0, startOffset) + newStr + source.slice(endOffset);
    return {
      updatedSource,
      replacedRange: { startOffset, endOffset },
      oldValue,
      newValue: newStr,
    };
  }

  /**
   * High-level helper for 3D viewport gizmo writeback: patches the exact transform call
   * matching `sourceMetadata`, or wraps the underlying primitive if not yet transformed.
   */
  public static patchOrInsertTransform(
    source: string,
    rootNode: ScadCstNode,
    targetMethod: "translate" | "rotate" | "scale",
    newVec: [number, number, number],
    sourceMetadata?: {
      transformMethod?: string | undefined;
      argIndex?: number | undefined;
      startOffset?: number | undefined;
      endOffset?: number | undefined;
      primitiveStartOffset?: number | undefined;
      primitiveEndOffset?: number | undefined;
      translateRange?: { startOffset: number; endOffset: number; isFluent?: boolean | undefined } | undefined;
      rotateRange?: { startOffset: number; endOffset: number; isFluent?: boolean | undefined } | undefined;
      scaleRange?: { startOffset: number; endOffset: number; isFluent?: boolean | undefined } | undefined;
    },
  ): PatchResult | null {
    const specificRange =
      targetMethod === "translate"
        ? sourceMetadata?.translateRange
        : targetMethod === "rotate"
          ? sourceMetadata?.rotateRange
          : sourceMetadata?.scaleRange;

    const fallbackRange =
      sourceMetadata?.transformMethod === targetMethod &&
      sourceMetadata.startOffset !== undefined &&
      sourceMetadata.endOffset !== undefined
        ? { startOffset: sourceMetadata.startOffset, endOffset: sourceMetadata.endOffset }
        : undefined;

    const range = specificRange ?? fallbackRange;
    if (range) {
      const patched = this.patchTransformArgument(
        source,
        rootNode,
        targetMethod,
        sourceMetadata?.argIndex ?? 0,
        newVec,
        range,
      );
      if (patched) return patched;
    }

    if (sourceMetadata?.primitiveStartOffset !== undefined && sourceMetadata?.primitiveEndOffset !== undefined) {
      const preferFluent =
        Boolean(sourceMetadata.translateRange?.isFluent) ||
        Boolean(sourceMetadata.rotateRange?.isFluent) ||
        Boolean(sourceMetadata.scaleRange?.isFluent);
      return this.wrapPrimitiveWithTransform(
        source,
        {
          startOffset: sourceMetadata.primitiveStartOffset,
          endOffset: sourceMetadata.primitiveEndOffset,
        },
        targetMethod,
        newVec,
        preferFluent,
      );
    }

    return this.patchTransformArgument(source, rootNode, targetMethod, sourceMetadata?.argIndex ?? 0, newVec);
  }

  private static findVariableDeclaration(containerNode: ScadCstNode, varName: string): ScadCstNode | null {
    for (let i = 0; i < containerNode.childCount; i++) {
      const c = containerNode.child(i);
      if (!c) continue;

      if (c.type === "Statement") {
        const res = this.findVariableDeclaration(c, varName);
        if (res) return res;
      }

      if (c.type === "VariableDeclaration") {
        const nameNode = this.findChildByType(c, "IDENTIFIER");
        if (nameNode && nameNode.text.trim() === varName) {
          return c;
        }
      }
    }
    return null;
  }

  private static findMethodOrOpCall(
    node: ScadCstNode | null | undefined,
    name: string,
    targetRange?: { startOffset: number; endOffset: number },
  ): ScadCstNode | null {
    if (!node) return null;

    if (targetRange) {
      const rangedMatch = this.findMethodOrOpCallInRange(node, name, targetRange);
      if (rangedMatch) return rangedMatch;
    }

    if (node.type === "MethodCall" || node.type === "TransformOp") {
      if (node.text.includes(name)) return node;
    }

    for (let i = 0; i < node.childCount; i++) {
      const res = this.findMethodOrOpCall(node.child(i), name);
      if (res) return res;
    }
    return null;
  }

  private static findMethodOrOpCallInRange(
    node: ScadCstNode | null | undefined,
    name: string,
    targetRange: { startOffset: number; endOffset: number },
  ): ScadCstNode | null {
    if (!node) return null;

    const startOffset = node.startIndex ?? node.startOffset ?? 0;
    const endOffset = node.endIndex ?? node.endOffset ?? 0;

    // Skip subtrees completely outside targetRange
    if (endOffset < targetRange.startOffset || startOffset > targetRange.endOffset) {
      return null;
    }

    if (node.type === "MethodCall" || node.type === "TransformOp") {
      if (
        node.text.includes(name) &&
        startOffset >= targetRange.startOffset - 2 &&
        endOffset <= targetRange.endOffset + 2
      ) {
        return node;
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const res = this.findMethodOrOpCallInRange(node.child(i), name, targetRange);
      if (res) return res;
    }
    return null;
  }

  private static findChildByType(node: ScadCstNode | null | undefined, type: string): ScadCstNode | null {
    if (!node) return null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === type) return c;
    }
    return null;
  }

  private static findDescendantByType(node: ScadCstNode | null | undefined, type: string): ScadCstNode | null {
    if (!node) return null;
    if (node.type === type) return node;
    for (let i = 0; i < node.childCount; i++) {
      const res = this.findDescendantByType(node.child(i), type);
      if (res) return res;
    }
    return null;
  }

  /**
   * Patches a dimension of a primitive solid (cube, cylinder, sphere, extrusion),
   * updating either a named variable (if bound) or the literal AST argument token.
   *
   * @param source - Original SCAD source code
   * @param rootNode - CST root node
   * @param dimensionIndex - 0: X/Width/Radius, 1: Y/Height, 2: Z/Depth
   * @param newValue - New dimension value to apply
   * @param targetRange - Optional byte offset range of the primitive call or solid
   * @param paramName - Optional bound variable name
   * @param primitiveType - Optional primitive kind ('cube', 'cylinder', 'sphere', 'linear_extrude')
   */
  public static patchPrimitiveDimension(
    source: string,
    rootNode: ScadCstNode,
    dimensionIndex: number,
    newValue: number,
    targetRange?: { startOffset: number; endOffset: number },
    paramName?: string,
    primitiveType?: string,
  ): PatchResult | null {
    const primNode = this.findPrimitiveInRange(rootNode, targetRange, primitiveType);
    const argListNode = primNode
      ? (this.findChildByType(primNode, "ArgumentList") ?? this.findDescendantByType(primNode, "ArgumentList"))
      : null;

    if (primNode && argListNode) {
      if (primNode.type === "CubePrimitive" || primNode.text.startsWith("cube")) {
        const sizeArg = this.findArgumentByNameOrPos(argListNode, "size", 0);
        if (sizeArg) {
          const vecNode = this.findDescendantByType(sizeArg, "VectorLiteral");
          if (vecNode) {
            const exprs = this.collectVectorElements(vecNode);
            if (dimensionIndex >= 0 && dimensionIndex < exprs.length) {
              return this.patchExpressionTarget(source, rootNode, exprs[dimensionIndex]!, newValue);
            }
          } else {
            const expr = this.findArgumentExpression(sizeArg);
            if (expr) {
              return this.patchExpressionTarget(source, rootNode, expr, newValue);
            }
          }
        }
      } else if (primNode.type === "CylinderPrimitive" || primNode.text.startsWith("cylinder")) {
        if (dimensionIndex === 1) {
          const hArg = this.findArgumentByNameOrPos(argListNode, "h", 0);
          const expr = hArg ? this.findArgumentExpression(hArg) : null;
          if (expr) {
            return this.patchExpressionTarget(source, rootNode, expr, newValue);
          }
        } else {
          const rArg =
            this.findArgumentByName(argListNode, "r") ??
            this.findArgumentByName(argListNode, "d") ??
            this.findArgumentByName(argListNode, "r1") ??
            this.findArgumentByName(argListNode, "d1") ??
            this.findArgumentByNameOrPos(argListNode, "r", 1);
          const expr = rArg ? this.findArgumentExpression(rArg) : null;
          if (rArg && expr) {
            const argIdent = this.findChildByType(rArg, "IDENTIFIER")?.text.trim();
            const isDiameter = argIdent === "d" || argIdent === "d1";
            return this.patchExpressionTarget(source, rootNode, expr, isDiameter ? newValue * 2 : newValue);
          }
        }
      } else if (primNode.type === "SpherePrimitive" || primNode.text.startsWith("sphere")) {
        const rArg =
          this.findArgumentByName(argListNode, "r") ??
          this.findArgumentByName(argListNode, "d") ??
          this.findArgumentByNameOrPos(argListNode, "r", 0);
        const expr = rArg ? this.findArgumentExpression(rArg) : null;
        if (rArg && expr) {
          const isDiameter = this.findChildByType(rArg, "IDENTIFIER")?.text.trim() === "d";
          return this.patchExpressionTarget(source, rootNode, expr, isDiameter ? newValue * 2 : newValue);
        }
      } else if (
        primNode.type === "LinearExtrudeOp" ||
        primNode.type === "ExtrusionOp" ||
        primNode.text.startsWith("linear_extrude")
      ) {
        if (dimensionIndex === 1) {
          const hArg = this.findArgumentByNameOrPos(argListNode, "height", 0);
          const expr = hArg ? this.findArgumentExpression(hArg) : null;
          if (expr) {
            return this.patchExpressionTarget(source, rootNode, expr, newValue);
          }
        }
      }
    }

    if (paramName) {
      const varRes = this.patchVariable(source, rootNode, paramName, newValue);
      if (varRes) return varRes;
    }

    return null;
  }

  private static findPrimitiveInRange(
    node: ScadCstNode | null | undefined,
    targetRange?: { startOffset: number; endOffset: number },
    primitiveType?: string,
  ): ScadCstNode | null {
    if (!node) return null;
    const startOffset = node.startIndex ?? node.startOffset ?? 0;
    const endOffset = node.endIndex ?? node.endOffset ?? 0;

    if (targetRange && (endOffset < targetRange.startOffset || startOffset > targetRange.endOffset)) {
      return null;
    }

    const primTypes = ["CubePrimitive", "CylinderPrimitive", "SpherePrimitive", "ExtrusionOp", "LinearExtrudeOp"];
    if (primTypes.includes(node.type)) {
      const typeMatches =
        !primitiveType ||
        node.type.toLowerCase().startsWith(primitiveType.toLowerCase()) ||
        node.text.toLowerCase().startsWith(primitiveType.toLowerCase());

      if (typeMatches) {
        if (!targetRange) return node;
        if (startOffset >= targetRange.startOffset - 2 && endOffset <= targetRange.endOffset + 2) {
          return node;
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const res = this.findPrimitiveInRange(node.child(i), targetRange, primitiveType);
      if (res) return res;
    }
    return null;
  }

  public static findArgumentByName(argListNode: ScadCstNode, name: string): ScadCstNode | null {
    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (!arg || arg.type !== "Argument") continue;
      const nameNode = this.findChildByType(arg, "IDENTIFIER");
      if (nameNode && nameNode.text.trim() === name) {
        return arg;
      }
    }
    return null;
  }

  public static findArgumentByNameOrPos(argListNode: ScadCstNode, name: string, pos: number): ScadCstNode | null {
    const named = this.findArgumentByName(argListNode, name);
    if (named) return named;

    let currentPos = 0;
    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (!arg || arg.type !== "Argument") continue;

      const hasEquals = this.findChildByText(arg, "=");
      if (!hasEquals) {
        if (currentPos === pos) return arg;
        currentPos++;
      }
    }
    return null;
  }

  public static findArgumentExpression(argNode: ScadCstNode): ScadCstNode | null {
    const hasEquals = this.findChildByText(argNode, "=");
    if (hasEquals) {
      let foundEq = false;
      for (let i = 0; i < argNode.childCount; i++) {
        const c = argNode.child(i);
        if (!c) continue;
        if (c.text.trim() === "=") {
          foundEq = true;
          continue;
        }
        if (foundEq && c.text.trim().length > 0) {
          return c;
        }
      }
    }
    for (let i = 0; i < argNode.childCount; i++) {
      const c = argNode.child(i);
      if (c && c.text.trim().length > 0 && c.text.trim() !== ",") {
        return c;
      }
    }
    return null;
  }

  public static collectVectorElements(vecNode: ScadCstNode): ScadCstNode[] {
    const exprs: ScadCstNode[] = [];
    for (let j = 0; j < vecNode.childCount; j++) {
      const c = vecNode.child(j);
      if (!c) continue;
      const t = c.text.trim();
      if (t === "[" || t === "]" || t === ",") continue;
      exprs.push(c);
    }
    return exprs;
  }

  public static findDescendantByTypeStatic(node: ScadCstNode | null | undefined, type: string): ScadCstNode | null {
    return this.findDescendantByType(node, type);
  }

  private static findChildByText(node: ScadCstNode | null | undefined, text: string): ScadCstNode | null {
    if (!node) return null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.text.trim() === text) return c;
    }
    return null;
  }
}
