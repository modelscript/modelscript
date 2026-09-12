// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Automated 1D -> 3D Load Mapping & 3D -> 1D ROM Boundary Pipeline.
 *
 * Extracts transient connector interface forces from Modelica dynamic simulations,
 * projects them onto 3D STEP boundary surfaces (e.g. motor mounts), and produces
 * high-performance Reduced Order Model (ROM) surrogate blocks for closed-loop control.
 */

export interface TransientPeakLoad {
  connectorName: string;
  peakMagnitude: number;
  timeOfPeak: number;
  forceVector: [number, number, number];
  torqueVector?: [number, number, number];
}

export interface FeaBoundaryCondition {
  surfacePatchId: string;
  appliedForce: [number, number, number];
  pressurePa?: number;
  fixedFaces: string[];
}

export class RomLoadPipeline {
  /**
   * Scans a Modelica time-series simulation result and extracts peak transient forces
   * acting on connector ports (e.g., Flange_a, Pin, Frame_a).
   */
  static extractPeakTransientLoads(
    trajectory: { t: number[]; states: string[]; y: number[][] },
    forcePrefix: string = "flange",
  ): TransientPeakLoad[] {
    const loads: TransientPeakLoad[] = [];
    const forceIndices: { name: string; idx: number }[] = [];

    trajectory.states.forEach((stateName, idx) => {
      const lower = stateName.toLowerCase();
      if (
        lower.includes(forcePrefix.toLowerCase()) ||
        lower.includes(".f") ||
        lower.includes("force") ||
        lower.includes("thrust") ||
        lower.includes("torque") ||
        lower.includes(".tau")
      ) {
        forceIndices.push({ name: stateName, idx });
      }
    });

    for (const item of forceIndices) {
      let maxVal = -Infinity;
      let maxTime = 0;

      for (let step = 0; step < trajectory.t.length; step++) {
        const val = Math.abs(trajectory.y[item.idx]?.[step] ?? 0);
        if (val > maxVal) {
          maxVal = val;
          maxTime = trajectory.t[step];
        }
      }

      loads.push({
        connectorName: item.name,
        peakMagnitude: maxVal === -Infinity ? 0 : maxVal,
        timeOfPeak: maxTime,
        forceVector: [0, 0, maxVal === -Infinity ? 0 : maxVal],
      });
    }

    return loads;
  }

  /**
   * Distributes a 1D scalar thrust or flange force across N mounting hole boundary faces.
   */
  static distributeLoadOverFasteners(
    totalForceN: number,
    fastenerCount: number,
    normalAxis: [number, number, number] = [0, 1, 0],
  ): FeaBoundaryCondition[] {
    const forcePerFastener = totalForceN / Math.max(1, fastenerCount);
    const conditions: FeaBoundaryCondition[] = [];

    for (let i = 0; i < fastenerCount; i++) {
      conditions.push({
        surfacePatchId: `mount_hole_${i + 1}`,
        appliedForce: [
          forcePerFastener * normalAxis[0],
          forcePerFastener * normalAxis[1],
          forcePerFastener * normalAxis[2],
        ],
        fixedFaces: ["central_hub_flange"],
      });
    }

    return conditions;
  }

  /**
   * Emits a standard CalculiX FEA input deck (.inp) applying the extracted boundary conditions.
   */
  static generateCalculixDeck(
    partName: string,
    conditions: FeaBoundaryCondition[],
    material: { E: number; nu: number; yieldStrength: number } = { E: 70e9, nu: 0.33, yieldStrength: 270e6 },
  ): string {
    const lines: string[] = [];
    lines.push(`*HEADING`);
    lines.push(`ModelScript Automated FEA Deck for ${partName}`);
    lines.push(`*MATERIAL, NAME=ALUMINUM`);
    lines.push(`*ELASTIC`);
    lines.push(` ${material.E}, ${material.nu}`);
    lines.push(`*STEP`);
    lines.push(`*STATIC`);

    for (const c of conditions) {
      lines.push(`*CLOAD`);
      lines.push(` ${c.surfacePatchId}, 2, ${c.appliedForce[1].toFixed(2)}`);
    }

    lines.push(`*BOUNDARY`);
    for (const fix of conditions[0]?.fixedFaces || ["hub_base"]) {
      lines.push(` ${fix}, 1, 3`);
    }

    lines.push(`*NODE FILE`);
    lines.push(` U`);
    lines.push(`*EL FILE`);
    lines.push(` S`);
    lines.push(`*END STEP`);

    return lines.join("\n");
  }

  /**
   * Generates a Modelica surrogate ROM block interface wrapper around an AOT-compiled WASM FMU.
   */
  static generateModelicaRomBlock(romName: string, inputs: string[], outputs: string[], wasmPath: string): string {
    const lines: string[] = [];
    lines.push(`block ${romName} "High-Speed 3D CFD/FEA Reduced Order Model Surrogate"`);

    for (const inp of inputs) {
      lines.push(`  input Real ${inp} "Surrogate input variable";`);
    }
    for (const out of outputs) {
      lines.push(`  output Real ${out} "Surrogate output response";`);
    }

    lines.push("");
    lines.push(`  annotation(`);
    lines.push(`    __modelscript_rom(type="surrogate_fmu", file="${wasmPath}"),`);
    lines.push(`    Icon(graphics={Text(textString="ROM: ${romName}")})`);
    lines.push(`  );`);
    lines.push(`end ${romName};`);

    return lines.join("\n");
  }
}
