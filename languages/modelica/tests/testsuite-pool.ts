// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

export interface TestCaseMetadata {
  name: string;
  keywords: string;
  status: "correct" | "incorrect" | "skipped";
  description: string;
  arrayMode?: "scalarize" | "preserve";
  fmiVersion?: "2.0" | "3.0";
  simulate?: boolean;
  xfail?: boolean | string;
}

export interface TestCase {
  file: string;
  metadata: TestCaseMetadata;
  source: string;
  expectedResult: string;
  expectedSimulationResult?: string;
}

export interface TestResult {
  name: string;
  file: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  cpuTime: number;
  message?: string;
  keywords?: string;
  testStatus?: string;
  xfail?: boolean | string;
}

export interface PoolOptions {
  concurrency: number;
  workerScript: string;
  cwd: string;
  testsuiteRoot: string;
  updateMode: boolean;
  omcMode?: boolean;
  timeoutMs?: number;
  maxTestsPerWorker?: number;
  maxWorkerRssBytes?: number;
}

interface QueuedTask {
  testCase: TestCase;
  resolve: (res: TestResult) => void;
}

interface ActiveTask {
  id: number;
  testCase: TestCase;
  startTime: number;
  timer: NodeJS.Timeout;
  resolve: (res: TestResult) => void;
}

class WorkerInstance {
  child: ChildProcess;
  activeTask: ActiveTask | null = null;
  testsProcessed = 0;
  stderr = "";
  isReady = false;
  isRetired = false;

  constructor(child: ChildProcess) {
    this.child = child;
  }
}

export class TestsuitePool {
  private options: Required<PoolOptions>;
  private workers: WorkerInstance[] = [];
  private idleWorkers: WorkerInstance[] = [];
  private queue: QueuedTask[] = [];
  private nextTaskId = 1;
  private isShuttingDown = false;

  constructor(options: PoolOptions) {
    this.options = {
      concurrency: Math.max(1, options.concurrency),
      workerScript: options.workerScript,
      cwd: options.cwd,
      testsuiteRoot: options.testsuiteRoot,
      updateMode: options.updateMode,
      omcMode: options.omcMode ?? false,
      timeoutMs: options.timeoutMs ?? 120_000,
      maxTestsPerWorker: options.maxTestsPerWorker ?? 15,
      maxWorkerRssBytes: options.maxWorkerRssBytes ?? 768 * 1024 * 1024,
    };

    for (let i = 0; i < this.options.concurrency; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    if (this.isShuttingDown) return;

    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--expose-gc", this.options.workerScript, "--persistent"],
      {
        cwd: this.options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_OPTIONS: "--max-old-space-size=1536",
        },
      },
    );

    const instance = new WorkerInstance(child);
    this.workers.push(instance);

    const rl = readline.createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      instance.stderr += chunk.toString("utf-8");
      // Keep only last 4000 characters of stderr buffer
      if (instance.stderr.length > 8000) {
        instance.stderr = instance.stderr.slice(-4000);
      }
    });

    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const msg = JSON.parse(trimmed);
        if (msg.type === "ready") {
          instance.isReady = true;
          this.onWorkerAvailable(instance);
        } else if (msg.type === "result" && instance.activeTask) {
          const task = instance.activeTask;
          instance.activeTask = null;
          clearTimeout(task.timer);

          const result: TestResult = msg.result;
          // Set duration from parent perspective (includes IPC roundtrip)
          result.duration = Date.now() - task.startTime;

          task.resolve(result);
          instance.testsProcessed++;

          const rss = typeof msg.rss === "number" ? msg.rss : 0;
          if (instance.testsProcessed >= this.options.maxTestsPerWorker || rss > this.options.maxWorkerRssBytes) {
            this.retireWorker(instance);
          } else {
            this.onWorkerAvailable(instance);
          }
        } else if (msg.type === "error" && instance.activeTask) {
          const task = instance.activeTask;
          instance.activeTask = null;
          clearTimeout(task.timer);

          task.resolve({
            name: path.basename(task.testCase.file),
            file: task.testCase.file,
            status: "failed",
            duration: Date.now() - task.startTime,
            cpuTime: 0,
            message: `Worker error: ${msg.error}\n${instance.stderr.slice(-2000)}`,
            keywords: task.testCase.metadata.keywords,
            testStatus: task.testCase.metadata.status,
            xfail: task.testCase.metadata.xfail,
          });

          this.retireWorker(instance);
        }
      } catch (err) {
        console.error("[TestsuitePool] Failed to parse worker message:", trimmed, err);
      }
    });

    child.on("close", (code) => {
      this.removeWorker(instance);

      if (instance.activeTask) {
        const task = instance.activeTask;
        instance.activeTask = null;
        clearTimeout(task.timer);

        task.resolve({
          name: path.basename(task.testCase.file),
          file: task.testCase.file,
          status: "failed",
          duration: Date.now() - task.startTime,
          cpuTime: 0,
          message: `Worker exited with code ${code}\n${instance.stderr.slice(-2000)}`,
          keywords: task.testCase.metadata.keywords,
          testStatus: task.testCase.metadata.status,
          xfail: task.testCase.metadata.xfail,
        });
      }

      // If not intentionally shutting down or retiring, spawn replacement
      if (!this.isShuttingDown && !instance.isRetired) {
        this.spawnWorker();
      }
    });
  }

  private onWorkerAvailable(worker: WorkerInstance): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.dispatchTask(worker, next);
    } else {
      if (!this.idleWorkers.includes(worker)) {
        this.idleWorkers.push(worker);
      }
    }
  }

  private dispatchTask(worker: WorkerInstance, task: QueuedTask): void {
    const taskId = this.nextTaskId++;
    const startTime = Date.now();
    worker.stderr = ""; // Reset stderr for new test

    const timer = setTimeout(() => {
      if (worker.activeTask && worker.activeTask.id === taskId) {
        const active = worker.activeTask;
        worker.activeTask = null;
        worker.child.kill("SIGKILL");

        active.resolve({
          name: path.basename(active.testCase.file),
          file: active.testCase.file,
          status: "failed",
          duration: Date.now() - active.startTime,
          cpuTime: 0,
          message: `Worker timed out after ${this.options.timeoutMs / 1000}s`,
          keywords: active.testCase.metadata.keywords,
          testStatus: active.testCase.metadata.status,
          xfail: active.testCase.metadata.xfail,
        });
      }
    }, this.options.timeoutMs);

    worker.activeTask = {
      id: taskId,
      testCase: task.testCase,
      startTime,
      timer,
      resolve: task.resolve,
    };

    const payload = JSON.stringify({
      type: "run",
      id: taskId,
      testCase: task.testCase,
      testsuiteRoot: this.options.testsuiteRoot,
      updateMode: this.options.updateMode,
      omcMode: this.options.omcMode,
    });

    worker.child.stdin!.write(payload + "\n");
  }

  private retireWorker(worker: WorkerInstance): void {
    worker.isRetired = true;
    try {
      worker.child.stdin!.write(JSON.stringify({ type: "shutdown" }) + "\n");
      worker.child.stdin!.end();
    } catch {
      // ignore
    }

    const forceKillTimer = setTimeout(() => {
      try {
        worker.child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 2000);

    worker.child.once("close", () => {
      clearTimeout(forceKillTimer);
    });

    this.removeWorker(worker);
    if (!this.isShuttingDown) {
      this.spawnWorker();
    }
  }

  private removeWorker(worker: WorkerInstance): void {
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    const idleIdx = this.idleWorkers.indexOf(worker);
    if (idleIdx >= 0) this.idleWorkers.splice(idleIdx, 1);
  }

  public runTest(testCase: TestCase): Promise<TestResult> {
    return new Promise<TestResult>((resolve) => {
      const task: QueuedTask = { testCase, resolve };
      const idleWorker = this.idleWorkers.shift();
      if (idleWorker) {
        this.dispatchTask(idleWorker, task);
      } else {
        this.queue.push(task);
      }
    });
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const promises: Promise<void>[] = [];

    for (const worker of [...this.workers]) {
      promises.push(
        new Promise<void>((resolve) => {
          if (worker.activeTask) {
            clearTimeout(worker.activeTask.timer);
          }
          try {
            worker.child.stdin?.write(JSON.stringify({ type: "shutdown" }) + "\n");
            worker.child.stdin?.end();
          } catch {
            // ignore
          }

          const forceKillTimer = setTimeout(() => {
            try {
              worker.child.kill("SIGKILL");
            } catch {
              // ignore
            }
            resolve();
          }, 500);

          worker.child.once("close", () => {
            clearTimeout(forceKillTimer);
            resolve();
          });
        }),
      );
    }

    await Promise.all(promises);
    this.workers = [];
    this.idleWorkers = [];
  }
}
