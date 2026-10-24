// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder } from "../dae/wasm_dae.js";
import type { DAEPass, PassContext, PassResult, PassRunSummary } from "./pass.js";

/**
 * Manages an ordered sequence of transformation and analysis passes over a `DAEBuilder`.
 *
 * Allows inserting, reordering, removing, or benchmarking individual compiler passes.
 */
export class DAEPassManager {
  private passes: DAEPass[] = [];

  /**
   * Creates a default compilation context.
   */
  static createDefaultContext(): PassContext {
    return {
      stateVars: new Set<number>(),
      derivativeVars: new Set<number>(),
      dummyDerivatives: new Set<number>(),
      parameterVars: new Set<number>(),
      parameters: new Map<string, number>(),
      eliminatedDerVars: new Set<number>(),
      sharedData: new Map<string, unknown>(),
      log: (_msg: string) => {
        /* default no-op */
      },
    };
  }

  /** Appends a pass to the end of the pipeline. */
  addPass(pass: DAEPass): this {
    this.passes.push(pass);
    return this;
  }

  /** Inserts a pass immediately before the designated target pass. */
  insertPassBefore(targetName: string, pass: DAEPass): this {
    const idx = this.passes.findIndex((p) => p.name === targetName);
    if (idx === -1) {
      throw new Error(`Pass '${targetName}' not found in pass manager pipeline.`);
    }
    this.passes.splice(idx, 0, pass);
    return this;
  }

  /** Inserts a pass immediately after the designated target pass. */
  insertPassAfter(targetName: string, pass: DAEPass): this {
    const idx = this.passes.findIndex((p) => p.name === targetName);
    if (idx === -1) {
      throw new Error(`Pass '${targetName}' not found in pass manager pipeline.`);
    }
    this.passes.splice(idx + 1, 0, pass);
    return this;
  }

  /** Removes a pass by name. Returns true if found and removed. */
  removePass(name: string): boolean {
    const idx = this.passes.findIndex((p) => p.name === name);
    if (idx !== -1) {
      this.passes.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Looks up a pass by name. */
  getPass(name: string): DAEPass | undefined {
    return this.passes.find((p) => p.name === name);
  }

  /** Returns all registered passes. */
  getPasses(): readonly DAEPass[] {
    return this.passes;
  }

  /**
   * Executes all passes in order on `arena`.
   *
   * @param arena - The DAE arena to transform.
   * @param initialContext - Optional initial context values or overrides.
   * @returns Summary of execution times, status, and mutated context.
   */
  run(arena: DAEBuilder, initialContext?: Partial<PassContext>): PassRunSummary {
    const ctx: PassContext = {
      ...DAEPassManager.createDefaultContext(),
      ...initialContext,
    };

    const reports: {
      passName: string;
      durationMs: number;
      result?: PassResult | undefined;
    }[] = [];

    const tStart = performance.now();

    for (const pass of this.passes) {
      const t0 = performance.now();
      const res = pass.run(arena, ctx);
      const durationMs = performance.now() - t0;
      reports.push({
        passName: pass.name,
        durationMs,
        result: res || undefined,
      });
    }

    const totalDurationMs = performance.now() - tStart;

    return {
      reports,
      totalDurationMs,
      context: ctx,
    };
  }
}
