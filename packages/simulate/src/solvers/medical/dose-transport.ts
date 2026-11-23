// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Pencil-Beam Radiation Dose Transport & DVH Evaluator.
 *
 * Serves `dicom-rt`, `nifti`, and `topas` medical physics & radiation oncology workflows.
 */

export interface RadiationBeam {
  /** Beam origin in mm [x, y, z]. */
  readonly originMm: readonly [number, number, number];
  /** Normalized beam direction vector [dx, dy, dz]. */
  readonly direction: readonly [number, number, number];
  /** Reference dose rate at d_max (Gy). */
  readonly doseAtDmaxGy: number;
  /** Beam lateral Gaussian sigma (mm). */
  readonly sigmaMm: number;
  /** Depth of maximum dose (mm, e.g. 15 mm for 6 MV photons). */
  readonly dMaxMm?: number | undefined;
  /** Effective linear attenuation coefficient mu (1/mm). */
  readonly attenuationPerMm?: number | undefined;
}

export interface DoseGridResult {
  readonly shape: readonly [number, number, number];
  readonly doseGy: Float64Array;
  readonly maxDoseGy: number;
}

/**
 * Computes 3D radiation dose distribution using an analytical Pencil-Beam kernel
 * (buildup + exponential depth attenuation * lateral Gaussian penumbra).
 */
export function computePencilBeamDose(
  shape: readonly [number, number, number],
  voxelSpacingMm: readonly [number, number, number],
  beams: readonly RadiationBeam[],
): DoseGridResult {
  const [nx, ny, nz] = shape;
  const [sx, sy, sz] = voxelSpacingMm;
  const doseGy = new Float64Array(nx * ny * nz);
  let maxDoseGy = 0;

  for (const beam of beams) {
    const [ox, oy, oz] = beam.originMm;
    const dLen = Math.hypot(beam.direction[0], beam.direction[1], beam.direction[2]) || 1;
    const dx = beam.direction[0] / dLen;
    const dy = beam.direction[1] / dLen;
    const dz = beam.direction[2] / dLen;
    const dMax = beam.dMaxMm ?? 15.0;
    const mu = beam.attenuationPerMm ?? 0.0055;
    const inv2Sig2 = 0.5 / (beam.sigmaMm * beam.sigmaMm);

    for (let ix = 0; ix < nx; ix++) {
      const px = ix * sx - ox;
      for (let iy = 0; iy < ny; iy++) {
        const py = iy * sy - oy;
        for (let iz = 0; iz < nz; iz++) {
          const pz = iz * sz - oz;
          const depth = px * dx + py * dy + pz * dz;
          if (depth < 0) continue;
          const rx = px - depth * dx;
          const ry = py - depth * dy;
          const rz = pz - depth * dz;
          const r2 = rx * rx + ry * ry + rz * rz;

          const pdd =
            depth < dMax ? 1.0 - Math.exp((-3.0 * depth) / Math.max(1e-3, dMax)) : Math.exp(-mu * (depth - dMax));
          const lateral = Math.exp(-r2 * inv2Sig2);
          const idx = (ix * ny + iy) * nz + iz;
          const d = doseGy[idx]! + beam.doseAtDmaxGy * pdd * lateral;
          doseGy[idx] = d;
          if (d > maxDoseGy) maxDoseGy = d;
        }
      }
    }
  }

  return { shape, doseGy, maxDoseGy };
}

export interface DvhMetrics {
  readonly minDoseGy: number;
  readonly meanDoseGy: number;
  readonly maxDoseGy: number;
  readonly d95Gy: number;
  readonly d50Gy: number;
}

/** Evaluates Dose-Volume Histogram (DVH) metrics over a boolean ROI mask. */
export function computeDvhMetrics(doseGy: Float64Array, roiMask: Uint8Array): DvhMetrics {
  const vals: number[] = [];
  let sum = 0;
  for (let i = 0; i < doseGy.length; i++) {
    if (roiMask[i]) {
      const d = doseGy[i]!;
      vals.push(d);
      sum += d;
    }
  }
  if (vals.length === 0) {
    return { minDoseGy: 0, meanDoseGy: 0, maxDoseGy: 0, d95Gy: 0, d50Gy: 0 };
  }
  vals.sort((a, b) => a - b);
  const idx95 = Math.floor(0.05 * (vals.length - 1)); // Dose received by at least 95% of volume
  const idx50 = Math.floor(0.5 * (vals.length - 1));
  return {
    minDoseGy: vals[0]!,
    meanDoseGy: sum / vals.length,
    maxDoseGy: vals[vals.length - 1]!,
    d95Gy: vals[idx95]!,
    d50Gy: vals[idx50]!,
  };
}
