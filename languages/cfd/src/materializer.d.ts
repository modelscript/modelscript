import type { BoundaryActionPayload, CaeDiagnostic, MaterializeOptions, ParameterLookup } from "./types.js";
/**
 * Evaluates an arithmetic expression string with parameter lookup and safe math functions.
 */
export declare function evaluateCfdExpression(exprStr: string, lookup?: ParameterLookup | Record<string, number | string>, diagnostics?: CaeDiagnostic[]): number | string;
/**
 * Materializes a CFD configuration template by replacing all {{ expression }} blocks
 * with their evaluated numeric or string values.
 */
export declare function materializeCfdConfig(templateText: string, options?: MaterializeOptions): string;
/**
 * Synthesizes a syntactic boundary marker directive for CFD configuration decks
 * from interactive 3D CAD surface selections.
 */
export declare function synthesizeCfdBoundary(action: BoundaryActionPayload, dialect?: "su2" | "openfoam" | string): string;
/**
 * Injects or updates a boundary action directive in a CFD configuration template.
 */
export declare function applyBoundaryActionToConfig(configText: string, action: BoundaryActionPayload, dialect?: string): string;
/**
 * Aerodynamic and thermodynamic flow state extracted from a CFD configuration deck for 1D-3D co-simulation.
 */
export interface CfdSlicingProperties {
    cd: number;
    cl?: number | undefined;
    refArea: number;
    refLength?: number | undefined;
    density: number;
    freeStreamVelocity: number;
    machNumber?: number | undefined;
    maxMachNumber?: number | undefined;
    reynoldsNumber?: number | undefined;
    aoaDeg?: number | undefined;
    dragForce?: number | undefined;
    liftForce?: number | undefined;
    dynamicViscosityPaS?: number | undefined;
    pressureDropPa?: number | undefined;
    residualHistory?: number[] | undefined;
    converged?: boolean | undefined;
    iterations?: number | undefined;
    cellMachNumbers?: number[] | undefined;
    cellPressuresPa?: number[] | undefined;
}
export interface Quasi1DEulerFvmOptions {
    numCells?: number | undefined;
    maxIterations?: number | undefined;
    cfl?: number | undefined;
    fluxScheme?: "ROE" | "HLLC" | undefined;
    freestreamDensity: number;
    freestreamVelocity: number;
    freestreamPressure: number;
    gamma?: number | undefined;
    thicknessRatio?: number | undefined;
    aoaRad?: number | undefined;
    skinFrictionCoeff?: number | undefined;
}
export interface Quasi1DEulerFvmResult {
    maxMachNumber: number;
    pressureDropPa: number;
    residualHistory: number[];
    converged: boolean;
    iterations: number;
    cellMachNumbers: number[];
    cellPressuresPa: number[];
}
/**
 * Multi-cell 1D/quasi-2D compressible Euler finite-volume solver over a variable-area
 * airfoil streamtube using approximate Riemann fluxes (Roe with Harten-Hyman entropy fix or HLLC).
 */
export declare function solveQuasi1DEulerFvm(opts: Quasi1DEulerFvmOptions): Quasi1DEulerFvmResult;
/**
 * Evaluates an SU2/OpenFOAM CFD configuration to derive physical freestream state,
 * Reynolds/Mach numbers, boundary-layer skin friction, compressible Prandtl-Glauert
 * lift coefficient, drag polar parameters, and quasi-1D compressible Euler FVM flowfield.
 */
export declare function extractCfdSlicingProperties(cfgText: string): CfdSlicingProperties;
//# sourceMappingURL=materializer.d.ts.map