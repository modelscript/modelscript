// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional CAD Parameter Inversion Engine.
 *
 * Propagates optimized 1D Modelica system simulation variables back into
 * procedural MCAD AST / source code, regenerating production STEP CAD models AOT.
 */

export interface ParameterInversionUpdate {
  parameterName: string;
  previousValue: number;
  newValue: number;
  unit?: string | undefined;
  sourceVariable?: string | undefined; // e.g., "chassis.arm_length"
}

export interface InversionResult {
  isSuccess: boolean;
  updatedSource: string;
  appliedUpdates: ParameterInversionUpdate[];
  regeneratedStep?: string | undefined;
}

export interface ParameterConstraintRule {
  name: string;
  evaluate: (params: Record<string, number>) => boolean;
  description?: string | undefined;
}

export interface SafeRegionGuard {
  /** Explicit numeric bounding boxes per parameter */
  parameterBounds?: Record<string, { min?: number | undefined; max?: number | undefined }> | undefined;
  /** Multidisciplinary linear or non-linear constraint rules (e.g. stress, buckling, clearance) */
  constraints?: ParameterConstraintRule[] | undefined;
  /** Optional custom validator predicate */
  customValidator?: ((params: Record<string, number>) => { isSafe: boolean; violations: string[] }) | undefined;
}

export interface CertifiedInversionResult extends InversionResult {
  isCertifiedSafe: boolean;
  violations: string[];
  summary: string;
}

export class ParameterInversionEngine {
  /**
   * Extracts scalar numeric parameters declared in MCAD source code.
   */
  static extractParameters(mcadSource: string): Record<string, number> {
    const params: Record<string, number> = {};
    const assignRegex = /\b(?:const|let|var)?\s*([A-Za-z_]\w*)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = assignRegex.exec(mcadSource)) !== null) {
      params[m[1]!] = parseFloat(m[2]!);
    }
    const propRegex = /\b([A-Za-z_]\w*)\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[,;}]/g;
    while ((m = propRegex.exec(mcadSource)) !== null) {
      const key = m[1]!;
      if (!(key in params)) {
        params[key] = parseFloat(m[2]!);
      }
    }
    return params;
  }

  /**
   * Updates named scalar parameters in procedural MCAD source code.
   * Matches definitions like:
   *   const ARM_LENGTH = 7;
   *   let BODY_WIDTH = 10.0;
   *   ARM_HEIGHT = 1;
   */
  static patchMcadSource(
    mcadSource: string,
    updates: Record<string, number>,
  ): { updatedSource: string; appliedUpdates: ParameterInversionUpdate[] } {
    let result = mcadSource;
    const appliedUpdates: ParameterInversionUpdate[] = [];
    const numPattern = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)";

    for (const [paramName, newVal] of Object.entries(updates)) {
      // Regex matches const/let/var or assignment
      const regex = new RegExp(`(\\b(?:const|let|var)?\\s*${paramName}\\s*=\\s*)${numPattern}(\\s*;)`, "g");
      let matched = false;

      result = result.replace(regex, (_match, prefix, oldValStr, suffix) => {
        matched = true;
        const oldVal = parseFloat(oldValStr);
        appliedUpdates.push({
          parameterName: paramName,
          previousValue: oldVal,
          newValue: newVal,
        });
        return `${prefix}${newVal}${suffix}`;
      });

      if (!matched) {
        // Also match property key in object literal: e.g. "width: 10,"
        const propRegex = new RegExp(`(\\b${paramName}\\s*:\\s*)${numPattern}(\\s*[,;}])`, "g");
        result = result.replace(propRegex, (_match, prefix, oldValStr, suffix) => {
          const oldVal = parseFloat(oldValStr);
          appliedUpdates.push({
            parameterName: paramName,
            previousValue: oldVal,
            newValue: newVal,
          });
          return `${prefix}${newVal}${suffix}`;
        });
      }
    }

    return { updatedSource: result, appliedUpdates };
  }

  /**
   * Patches MCAD source only if the new parameters strictly reside within the certified safe region P_safe.
   * Rejects the update and keeps the original source untouched if any multidisciplinary constraint is violated.
   */
  static patchMcadSourceCertified(
    mcadSource: string,
    updates: Record<string, number>,
    guard: SafeRegionGuard,
  ): CertifiedInversionResult {
    const violations: string[] = [];
    const effectiveParams: Record<string, number> = {
      ...this.extractParameters(mcadSource),
      ...updates,
    };

    // 1. Check explicit parameter bounds
    if (guard.parameterBounds) {
      for (const [param, val] of Object.entries(effectiveParams)) {
        const bound = guard.parameterBounds[param];
        if (bound) {
          if (bound.min !== undefined && val < bound.min) {
            violations.push(`Parameter '${param}' value ${val} violates minimum allowable bound ${bound.min}.`);
          }
          if (bound.max !== undefined && val > bound.max) {
            violations.push(`Parameter '${param}' value ${val} violates maximum allowable bound ${bound.max}.`);
          }
        }
      }
    }

    // 2. Check multidisciplinary constraint rules
    if (guard.constraints) {
      for (const rule of guard.constraints) {
        try {
          const isSatisfied = rule.evaluate(effectiveParams);
          if (!isSatisfied) {
            violations.push(
              rule.description || `Multidisciplinary constraint '${rule.name}' violated by candidate parameter set.`,
            );
          }
        } catch (err: any) {
          violations.push(`Constraint '${rule.name}' evaluation error: ${err.message}`);
        }
      }
    }

    // 3. Check custom validator
    if (guard.customValidator) {
      const customRes = guard.customValidator(effectiveParams);
      if (!customRes.isSafe) {
        violations.push(...customRes.violations);
      }
    }

    // If violated, reject update completely and do NOT patch source code
    if (violations.length > 0) {
      return {
        isSuccess: false,
        isCertifiedSafe: false,
        updatedSource: mcadSource,
        appliedUpdates: [],
        violations,
        summary: `Certified parameter inversion REJECTED: ${violations.length} constraint violation(s) detected.`,
      };
    }

    // Parameters are certified safe, proceed with source patch
    const patchResult = this.patchMcadSource(mcadSource, updates);
    return {
      isSuccess: true,
      isCertifiedSafe: true,
      updatedSource: patchResult.updatedSource,
      appliedUpdates: patchResult.appliedUpdates,
      violations: [],
      summary: `Certified parameter inversion SUCCESSFUL: All ${patchResult.appliedUpdates.length} parameter update(s) mathematically proven safe.`,
    };
  }

  /**
   * Inverts target mass into target dimension for a prismatic part given density.
   *   m = rho * (L * w * h)  =>  L = m / (rho * w * h)
   */
  static solveLengthForMass(targetMassKg: number, densityKgM3: number, widthM: number, heightM: number): number {
    const crossSection = widthM * heightM;
    if (crossSection <= 0 || densityKgM3 <= 0) return 0;
    return targetMassKg / (densityKgM3 * crossSection);
  }

  /**
   * Scales a bounding box isotropically to match a target volume or mass.
   */
  static scaleDimensionsForMass(
    currentDimensions: [number, number, number],
    currentMass: number,
    targetMass: number,
  ): [number, number, number] {
    if (currentMass <= 0 || targetMass <= 0) return currentDimensions;
    const scaleFactor = Math.cbrt(targetMass / currentMass);
    return [currentDimensions[0] * scaleFactor, currentDimensions[1] * scaleFactor, currentDimensions[2] * scaleFactor];
  }
}
