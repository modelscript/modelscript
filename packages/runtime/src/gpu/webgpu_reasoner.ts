// SPDX-License-Identifier: AGPL-3.0-or-later

import { SHACL_VALIDATION_WGSL, TRANSITIVE_CLOSURE_WGSL } from "./shaders/transitive_closure.wgsl.js";

/**
 * WGSL Compute Shader for Sparse CSR Frontier-Based Parallel BFS / Reachability.
 * Scales to 10^6+ nodes in O(N + E) memory using atomic bitset updates instead of dense O(N^2) matrices.
 */
export const CSR_BFS_FRONTIER_WGSL = /* wgsl */ `
struct Params {
  nodeCount: u32,
  wordCount: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> rowOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> colIndices: array<u32>;
@group(0) @binding(3) var<storage, read> currFrontier: array<u32>;
@group(0) @binding(4) var<storage, read_write> nextFrontier: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> visited: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> changedFlag: array<atomic<u32>>;

@compute @workgroup_size(64)
fn csrFrontierStep(@builtin(global_invocation_id) gid: vec3<u32>) {
  let u = gid.x;
  if (u >= params.nodeCount) { return; }

  let wIdx = u >> 5u;
  let mask = 1u << (u & 31u);
  if ((currFrontier[wIdx] & mask) == 0u) { return; }

  let start = rowOffsets[u];
  let end = rowOffsets[u + 1u];
  for (var e = start; e < end; e = e + 1u) {
    let v = colIndices[e];
    let vWord = v >> 5u;
    let vMask = 1u << (v & 31u);
    let prev = atomicOr(&visited[vWord], vMask);
    if ((prev & vMask) == 0u) {
      atomicOr(&nextFrontier[vWord], vMask);
      atomicStore(&changedFlag[0], 1u);
    }
  }
}
`;

/**
 * Compressed Sparse Row (CSR) directed graph representation in O(N + E) memory.
 * Enables million-node property-path reachability (`p+` / `p*`) without dense O(N^2/8) bitsets.
 */
export class SparseCsrGraph {
  public readonly nodeCount: number;
  public readonly edgeCount: number;
  public readonly rowOffsets: Uint32Array;
  public readonly colIndices: Uint32Array;

  constructor(nodeCount: number, rowOffsets: Uint32Array, colIndices: Uint32Array) {
    this.nodeCount = nodeCount;
    this.edgeCount = colIndices.length;
    this.rowOffsets = rowOffsets;
    this.colIndices = colIndices;
  }

  /** Builds a CSR graph from an edge list `[u, v][]` in O(N + E) time and space. */
  public static fromEdges(nodeCount: number, edges: readonly [number, number][]): SparseCsrGraph {
    const rowOffsets = new Uint32Array(nodeCount + 1);
    let validEdges = 0;
    for (let i = 0; i < edges.length; i++) {
      const [u, v] = edges[i]!;
      if (u >= 0 && u < nodeCount && v >= 0 && v < nodeCount) {
        rowOffsets[u + 1]!++;
        validEdges++;
      }
    }
    for (let i = 0; i < nodeCount; i++) {
      rowOffsets[i + 1] = rowOffsets[i + 1]! + rowOffsets[i]!;
    }
    const colIndices = new Uint32Array(validEdges);
    const cursor = new Uint32Array(rowOffsets);
    for (let i = 0; i < edges.length; i++) {
      const [u, v] = edges[i]!;
      if (u >= 0 && u < nodeCount && v >= 0 && v < nodeCount) {
        const pos = cursor[u]!;
        colIndices[pos] = v;
        cursor[u] = pos + 1;
      }
    }
    return new SparseCsrGraph(nodeCount, rowOffsets, colIndices);
  }
}

export interface SparseReachabilityResult {
  readonly reachable: Uint32Array;
  readonly distances: Int32Array;
  readonly hops: number;
  readonly executionTimeMs: number;
  readonly engine: "webgpu" | "cpu-fallback";
}

/**
 * Dense Bitset Graph Adjacency / Reachability Matrix.
 * Represents an N x N directed graph where each row u contains
 * ceil(N / 32) 32-bit words.
 */
export class BitsetGraph {
  public readonly nodeCount: number;
  public readonly wordsPerRow: number;
  public readonly matrix: Uint32Array;

  constructor(nodeCount: number, matrix?: Uint32Array) {
    this.nodeCount = nodeCount;
    this.wordsPerRow = Math.ceil(nodeCount / 32) || 1;
    this.matrix = matrix ?? new Uint32Array(this.nodeCount * this.wordsPerRow);
  }

  public addEdge(from: number, to: number): void {
    if (from >= this.nodeCount || to >= this.nodeCount) return;
    const wordIdx = from * this.wordsPerRow + (to >> 5);
    const bit = to & 31;
    this.matrix[wordIdx]! |= 1 << bit;
  }

  public hasEdge(from: number, to: number): boolean {
    if (from >= this.nodeCount || to >= this.nodeCount) return false;
    const wordIdx = from * this.wordsPerRow + (to >> 5);
    const bit = to & 31;
    return (this.matrix[wordIdx]! & (1 << bit)) !== 0;
  }

  /**
   * Returns an array of all reachable successor nodes from `from`.
   */
  public getReachable(from: number): number[] {
    const res: number[] = [];
    if (from >= this.nodeCount) return res;
    const rowOffset = from * this.wordsPerRow;
    for (let w = 0; w < this.wordsPerRow; w++) {
      let word = this.matrix[rowOffset + w]!;
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        res.push(w * 32 + bit);
        word &= word - 1; // clear lowest set bit
      }
    }
    return res;
  }
}

type GPUDevice = any;
type GPUAdapter = any;
type GPUComputePipeline = any;

const GPUBufferUsageFlags = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

const GPUMapModeFlags = {
  READ: 0x0001,
  WRITE: 0x0002,
};

export interface SHACLNumericConstraint {
  propertyIndex: number;
  attributeStride: number;
  minInclusive?: number | undefined;
  maxInclusive?: number | undefined;
  expectedClassId?: number | undefined;
}

export interface SHACLValidationResult {
  totalInstances: number;
  violationCount: number;
  violationIndices: Uint32Array;
  executionTimeMs: number;
  engine: "webgpu" | "cpu-fallback";
}

/**
 * WebGPU-Accelerated Ontology & Graph Co-Processor.
 * Executes parallel Boolean matrix transitive closures and parallel SHACL constraint
 * validations across 10^5 to 10^7 entities using WebGPU compute shaders.
 * Falls back seamlessly to optimized CPU bitset operations in headless / Node environments.
 */
export class WebGPUOntologyReasoner {
  private _device: GPUDevice | null = null;
  private _adapter: GPUAdapter | null = null;
  private _transitivePipeline: GPUComputePipeline | null = null;
  private _shaclPipeline: GPUComputePipeline | null = null;
  private _csrBfsPipeline: GPUComputePipeline | null = null;
  private _isInitialized = false;

  /**
   * Initializes the WebGPU compute device and compiles WGSL pipelines.
   * Returns true if hardware WebGPU is enabled, false if using CPU fallback.
   */
  public async init(): Promise<boolean> {
    if (this._isInitialized) return this._device !== null;

    if (typeof navigator !== "undefined" && (navigator as any).gpu) {
      try {
        const gpu = (navigator as any).gpu;
        this._adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (this._adapter) {
          this._device = await this._adapter.requestDevice();
          if (this._device) {
            this._compilePipelines();
          }
        }
      } catch (err) {
        console.warn("WebGPU initialization failed, falling back to CPU reasoner:", err);
      }
    }

    this._isInitialized = true;
    return this._device !== null;
  }

  public isGPUAvailable(): boolean {
    return this._device !== null;
  }

  public getEngineName(): string {
    return this._device ? "WebGPU Compute (WGSL)" : "CPU Bitset SIMD Engine";
  }

  private _compilePipelines(): void {
    if (!this._device) return;

    const tcModule = this._device.createShaderModule({ code: TRANSITIVE_CLOSURE_WGSL });
    this._transitivePipeline = this._device.createComputePipeline({
      layout: "auto",
      compute: { module: tcModule, entryPoint: "transitiveClosureStep" },
    });

    const shaclModule = this._device.createShaderModule({ code: SHACL_VALIDATION_WGSL });
    this._shaclPipeline = this._device.createComputePipeline({
      layout: "auto",
      compute: { module: shaclModule, entryPoint: "validateConstraints" },
    });

    const csrModule = this._device.createShaderModule({ code: CSR_BFS_FRONTIER_WGSL });
    this._csrBfsPipeline = this._device.createComputePipeline({
      layout: "auto",
      compute: { module: csrModule, entryPoint: "csrFrontierStep" },
    });
  }

  /**
   * Computes single-source or multi-source sparse property-path reachability (`p+` / `p*`)
   * over a `SparseCsrGraph` in O(N + E) memory.
   * Uses `CSR_BFS_FRONTIER_WGSL` on WebGPU devices and a zero-allocation typed-array BFS on CPU.
   */
  public async computeSparseReachability(
    graph: SparseCsrGraph,
    sources: readonly number[],
    options: { reflexive?: boolean | undefined; maxHops?: number | undefined } = {},
  ): Promise<SparseReachabilityResult> {
    const t0 = performance.now();
    const n = graph.nodeCount;
    const reflexive = options.reflexive ?? false;
    const maxHops = options.maxHops ?? n;

    if (this._device && this._csrBfsPipeline && n > 0) {
      return this._computeSparseReachabilityWebGPU(graph, sources, reflexive, maxHops, t0);
    }

    // Zero-allocation typed-array frontier BFS (CPU fallback)
    const distances = new Int32Array(n);
    distances.fill(-1);
    const queue = new Uint32Array(n);
    let head = 0;
    let tail = 0;

    // Seed initial frontier
    const inQueue = new Uint8Array(n);
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i]!;
      if (s < 0 || s >= n) continue;
      if (reflexive) {
        if (distances[s] === -1) {
          distances[s] = 0;
          queue[tail++] = s;
          inQueue[s] = 1;
        }
      } else {
        if (inQueue[s] === 0) {
          inQueue[s] = 1;
          queue[tail++] = s;
        }
      }
    }

    const rowOffsets = graph.rowOffsets;
    const colIndices = graph.colIndices;
    let hops = 0;
    let levelEnd = tail;
    let currentDepth = 0;

    while (head < tail && currentDepth < maxHops) {
      const u = queue[head++]!;
      const start = rowOffsets[u]!;
      const end = rowOffsets[u + 1]!;
      const nextDist = currentDepth + 1;

      for (let e = start; e < end; e++) {
        const v = colIndices[e]!;
        if (distances[v] === -1) {
          distances[v] = nextDist;
          if (inQueue[v] === 0) {
            inQueue[v] = 1;
            queue[tail++] = v;
          }
        }
      }

      if (head === levelEnd) {
        currentDepth++;
        hops = currentDepth;
        levelEnd = tail;
      }
    }

    // Collect all reachable nodes (distances[i] >= 0)
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (distances[i]! >= 0) count++;
    }
    const reachable = new Uint32Array(count);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      if (distances[i]! >= 0) reachable[idx++] = i;
    }

    return {
      reachable,
      distances,
      hops,
      executionTimeMs: performance.now() - t0,
      engine: "cpu-fallback",
    };
  }

  private async _computeSparseReachabilityWebGPU(
    graph: SparseCsrGraph,
    sources: readonly number[],
    reflexive: boolean,
    maxHops: number,
    t0: number,
  ): Promise<SparseReachabilityResult> {
    const device = this._device!;
    const n = graph.nodeCount;
    const wordCount = Math.ceil(n / 32) || 1;
    const bitsetBytes = wordCount * 4;

    const initFrontier = new Uint32Array(wordCount);
    const initVisited = new Uint32Array(wordCount);
    for (const s of sources) {
      if (s >= 0 && s < n) {
        initFrontier[s >> 5]! |= 1 << (s & 31);
        if (reflexive) initVisited[s >> 5]! |= 1 << (s & 31);
      }
    }

    const paramsBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsageFlags.UNIFORM | GPUBufferUsageFlags.COPY_DST,
    });
    device.queue.writeBuffer(paramsBuf, 0, new Uint32Array([n, wordCount, 0, 0]));

    const rowBuf = device.createBuffer({
      size: Math.max(4, graph.rowOffsets.byteLength),
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
    });
    device.queue.writeBuffer(rowBuf, 0, graph.rowOffsets);

    const colBuf = device.createBuffer({
      size: Math.max(4, graph.colIndices.byteLength),
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
    });
    if (graph.colIndices.byteLength > 0) device.queue.writeBuffer(colBuf, 0, graph.colIndices);

    let currBuf = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    let nextBuf = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    const visitedBuf = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    const changedBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    const readFlagBuf = device.createBuffer({
      size: 4,
      usage: GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.MAP_READ,
    });
    const readVisitedBuf = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.MAP_READ,
    });

    device.queue.writeBuffer(currBuf, 0, initFrontier);
    device.queue.writeBuffer(visitedBuf, 0, initVisited);

    const workgroups = Math.ceil(n / 64);
    const zeroBitset = new Uint32Array(wordCount);
    const zeroFlag = new Uint32Array(1);
    let hops = 0;

    for (let step = 0; step < maxHops; step++) {
      device.queue.writeBuffer(nextBuf, 0, zeroBitset);
      device.queue.writeBuffer(changedBuf, 0, zeroFlag);

      const bindGroup = device.createBindGroup({
        layout: this._csrBfsPipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramsBuf } },
          { binding: 1, resource: { buffer: rowBuf } },
          { binding: 2, resource: { buffer: colBuf } },
          { binding: 3, resource: { buffer: currBuf } },
          { binding: 4, resource: { buffer: nextBuf } },
          { binding: 5, resource: { buffer: visitedBuf } },
          { binding: 6, resource: { buffer: changedBuf } },
        ],
      });

      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this._csrBfsPipeline!);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      enc.copyBufferToBuffer(changedBuf, 0, readFlagBuf, 0, 4);
      device.queue.submit([enc.finish()]);

      await readFlagBuf.mapAsync(GPUMapModeFlags.READ);
      const changed = new Uint32Array(readFlagBuf.getMappedRange())[0]!;
      readFlagBuf.unmap();

      if (changed === 0) break;
      hops++;
      const tmp = currBuf;
      currBuf = nextBuf;
      nextBuf = tmp;
    }

    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(visitedBuf, 0, readVisitedBuf, 0, bitsetBytes);
    device.queue.submit([enc.finish()]);
    await readVisitedBuf.mapAsync(GPUMapModeFlags.READ);
    const visWords = new Uint32Array(readVisitedBuf.getMappedRange().slice(0));
    readVisitedBuf.unmap();

    const reachableList: number[] = [];
    const distances = new Int32Array(n);
    distances.fill(-1);
    for (let w = 0; w < wordCount; w++) {
      let word = visWords[w]!;
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        const node = w * 32 + bit;
        if (node < n) {
          reachableList.push(node);
          distances[node] = 1;
        }
        word &= word - 1;
      }
    }

    paramsBuf.destroy();
    rowBuf.destroy();
    colBuf.destroy();
    currBuf.destroy();
    nextBuf.destroy();
    visitedBuf.destroy();
    changedBuf.destroy();
    readFlagBuf.destroy();
    readVisitedBuf.destroy();

    return {
      reachable: new Uint32Array(reachableList),
      distances,
      hops,
      executionTimeMs: performance.now() - t0,
      engine: "webgpu",
    };
  }

  /**
   * Computes the reflexive-transitive closure of a directed graph.
   * If WebGPU is active, uses parallel WGSL doubling steps; otherwise uses CPU bitset matrix multiplication.
   */
  public async computeTransitiveClosure(
    nodeCount: number,
    edges: [number, number][],
    reflexive: boolean = true,
  ): Promise<BitsetGraph> {
    const _start = performance.now();
    void _start;
    const graph = new BitsetGraph(nodeCount);

    if (reflexive) {
      for (let i = 0; i < nodeCount; i++) {
        graph.addEdge(i, i);
      }
    }

    for (const [u, v] of edges) {
      graph.addEdge(u, v);
    }

    if (this._device && this._transitivePipeline) {
      await this._computeClosureWebGPU(graph);
    } else {
      this._computeClosureCPU(graph);
    }

    return graph;
  }

  /**
   * CPU Bitset Warshall / Doubling Algorithm for Transitive Closure.
   * Optimizes cache locality by word-wise bitwise OR across bitset rows.
   */
  private _computeClosureCPU(graph: BitsetGraph): void {
    const n = graph.nodeCount;
    const wpr = graph.wordsPerRow;
    const mat = graph.matrix;

    // Fast bitwise Warshall algorithm: for each k, if (i -> k), row[i] |= row[k]
    for (let k = 0; k < n; k++) {
      const kRow = k * wpr;
      const kWordOffset = k >> 5;
      const kBitMask = 1 << (k & 31);

      for (let i = 0; i < n; i++) {
        const iRow = i * wpr;
        if ((mat[iRow + kWordOffset]! & kBitMask) !== 0) {
          // Row i reaches k: OR row k into row i
          for (let w = 0; w < wpr; w++) {
            mat[iRow + w]! |= mat[kRow + w]!;
          }
        }
      }
    }
  }

  /**
   * WebGPU WGSL Dispatch for Transitive Closure.
   */
  private async _computeClosureWebGPU(graph: BitsetGraph): Promise<void> {
    const device = this._device!;
    const pipeline = this._transitivePipeline!;
    const n = graph.nodeCount;
    const wpr = graph.wordsPerRow;
    const totalBytes = graph.matrix.byteLength;

    // Create GPU buffers
    const uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsageFlags.UNIFORM | GPUBufferUsageFlags.COPY_DST,
    });
    const uniformData = new Uint32Array([n, wpr, 0, 0]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const flagBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_SRC | GPUBufferUsageFlags.COPY_DST,
    });

    const bufIn = device.createBuffer({
      size: totalBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    const bufOut = device.createBuffer({
      size: totalBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST | GPUBufferUsageFlags.COPY_SRC,
    });
    const readbackBuffer = device.createBuffer({
      size: totalBytes,
      usage: GPUBufferUsageFlags.MAP_READ | GPUBufferUsageFlags.COPY_DST,
    });

    try {
      device.queue.writeBuffer(bufIn, 0, graph.matrix);
      device.queue.writeBuffer(bufOut, 0, graph.matrix);

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: bufIn } },
          { binding: 2, resource: { buffer: bufOut } },
          { binding: 3, resource: { buffer: flagBuffer } },
        ],
      });

      const workgroups = Math.ceil(n / 64);
      const maxSteps = Math.ceil(Math.log2(Math.max(2, n))) + 1;

      for (let step = 0; step < maxSteps; step++) {
        const commandEncoder = device.createCommandEncoder();
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroups);
        pass.end();

        // Copy bufOut back to bufIn for next doubling iteration
        commandEncoder.copyBufferToBuffer(bufOut, 0, bufIn, 0, totalBytes);
        device.queue.submit([commandEncoder.finish()]);
      }

      // Read back final matrix
      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(bufOut, 0, readbackBuffer, 0, totalBytes);
      device.queue.submit([copyEncoder.finish()]);

      await readbackBuffer.mapAsync(GPUMapModeFlags.READ);
      const arrayBuffer = readbackBuffer.getMappedRange();
      graph.matrix.set(new Uint32Array(arrayBuffer));
      readbackBuffer.unmap();
    } finally {
      // Clean up GPU buffers
      uniformBuffer.destroy();
      flagBuffer.destroy();
      bufIn.destroy();
      bufOut.destroy();
      readbackBuffer.destroy();
    }
  }

  /**
   * Validates SHACL constraints across instance attributes in parallel.
   */
  public async validateSHACL(
    instances: Float32Array,
    constraint: SHACLNumericConstraint,
    instanceClasses?: Uint32Array,
  ): Promise<SHACLValidationResult> {
    const start = performance.now();
    const stride = constraint.attributeStride;
    const totalInstances = Math.floor(instances.length / stride);
    const violationWords = Math.ceil(totalInstances / 32) || 1;
    const violationBitset = new Uint32Array(violationWords);

    if (this._device && this._shaclPipeline && totalInstances > 0) {
      await this._validateSHACLWebGPU(instances, constraint, totalInstances, violationBitset, instanceClasses);
      const violations: number[] = [];
      for (let w = 0; w < violationWords; w++) {
        let word = violationBitset[w]!;
        while (word !== 0) {
          const bit = 31 - Math.clz32(word & -word);
          const idx = w * 32 + bit;
          if (idx < totalInstances) {
            violations.push(idx);
          }
          word &= word - 1;
        }
      }
      return {
        totalInstances,
        violationCount: violations.length,
        violationIndices: new Uint32Array(violations),
        executionTimeMs: performance.now() - start,
        engine: "webgpu",
      };
    }

    const min = constraint.minInclusive ?? -Infinity;
    const max = constraint.maxInclusive ?? Infinity;
    const checkClass = constraint.expectedClassId !== undefined;
    const expectedClass = constraint.expectedClassId ?? 0;

    // CPU execution (standard path or fallback)
    const violations: number[] = [];
    const propIdx = constraint.propertyIndex;

    for (let i = 0; i < totalInstances; i++) {
      const val = instances[i * stride + propIdx]!;
      let isViolation = val < min || val > max;

      if (!isViolation && checkClass && instanceClasses) {
        if (instanceClasses[i] !== expectedClass) {
          isViolation = true;
        }
      }

      if (isViolation) {
        violations.push(i);
        violationBitset[i >> 5]! |= 1 << (i & 31);
      }
    }

    return {
      totalInstances,
      violationCount: violations.length,
      violationIndices: new Uint32Array(violations),
      executionTimeMs: performance.now() - start,
      engine: "cpu-fallback",
    };
  }

  /**
   * WebGPU WGSL Dispatch for Parallel SHACL Constraint Validation.
   */
  private async _validateSHACLWebGPU(
    instances: Float32Array,
    constraint: SHACLNumericConstraint,
    totalInstances: number,
    violationBitset: Uint32Array,
    instanceClasses?: Uint32Array,
  ): Promise<void> {
    const device = this._device!;
    const pipeline = this._shaclPipeline!;

    const uniformData = new ArrayBuffer(32);
    const u32View = new Uint32Array(uniformData);
    const f32View = new Float32Array(uniformData);
    u32View[0] = totalInstances;
    u32View[1] = constraint.attributeStride;
    u32View[2] = constraint.propertyIndex;
    f32View[3] = constraint.minInclusive ?? -1e38;
    f32View[4] = constraint.maxInclusive ?? 1e38;
    u32View[5] = constraint.expectedClassId ?? 0;
    u32View[6] = constraint.expectedClassId !== undefined && instanceClasses ? 1 : 0;
    u32View[7] = 0;

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsageFlags.UNIFORM | GPUBufferUsageFlags.COPY_DST,
    });
    const attrBytes = Math.max(4, instances.byteLength);
    const attrBuffer = device.createBuffer({
      size: attrBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
    });
    const classesArray = instanceClasses ?? new Uint32Array(Math.max(1, totalInstances));
    const classBytes = Math.max(4, classesArray.byteLength);
    const classBuffer = device.createBuffer({
      size: classBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_DST,
    });
    const bitsetBytes = Math.max(4, violationBitset.byteLength);
    const bitsetBuffer = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.STORAGE | GPUBufferUsageFlags.COPY_SRC | GPUBufferUsageFlags.COPY_DST,
    });
    const readbackBuffer = device.createBuffer({
      size: bitsetBytes,
      usage: GPUBufferUsageFlags.MAP_READ | GPUBufferUsageFlags.COPY_DST,
    });

    try {
      device.queue.writeBuffer(uniformBuffer, 0, uniformData);
      device.queue.writeBuffer(attrBuffer, 0, instances);
      device.queue.writeBuffer(classBuffer, 0, classesArray);
      device.queue.writeBuffer(bitsetBuffer, 0, violationBitset);

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: attrBuffer } },
          { binding: 2, resource: { buffer: classBuffer } },
          { binding: 3, resource: { buffer: bitsetBuffer } },
        ],
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(totalInstances / 64));
      pass.end();

      encoder.copyBufferToBuffer(bitsetBuffer, 0, readbackBuffer, 0, violationBitset.byteLength);
      device.queue.submit([encoder.finish()]);

      await readbackBuffer.mapAsync(GPUMapModeFlags.READ);
      violationBitset.set(new Uint32Array(readbackBuffer.getMappedRange()));
      readbackBuffer.unmap();
    } finally {
      uniformBuffer.destroy();
      attrBuffer.destroy();
      classBuffer.destroy();
      bitsetBuffer.destroy();
      readbackBuffer.destroy();
    }
  }

  /**
   * Releases the WebGPU device and pipelines.
   */
  public destroy(): void {
    this._device?.destroy?.();
    this._device = null;
    this._adapter = null;
    this._transitivePipeline = null;
    this._shaclPipeline = null;
    this._isInitialized = false;
  }
}
