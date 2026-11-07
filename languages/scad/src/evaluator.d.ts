/**
 * @fileoverview OpenSCAD Language Evaluator & Constructive Solid Geometry (CSG) Engine.
 *
 * Academic Citations:
 * - Requicha, A. A. (1980). Representations for rigid solids: Theory, methods, and systems.
 *   ACM Computing Surveys, 12(4), 437-464. https://doi.org/10.1145/356827.356833
 * - Foley, J. D., Van Dam, A., Feiner, S. K., & Hughes, J. F. (1996). Computer Graphics:
 *   Principles and Practice (2nd ed.). Addison-Wesley. Chapter 12: Constructive Solid Geometry.
 * - Kienzle, M. (2009). OpenSCAD: The Programmers Solid 3D CAD Modeller. https://openscad.org
 *
 * ModelScript Architectural Rationale:
 * Cyber-physical systems (CPS) require tight co-design between 1D lumped-parameter dynamic models
 * (Modelica) and 3D geometric packaging (CAD/CFD). Physical properties such as mass, moments of inertia,
 * thermal dissipation area, and hydraulic flow restrictions depend directly on 3D geometry.
 * The SCAD evaluator executes declarative OpenSCAD models, resolving parametric modules, loops, and
 * mathematical transformations into normalized CSG solid trees (`@modelscript/cad`) for downstream
 * OpenCascade B-Rep evaluation, STEP (ISO 10303) export, and 3D CFD meshing.
 *
 * ModelScript Modifications:
 * - Augments geometric primitives with CFD boundary patch tags (`tagPatch`, `BoundaryPatchType`:
 *   inlet, outlet, wall, symmetry) to directly link 3D geometry with SU2/OpenFOAM CFD boundary conditions.
 * - Injects bidirectional parameter bindings between Modelica simulation parameters and SCAD variables.
 * - Preserves AST source mapping (`SolidSourceMetadata`) on generated solids for interactive visual picking in the 3D IDE.
 */
import { type AABB, type ManifoldSurfaceMesh, type Solid } from "@modelscript/cad";
import type { ScadCstNode } from "./patcher.js";
import type { ScadWorkspaceIndex } from "./workspace-index.js";
export type ScadValue = number | string | boolean | undefined | ScadValue[];
interface ScadCallableDef {
    params: string[];
    defaults: Map<string, ScadValue>;
    defaultExprs?: Map<string, ScadCstNode> | undefined;
    bodyNode: ScadCstNode;
    scope: Scope;
}
/**
 * Options for configuring an OpenSCAD evaluation run, such as externally injected variables
 * and cross-file workspace index resolution.
 */
export interface ScadEvaluationOptions {
    /** Optional map of initial variable bindings (e.g., synchronized from Modelica parameters). */
    variables?: Record<string, ScadValue> | undefined;
    /** Optional multi-file workspace index for resolving `include <...>` and `use <...>` directives. */
    workspaceIndex?: ScadWorkspaceIndex | undefined;
    /** Optional document URI for relative dependency resolution in `workspaceIndex`. */
    uri?: string | undefined;
}
/**
 * Hierarchical lexical environment storing OpenSCAD variables, functions, and modules.
 */
declare class Scope {
    parent: Scope | null;
    variables: Map<string, ScadValue>;
    functions: Map<string, ScadCallableDef>;
    modules: Map<string, ScadCallableDef>;
    childrenSolids?: Solid[] | undefined;
    constructor(parent?: Scope | null);
    /**
     * Initializes OpenSCAD special variables (`$fn`, `$fa`, `$fs`, `$t`) and `PI` in the root scope.
     */
    private initBuiltins;
    /**
     * Resolves a variable value by walking up the lexical scope chain.
     */
    getVar(name: string): ScadValue;
    /**
     * Binds or updates a variable in the current scope.
     */
    setVar(name: string, val: ScadValue): void;
    /**
     * Resolves a user-defined function signature by walking up the scope chain.
     */
    getFunc(name: string): ScadCallableDef | undefined;
    /**
     * Resolves a user-defined module signature by walking up the scope chain.
     */
    getModule(name: string): ScadCallableDef | undefined;
    /**
     * Resolves child solids passed to a user-defined module instantiation for `children()`.
     */
    getChildren(): Solid[];
}
/**
 * Interpreter that evaluates OpenSCAD CST nodes into `@modelscript/cad` CSG `Solid` trees.
 */
export declare class ScadEvaluator {
    private static readonly MAX_CALL_DEPTH;
    private globalScope;
    private workspaceIndex?;
    private currentUri?;
    private activeDirectiveStack;
    private callDepth;
    constructor(options?: ScadEvaluationOptions);
    /**
     * Returns a snapshot of all variables in the global scope.
     */
    getVariables(): Record<string, ScadValue>;
    /**
     * Evaluates a parsed SourceFile CST root node into a list of top-level Solid parts.
     */
    evaluateParts(rootNode: ScadCstNode): Solid[];
    /**
     * Evaluates a parsed SourceFile CST root node into a combined Solid geometry tree.
     */
    evaluate(rootNode: ScadCstNode): Solid | null;
    private extractDirectiveTarget;
    private resolveDirectiveCst;
    /**
     * Evaluates all child statements of a block or root node in order, pre-scanning and hoisting
     * `use`/`include`, `function`, and `module` declarations before evaluating variables and geometry statements.
     */
    private evaluateStatements;
    /**
     * Detects a standalone `tag_port("name", "type");` statement (parsed as `PrefixSolid` with an
     * empty `;` child statement) so its boundary patch tag can be attached to the next solid in the block.
     */
    private tryExtractStandaloneTagPort;
    private registerModuleDeclaration;
    private registerFunctionDeclaration;
    /**
     * Dispatches evaluation for a single statement node (declarations, control flow, prefix or chained solids).
     */
    private evaluateStatement;
    /**
     * Evaluates a fluent method-chained solid expression (`cube(...).translate(...).fillet(...)`),
     * recording source byte ranges on each transformation step for interactive 3D gizmo writeback.
     */
    private evaluateChainedSolid;
    /**
     * Evaluates OpenSCAD `rotate` arguments supporting both Euler vector syntax (`rotate([rx, ry, rz])`)
     * and scalar/axis-angle syntax (`rotate(a)` or `rotate(a = 45, v = [0, 1, 0])`).
     */
    private applyScadRotation;
    /**
     * Recursively updates 2D `ExtrusionSolid` leaf nodes inside boolean and transform CSG subtrees
     * with the target `linear_extrude` height, twist, and scale parameters.
     */
    private applyLinearExtrudeToTree;
    /**
     * Recursively offsets 2D/extruded profiles within a solid tree using edge-normal offsetting.
     */
    private applyOffsetToTree;
    /**
     * Decomposes a 4x3 or 4x4 affine transformation matrix into scale, rotation (axis-angle),
     * mirror (if negative determinant), and translation.
     */
    private applyMultmatrix;
    /**
     * Resizes a target solid to match `newsize = [x, y, z]` using bounding-box ratios and `auto` flags.
     */
    private applyResize;
    /**
     * Applies a single fluent CAD transformation or feature operation (`fillet`, `chamfer`, `translate`,
     * `rotate`, `scale`, `resize`, `mirror`, `color`) to `target`.
     */
    private applyMethod;
    /**
     * Unwraps a `PrimarySolid` CST node and evaluates its underlying primitive or module call.
     */
    private evaluatePrimarySolid;
    /**
     * Evaluates a prefix-style OpenSCAD operation (`linear_extrude`, `rotate_extrude`, `tag_port`,
     * `union`, `difference`, `intersection`, `hull`, `minkowski`, `translate`, `rotate`, `scale`,
     * `resize`, `mirror`, `multmatrix`, `color`, `offset`) applied to a child statement or block.
     */
    private evaluatePrefixSolid;
    /**
     * Collects all `IDENTIFIER` token texts within a subtree, using fast zero-allocation
     * WASM linear-memory traversal when available.
     */
    private collectIdentifiers;
    /**
     * Evaluates a 3D/2D primitive (`cube`, `cylinder`, `sphere`, `polyhedron`, `polygon`, `square`, `circle`)
     * or user-defined `ModuleInstantiation` into a `Solid` with attached source metadata.
     */
    private tryEvaluateSolid;
    private isExpressionChild;
    /**
     * Evaluates an OpenSCAD expression CST node (literals, vectors, ranges, arithmetic, conditionals,
     * built-in math/vector/string functions, and user-defined function calls) within `scope`.
     */
    evaluateExpression(exprNode: ScadCstNode, scope: Scope): ScadValue;
    /**
     * Evaluates an `ArgumentList` CST node into positional values and named `key = value` bindings.
     */
    private evaluateArgumentList;
    /**
     * Parses a `ParameterList` CST node into ordered parameter names and evaluated default values.
     */
    private parseParameters;
    /**
     * Finds the first direct child node matching `targetType`, utilizing WASM linear-memory
     * pointer traversal when uncached to avoid allocating sibling CST node wrappers.
     */
    private findChildByType;
}
/**
 * Parses OpenSCAD source code synchronously into a CST tree compatible with `ScadEvaluator`.
 */
export declare function parseScadSource(source: string): ScadCstNode;
/**
 * Result of `evaluateScad`, combining the root CSG `Solid` properties with convenience
 * accessors for tessellated mesh data, bounding box, variables, and STEP export.
 */
export type ScadEvaluationResult = Solid & {
    /** The combined root CSG `Solid` (or `null` if the script produced no geometry). */
    readonly solid: Solid | null;
    /** Top-level `Solid` parts produced by the script. */
    readonly solids: Solid[];
    /** Leaf primitive `Solid` nodes collected across the CSG tree. */
    readonly primitives: Solid[];
    /** Evaluated global scope variables (`Record<string, ScadValue>`). */
    readonly variables: Record<string, ScadValue>;
    /** Lazily tessellated 2-manifold surface mesh (`vertices`, `indices`, `normals`, `tags`). */
    readonly mesh: ManifoldSurfaceMesh;
    /** Lazily tessellated vertex coordinates (`Float32Array`). */
    readonly vertices: Float32Array;
    /** Lazily tessellated triangle vertex indices (`Uint32Array`). */
    readonly indices: Uint32Array;
    /** Lazily tessellated vertex normals (`Float32Array`). */
    readonly normals: Float32Array;
    /** Number of triangles in the tessellated surface mesh. */
    readonly triangleCount: number;
    /** Axis-aligned bounding box `{ min: Vec3, max: Vec3 }`. */
    readonly boundingBox: AABB;
    /** Alias for `boundingBox`. */
    readonly bounds: AABB;
    /** Compiles the evaluated CSG solid into an ISO 10303-21 STEP B-Rep string. */
    toStep(): string;
};
/**
 * Synchronously parses (if given OpenSCAD source text) and evaluates an OpenSCAD model into
 * a CSG `Solid` augmented with lazy mesh, bounding-box, variable, and STEP export accessors.
 */
export declare function evaluateScad(sourceOrRoot: string | ScadCstNode, options?: ScadEvaluationOptions): ScadEvaluationResult;
export {};
//# sourceMappingURL=evaluator.d.ts.map