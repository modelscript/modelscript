// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { extractIsoSurfaceMesh, lowerNiftiToDae, voxelToWorldRAS } from "../src/mesh/index.js";
import { parseNifti } from "../src/parser/index.js";

const SAMPLE_NIFTI = `
  NIFTI title="LeftVentricleSeg" datatype=INT16 segmentation=true
  DIM ndim=3 nx=2 ny=2 nz=2 nt=1
  PIXDIM qfac=1 dx=2.0 dy=2.0 dz=2.0
  SFORM code=1 srow_x=[2.0,0,0,10.0] srow_y=[0,2.0,0,20.0] srow_z=[0,0,2.0,30.0]
  LABEL id=1 name="Myocardium" color=[220,20,60]
  ROI id=ROI_MYO name="MyocardiumTracer" label=1 D=0.18 clearance=0.03 conc=2.5
  VOXELS 1 1 0 0 0 0 0 0
`;

export const niftiBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "nifti",
  referenceTool: "NIfTI-1 RAS Affine / Watertight Marching Surface",
  defaultTolerance: 1e-6,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseNifti(SAMPLE_NIFTI);
    const ras = voxelToWorldRAS(doc.header, 1, 2, 3);
    const mesh = extractIsoSurfaceMesh(doc);
    const dae = lowerNiftiToDae(doc);
    const d1 = performance.now() - t0;

    const rasErr = Math.max(Math.abs(ras[0] - 12.0), Math.abs(ras[1] - 24.0), Math.abs(ras[2] - 36.0));
    const volErr = Math.abs(mesh.totalVolumeMm3 - 16.0);
    const areaErr = Math.abs(mesh.surfaceAreaMm2 - 40.0);
    const maxErr = Math.max(rasErr, volErr, areaErr);

    return [
      {
        id: "nifti-ras-mesh-dae",
        name: "RAS Affine, Watertight Volume/Area & Tracer DAE Lowering",
        scale: "micro",
        referenceTool: "NIfTI-1 RAS Affine / Watertight Marching Surface",
        metricKind: "max-relative-error",
        threshold: 1e-6,
        measuredError: maxErr,
        passed: maxErr < 1e-6 && dae.getVarCount() >= 8 && dae.getEqCount() >= 8,
        durationMs: d1,
        details: `vol=${mesh.totalVolumeMm3}mm3, area=${mesh.surfaceAreaMm2}mm2, ${dae.getVarCount()}x${dae.getEqCount()} DAE`,
      },
    ];
  },
};
