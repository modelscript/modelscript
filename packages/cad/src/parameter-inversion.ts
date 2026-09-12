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
  unit?: string;
  sourceVariable?: string; // e.g., "chassis.arm_length"
}

export interface InversionResult {
  isSuccess: boolean;
  updatedSource: string;
  appliedUpdates: ParameterInversionUpdate[];
  regeneratedStep?: string;
}

export class ParameterInversionEngine {
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

    for (const [paramName, newVal] of Object.entries(updates)) {
      // Regex matches const/let/var or assignment
      const regex = new RegExp(`(\\b(?:const|let|var)?\\s*${paramName}\\s*=\\s*)([\\d.]+)(\\s*;)`, "g");
      let matched = false;

      result = result.replace(regex, (match, prefix, oldValStr, suffix) => {
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
        const propRegex = new RegExp(`(\\b${paramName}\\s*:\\s*)([\\d.]+)(\\s*[,;])`, "g");
        result = result.replace(propRegex, (match, prefix, oldValStr, suffix) => {
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
