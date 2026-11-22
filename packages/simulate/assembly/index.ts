// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Standalone AssemblyScript/WebAssembly Numerical Kernels.
 *
 * Keeps heavy simulation-domain kernels (meshing, ROM/SVD/SINDy linear algebra,
 * SSA/Tau-Leaping/Radau IIA integrators, and AC-OPF/Powerflow/PTDF-LODF grid solvers)
 * in `simulate.wasm` so `@modelscript/runtime`'s `release.wasm` stays lean for all 113 consumers.
 */

export * from "./meshing";
export * from "./rom_linalg";
export * from "./integrators";
export * from "./power_grid";
export * from "./control_bifurcation";
export * from "./harmonics_qss";

export function alloc(bytes: usize): usize {
  return heap.alloc(bytes);
}

export function free(ptr: usize): void {
  heap.free(ptr);
}
