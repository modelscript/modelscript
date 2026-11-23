// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — WebGPU WGSL Compute Shaders for Large-Scale Physical Kernels.
 *
 * Provides ready-to-dispatch WGSL compute shaders for:
 *   1. SIMP Topology Optimization mesh-independent sensitivity filter (`SIMP_FILTER_WGSL`)
 *   2. 3D Yee-Grid FDTD Maxwell curl update (`FDTD_3D_YEE_WGSL`)
 *   3. 3D Pencil-Beam Radiation Dose deposition (`PENCIL_BEAM_DOSE_WGSL`)
 */

export const SIMP_FILTER_WGSL = /* wgsl */ `
struct FilterParams {
  nelx: u32,
  nely: u32,
  rmin: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> params: FilterParams;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> dc: array<f32>;
@group(0) @binding(3) var<storage, read_write> dcn: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ex = gid.x;
  let ey = gid.y;
  if (ex >= params.nelx || ey >= params.nely) { return; }

  let rCeil = i32(ceil(params.rmin));
  let iMin = max(0, i32(ex) - rCeil);
  let iMax = min(i32(params.nelx) - 1, i32(ex) + rCeil);
  let jMin = max(0, i32(ey) - rCeil);
  let jMax = min(i32(params.nely) - 1, i32(ey) + rCeil);

  var sumW: f32 = 0.0;
  var sumVal: f32 = 0.0;
  for (var ix = iMin; ix <= iMax; ix = ix + 1) {
    for (var iy = jMin; iy <= jMax; iy = iy + 1) {
      let dx = f32(i32(ex) - ix);
      let dy = f32(i32(ey) - iy);
      let fac = params.rmin - sqrt(dx * dx + dy * dy);
      if (fac > 0.0) {
        let idx = u32(ix) * params.nely + u32(iy);
        sumW = sumW + fac;
        sumVal = sumVal + fac * x[idx] * dc[idx];
      }
    }
  }
  let eIdx = ex * params.nely + ey;
  dcn[eIdx] = sumVal / max(1e-12, x[eIdx] * sumW);
}
`;

export const FDTD_3D_YEE_WGSL = /* wgsl */ `
struct FdtdParams {
  nx: u32,
  ny: u32,
  nz: u32,
  dtOverDx: f32,
};

@group(0) @binding(0) var<uniform> p: FdtdParams;
@group(0) @binding(1) var<storage, read_write> Ez: array<f32>;
@group(0) @binding(2) var<storage, read> Hx: array<f32>;
@group(0) @binding(3) var<storage, read> Hy: array<f32>;
@group(0) @binding(4) var<storage, read> invEps: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn update_e(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x == 0u || y == 0u || x >= p.nx - 1u || y >= p.ny - 1u || z >= p.nz) { return; }
  let idx = (x * p.ny + y) * p.nz + z;
  let idxXm = ((x - 1u) * p.ny + y) * p.nz + z;
  let idxYm = (x * p.ny + (y - 1u)) * p.nz + z;
  let curlH = (Hy[idx] - Hy[idxXm]) - (Hx[idx] - Hx[idxYm]);
  Ez[idx] = Ez[idx] + p.dtOverDx * invEps[idx] * curlH;
}
`;

export const PENCIL_BEAM_DOSE_WGSL = /* wgsl */ `
struct DoseParams {
  nx: u32, ny: u32, nz: u32, _pad0: u32,
  sx: f32, sy: f32, sz: f32, doseAtDmax: f32,
  ox: f32, oy: f32, oz: f32, dMax: f32,
  dx: f32, dy: f32, dz: f32, inv2Sig2: f32,
  mu: f32, _pad1: f32, _pad2: f32, _pad3: f32,
};

@group(0) @binding(0) var<uniform> p: DoseParams;
@group(0) @binding(1) var<storage, read_write> doseGy: array<f32>;

@compute @workgroup_size(4, 4, 4)
fn deposit(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.nx || gid.y >= p.ny || gid.z >= p.nz) { return; }
  let px = f32(gid.x) * p.sx - p.ox;
  let py = f32(gid.y) * p.sy - p.oy;
  let pz = f32(gid.z) * p.sz - p.oz;
  let depth = px * p.dx + py * p.dy + pz * p.dz;
  if (depth < 0.0) { return; }
  let rx = px - depth * p.dx;
  let ry = py - depth * p.dy;
  let rz = pz - depth * p.dz;
  let r2 = rx * rx + ry * ry + rz * rz;
  var pdd: f32;
  if (depth < p.dMax) {
    pdd = 1.0 - exp(-3.0 * depth / max(1e-3, p.dMax));
  } else {
    pdd = exp(-p.mu * (depth - p.dMax));
  }
  let idx = (gid.x * p.ny + gid.y) * p.nz + gid.z;
  doseGy[idx] = doseGy[idx] + p.doseAtDmax * pdd * exp(-r2 * p.inv2Sig2);
}
`;
