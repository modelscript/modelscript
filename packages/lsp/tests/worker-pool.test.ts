import { IndexFileTask, LspWorkerPool } from "../src/workers/worker-pool.js";

describe("LspWorkerPool Unit & Regression Tests", () => {
  const createTasks = (count: number): IndexFileTask[] => {
    return Array.from({ length: count }, (_, i) => ({
      uri: `file:///workspace/Model_${i + 1}.mo`,
      fileId: i + 1,
      content: `model Model_${i + 1} end;`,
    }));
  };

  describe("partitionTasks", () => {
    test("partitions tasks into chunks of specified size", () => {
      const pool = new LspWorkerPool(4);
      const tasks = createTasks(10);
      const batches = pool.partitionTasks(tasks, 3);

      expect(batches.length).toBe(4);
      expect(batches[0].length).toBe(3);
      expect(batches[1].length).toBe(3);
      expect(batches[2].length).toBe(3);
      expect(batches[3].length).toBe(1);
    });

    test("defaults batch size to 50 when omitted", () => {
      const pool = new LspWorkerPool();
      const tasks = createTasks(105);
      const batches = pool.partitionTasks(tasks);

      expect(batches.length).toBe(3);
      expect(batches[0].length).toBe(50);
      expect(batches[1].length).toBe(50);
      expect(batches[2].length).toBe(5);
    });

    test("handles empty task list", () => {
      const pool = new LspWorkerPool();
      const batches = pool.partitionTasks([]);
      expect(batches).toEqual([]);
    });

    test("prevents infinite loop when batchSize is 0, negative, or NaN", () => {
      const pool = new LspWorkerPool();
      const tasks = createTasks(5);

      // batchSize: 0 should not loop infinitely and clamp to minimum 1
      const batchesZero = pool.partitionTasks(tasks, 0);
      expect(batchesZero.length).toBe(5);
      expect(batchesZero.every((b) => b.length === 1)).toBe(true);

      // batchSize: negative should clamp to minimum 1
      const batchesNeg = pool.partitionTasks(tasks, -10);
      expect(batchesNeg.length).toBe(5);

      // batchSize: NaN should fall back safely to default 50
      const batchesNaN = pool.partitionTasks(tasks, NaN);
      expect(batchesNaN.length).toBe(1);
    });

    test("handles floating point batch sizes safely", () => {
      const pool = new LspWorkerPool();
      const tasks = createTasks(10);
      const batches = pool.partitionTasks(tasks, 3.8);

      expect(batches.length).toBe(4);
      expect(batches[0].length).toBe(3);
    });
  });

  describe("concurrency sanitization", () => {
    test("defaults concurrency to 4 when omitted or NaN", () => {
      const pool = new LspWorkerPool();
      expect(pool.maxConcurrency).toBe(4);

      const poolNaN = new LspWorkerPool(NaN);
      expect(poolNaN.maxConcurrency).toBe(4);
    });

    test("sanitizes 0 or negative concurrency to at least 1 without dropping tasks", async () => {
      const poolZero = new LspWorkerPool(0);
      expect(poolZero.maxConcurrency).toBe(1);

      const poolNeg = new LspWorkerPool(-5);
      expect(poolNeg.maxConcurrency).toBe(1);

      const tasks = createTasks(6);
      const batches = poolNeg.partitionTasks(tasks, 2);
      const results = await poolNeg.processBatches(batches, async (batch, batchId) => {
        return { batchId, stubs: [] };
      });

      expect(results.length).toBe(3);
      expect(results[0].batchId).toBe(0);
      expect(results[1].batchId).toBe(1);
      expect(results[2].batchId).toBe(2);
    });
  });

  describe("processBatches execution & ordering", () => {
    test("preserves batch result order when workers complete out of order", async () => {
      const pool = new LspWorkerPool(4);
      const tasks = createTasks(8);
      const batches = pool.partitionTasks(tasks, 2);
      expect(batches.length).toBe(4);

      // Delays: batch 0 is slowest (40ms), batch 3 is fastest (5ms)
      const delays = [40, 30, 20, 5];

      const results = await pool.processBatches(batches, async (batch, batchId) => {
        await new Promise((resolve) => setTimeout(resolve, delays[batchId]));
        return {
          batchId,
          stubs: batch.map((item) => ({
            fileId: item.fileId,
            symbolId: item.fileId * 10,
            parentSymbolId: 0,
            kind: 1,
            flags: 0,
            nameHash: item.fileId * 100,
            startByte: 0,
            endByte: item.content.length,
          })),
        };
      });

      expect(results.length).toBe(4);
      expect(results[0].batchId).toBe(0);
      expect(results[1].batchId).toBe(1);
      expect(results[2].batchId).toBe(2);
      expect(results[3].batchId).toBe(3);

      expect(results[0].stubs[0].fileId).toBe(1);
      expect(results[3].stubs[1].fileId).toBe(8);
    });

    test("handles empty batches array", async () => {
      const pool = new LspWorkerPool(4);
      let progressReported = false;

      const results = await pool.processBatches(
        [],
        async () => {
          throw new Error("Should not be called");
        },
        (completed, total) => {
          progressReported = true;
          expect(completed).toBe(0);
          expect(total).toBe(0);
        },
      );

      expect(results).toEqual([]);
      expect(progressReported).toBe(true);
    });

    test("correctly tracks progress across batches", async () => {
      const pool = new LspWorkerPool(2);
      const tasks = createTasks(20);
      const batches = pool.partitionTasks(tasks, 5);
      expect(batches.length).toBe(4);

      const progressEvents: { completed: number; total: number }[] = [];

      await pool.processBatches(
        batches,
        async (batch, batchId) => {
          return { batchId, stubs: [] };
        },
        (completed, total) => {
          progressEvents.push({ completed, total });
        },
      );

      expect(progressEvents.length).toBe(4);
      expect(progressEvents[progressEvents.length - 1]).toEqual({ completed: 4, total: 4 });
    });

    test("does not crash if onProgress callback throws an error", async () => {
      const pool = new LspWorkerPool(2);
      const tasks = createTasks(6);
      const batches = pool.partitionTasks(tasks, 2);

      const results = await pool.processBatches(
        batches,
        async (batch, batchId) => {
          return { batchId, stubs: [] };
        },
        () => {
          throw new Error("Progress callback error");
        },
      );

      expect(results.length).toBe(3);
    });

    test("propagates workerHandler errors", async () => {
      const pool = new LspWorkerPool(2);
      const tasks = createTasks(6);
      const batches = pool.partitionTasks(tasks, 2);

      await expect(
        pool.processBatches(batches, async (_batch, batchId) => {
          if (batchId === 1) {
            throw new Error("Worker failed on batch 1");
          }
          return { batchId, stubs: [] };
        }),
      ).rejects.toThrow("Worker failed on batch 1");
    });

    test("handles large volume of batches efficiently", async () => {
      const pool = new LspWorkerPool(8);
      const tasks = createTasks(500);
      const batches = pool.partitionTasks(tasks, 10);
      expect(batches.length).toBe(50);

      const results = await pool.processBatches(batches, async (batch, batchId) => {
        return {
          batchId,
          stubs: batch.map((b) => ({
            fileId: b.fileId,
            symbolId: b.fileId,
            parentSymbolId: 0,
            kind: 1,
            flags: 0,
            nameHash: b.fileId,
            startByte: 0,
            endByte: 10,
          })),
        };
      });

      expect(results.length).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(results[i].batchId).toBe(i);
        expect(results[i].stubs.length).toBe(10);
      }
    });
  });
});
