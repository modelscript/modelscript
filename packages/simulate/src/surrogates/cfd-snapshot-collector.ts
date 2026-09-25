// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Dimensional CFD Flow Field Snapshot Collector.
 *
 * Streams and records spatial state snapshots (velocity, pressure, wall forces)
 * across varied operating conditions (inlet speed, angle of attack, temperature)
 * for training Proper Orthogonal Decomposition (POD-Galerkin) and Neural Operator surrogates.
 */

export interface CfdSnapshotRecord {
  timestamp: number;
  parameters: Record<string, number>;
  scalarOutputs: Record<string, number>;
  /** Contiguous spatial field (e.g., velocity magnitude or U component across all cells). */
  fieldData: Float32Array;
}

export interface SnapshotMatrixDataset {
  parameterNames: string[];
  scalarOutputNames: string[];
  numSnapshots: number;
  numFeatures: number;
  /** Size: [numSnapshots x numParams] stored row-major. */
  parameters: Float64Array;
  /** Size: [numSnapshots x numScalarOutputs] stored row-major. */
  scalarOutputs: Float64Array;
  /** Size: [numFeatures x numSnapshots] stored column-major (each column is one spatial snapshot). */
  snapshots: Float64Array;
}

export class CfdSnapshotCollector {
  private records: CfdSnapshotRecord[] = [];
  public readonly numFeatures: number;

  constructor(numFeatures: number) {
    this.numFeatures = numFeatures;
  }

  /**
   * Records a single flow field snapshot during high-fidelity simulation.
   */
  public record(
    parameters: Record<string, number>,
    fieldData: Float32Array,
    timestamp: number,
    scalarOutputs: Record<string, number> = {},
  ): void {
    if (fieldData.length !== this.numFeatures) {
      throw new Error(`Field data length mismatch: got ${fieldData.length}, expected ${this.numFeatures}`);
    }

    // Clone fieldData into a Float32Array so it is decoupled from solver ping-pong buffers
    const fieldClone = new Float32Array(fieldData.length);
    fieldClone.set(fieldData);

    this.records.push({
      timestamp,
      parameters: { ...parameters },
      scalarOutputs: { ...scalarOutputs },
      fieldData: fieldClone,
    });
  }

  public get count(): number {
    return this.records.length;
  }

  public clear(): void {
    this.records = [];
  }

  /**
   * Compiles collected snapshots into column-major snapshot matrix S in R^{N x M}.
   */
  public toDataset(): SnapshotMatrixDataset {
    const M = this.records.length;
    const N = this.numFeatures;

    if (M === 0) {
      throw new Error("No snapshots collected");
    }

    const first = this.records[0]!;
    const paramNames = Object.keys(first.parameters);
    const scalarNames = Object.keys(first.scalarOutputs);

    const P = paramNames.length;
    const Q = scalarNames.length;

    const paramMat = new Float64Array(M * P);
    const scalarMat = new Float64Array(M * Q);
    const snapshotMat = new Float64Array(N * M);

    for (let j = 0; j < M; j++) {
      const rec = this.records[j]!;

      // Fill parameters row j
      for (let p = 0; p < P; p++) {
        paramMat[j * P + p] = rec.parameters[paramNames[p]!] ?? 0.0;
      }

      // Fill scalar outputs row j
      for (let q = 0; q < Q; q++) {
        scalarMat[j * Q + q] = rec.scalarOutputs[scalarNames[q]!] ?? 0.0;
      }

      // Fill column j of snapshot matrix
      const fData = rec.fieldData;
      for (let i = 0; i < N; i++) {
        snapshotMat[j * N + i] = fData[i]!;
      }
    }

    return {
      parameterNames: paramNames,
      scalarOutputNames: scalarNames,
      numSnapshots: M,
      numFeatures: N,
      parameters: paramMat,
      scalarOutputs: scalarMat,
      snapshots: snapshotMat,
    };
  }
}
