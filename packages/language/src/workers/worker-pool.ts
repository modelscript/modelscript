/**
 * Parallel Background Worker Pool Coordinator for Workspace Indexing.
 * Partitions files across background thread workers and merges binary stub chunks in parallel.
 */

export interface IndexFileTask {
  uri: string;
  fileId: number;
  content: string;
}

export interface WorkerStubResult {
  fileId: number;
  symbolId: number;
  parentSymbolId: number;
  kind: number;
  flags: number;
  nameHash: number;
  nameHandle: number;
  startByte: number;
  endByte: number;
}

export interface IndexBatchResult {
  batchId: number;
  stubs: WorkerStubResult[];
  rawPayload?: Uint32Array;
}

export class LspWorkerPool {
  private concurrency: number;

  constructor(concurrency?: number) {
    this.concurrency = concurrency || 4;
  }

  get maxConcurrency(): number {
    return this.concurrency;
  }

  /**
   * Partitions tasks into balanced chunks for parallel execution.
   */
  partitionTasks(tasks: IndexFileTask[], batchSize: number = 50): IndexFileTask[][] {
    const batches: IndexFileTask[][] = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
      batches.push(tasks.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Executes batch indexing tasks in parallel across worker handlers.
   */
  async processBatches(
    batches: IndexFileTask[][],
    workerHandler: (batch: IndexFileTask[], batchId: number) => Promise<IndexBatchResult>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<IndexBatchResult[]> {
    const results: IndexBatchResult[] = [];
    let completed = 0;
    const total = batches.length;

    const queue = batches.map((batch, index) => ({ batch, index }));
    const running: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      if (queue.length === 0) return;
      const item = queue.shift()!;
      const result = await workerHandler(item.batch, item.index);
      results[item.index] = result;
      completed++;
      if (onProgress) onProgress(completed, total);
      if (queue.length > 0) {
        await runNext();
      }
    };

    const numWorkers = Math.min(this.concurrency, batches.length);
    for (let i = 0; i < numWorkers; i++) {
      running.push(runNext());
    }

    await Promise.all(running);
    return results;
  }
}
