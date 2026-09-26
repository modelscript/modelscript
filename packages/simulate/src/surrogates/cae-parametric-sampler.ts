// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CAE Parametric Design of Experiments (DoE) Sampler.
 *
 * Generates parametric simulation variations across structural FEA and aerodynamic CFD operating envelopes:
 *   1. Structural FEA sweeps: Load factors, Young's modulus, and boundary stiffness via in-WASM FeaSolver.
 *   2. Aerodynamic CFD sweeps: Freestream velocity, Reynolds number, and Angle of Attack (AoA).
 * Compiles snapshot runs into aligned CaeRunResult[] datasets ready for CaeSnapshotExtractor and POD reduction.
 */

import { loadInpToFea } from "../fea/inp-loader.js";
import type { FeaBoundaryConditions } from "../fea/tet4-types.js";
import type { CaeRunResult } from "./cae-snapshot-extractor.js";

export interface FeaSamplingOptions {
  /** Load multipliers to sweep, e.g. [0.6, 0.8, 1.0, 1.2, 1.4]. Defaults to 5 steps from 0.6 to 1.4 */
  loadMultipliers?: number[];
  /** Young's modulus multipliers, e.g. [0.9, 1.0, 1.1]. Defaults to [1.0] */
  modulusMultipliers?: number[];
  /** Solvers convergence tolerance. Default: 1e-5 */
  tolerance?: number;
  /** Maximum iterations per solve. Default: 300 */
  maxIterations?: number;
}

export interface CfdSamplingOptions {
  /** Freestream velocities in m/s, e.g. [20, 35, 50, 65, 80] */
  velocities?: number[];
  /** Angles of attack in degrees, e.g. [0, 2, 4, 6, 8] */
  anglesOfAttackDeg?: number[];
  /** Baseline fluid density in kg/m^3. Default: 1.225 (sea level air) */
  density?: number;
}

export class CaeParametricSampler {
  /**
   * Performs an automated parametric DoE sweep on a CalculiX / Abaqus (.inp) deck
   * using the in-WASM linear tetrahedral FEA solver.
   */
  public static sampleFeaDeck(deckContent: string, options: FeaSamplingOptions = {}): CaeRunResult[] {
    const setup = loadInpToFea(deckContent);
    const { mesh, material, bcs, solver } = setup;

    const loadScales = options.loadMultipliers ?? [0.6, 0.8, 1.0, 1.2, 1.4];
    const modScales = options.modulusMultipliers ?? [1.0];
    const tol = options.tolerance ?? 1e-5;
    const maxIters = options.maxIterations ?? 300;

    const runs: CaeRunResult[] = [];
    let runCounter = 0;

    for (const modScale of modScales) {
      // If Young's modulus changes, re-initialize solver with scaled material
      const activeMaterial = Math.abs(modScale - 1.0) > 1e-6 ? { ...material, E: material.E * modScale } : material;
      const activeSolver =
        Math.abs(modScale - 1.0) > 1e-6
          ? loadInpToFea(deckContent, { defaultYoungsModulus: activeMaterial.E }).solver
          : solver;

      for (const loadScale of loadScales) {
        runCounter++;

        // Scale nodal loads
        const scaledLoads = new Map<number, [number, number, number]>();
        for (const [nodeId, force] of bcs.nodalLoads.entries()) {
          scaledLoads.set(nodeId, [force[0] * loadScale, force[1] * loadScale, force[2] * loadScale]);
        }

        const runBcs: FeaBoundaryConditions = {
          fixedNodes: bcs.fixedNodes,
          nodalLoads: scaledLoads,
          resetDynamics: true,
          corotational: false,
        };

        const result = activeSolver.solve(runBcs, tol, maxIters);

        // Extract nodal von Mises stresses
        const nodalStress = new Float32Array(mesh.numNodes);
        if (result.nodalVonMises) {
          for (let i = 0; i < mesh.numNodes; i++) {
            nodalStress[i] = result.nodalVonMises[i] || 0;
          }
        } else if (result.elementVonMises) {
          // Average element stresses to nodes
          const counts = new Uint16Array(mesh.numNodes);
          const npe = mesh.nodesPerElement;
          for (let e = 0; e < mesh.numElements; e++) {
            const s = result.elementVonMises[e] || 0;
            const base = e * npe;
            for (let i = 0; i < npe; i++) {
              const nid = mesh.elements[base + i]!;
              nodalStress[nid] += s;
              counts[nid]++;
            }
          }
          for (let i = 0; i < mesh.numNodes; i++) {
            if (counts[i]! > 0) nodalStress[i] /= counts[i]!;
          }
        }

        // Float32Array of displacements [ux0, uy0, uz0, ...]
        const displacements = new Float32Array(result.displacements);

        runs.push({
          runId: `fea_run_${runCounter}`,
          parameters: {
            loadScale,
            youngsModulus: activeMaterial.E > 1e6 ? activeMaterial.E / 1e9 : activeMaterial.E,
          },
          scalarOutputs: {
            maxStress: result.maxVonMisesStress,
            maxDisplacement: result.maxDisplacement,
            safetyFactor: result.safetyFactor ?? 250e6 / Math.max(1.0, result.maxVonMisesStress),
          },
          fields: {
            vonMisesStress: nodalStress,
            displacements,
          },
          nodeCoordinates: mesh.nodeCoords,
        });
      }
    }

    return runs;
  }

  /**
   * Synthesizes an aerodynamic flow field snapshot envelope across freestream velocities
   * and angles of attack (AoA) from baseline geometry or baseline CFD result.
   */
  public static sampleCfdEnvelope(
    baselineMesh: {
      positions: number[] | Float32Array;
      indices: number[] | Uint32Array;
    },
    options: CfdSamplingOptions = {},
  ): CaeRunResult[] {
    const velocities = options.velocities ?? [25.0, 40.0, 55.0, 70.0, 85.0];
    const aoasDeg = options.anglesOfAttackDeg ?? [0.0, 2.5, 5.0, 7.5, 10.0];
    const rho = options.density ?? 1.225;

    const numNodes = baselineMesh.positions.length / 3;
    const runs: CaeRunResult[] = [];
    let runCounter = 0;

    for (const v_inf of velocities) {
      const q_inf = 0.5 * rho * v_inf * v_inf; // Dynamic pressure 0.5 * rho * V^2

      for (const aoaDeg of aoasDeg) {
        runCounter++;
        const aoaRad = (aoaDeg * Math.PI) / 180.0;

        // Aerodynamic polar coefficients
        // Thin airfoil theory: Cl = 2*pi*alpha, Cd = Cd0 + k*Cl^2
        const cL = 2.0 * Math.PI * (aoaRad + 0.02);
        const cD = 0.015 + 0.045 * (cL * cL);
        const lOverD = cD > 1e-4 ? cL / cD : 0;

        const liftForce = q_inf * cL * 1.5; // Area ~ 1.5 m^2
        const dragForce = q_inf * cD * 1.5;

        // Spatial pressure and velocity distribution over surface nodes
        const pressureField = new Float32Array(numNodes);
        const velocityField = new Float32Array(numNodes * 3);

        const cosAoa = Math.cos(aoaRad);
        const sinAoa = Math.sin(aoaRad);

        for (let i = 0; i < numNodes; i++) {
          const x = baselineMesh.positions[i * 3 + 0] ?? 0;
          const y = baselineMesh.positions[i * 3 + 1] ?? 0;
          const z = baselineMesh.positions[i * 3 + 2] ?? 0;

          // Normalized chord station [0, 1]
          const chordNorm = Math.max(0, Math.min(1, (x + 1.0) / 2.0));

          // Suction vs pressure side coefficient (Cp distribution)
          const cpUpper = -1.2 * (1.0 - chordNorm) * Math.sin(aoaRad + 0.1) - 0.2;
          const cpLower = 0.8 * (1.0 - chordNorm) * Math.cos(aoaRad) + 0.1;
          const cp = y >= 0 ? cpUpper : cpLower;

          // Static pressure: p = p_inf + Cp * q_inf
          pressureField[i] = 101325.0 + cp * q_inf;

          // Local flow velocity around body
          const localSpeed = v_inf * Math.sqrt(Math.max(0.01, 1.0 - cp));
          velocityField[i * 3 + 0] = localSpeed * cosAoa;
          velocityField[i * 3 + 1] = localSpeed * sinAoa;
          velocityField[i * 3 + 2] = 0.0;
        }

        runs.push({
          runId: `cfd_sweep_${runCounter}`,
          parameters: {
            freestreamVelocity: v_inf,
            angleOfAttackDeg: aoaDeg,
            angle_of_attack: aoaDeg,
          },

          scalarOutputs: {
            liftForce,
            dragForce,
            liftCoefficient: cL,
            dragCoefficient: cD,
            liftToDragRatio: lOverD,
            pressureDrop: q_inf * (1.2 + cD),
          },
          fields: {
            pressure: pressureField,
            velocity: velocityField,
          },
          nodeCoordinates: baselineMesh.positions,
        });
      }
    }

    return runs;
  }
}
