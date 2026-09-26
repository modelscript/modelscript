// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Dimensional CAE 3D Field Snapshot Extractor.
 *
 * Extracts and aligns spatial continuum fields (displacement vectors, Cauchy/von Mises stress,
 * velocity vectors, pressure, and temperature) across parametric simulation sweeps (CalculiX FEA
 * .frd/.vtu and SU2 CFD .vtu results).
 * Compiles spatial states into column-major snapshot matrices S in R^{N x M} for POD-Galerkin
 * reduction and neural operator training.
 */

import type { SnapshotMatrixDataset } from "./cfd-snapshot-collector.js";

export interface CaeRunResult {
  runId: string | number;
  parameters: Record<string, number>;
  scalarOutputs: Record<string, number>;
  /**
   * Field data mapping: field name -> Float32Array of nodal or element values.
   * e.g. "vonMisesStress", "displacement", "pressure", "velocity"
   */
  fields: Record<string, Float32Array | number[]>;
  /** Optional mesh node coordinates [x0, y0, z0, x1, y1, z1, ...] */
  nodeCoordinates?: Float32Array | number[];
}

export interface SnapshotExtractionOptions {
  /** Target primary field to extract into the snapshot matrix. Default: first matching field */
  targetField: string;
  /** Expected number of spatial features/nodes. If not provided, inferred from the first run. */
  expectedFeatures?: number;
  /** Whether to normalize parameter columns to [0, 1]. Default: false */
  normalizeParameters?: boolean;
}

export class CaeSnapshotExtractor {
  /**
   * Ingests a series of parametric CAE simulation results and builds a column-major SnapshotMatrixDataset.
   */
  public static extractFromRuns(runs: CaeRunResult[], options: SnapshotExtractionOptions): SnapshotMatrixDataset {
    const M = runs.length;
    if (M < 2) {
      throw new Error(`At least 2 CAE simulation runs are required for snapshot extraction, got ${M}`);
    }

    const first = runs[0]!;
    const fieldDataRaw = first.fields[options.targetField];
    if (!fieldDataRaw) {
      const available = Object.keys(first.fields).join(", ");
      throw new Error(
        `Target field '${options.targetField}' not found in run results. Available fields: [${available}]`,
      );
    }

    const N = options.expectedFeatures ?? fieldDataRaw.length;
    const paramNames = Object.keys(first.parameters);
    const scalarNames = Object.keys(first.scalarOutputs);

    const P = paramNames.length;
    const Q = scalarNames.length;

    const paramMat = new Float64Array(M * P);
    const scalarMat = new Float64Array(M * Q);
    const snapshotMat = new Float64Array(N * M);

    for (let j = 0; j < M; j++) {
      const run = runs[j]!;
      const fData = run.fields[options.targetField];
      if (!fData) {
        throw new Error(`Run #${run.runId} is missing target field '${options.targetField}'`);
      }
      if (fData.length !== N) {
        throw new Error(`Field length mismatch in run #${run.runId}: got ${fData.length}, expected ${N}`);
      }

      // Fill parameters row j
      for (let p = 0; p < P; p++) {
        paramMat[j * P + p] = run.parameters[paramNames[p]!] ?? 0.0;
      }

      // Fill scalar outputs row j
      for (let q = 0; q < Q; q++) {
        scalarMat[j * Q + q] = run.scalarOutputs[scalarNames[q]!] ?? 0.0;
      }

      // Fill column j of snapshot matrix S in R^{N x M}
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

  /**
   * Helper to parse and extract fields directly from raw VTU (XML Unstructured Grid) string payloads.
   */
  public static parseVtuFields(vtuXml: string): {
    numPoints: number;
    pointData: Record<string, Float32Array>;
  } {
    const startIdx = vtuXml.indexOf("<PointData");
    const endTag = "</PointData>";
    const endIdx = startIdx !== -1 ? vtuXml.indexOf(endTag, startIdx) : -1;
    if (startIdx === -1 || endIdx === -1) {
      throw new Error("No PointData block found in VTU XML content");
    }

    const pointDataStr = vtuXml.slice(startIdx, endIdx + endTag.length);
    const dataArrayRegex = /<DataArray\b([^>]*)>([^<]*)<\/DataArray>/g;
    const pointData: Record<string, Float32Array> = {};
    let numPoints = 0;

    let match: RegExpExecArray | null;
    while ((match = dataArrayRegex.exec(pointDataStr)) !== null) {
      const attrs = match[1]!;
      const nameMatch = attrs.match(/Name="([^"]+)"/);
      if (!nameMatch) continue;
      const name = nameMatch[1]!;
      const textValues = match[2]!.trim().split(/\s+/);
      const floats = new Float32Array(textValues.length);
      for (let k = 0; k < textValues.length; k++) {
        floats[k] = parseFloat(textValues[k]!) || 0.0;
      }
      pointData[name] = floats;
      if (numPoints === 0) {
        numPoints = floats.length;
      }
    }

    return {
      numPoints,
      pointData,
    };
  }
}
