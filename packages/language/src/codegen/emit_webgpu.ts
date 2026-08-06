import { LanguageOptions } from "../dsl.js";

export function generateWebGPUEmitter(grammarDef: LanguageOptions): string {
  return `// --- Auto-Generated WebGPU Backend (Phase 5) ---
// Cross-platform, browser-native tensor execution via WGSL Compute Shaders

export function emit_wgsl_prelude(): string {
    return \`
struct TensorDim {
    rows: u32,
    cols: u32,
}

@group(0) @binding(0) var<storage, read> dimA: TensorDim;
@group(0) @binding(1) var<storage, read> dimB: TensorDim;
@group(0) @binding(2) var<storage, read> A: array<f32>;
@group(0) @binding(3) var<storage, read> B: array<f32>;
@group(0) @binding(4) var<storage, read_write> C: array<f32>;
\`;
}

export function emit_wgsl_matmul(): string {
    // Standard Tiled Matrix Multiplication Shader (Block size 16x16)
    return \`
const TILE_SIZE = 16u;
var<workgroup> tileA: array<f32, 256>; // 16 * 16
var<workgroup> tileB: array<f32, 256>; // 16 * 16

@compute @workgroup_size(16, 16)
fn matmul_main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let row = global_id.y;
    let col = global_id.x;
    
    let K = dimA.cols;
    let numTiles = (K + TILE_SIZE - 1u) / TILE_SIZE;
    
    var acc = 0.0;
    
    for (var t = 0u; t < numTiles; t++) {
        let tiledColA = t * TILE_SIZE + local_id.x;
        let tiledRowB = t * TILE_SIZE + local_id.y;
        
        // Load into shared memory
        if (row < dimA.rows && tiledColA < K) {
            tileA[local_id.y * TILE_SIZE + local_id.x] = A[row * K + tiledColA];
        } else {
            tileA[local_id.y * TILE_SIZE + local_id.x] = 0.0;
        }
        
        if (tiledRowB < K && col < dimB.cols) {
            tileB[local_id.y * TILE_SIZE + local_id.x] = B[tiledRowB * dimB.cols + col];
        } else {
            tileB[local_id.y * TILE_SIZE + local_id.x] = 0.0;
        }
        
        workgroupBarrier();
        
        for (var k = 0u; k < TILE_SIZE; k++) {
            acc += tileA[local_id.y * TILE_SIZE + k] * tileB[k * TILE_SIZE + local_id.x];
        }
        
        workgroupBarrier();
    }
    
    if (row < dimA.rows && col < dimB.cols) {
        C[row * dimB.cols + col] = acc;
    }
}
\`;
}

export function emit_webgpu_host_spmv(nnz: u32, numRows: u32, numCols: u32): string {
    // Generates JS host code to map WASM linear memory into WebGPU Storage Buffers
    return \`
    async function executeSpMV(device, valBufferOffset, colPtrOffset, rowIdxOffset, xBufferOffset, yBufferOffset) {
        // Load WASM memory slices
        const vals = new Float32Array(wasmMemory.buffer, valBufferOffset, \${nnz});
        const colPtrs = new Uint32Array(wasmMemory.buffer, colPtrOffset, \${numCols} + 1);
        const rowIdxs = new Uint32Array(wasmMemory.buffer, rowIdxOffset, \${nnz});
        const xVec = new Float32Array(wasmMemory.buffer, xBufferOffset, \${numCols});
        
        // Create GPU buffers
        const gpuVals = device.createBuffer({ size: vals.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const gpuColPtrs = device.createBuffer({ size: colPtrs.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const gpuRowIdxs = device.createBuffer({ size: rowIdxs.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const gpuX = device.createBuffer({ size: xVec.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        const gpuY = device.createBuffer({ size: \${numRows} * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        
        // Write to GPU
        device.queue.writeBuffer(gpuVals, 0, vals);
        device.queue.writeBuffer(gpuColPtrs, 0, colPtrs);
        device.queue.writeBuffer(gpuRowIdxs, 0, rowIdxs);
        device.queue.writeBuffer(gpuX, 0, xVec);
    }
\`;
}
`;
}
