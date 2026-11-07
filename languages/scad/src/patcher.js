// SPDX-License-Identifier: AGPL-3.0-or-later
export class ScadPatcher {
    /**
     * Patches a specific CST node by replacing its exact byte slice in the source string.
     */
    static patchNode(source, node, newValue) {
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
     * Finds a VariableDeclaration for `varName` in the CST and patches its value expression.
     * If not found, returns null.
     */
    static patchVariable(source, rootNode, varName, newValue) {
        const varDeclNode = this.findVariableDeclaration(rootNode, varName);
        if (!varDeclNode)
            return null;
        // Find the Expression node on the right hand side of '='
        let valueNode = null;
        let foundEquals = false;
        for (let i = 0; i < varDeclNode.childCount; i++) {
            const c = varDeclNode.child(i);
            if (!c)
                continue;
            if (c.text.trim() === "=") {
                foundEquals = true;
                continue;
            }
            if (foundEquals && (c.type === "Expression" || c.type.endsWith("Expression") || c.type === "NUMBER")) {
                valueNode = c;
                break;
            }
        }
        if (!valueNode)
            return null;
        return this.patchNode(source, valueNode, newValue);
    }
    /**
     * Finds a primary solid or transform method call (scoped to `targetRange` when provided)
     * and updates its numerical vector parameter.
     */
    static patchTransformArgument(source, rootNode, targetMethod, argIndex, newVec, targetRange) {
        const callNode = this.findMethodOrOpCall(rootNode, targetMethod, targetRange);
        if (!callNode)
            return null;
        // Find ArgumentList
        const argListNode = this.findChildByType(callNode, "ArgumentList") ?? this.findDescendantByType(callNode, "ArgumentList");
        if (!argListNode)
            return null;
        let currentArgIdx = 0;
        const argNodes = [];
        for (let i = 0; i < argListNode.childCount; i++) {
            const arg = argListNode.child(i);
            if (arg && arg.type === "Argument")
                argNodes.push(arg);
        }
        if (targetMethod === "rotate" && argIndex === 0 && argNodes.length > 1) {
            const formattedVec = `[${Number(newVec[0].toFixed(4))}, ${Number(newVec[1].toFixed(4))}, ${Number(newVec[2].toFixed(4))}]`;
            return this.patchNode(source, argListNode, formattedVec);
        }
        for (const arg of argNodes) {
            if (currentArgIdx === argIndex) {
                const formattedVec = `[${Number(newVec[0].toFixed(4))}, ${Number(newVec[1].toFixed(4))}, ${Number(newVec[2].toFixed(4))}]`;
                return this.patchNode(source, arg, formattedVec);
            }
            currentArgIdx++;
        }
        return null;
    }
    /**
     * Patches a single component of a vector argument in a transform or method call
     * (scoped to `targetRange` when provided).
     */
    static patchVectorComponent(source, rootNode, targetMethod, argIndex, compIndex, newValue, targetRange) {
        const callNode = this.findMethodOrOpCall(rootNode, targetMethod, targetRange);
        if (!callNode)
            return null;
        const argListNode = this.findDescendantByType(callNode, "ArgumentList");
        if (!argListNode)
            return null;
        let currentArgIdx = 0;
        for (let i = 0; i < argListNode.childCount; i++) {
            const arg = argListNode.child(i);
            if (!arg || arg.type !== "Argument")
                continue;
            if (currentArgIdx === argIndex) {
                const vecNode = this.findDescendantByType(arg, "VectorLiteral");
                if (!vecNode)
                    return null;
                const exprs = [];
                for (let j = 0; j < vecNode.childCount; j++) {
                    const c = vecNode.child(j);
                    if (c && (c.type === "Expression" || c.type.endsWith("Expression") || c.type === "NUMBER")) {
                        exprs.push(c);
                    }
                }
                if (compIndex >= 0 && compIndex < exprs.length) {
                    return this.patchNode(source, exprs[compIndex], String(newValue));
                }
            }
            currentArgIdx++;
        }
        return null;
    }
    /**
     * Wraps an untransformed primitive at `primitiveRange` with a new prefix or fluent transform.
     */
    static wrapPrimitiveWithTransform(source, primitiveRange, transformMethod, vec, preferFluent = false) {
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
     * High-level helper for 3D viewport gizmo writeback: patches the exact transform call
     * matching `sourceMetadata`, or wraps the underlying primitive if not yet transformed.
     */
    static patchOrInsertTransform(source, rootNode, targetMethod, newVec, sourceMetadata) {
        const specificRange = targetMethod === "translate"
            ? sourceMetadata?.translateRange
            : targetMethod === "rotate"
                ? sourceMetadata?.rotateRange
                : sourceMetadata?.scaleRange;
        const fallbackRange = sourceMetadata?.transformMethod === targetMethod &&
            sourceMetadata.startOffset !== undefined &&
            sourceMetadata.endOffset !== undefined
            ? { startOffset: sourceMetadata.startOffset, endOffset: sourceMetadata.endOffset }
            : undefined;
        const range = specificRange ?? fallbackRange;
        if (range) {
            const patched = this.patchTransformArgument(source, rootNode, targetMethod, sourceMetadata?.argIndex ?? 0, newVec, range);
            if (patched)
                return patched;
        }
        if (sourceMetadata?.primitiveStartOffset !== undefined && sourceMetadata?.primitiveEndOffset !== undefined) {
            const preferFluent = Boolean(sourceMetadata.translateRange?.isFluent) ||
                Boolean(sourceMetadata.rotateRange?.isFluent) ||
                Boolean(sourceMetadata.scaleRange?.isFluent);
            return this.wrapPrimitiveWithTransform(source, {
                startOffset: sourceMetadata.primitiveStartOffset,
                endOffset: sourceMetadata.primitiveEndOffset,
            }, targetMethod, newVec, preferFluent);
        }
        return this.patchTransformArgument(source, rootNode, targetMethod, sourceMetadata?.argIndex ?? 0, newVec);
    }
    static findVariableDeclaration(containerNode, varName) {
        for (let i = 0; i < containerNode.childCount; i++) {
            const c = containerNode.child(i);
            if (!c)
                continue;
            if (c.type === "Statement") {
                const res = this.findVariableDeclaration(c, varName);
                if (res)
                    return res;
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
    static findMethodOrOpCall(node, name, targetRange) {
        if (!node)
            return null;
        if (targetRange) {
            const rangedMatch = this.findMethodOrOpCallInRange(node, name, targetRange);
            if (rangedMatch)
                return rangedMatch;
        }
        if (node.type === "MethodCall" || node.type === "TransformOp") {
            if (node.text.includes(name))
                return node;
        }
        for (let i = 0; i < node.childCount; i++) {
            const res = this.findMethodOrOpCall(node.child(i), name);
            if (res)
                return res;
        }
        return null;
    }
    static findMethodOrOpCallInRange(node, name, targetRange) {
        if (!node)
            return null;
        const startOffset = node.startIndex ?? node.startOffset ?? 0;
        const endOffset = node.endIndex ?? node.endOffset ?? 0;
        // Skip subtrees completely outside targetRange
        if (endOffset < targetRange.startOffset || startOffset > targetRange.endOffset) {
            return null;
        }
        if (node.type === "MethodCall" || node.type === "TransformOp") {
            if (node.text.includes(name) &&
                startOffset >= targetRange.startOffset - 2 &&
                endOffset <= targetRange.endOffset + 2) {
                return node;
            }
        }
        for (let i = 0; i < node.childCount; i++) {
            const res = this.findMethodOrOpCallInRange(node.child(i), name, targetRange);
            if (res)
                return res;
        }
        return null;
    }
    static findChildByType(node, type) {
        if (!node)
            return null;
        for (let i = 0; i < node.childCount; i++) {
            const c = node.child(i);
            if (c && c.type === type)
                return c;
        }
        return null;
    }
    static findDescendantByType(node, type) {
        if (!node)
            return null;
        if (node.type === type)
            return node;
        for (let i = 0; i < node.childCount; i++) {
            const res = this.findDescendantByType(node.child(i), type);
            if (res)
                return res;
        }
        return null;
    }
}
//# sourceMappingURL=patcher.js.map