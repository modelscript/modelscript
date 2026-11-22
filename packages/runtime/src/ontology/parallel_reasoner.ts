// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WasmOntologyReasoner,
  type ConsistencyResult,
  type OWL2Axiom,
  type OWL2ClassDeclaration,
  type TaxonomyNode,
} from "./wasm_ontology.js";

/**
 * A decoupled ontology partition or modular component (e.g. subsystem, physical domain, or file).
 */
export interface OntologyModule {
  readonly name: string;
  readonly axioms: readonly OWL2Axiom[];
}

/**
 * Result of classifying an individual ontology module.
 */
export interface ModuleClassificationResult {
  readonly moduleName: string;
  readonly consistency: ConsistencyResult;
  readonly taxonomy: readonly TaxonomyNode[];
  readonly axiomCount: number;
  readonly executionTimeMs: number;
}

/**
 * High-performance parallel reasoner coordinator.
 * Partitions and executes reasoning workloads concurrently across decoupled modules
 * or sub-assemblies to maximize throughput on modern multi-core systems.
 */
export class ParallelOntologyReasoner {
  private concurrency: number;
  private useWorkers: boolean;

  constructor(options?: { concurrency?: number | undefined; useWorkers?: boolean | undefined }) {
    this.concurrency = options?.concurrency ?? 4;
    this.useWorkers = options?.useWorkers ?? false;
  }

  /**
   * Classify a single ontology module asynchronously (optionally offloaded to a Node worker thread).
   */
  async classifyModule(module: OntologyModule): Promise<ModuleClassificationResult> {
    if (this.useWorkers && typeof process !== "undefined" && process.versions?.node) {
      try {
        const { Worker } = await import("node:worker_threads");
        const moduleUrl = new URL("./wasm_ontology.js", import.meta.url).href;
        const workerCode = `
          import { parentPort, workerData } from "node:worker_threads";
          import { WasmOntologyReasoner } from ${JSON.stringify(moduleUrl)};
          const start = performance.now();
          const reasoner = new WasmOntologyReasoner();
          await reasoner.init();
          reasoner.loadOntology(workerData.axioms);
          reasoner.classify();
          parentPort.postMessage({
            moduleName: workerData.name,
            consistency: reasoner.checkConsistency(),
            taxonomy: reasoner.getTaxonomy(),
            axiomCount: workerData.axioms.length,
            executionTimeMs: performance.now() - start,
          });
        `;
        return await new Promise<ModuleClassificationResult>((resolve, reject) => {
          const worker = new Worker(workerCode, { eval: true, workerData: module });
          worker.once("message", (res: ModuleClassificationResult) => {
            void worker.terminate();
            resolve(res);
          });
          worker.once("error", (err) => {
            void worker.terminate();
            reject(err);
          });
        });
      } catch {
        // Fall through to in-process execution when worker_threads or ESM eval is unavailable
      }
    }

    const start = performance.now();
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();
    reasoner.loadOntology(module.axioms);
    reasoner.classify();

    const consistency = reasoner.checkConsistency();
    const taxonomy = reasoner.getTaxonomy();

    return {
      moduleName: module.name,
      consistency,
      taxonomy,
      axiomCount: module.axioms.length,
      executionTimeMs: performance.now() - start,
    };
  }

  /**
   * Concurrently classify an array of independent ontology modules with bounded concurrency.
   */
  async classifyAll(modules: readonly OntologyModule[]): Promise<Map<string, ModuleClassificationResult>> {
    const results = new Map<string, ModuleClassificationResult>();

    for (let i = 0; i < modules.length; i += this.concurrency) {
      const batch = modules.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(batch.map((m) => this.classifyModule(m)));
      for (const res of batchResults) {
        results.set(res.moduleName, res);
      }
    }

    return results;
  }

  /**
   * Aggregate individual module classification outcomes into a unified consistency report.
   */
  mergeResults(results: Map<string, ModuleClassificationResult>): {
    isConsistent: boolean;
    totalAxioms: number;
    totalTaxonomyNodes: number;
    inconsistentModules: string[];
  } {
    let isConsistent = true;
    let totalAxioms = 0;
    let totalTaxonomyNodes = 0;
    const inconsistentModules: string[] = [];

    for (const [name, res] of results) {
      totalAxioms += res.axiomCount;
      totalTaxonomyNodes += res.taxonomy.length;
      if (!res.consistency.isConsistent) {
        isConsistent = false;
        inconsistentModules.push(name);
      }
    }

    return {
      isConsistent,
      totalAxioms,
      totalTaxonomyNodes,
      inconsistentModules,
    };
  }

  /**
   * Automatically partition a monolithic ontology into decoupled modules using syntactic bot-locality.
   */
  static partitionByLocality(axioms: readonly OWL2Axiom[], targetPartitions = 3): OntologyModule[] {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(axioms);

    const declaredClasses = axioms
      .filter((a): a is OWL2ClassDeclaration => a.type === "ClassDeclaration")
      .map((a) => a.iri);

    if (declaredClasses.length === 0) {
      return [{ name: "Partition_1", axioms }];
    }

    const partitionCount = Math.min(targetPartitions, declaredClasses.length);
    const seedsPerPartition = Math.ceil(declaredClasses.length / partitionCount);
    const modules: OntologyModule[] = [];

    for (let p = 0; p < partitionCount; p++) {
      const seedSubset = new Set<string>(declaredClasses.slice(p * seedsPerPartition, (p + 1) * seedsPerPartition));
      if (seedSubset.size === 0) continue;
      const moduleAxioms = reasoner.extractBotLocalityModule(seedSubset);
      modules.push({
        name: `LocalityModule_${p + 1}`,
        axioms: moduleAxioms,
      });
    }

    return modules;
  }
}

/**
 * Result of lock-free `SharedArrayBuffer` parallel EL++ subclass saturation.
 */
export interface SharedELSaturationResult {
  readonly classCount: number;
  readonly inferredEdgeCount: number;
  readonly workerCount: number;
  readonly usedSharedMemory: boolean;
  readonly executionTimeMs: number;
  isSubClassOf(subIri: string, supIri: string): boolean;
  getSuperClasses(classIri: string): string[];
}

/**
 * Lock-free `SharedArrayBuffer` parallel EL++ taxonomy saturation engine (ELK / RDFox style).
 *
 * Uses a single `SharedArrayBuffer` holding:
 *   1. CSR adjacency (`rowOffsets`, `colIndices`) of direct `SubClassOf` / `EquivalentClasses` edges
 *   2. An `N x ceil(N/32)` shared reachability bitset updated lock-free via `Atomics.or`
 *   3. A lock-free atomic work-stealing cursor (`Atomics.add`) distributing class chunks across workers
 *      with zero IPC serialization overhead.
 */
export class SharedMemoryELReasoner {
  private workerCount: number;

  constructor(options?: { workerCount?: number | undefined }) {
    this.workerCount = Math.max(1, options?.workerCount ?? 4);
  }

  public async saturateParallel(axioms: readonly OWL2Axiom[]): Promise<SharedELSaturationResult> {
    const t0 = performance.now();

    // 1. Intern all named classes into dense 0..N-1 IDs
    const iriToId = new Map<string, number>();
    const idToIri: string[] = [];
    const intern = (iri: string): number => {
      let id = iriToId.get(iri);
      if (id === undefined) {
        id = idToIri.length;
        iriToId.set(iri, id);
        idToIri.push(iri);
      }
      return id;
    };

    const rawEdges: Array<[number, number]> = [];
    for (let i = 0; i < axioms.length; i++) {
      const ax = axioms[i]!;
      if (ax.type === "ClassDeclaration") {
        intern(ax.iri);
      } else if (ax.type === "SubClassOf") {
        rawEdges.push([intern(ax.subClassIri), intern(ax.superClassIri)]);
      } else if (ax.type === "EquivalentClasses") {
        for (let a = 0; a < ax.classIris.length; a++) {
          const u = intern(ax.classIris[a]!);
          for (let b = 0; b < ax.classIris.length; b++) {
            if (a !== b) rawEdges.push([u, intern(ax.classIris[b]!)]);
          }
        }
      }
    }

    const n = idToIri.length;
    const wordsPerRow = Math.ceil(n / 32) || 1;

    if (n === 0) {
      return {
        classCount: 0,
        inferredEdgeCount: 0,
        workerCount: 1,
        usedSharedMemory: typeof SharedArrayBuffer !== "undefined",
        executionTimeMs: performance.now() - t0,
        isSubClassOf: (s, p) => s === p,
        getSuperClasses: () => [],
      };
    }

    // 2. Allocate SharedArrayBuffer (or fallback ArrayBuffer if SAB unavailable)
    const hasSab = typeof SharedArrayBuffer !== "undefined";
    const BufferCtor = hasSab ? SharedArrayBuffer : ArrayBuffer;

    const ctrlBytes = 16; // [0]: atomic work-stealing cursor
    const rowOffBytes = (n + 1) * 4;
    const colIdxBytes = Math.max(1, rawEdges.length) * 4;
    const bitsetBytes = n * wordsPerRow * 4;

    const ctrlSab = new BufferCtor(ctrlBytes);
    const rowSab = new BufferCtor(rowOffBytes);
    const colSab = new BufferCtor(colIdxBytes);
    const bitsetSab = new BufferCtor(bitsetBytes);

    const ctrl = new Int32Array(ctrlSab);
    const rowOffsets = new Int32Array(rowSab);
    const colIndices = new Int32Array(colSab);
    const bitset = new Int32Array(bitsetSab);

    // Build CSR in shared memory
    for (let i = 0; i < rawEdges.length; i++) {
      rowOffsets[rawEdges[i]![0] + 1]!++;
    }
    for (let i = 0; i < n; i++) {
      rowOffsets[i + 1] = rowOffsets[i + 1]! + rowOffsets[i]!;
    }
    const cursor = new Int32Array(rowOffsets);
    for (let i = 0; i < rawEdges.length; i++) {
      const [u, v] = rawEdges[i]!;
      colIndices[cursor[u]!] = v;
      cursor[u] = cursor[u]! + 1;
    }

    const chunkSize = Math.max(1, Math.min(64, Math.ceil(n / (this.workerCount * 4))));
    let usedWorkers = 1;

    // 3. Execute lock-free work-stealing saturation across Node worker_threads sharing the SAB
    if (hasSab && this.workerCount > 1 && n >= 16 && typeof process !== "undefined" && process.versions?.node) {
      try {
        const { Worker } = await import("node:worker_threads");
        const numWorkers = Math.min(this.workerCount, Math.ceil(n / chunkSize));
        usedWorkers = numWorkers;

        const workerScript = `
          const { workerData, parentPort } = require("node:worker_threads");
          const { n, wordsPerRow, chunkSize, ctrlSab, rowSab, colSab, bitsetSab } = workerData;
          const ctrl = new Int32Array(ctrlSab);
          const rowOffsets = new Int32Array(rowSab);
          const colIndices = new Int32Array(colSab);
          const bitset = new Int32Array(bitsetSab);
          const queue = new Int32Array(n);

          while (true) {
            const start = Atomics.add(ctrl, 0, chunkSize);
            if (start >= n) break;
            const end = Math.min(n, start + chunkSize);

            for (let src = start; src < end; src++) {
              const rowBase = src * wordsPerRow;
              // Reflexive self bit
              Atomics.or(bitset, rowBase + (src >> 5), 1 << (src & 31));
              let head = 0;
              let tail = 0;
              queue[tail++] = src;

              while (head < tail) {
                const u = queue[head++];
                const eStart = rowOffsets[u];
                const eEnd = rowOffsets[u + 1];
                for (let e = eStart; e < eEnd; e++) {
                  const v = colIndices[e];
                  const wIdx = rowBase + (v >> 5);
                  const mask = 1 << (v & 31);
                  const prev = Atomics.or(bitset, wIdx, mask);
                  if ((prev & mask) === 0) {
                    queue[tail++] = v;
                  }
                }
              }
            }
          }
          parentPort.postMessage(1);
        `;

        await Promise.all(
          Array.from({ length: numWorkers }, () => {
            return new Promise<void>((resolve, reject) => {
              const w = new Worker(workerScript, {
                eval: true,
                workerData: { n, wordsPerRow, chunkSize, ctrlSab, rowSab, colSab, bitsetSab },
              });
              w.once("message", () => {
                void w.terminate();
                resolve();
              });
              w.once("error", (err) => {
                void w.terminate();
                reject(err);
              });
            });
          }),
        );
      } catch {
        // Fall through to in-process shared-buffer saturation
        usedWorkers = 1;
        ctrl[0] = 0;
      }
    }

    // In-process fallback (or single-worker mode)
    if (usedWorkers === 1 && ctrl[0]! < n) {
      const queue = new Int32Array(n);
      for (let src = 0; src < n; src++) {
        const rowBase = src * wordsPerRow;
        bitset[rowBase + (src >> 5)]! |= 1 << (src & 31);
        let head = 0;
        let tail = 0;
        queue[tail++] = src;
        while (head < tail) {
          const u = queue[head++]!;
          const eStart = rowOffsets[u]!;
          const eEnd = rowOffsets[u + 1]!;
          for (let e = eStart; e < eEnd; e++) {
            const v = colIndices[e]!;
            const wIdx = rowBase + (v >> 5);
            const mask = 1 << (v & 31);
            if ((bitset[wIdx]! & mask) === 0) {
              bitset[wIdx]! |= mask;
              queue[tail++] = v;
            }
          }
        }
      }
    }

    // Count total inferred subsumption pairs (excluding reflexive self-edges)
    let inferredEdgeCount = 0;
    for (let i = 0; i < n; i++) {
      const rowBase = i * wordsPerRow;
      for (let w = 0; w < wordsPerRow; w++) {
        let word = bitset[rowBase + w]! >>> 0;
        while (word !== 0) {
          word &= word - 1;
          inferredEdgeCount++;
        }
      }
    }
    inferredEdgeCount = Math.max(0, inferredEdgeCount - n);

    return {
      classCount: n,
      inferredEdgeCount,
      workerCount: usedWorkers,
      usedSharedMemory: hasSab,
      executionTimeMs: performance.now() - t0,
      isSubClassOf(subIri: string, supIri: string): boolean {
        if (subIri === supIri) return true;
        const sId = iriToId.get(subIri);
        const pId = iriToId.get(supIri);
        if (sId === undefined || pId === undefined) return false;
        const word = bitset[sId * wordsPerRow + (pId >> 5)]!;
        return (word & (1 << (pId & 31))) !== 0;
      },
      getSuperClasses(classIri: string): string[] {
        const sId = iriToId.get(classIri);
        if (sId === undefined) return [];
        const out: string[] = [];
        const rowBase = sId * wordsPerRow;
        for (let w = 0; w < wordsPerRow; w++) {
          let word = bitset[rowBase + w]! >>> 0;
          while (word !== 0) {
            const bit = 31 - Math.clz32(word & -word);
            const targetId = w * 32 + bit;
            if (targetId < n && targetId !== sId) {
              out.push(idToIri[targetId]!);
            }
            word &= word - 1;
          }
        }
        return out;
      },
    };
  }
}
