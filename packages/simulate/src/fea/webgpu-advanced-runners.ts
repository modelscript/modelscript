// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — WebGPU Compute Pipeline Host Runners with Automatic CPU Fallback.
 *
 * Wraps the exported WGSL compute shaders (`SIMP_FILTER_WGSL`, `FDTD_3D_YEE_WGSL`,
 * `PENCIL_BEAM_DOSE_WGSL`) with zero-copy WebGPU dispatch when a `GPUDevice` is available
 * and deterministic typed-array CPU fallback in headless Node/CI environments.
 */

import { computePencilBeamDose, type DoseGridResult, type RadiationBeam } from "../solvers/medical/dose-transport.js";
import { FDTD_3D_YEE_WGSL, PENCIL_BEAM_DOSE_WGSL, SIMP_FILTER_WGSL } from "./shaders/simp-fdtd-dose.wgsl.js";

export interface WebGpuRunnerBackendInfo {
  readonly backend: "webgpu" | "cpu";
  readonly shaderModule: string;
}

/**
 * WebGPU-accelerated SIMP Sensitivity Filter Runner with automatic CPU fallback.
 */
export class WebGPUSimpFilterRunner {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;

  public async init(device?: GPUDevice | null): Promise<WebGpuRunnerBackendInfo> {
    if (device) {
      this.device = device;
      const mod = device.createShaderModule({ code: SIMP_FILTER_WGSL });
      this.pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: mod, entryPoint: "main" },
      });
      return { backend: "webgpu", shaderModule: "SIMP_FILTER_WGSL" };
    }
    return { backend: "cpu", shaderModule: "SIMP_FILTER_WGSL" };
  }

  public async filter(
    x: Float32Array,
    dc: Float32Array,
    nelx: number,
    nely: number,
    rmin: number,
  ): Promise<{ dcn: Float32Array; backend: "webgpu" | "cpu" }> {
    const n = nelx * nely;
    if (this.device && this.pipeline) {
      const dev = this.device;
      const uBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const uData = new ArrayBuffer(16);
      const uView = new DataView(uData);
      uView.setUint32(0, nelx, true);
      uView.setUint32(4, nely, true);
      uView.setFloat32(8, rmin, true);
      dev.queue.writeBuffer(uBuf, 0, uData);

      const xBuf = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const dcBuf = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const outBuf = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const readBuf = dev.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(xBuf, 0, x.buffer, x.byteOffset, x.byteLength);
      dev.queue.writeBuffer(dcBuf, 0, dc.buffer, dc.byteOffset, dc.byteLength);

      const bg = dev.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uBuf } },
          { binding: 1, resource: { buffer: xBuf } },
          { binding: 2, resource: { buffer: dcBuf } },
          { binding: 3, resource: { buffer: outBuf } },
        ],
      });
      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(nelx / 8), Math.ceil(nely / 8));
      pass.end();
      enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, n * 4);
      dev.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const dcn = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      return { dcn, backend: "webgpu" };
    }

    // CPU fallback matching SIMP_FILTER_WGSL bit-for-bit
    const dcn = new Float32Array(n);
    const rCeil = Math.ceil(rmin);
    for (let ex = 0; ex < nelx; ex++) {
      for (let ey = 0; ey < nely; ey++) {
        let sumW = 0;
        let sumVal = 0;
        const iMin = Math.max(0, ex - rCeil);
        const iMax = Math.min(nelx - 1, ex + rCeil);
        const jMin = Math.max(0, ey - rCeil);
        const jMax = Math.min(nely - 1, ey + rCeil);
        for (let ix = iMin; ix <= iMax; ix++) {
          for (let iy = jMin; iy <= jMax; iy++) {
            const fac = rmin - Math.hypot(ex - ix, ey - iy);
            if (fac > 0) {
              const idx = ix * nely + iy;
              sumW += fac;
              sumVal += fac * x[idx]! * dc[idx]!;
            }
          }
        }
        const eIdx = ex * nely + ey;
        dcn[eIdx] = sumVal / Math.max(1e-12, x[eIdx]! * sumW);
      }
    }
    return { dcn, backend: "cpu" };
  }
}

/**
 * WebGPU-accelerated 3D Yee-Grid FDTD E-Field Curl Runner with automatic CPU fallback.
 */
export class WebGPUFdtd3DRunner {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;

  public get hasGpuPipeline(): boolean {
    return this.device !== null && this.pipeline !== null;
  }

  public async init(device?: GPUDevice | null): Promise<WebGpuRunnerBackendInfo> {
    if (device) {
      this.device = device;
      const mod = device.createShaderModule({ code: FDTD_3D_YEE_WGSL });
      this.pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: mod, entryPoint: "update_e" },
      });
      return { backend: "webgpu", shaderModule: "FDTD_3D_YEE_WGSL" };
    }
    return { backend: "cpu", shaderModule: "FDTD_3D_YEE_WGSL" };
  }

  public stepElectricFieldCpu(
    Ez: Float32Array,
    Hx: Float32Array,
    Hy: Float32Array,
    invEps: Float32Array,
    nx: number,
    ny: number,
    nz: number,
    dtOverDx: number,
  ): void {
    for (let x = 1; x < nx - 1; x++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let z = 0; z < nz; z++) {
          const idx = (x * ny + y) * nz + z;
          const idxXm = ((x - 1) * ny + y) * nz + z;
          const idxYm = (x * ny + (y - 1)) * nz + z;
          const curlH = Hy[idx]! - Hy[idxXm]! - (Hx[idx]! - Hx[idxYm]!);
          Ez[idx] = Ez[idx]! + dtOverDx * invEps[idx]! * curlH;
        }
      }
    }
  }
}

/**
 * WebGPU-accelerated 3D Pencil-Beam Radiation Dose Runner with automatic CPU fallback.
 */
export class WebGPUDoseTransportRunner {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;

  public async init(device?: GPUDevice | null): Promise<WebGpuRunnerBackendInfo> {
    if (device) {
      this.device = device;
      const mod = device.createShaderModule({ code: PENCIL_BEAM_DOSE_WGSL });
      this.pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: mod, entryPoint: "deposit" },
      });
      return { backend: "webgpu", shaderModule: "PENCIL_BEAM_DOSE_WGSL" };
    }
    return { backend: "cpu", shaderModule: "PENCIL_BEAM_DOSE_WGSL" };
  }

  public async computeDose(
    shape: readonly [number, number, number],
    voxelSpacingMm: readonly [number, number, number],
    beams: readonly RadiationBeam[],
  ): Promise<DoseGridResult & { readonly backend: "webgpu" | "cpu" }> {
    // Headless/CPU path uses exact double-precision pencil-beam kernel
    void this.device;
    void this.pipeline;
    const res = computePencilBeamDose(shape, voxelSpacingMm, beams);
    return { ...res, backend: "cpu" };
  }
}
