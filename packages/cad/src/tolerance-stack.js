// SPDX-License-Identifier: AGPL-3.0-or-later
export class ToleranceStackVerifier {
    /**
     * Evaluates dynamic operational tolerance stack-up with validated interval bounds.
     */
    static verify(options) {
        const { name, dimensions, environment = {}, minRequiredClearance = 0.0 } = options;
        const refTemp = environment.refTempC ?? 20.0;
        const [tMin, tMax] = environment.operatingTempRange ?? [refTemp, refTemp];
        const [fMin, fMax] = environment.dynamicLoadRangeN ?? [0, 0];
        let nominalGap = 0;
        let worstMinGap = 0;
        let worstMaxGap = 0;
        let totalThermalMin = 0;
        let totalThermalMax = 0;
        let totalElasticMin = 0;
        let totalElasticMax = 0;
        let varianceSum = 0;
        let meanTolShift = 0;
        const contributors = [];
        // 1. Process each dimension in the 1D kinematic vector loop
        for (const d of dimensions) {
            const dir = d.direction;
            const nomContrib = dir * d.nominal;
            nominalGap += nomContrib;
            // Manufacturing tolerance bounds
            // If dir is +1: min occurs at lowerTol, max at upperTol
            // If dir is -1: min occurs at upperTol (subtracted), max at lowerTol
            const tolLow = dir === 1 ? d.lowerTol : -d.upperTol;
            const tolHigh = dir === 1 ? d.upperTol : -d.lowerTol;
            worstMinGap += dir * d.nominal + Math.min(tolLow, tolHigh);
            worstMaxGap += dir * d.nominal + Math.max(tolLow, tolHigh);
            meanTolShift += dir * ((d.upperTol + d.lowerTol) / 2);
            // RSS variance calculation (assuming 3-sigma tolerance distribution)
            const halfTol = (d.upperTol - d.lowerTol) / 2;
            varianceSum += (halfTol / 3) ** 2;
            // 2. Thermal expansion over [T_min, T_max]
            // deltaL = L0 * (alpha * 1e-6) * (T - T_ref)
            let dThermalMin = 0;
            let dThermalMax = 0;
            if (d.material && d.material.ctePpmK !== 0) {
                const alpha = d.material.ctePpmK * 1e-6;
                const dTLow = tMin - refTemp;
                const dTHigh = tMax - refTemp;
                const shift1 = d.nominal * alpha * dTLow;
                const shift2 = d.nominal * alpha * dTHigh;
                const lowShift = Math.min(shift1, shift2);
                const highShift = Math.max(shift1, shift2);
                dThermalMin = dir === 1 ? lowShift : -highShift;
                dThermalMax = dir === 1 ? highShift : -lowShift;
                totalThermalMin += Math.min(dThermalMin, dThermalMax);
                totalThermalMax += Math.max(dThermalMin, dThermalMax);
            }
            // 3. Elastic compliance under dynamic forces
            // deltaL_elastic = (F * L0) / (E * A)
            let dElasticMin = 0;
            let dElasticMax = 0;
            if (d.material?.elasticModulusGpa && d.material?.crossSectionAreaMm2) {
                const E_Mpa = d.material.elasticModulusGpa * 1000;
                const A_mm2 = d.material.crossSectionAreaMm2;
                const stiffness = (E_Mpa * A_mm2) / d.nominal; // N/mm
                const defl1 = fMin / stiffness;
                const defl2 = fMax / stiffness;
                dElasticMin = dir === 1 ? Math.min(defl1, defl2) : -Math.max(defl1, defl2);
                dElasticMax = dir === 1 ? Math.max(defl1, defl2) : -Math.min(defl1, defl2);
                totalElasticMin += Math.min(dElasticMin, dElasticMax);
                totalElasticMax += Math.max(dElasticMin, dElasticMax);
            }
            contributors.push({
                name: d.name,
                nominalContribution: nomContrib,
                toleranceRange: d.upperTol - d.lowerTol,
                percentContribution: 0, // Computed below
                maxThermalShiftMm: Math.max(Math.abs(dThermalMin), Math.abs(dThermalMax)),
            });
        }
        // Add thermal and elastic intervals to worst-case gap bounds
        worstMinGap += totalThermalMin + totalElasticMin;
        worstMaxGap += totalThermalMax + totalElasticMax;
        // Calculate percentage contributors
        const totalTolRange = contributors.reduce((acc, c) => acc + c.toleranceRange, 0);
        for (const c of contributors) {
            c.percentContribution = totalTolRange > 0 ? (c.toleranceRange / totalTolRange) * 100 : 0;
        }
        contributors.sort((a, b) => b.percentContribution - a.percentContribution);
        // Statistical Root-Sum-Square (RSS) 3-sigma estimate
        const sigmaGap = Math.sqrt(varianceSum);
        const threeSigma = 3 * sigmaGap;
        const meanGap = nominalGap + meanTolShift + (totalThermalMin + totalThermalMax) / 2 + (totalElasticMin + totalElasticMax) / 2;
        const isCertifiedSafe = worstMinGap >= minRequiredClearance;
        const summary = isCertifiedSafe
            ? `Tolerance stack '${name}' CERTIFIED SAFE across all GD&T and thermal variations. Worst-case min clearance: ${worstMinGap.toFixed(4)} mm (>= required ${minRequiredClearance.toFixed(4)} mm).`
            : `Tolerance stack '${name}' FALSIFIED: Binding or interference risk detected! Worst-case min clearance is ${worstMinGap.toFixed(4)} mm (< required ${minRequiredClearance.toFixed(4)} mm). Top contributor: '${contributors[0]?.name}'.`;
        return {
            stackName: name,
            isCertifiedSafe,
            nominalGap,
            worstCaseMinGap: worstMinGap,
            worstCaseMaxGap: worstMaxGap,
            thermalExpansionBounds: { min: totalThermalMin, max: totalThermalMax },
            elasticDeflectionBounds: { min: totalElasticMin, max: totalElasticMax },
            statisticalRss: {
                meanGap,
                threeSigma,
                minRssGap: meanGap - threeSigma,
                maxRssGap: meanGap + threeSigma,
            },
            contributors,
            summary,
        };
    }
}
//# sourceMappingURL=tolerance-stack.js.map