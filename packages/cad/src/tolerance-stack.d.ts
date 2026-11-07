/**
 * @modelscript/cad — Dynamic GD&T and Operational Tolerance Stack-Up Verifier.
 *
 * Computes validated 1D/3D kinematic assembly gap distributions under combined
 * manufacturing dimensional tolerances (GD&T limit/bilateral intervals),
 * operational thermal expansion (CTE over [T_min, T_max]), and dynamic mechanical strain.
 */
export interface DimensionTolerance {
    name: string;
    nominal: number;
    lowerTol: number;
    upperTol: number;
    /**
     * Vector loop direction:
     * +1 = increases gap (e.g. housing bore, slot width)
     * -1 = decreases gap (e.g. pin diameter, inserted component length)
     */
    direction: 1 | -1;
    material?: {
        name: string;
        /** Coefficient of thermal expansion in ppm/K (1e-6 / K) */
        ctePpmK: number;
        /** Young's Modulus in GPa */
        elasticModulusGpa?: number | undefined;
        /** Cross-sectional area in mm^2 for axial compliance */
        crossSectionAreaMm2?: number | undefined;
    } | undefined;
}
export interface OperationalEnvironment {
    /** Reference room assembly temperature in degC (default: 20) */
    refTempC?: number | undefined;
    /** Operating temperature range [T_min, T_max] in degC */
    operatingTempRange?: [number, number] | undefined;
    /** Dynamic axial mechanical load range [F_min, F_max] in Newtons */
    dynamicLoadRangeN?: [number, number] | undefined;
}
export interface ToleranceStackOptions {
    name: string;
    dimensions: DimensionTolerance[];
    environment?: OperationalEnvironment | undefined;
    minRequiredClearance?: number | undefined;
}
export interface ToleranceContributor {
    name: string;
    nominalContribution: number;
    toleranceRange: number;
    percentContribution: number;
    maxThermalShiftMm: number;
}
export interface ToleranceStackResult {
    stackName: string;
    isCertifiedSafe: boolean;
    nominalGap: number;
    worstCaseMinGap: number;
    worstCaseMaxGap: number;
    thermalExpansionBounds: {
        min: number;
        max: number;
    };
    elasticDeflectionBounds: {
        min: number;
        max: number;
    };
    statisticalRss: {
        meanGap: number;
        threeSigma: number;
        minRssGap: number;
        maxRssGap: number;
    };
    contributors: ToleranceContributor[];
    summary: string;
}
export declare class ToleranceStackVerifier {
    /**
     * Evaluates dynamic operational tolerance stack-up with validated interval bounds.
     */
    static verify(options: ToleranceStackOptions): ToleranceStackResult;
}
//# sourceMappingURL=tolerance-stack.d.ts.map