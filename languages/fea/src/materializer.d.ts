import type { BoundaryActionPayload, CaeDiagnostic, MaterializeOptions, ParameterLookup } from "./types.js";
/**
 * Evaluates an arithmetic expression string with parameter lookup and safe math functions.
 */
export declare function evaluateFeaExpression(exprStr: string, lookup?: ParameterLookup | Record<string, number | string>, diagnostics?: CaeDiagnostic[]): number | string;
/**
 * Materializes an FEA deck template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export declare function materializeFeaDeck(templateText: string, options?: MaterializeOptions): string;
/**
 * Synthesizes a syntactic boundary or load directive for FEA decks (CalculiX / .inp / NASTRAN BDF).
 */
export declare function synthesizeFeaBoundary(action: BoundaryActionPayload, dialect?: "calculix" | "abaqus" | "bdf" | string): string;
/**
 * Injects or updates a boundary constraint or load in an FEA deck template.
 */
export declare function applyBoundaryActionToDeck(deckText: string, action: BoundaryActionPayload, dialect?: string): string;
/**
 * Structural mass, Von Mises stress, nodal displacement, and yield safety metrics computed from an FEA deck.
 */
export interface FeaSlicingProperties {
    mass: number;
    totalMass: number;
    maxVonMisesPa: number;
    maxVonMisesStress: number;
    yieldStrengthPa: number;
    safetyFactor: number;
    isSafe: boolean;
    totalVolumeM3?: number | undefined;
    maxDisplacementM?: number | undefined;
    nodeCount?: number | undefined;
    elementCount?: number | undefined;
    nodalDisplacements?: Record<number, [number, number, number]> | undefined;
    elementVonMisesPa?: Record<number, number> | undefined;
    elementCauchyStressPa?: Record<number, [number, number, number, number, number, number]> | undefined;
    naturalFrequenciesHz?: number[] | undefined;
}
/**
 * Evaluates an FEA input deck by parsing nodes, elements, materials, boundary conditions,
 * and loads, assembling the 3D linear elasticity stiffness matrix K * u = F, solving for
 * nodal displacements, and computing element Von Mises stresses and structural mass.
 */
export declare function extractFeaSlicingProperties(deckText: string): FeaSlicingProperties;
//# sourceMappingURL=materializer.d.ts.map