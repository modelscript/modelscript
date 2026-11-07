export interface ScadCstTree {
    sourceCode?: string | undefined;
    mem32?: Uint32Array | undefined;
    _encoding?: number | undefined;
    facade?: {
        syntaxNames?: string[] | undefined;
        exports?: {
            getFatPaddingPtr?: ((rPad: number) => number) | undefined;
        } | undefined;
        getInputEncoding?: (() => number) | undefined;
    } | undefined;
}
export interface ScadCstNode {
    readonly type: string;
    readonly text: string;
    readonly childCount: number;
    child(index: number): ScadCstNode | null;
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
    replacedRange: {
        startOffset: number;
        endOffset: number;
    };
    oldValue: string;
    newValue: string;
}
export declare class ScadPatcher {
    /**
     * Patches a specific CST node by replacing its exact byte slice in the source string.
     */
    static patchNode(source: string, node: ScadCstNode, newValue: string | number): PatchResult;
    /**
     * Finds a VariableDeclaration for `varName` in the CST and patches its value expression.
     * If not found, returns null.
     */
    static patchVariable(source: string, rootNode: ScadCstNode, varName: string, newValue: number | string): PatchResult | null;
    /**
     * Finds a primary solid or transform method call (scoped to `targetRange` when provided)
     * and updates its numerical vector parameter.
     */
    static patchTransformArgument(source: string, rootNode: ScadCstNode, targetMethod: string, argIndex: number, newVec: [number, number, number], targetRange?: {
        startOffset: number;
        endOffset: number;
    }): PatchResult | null;
    /**
     * Patches a single component of a vector argument in a transform or method call
     * (scoped to `targetRange` when provided).
     */
    static patchVectorComponent(source: string, rootNode: ScadCstNode, targetMethod: string, argIndex: number, compIndex: number, newValue: number, targetRange?: {
        startOffset: number;
        endOffset: number;
    }): PatchResult | null;
    /**
     * Wraps an untransformed primitive at `primitiveRange` with a new prefix or fluent transform.
     */
    static wrapPrimitiveWithTransform(source: string, primitiveRange: {
        startOffset: number;
        endOffset: number;
    }, transformMethod: "translate" | "rotate" | "scale", vec: [number, number, number], preferFluent?: boolean): PatchResult;
    /**
     * High-level helper for 3D viewport gizmo writeback: patches the exact transform call
     * matching `sourceMetadata`, or wraps the underlying primitive if not yet transformed.
     */
    static patchOrInsertTransform(source: string, rootNode: ScadCstNode, targetMethod: "translate" | "rotate" | "scale", newVec: [number, number, number], sourceMetadata?: {
        transformMethod?: string | undefined;
        argIndex?: number | undefined;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        primitiveStartOffset?: number | undefined;
        primitiveEndOffset?: number | undefined;
        translateRange?: {
            startOffset: number;
            endOffset: number;
            isFluent?: boolean | undefined;
        } | undefined;
        rotateRange?: {
            startOffset: number;
            endOffset: number;
            isFluent?: boolean | undefined;
        } | undefined;
        scaleRange?: {
            startOffset: number;
            endOffset: number;
            isFluent?: boolean | undefined;
        } | undefined;
    }): PatchResult | null;
    private static findVariableDeclaration;
    private static findMethodOrOpCall;
    private static findMethodOrOpCallInRange;
    private static findChildByType;
    private static findDescendantByType;
}
//# sourceMappingURL=patcher.d.ts.map