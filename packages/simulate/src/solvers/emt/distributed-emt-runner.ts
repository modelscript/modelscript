// SPDX-License-Identifier: AGPL-3.0-or-later

import { WasmEmtBridge, partitionEmtGraphWasm } from "./wasm-emt-bridge.js";

export interface DistributedEmtBranchSpec {
  fromNode: number;
  toNode: number;
  r: number;
  l: number;
  c: number;
}

export interface DistributedEmtSourceSpec {
  node: number;
  kind: 0 | 1; // 0 = DC, 1 = AC sine
  amplitude: number; // Peak voltage in Volts
  freqHz: number;
  phaseRad: number;
  rInternal: number;
}

export interface DistributedEmtBergeronLineSpec {
  id?: string | undefined;
  fromNode: number;
  toNode: number;
  zc: number;
  tauSec: number;
  rTotal?: number | undefined;
}

export interface DistributedEmtTransformerSpec {
  pPos: number;
  pNeg: number;
  sPos: number;
  sNeg: number;
  turnsRatio: number;
  rLeakage: number;
  lLeakage: number;
}

export interface DistributedEmtNetworkSpec {
  nNodes: number;
  dt: number;
  branches: DistributedEmtBranchSpec[];
  sources: DistributedEmtSourceSpec[];
  bergeronLines: DistributedEmtBergeronLineSpec[];
  transformers?: DistributedEmtTransformerSpec[] | undefined;
}

export interface CutBergeronLinkState {
  lineIndex: number;
  fromGlobalNode: number;
  toGlobalNode: number;
  fromPartition: number;
  fromLocalNode: number;
  fromBoundaryId: number;
  toPartition: number;
  toLocalNode: number;
  toBoundaryId: number;
  gc: number;
  eta: number;
  delaySteps: number;
  delayFrac: number;
  bufLen: number;
  bufIdx: number;
  /** SharedArrayBuffer-backed ring buffer for waves departing fromNode -> arriving at toNode */
  bufFrom: Float64Array;
  /** SharedArrayBuffer-backed ring buffer for waves departing toNode -> arriving at fromNode */
  bufTo: Float64Array;
}

export interface PartitionInstance {
  partitionId: number;
  globalNodes: number[];
  bridge: WasmEmtBridge;
}

export interface DistributedEmtPartitionSummary {
  partOfNode: Int32Array;
  cutEdgeCount: number;
  imbalanceRatio: number;
}

export interface SlurmDistributedEmtManifest {
  profileId: "emt-distributed-cluster";
  numPartitions: number;
  cutLineCount: number;
  imbalanceRatio: number;
  dtUs: number;
  sharedRingBufferBytes: number;
  partitions: Array<{
    partitionId: number;
    nodeCount: number;
    incidentCutLines: number[];
  }>;
}

function createSharedFloat64Buffer(length: number): Float64Array {
  const byteLength = length * Float64Array.BYTES_PER_ELEMENT;
  if (typeof SharedArrayBuffer !== "undefined") {
    return new Float64Array(new SharedArrayBuffer(byteLength));
  }
  return new Float64Array(new ArrayBuffer(byteLength));
}

/**
 * Multi-partition distributed electromagnetic transient (EMT) solver runner.
 *
 * Partitions an EMT network across `numPartitions` sub-networks by contracting all
 * zero-delay algebraic couplings ($\tau < \Delta t$) via the AssemblyScript
 * `emt_partition_network` kernel and cutting only across Bergeron distributed-parameter
 * transmission lines ($\tau \ge \Delta t$).
 *
 * Each partition runs its own independent `WasmEmtBridge` LU solver and exchanges
 * delayed traveling-wave history currents via `SharedArrayBuffer` ring buffers,
 * achieving exact mathematical equivalence with a monolithic single-domain solve.
 */
export class DistributedEmtRunner {
  public readonly spec: DistributedEmtNetworkSpec;
  public readonly numPartitions: number;
  public readonly partitionResult: DistributedEmtPartitionSummary;
  public readonly partitions: PartitionInstance[] = [];
  public readonly cutLinks: CutBergeronLinkState[] = [];

  private readonly nodeToPart: Int32Array;
  private readonly nodeToLocal: Int32Array;
  private readonly globalVoltages: Float64Array;

  constructor(spec: DistributedEmtNetworkSpec, requestedPartitions: number) {
    this.spec = spec;
    this.numPartitions = Math.max(1, Math.floor(requestedPartitions));
    this.globalVoltages = new Float64Array(spec.nNodes);

    // 1. Build zero-delay edges & delay lines for WASM partitioner
    const zeroDelayEdges: Array<{ from: number; to: number }> = [];
    for (const br of spec.branches) {
      if (br.fromNode >= 0 && br.toNode >= 0) {
        zeroDelayEdges.push({ from: br.fromNode, to: br.toNode });
      }
    }
    if (spec.transformers) {
      for (const xf of spec.transformers) {
        if (xf.pPos >= 0 && xf.pNeg >= 0) {
          zeroDelayEdges.push({ from: xf.pPos, to: xf.pNeg });
        }
        if (xf.sPos >= 0 && xf.sNeg >= 0) {
          zeroDelayEdges.push({ from: xf.sPos, to: xf.sNeg });
        }
        if (xf.pPos >= 0 && xf.sPos >= 0) {
          zeroDelayEdges.push({ from: xf.pPos, to: xf.sPos });
        }
      }
    }

    const delayLines: Array<{ from: number; to: number; tauSec: number }> = [];
    for (const line of spec.bergeronLines) {
      if (line.fromNode >= 0 && line.toNode >= 0) {
        delayLines.push({
          from: line.fromNode,
          to: line.toNode,
          tauSec: line.tauSec,
        });
      }
    }

    const rawPart = partitionEmtGraphWasm(spec.nNodes, zeroDelayEdges, delayLines, spec.dt, this.numPartitions);

    // 2. Group nodes by assigned partition and build local index mappings
    this.nodeToPart = new Int32Array(spec.nNodes);
    this.nodeToLocal = new Int32Array(spec.nNodes);
    const partNodes: number[][] = Array.from({ length: this.numPartitions }, () => []);

    for (let u = 0; u < spec.nNodes; u++) {
      const p = Math.max(0, Math.min(this.numPartitions - 1, rawPart.nodePartitions[u]!));
      this.nodeToPart[u] = p;
      this.nodeToLocal[u] = partNodes[p]!.length;
      partNodes[p]!.push(u);
    }

    let maxPartNodes = 0;
    for (let p = 0; p < this.numPartitions; p++) {
      if (partNodes[p]!.length > maxPartNodes) maxPartNodes = partNodes[p]!.length;
    }
    const avgPartNodes = spec.nNodes / this.numPartitions;
    const imbalanceRatio = avgPartNodes > 0 ? maxPartNodes / avgPartNodes : 1.0;

    this.partitionResult = {
      partOfNode: this.nodeToPart,
      cutEdgeCount: rawPart.cutLineCount,
      imbalanceRatio,
    };

    // Ensure every partition has at least 1 dummy node if empty so WasmEmtBridge is valid
    for (let p = 0; p < this.numPartitions; p++) {
      const gNodes = partNodes[p]!;
      const localCount = Math.max(1, gNodes.length);
      const bridge = new WasmEmtBridge(
        localCount,
        spec.dt,
        Math.max(16, spec.branches.length + 4),
        Math.max(8, spec.sources.length + 4),
      );
      this.partitions.push({
        partitionId: p,
        globalNodes: gNodes,
        bridge,
      });
    }

    const mapNode = (globalNode: number, targetPart: number): number => {
      if (globalNode < 0) return -1;
      if (this.nodeToPart[globalNode] !== targetPart) {
        throw new Error(
          `Zero-delay element crosses partition boundary between node ${globalNode} (part ${this.nodeToPart[globalNode]}) and part ${targetPart}`,
        );
      }
      return this.nodeToLocal[globalNode]!;
    };

    // 3. Populate internal RLC branches, sources, and transformers into their respective partitions
    for (const br of spec.branches) {
      const ownerPart =
        br.fromNode >= 0 ? this.nodeToPart[br.fromNode]! : br.toNode >= 0 ? this.nodeToPart[br.toNode]! : 0;
      const part = this.partitions[ownerPart]!;
      part.bridge.addBranch(mapNode(br.fromNode, ownerPart), mapNode(br.toNode, ownerPart), br.r, br.l, br.c);
    }

    for (const src of spec.sources) {
      if (src.node < 0) continue;
      const ownerPart = this.nodeToPart[src.node]!;
      const part = this.partitions[ownerPart]!;
      part.bridge.addSource({
        node: mapNode(src.node, ownerPart),
        isDc: src.kind === 0,
        vPeakKv: src.amplitude / 1000.0,
        freqHz: src.freqHz,
        phaseRad: src.phaseRad,
        gSource: 1.0 / Math.max(1e-6, src.rInternal),
      });
    }

    if (spec.transformers) {
      for (const xf of spec.transformers) {
        const refNode = xf.pPos >= 0 ? xf.pPos : xf.sPos >= 0 ? xf.sPos : xf.pNeg >= 0 ? xf.pNeg : xf.sNeg;
        const ownerPart = refNode >= 0 ? this.nodeToPart[refNode]! : 0;
        const part = this.partitions[ownerPart]!;
        const denom = xf.rLeakage + (2.0 * xf.lLeakage) / spec.dt;
        const gLeakage = denom > 0 ? 1.0 / denom : 1.0;
        const alphaL = denom > 0 ? ((2.0 * xf.lLeakage) / spec.dt - xf.rLeakage) / denom : 0.0;
        part.bridge.addTransformerWinding(
          mapNode(xf.pPos, ownerPart),
          mapNode(xf.pNeg, ownerPart),
          mapNode(xf.sPos, ownerPart),
          mapNode(xf.sNeg, ownerPart),
          gLeakage,
          alphaL,
          xf.turnsRatio,
        );
      }
    }

    // 4. Populate Bergeron lines:
    //    - Internal Bergeron lines (both endpoints in same partition) are added natively
    //    - Cross-partition Bergeron lines (endpoints in different partitions) are registered
    //      as SharedArrayBuffer-coupled traveling-wave ports
    for (let l = 0; l < spec.bergeronLines.length; l++) {
      const line = spec.bergeronLines[l]!;
      const pFrom = line.fromNode >= 0 ? this.nodeToPart[line.fromNode]! : 0;
      const pTo = line.toNode >= 0 ? this.nodeToPart[line.toNode]! : pFrom;

      if (pFrom === pTo || line.fromNode < 0 || line.toNode < 0) {
        const part = this.partitions[pFrom]!;
        part.bridge.addBergeronLine(
          mapNode(line.fromNode, pFrom),
          mapNode(line.toNode, pFrom),
          line.zc,
          line.tauSec,
          line.rTotal ?? 0,
        );
      } else {
        if (line.tauSec < spec.dt) {
          throw new Error(
            `Bergeron line ${l} has tauSec (${line.tauSec}s) < dt (${spec.dt}s) and cannot be cut across partitions`,
          );
        }
        const zc = line.zc > 1e-6 ? line.zc : 1e-6;
        const gc = 1.0 / zc;
        const rTotal = line.rTotal ?? 0;
        const ratio = rTotal / (4.0 * zc);
        const eta = Math.max(0.1, (1.0 - ratio) / (1.0 + ratio));

        const exactSteps = Math.max(1.0, line.tauSec / spec.dt);
        const delaySteps = Math.floor(exactSteps);
        const delayFrac = exactSteps - delaySteps;
        const bufLen = delaySteps + 2;

        const fromLocalNode = this.nodeToLocal[line.fromNode]!;
        const toLocalNode = this.nodeToLocal[line.toNode]!;

        // Register DC/instantaneous Norton port (freqHz = 0) with shunt conductance gc
        const fromBoundaryId = this.partitions[pFrom]!.bridge.registerHybridBoundary(fromLocalNode, -1, -1, gc, 0.0);
        const toBoundaryId = this.partitions[pTo]!.bridge.registerHybridBoundary(toLocalNode, -1, -1, gc, 0.0);

        this.cutLinks.push({
          lineIndex: l,
          fromGlobalNode: line.fromNode,
          toGlobalNode: line.toNode,
          fromPartition: pFrom,
          fromLocalNode,
          fromBoundaryId,
          toPartition: pTo,
          toLocalNode,
          toBoundaryId,
          gc,
          eta,
          delaySteps,
          delayFrac,
          bufLen,
          bufIdx: 0,
          bufFrom: createSharedFloat64Buffer(bufLen),
          bufTo: createSharedFloat64Buffer(bufLen),
        });
      }
    }

    // 5. Factorize each partition's nodal conductance matrix independently
    for (const part of this.partitions) {
      const ok = part.bridge.buildAndFactorize();
      if (!ok) {
        throw new Error(`Singular nodal conductance matrix in partition ${part.partitionId}`);
      }
    }
  }

  /**
   * Advances all distributed EMT partitions by one time step $\Delta t$,
   * exchanging delayed Bergeron traveling waves through `SharedArrayBuffer` ring buffers.
   */
  step(): Float64Array {
    // 1. Read arriving traveling waves from SharedArrayBuffer ring buffers for all cut lines
    const arrivingFromM = new Float64Array(this.cutLinks.length);
    const arrivingFromK = new Float64Array(this.cutLinks.length);

    for (let c = 0; c < this.cutLinks.length; c++) {
      const link = this.cutLinks[c]!;
      const readIdx1 = (link.bufIdx - link.delaySteps + link.bufLen) % link.bufLen;
      const readIdx2 = (readIdx1 - 1 + link.bufLen) % link.bufLen;

      const waveFromK = (1.0 - link.delayFrac) * link.bufFrom[readIdx1]! + link.delayFrac * link.bufFrom[readIdx2]!;
      const waveFromM = (1.0 - link.delayFrac) * link.bufTo[readIdx1]! + link.delayFrac * link.bufTo[readIdx2]!;

      arrivingFromK[c] = waveFromK;
      arrivingFromM[c] = waveFromM;

      // Inject instantaneous arriving wave into each partition's boundary port
      // With freqHz = 0 and angA = pi/2: iNortonA = wave * sin(0 * t + pi/2) = wave
      this.partitions[link.fromPartition]!.bridge.updateBoundaryNorton(
        link.fromBoundaryId,
        waveFromM,
        Math.PI / 2,
        0,
        0,
        0,
        0,
        0,
      );
      this.partitions[link.toPartition]!.bridge.updateBoundaryNorton(
        link.toBoundaryId,
        waveFromK,
        Math.PI / 2,
        0,
        0,
        0,
        0,
        0,
      );
    }

    // 2. Step each partition's WASM EMT kernel independently
    const localVoltageViews: Float64Array[] = new Array(this.partitions.length);
    for (let p = 0; p < this.partitions.length; p++) {
      const part = this.partitions[p]!;
      part.bridge.step();
      const vLocal = part.bridge.getVoltages();
      localVoltageViews[p] = vLocal;

      for (let localIdx = 0; localIdx < part.globalNodes.length; localIdx++) {
        const globalNode = part.globalNodes[localIdx]!;
        this.globalVoltages[globalNode] = vLocal[localIdx]!;
      }
    }

    // 3. Update outgoing Bergeron traveling waves in SharedArrayBuffer ring buffers
    for (let c = 0; c < this.cutLinks.length; c++) {
      const link = this.cutLinks[c]!;
      const vFrom = localVoltageViews[link.fromPartition]![link.fromLocalNode]!;
      const vTo = localVoltageViews[link.toPartition]![link.toLocalNode]!;

      link.bufFrom[link.bufIdx] = (2.0 * link.gc * vFrom - arrivingFromM[c]!) * link.eta;
      link.bufTo[link.bufIdx] = (2.0 * link.gc * vTo - arrivingFromK[c]!) * link.eta;
      link.bufIdx = (link.bufIdx + 1) % link.bufLen;
    }

    return this.globalVoltages;
  }

  /**
   * Runs `nSteps` steps and returns the final global voltage vector.
   */
  run(nSteps: number): Float64Array {
    for (let s = 0; s < nSteps; s++) {
      this.step();
    }
    return new Float64Array(this.globalVoltages);
  }

  /**
   * Returns a snapshot of the current global node voltages.
   */
  getGlobalNodeVoltages(): Float64Array {
    return new Float64Array(this.globalVoltages);
  }

  /**
   * Generates a Slurm HPC distributed cluster manifest for `emt-distributed-cluster`.
   */
  generateSlurmManifest(): SlurmDistributedEmtManifest {
    let sharedBytes = 0;
    for (const link of this.cutLinks) {
      sharedBytes += link.bufLen * 2 * Float64Array.BYTES_PER_ELEMENT;
    }

    return {
      profileId: "emt-distributed-cluster",
      numPartitions: this.numPartitions,
      cutLineCount: this.cutLinks.length,
      imbalanceRatio: this.partitionResult.imbalanceRatio,
      dtUs: this.spec.dt * 1e6,
      sharedRingBufferBytes: sharedBytes,
      partitions: this.partitions.map((part) => ({
        partitionId: part.partitionId,
        nodeCount: part.globalNodes.length,
        incidentCutLines: this.cutLinks
          .filter((l) => l.fromPartition === part.partitionId || l.toPartition === part.partitionId)
          .map((l) => l.lineIndex),
      })),
    };
  }

  dispose(): void {
    // WASM linear memory is arena-managed
  }
}
