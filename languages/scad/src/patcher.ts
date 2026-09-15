// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PatchResult {
  updatedSource: string;
  replacedRange: { startByte: number; endByte: number };
  oldValue: string;
  newValue: string;
}

export class ScadPatcher {
  /**
   * Patches a specific CST node by replacing its exact byte slice in the source string.
   */
  public static patchNode(source: string, node: any, newValue: string | number): PatchResult {
    const startByte = node.startIndex ?? node.startByte ?? 0;
    const endByte = node.endIndex ?? node.endByte ?? 0;
    const oldValue = source.slice(startByte, endByte);
    const newStr = String(newValue);

    const updatedSource = source.slice(0, startByte) + newStr + source.slice(endByte);

    return {
      updatedSource,
      replacedRange: { startByte, endByte },
      oldValue,
      newValue: newStr,
    };
  }

  /**
   * Finds a VariableDeclaration for `varName` in the CST and patches its value expression.
   * If not found, returns null.
   */
  public static patchVariable(
    source: string,
    rootNode: any,
    varName: string,
    newValue: number | string,
  ): PatchResult | null {
    const varDeclNode = this.findVariableDeclaration(rootNode, varName);
    if (!varDeclNode) return null;

    // Find the Expression node on the right hand side of '='
    let valueNode: any = null;
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
    return this.patchNode(source, valueNode, newValue);
  }

  /**
   * Finds a primary solid or transform method call and updates its numerical parameter.
   */
  public static patchTransformArgument(
    source: string,
    rootNode: any,
    targetMethod: string,
    argIndex: number,
    newVec: [number, number, number],
  ): PatchResult | null {
    const callNode = this.findMethodOrOpCall(rootNode, targetMethod);
    if (!callNode) return null;

    // Find ArgumentList
    const argListNode = this.findChildByType(callNode, "ArgumentList");
    if (!argListNode) return null;

    let currentArgIdx = 0;
    for (let i = 0; i < argListNode.childCount; i++) {
      const arg = argListNode.child(i);
      if (!arg || arg.type !== "Argument") continue;

      if (currentArgIdx === argIndex) {
        const formattedVec = `[${newVec[0]}, ${newVec[1]}, ${newVec[2]}]`;
        return this.patchNode(source, arg, formattedVec);
      }
      currentArgIdx++;
    }

    return null;
  }

  private static findVariableDeclaration(containerNode: any, varName: string): any {
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

  private static findMethodOrOpCall(node: any, name: string): any {
    if (!node) return null;

    if (node.type === "MethodCall" || node.type === "TransformOp") {
      if (node.text.includes(name)) return node;
    }

    for (let i = 0; i < node.childCount; i++) {
      const res = this.findMethodOrOpCall(node.child(i), name);
      if (res) return res;
    }
    return null;
  }

  private static findChildByType(node: any, type: string): any {
    if (!node) return null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === type) return c;
    }
    return null;
  }
}
