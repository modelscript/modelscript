// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability } from "@modelscript/runtime";
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface JitEngineOptions {
  /** Execution mode: "auto" prefers cached native binary or V8 JIT; "v8" uses in-process V8; "native" compiles C */
  mode?: "auto" | "v8" | "native";
  /** Directory for cached native binaries */
  cacheDir?: string;
  /** C compiler (default: gcc or clang) */
  compiler?: string;
  /** Optimization level (default: -O3 -fno-math-errno) */
  optFlag?: string;
}

export interface JitSimulateOptions {
  startTime?: number;
  stopTime?: number;
  step?: number;
  solver?: "rk4" | "euler";
  tolerance?: number;
  parameterOverrides?: Map<string, number> | Record<string, number>;
  mode?: "auto" | "v8" | "native";
  /** Pre-generated C simulation code (optional) */
  cSource?: string;
  /** Model identifier name */
  modelName?: string;
}

export interface JitSimulateResult {
  t: number[];
  y: number[][];
  states: string[];
  modeUsed: "v8" | "native";
  compilationTimeMs: number;
  executionTimeMs: number;
  totalTimeMs: number;
  cacheHit: boolean;
}

/** In-memory cache of compiled native binary paths keyed by SHA-256 source hash */
const nativeBinaryCache = new Map<string, string>();

/** In-memory cache of compiled V8 RHS functions keyed by DAE topology signature */
const v8FunctionCache = new Map<string, (env: Float64Array, t: number) => void>();

export class ArenaJitEngine {
  private cacheDir: string;
  private compiler: string;
  private optFlag: string;
  private defaultMode: "auto" | "v8" | "native";

  constructor(options?: JitEngineOptions) {
    this.defaultMode = options?.mode ?? "auto";
    this.compiler = options?.compiler ?? process.env.CC ?? "gcc";
    this.optFlag = options?.optFlag ?? "-O3 -fno-math-errno";

    if (options?.cacheDir) {
      this.cacheDir = options.cacheDir;
    } else {
      const tmp = typeof process !== "undefined" ? process.env.TMPDIR || os.tmpdir() : "/tmp";
      this.cacheDir = path.join(tmp, "msx-jit-cache");
    }

    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      // Ignore in environments without fs
    }
  }

  /**
   * Run simulation using the JIT engine.
   * Delivers sub-15ms execution latency through in-process V8 compilation or cached native binary execution.
   */
  async simulate(arena: DAEBuilder, options?: JitSimulateOptions): Promise<JitSimulateResult> {
    const tStart = performance.now();
    const mode = options?.mode ?? this.defaultMode;

    if (mode === "v8" || (mode === "auto" && !options?.cSource)) {
      return this.simulateV8(arena, options, tStart);
    }

    if (mode === "native") {
      return this.simulateNative(arena, options, tStart);
    }

    // Auto with cSource: check if native binary is already cached
    if (options?.cSource) {
      const hash = this.computeSourceHash(options.cSource);
      if (nativeBinaryCache.has(hash)) {
        return this.simulateNative(arena, options, tStart);
      }
    }

    // Default fast path: in-process V8 JIT (<10ms)
    return this.simulateV8(arena, options, tStart);
  }

  /**
   * In-process V8 JIT compilation and execution.
   * Compiles the RHS evaluation equations directly into optimized V8 JavaScript bytecode.
   */
  private simulateV8(arena: DAEBuilder, options: JitSimulateOptions | undefined, tStart: number): JitSimulateResult {
    const startTime = options?.startTime ?? 0;
    const stopTime = options?.stopTime ?? 1;
    const step = options?.step ?? 0.01;
    const integrator = options?.solver ?? "rk4";

    const tCompileStart = performance.now();
    const { rhsFn, stateVarNames, stateVarIndices, derVarIndices, initialEnv, cacheHit } = this.compileRhsV8(
      arena,
      options?.parameterOverrides,
    );
    const compilationTimeMs = performance.now() - tCompileStart;

    const tExecStart = performance.now();
    const env = new Float64Array(initialEnv);
    const numStates = stateVarIndices.length;

    const times: number[] = [];
    const trajectories: number[][] = [];

    let t = startTime;
    const nSteps = Math.max(1, Math.ceil((stopTime - startTime) / step));
    const dt = (stopTime - startTime) / nSteps;

    // Record t0
    times.push(t);
    const y0: number[] = new Array(numStates);
    for (let s = 0; s < numStates; s++) {
      y0[s] = env[stateVarIndices[s]!] ?? 0;
    }
    trajectories.push(y0);

    const k1 = new Float64Array(numStates);
    const k2 = new Float64Array(numStates);
    const k3 = new Float64Array(numStates);
    const k4 = new Float64Array(numStates);
    const savedStates = new Float64Array(numStates);

    while (t < stopTime - 1e-12) {
      const h = Math.min(dt, stopTime - t);

      if (integrator === "euler") {
        rhsFn(env, t);
        for (let s = 0; s < numStates; s++) {
          const sIdx = stateVarIndices[s]!;
          const derIdx = derVarIndices[s]!;
          env[sIdx] += h * (env[derIdx] ?? 0);
        }
      } else {
        // RK4
        // Save base states
        for (let s = 0; s < numStates; s++) {
          savedStates[s] = env[stateVarIndices[s]!] ?? 0;
        }

        // Stage 1 (k1)
        rhsFn(env, t);
        for (let s = 0; s < numStates; s++) {
          k1[s] = env[derVarIndices[s]!] ?? 0;
          env[stateVarIndices[s]!] = savedStates[s]! + 0.5 * h * k1[s]!;
        }

        // Stage 2 (k2)
        rhsFn(env, t + 0.5 * h);
        for (let s = 0; s < numStates; s++) {
          k2[s] = env[derVarIndices[s]!] ?? 0;
          env[stateVarIndices[s]!] = savedStates[s]! + 0.5 * h * k2[s]!;
        }

        // Stage 3 (k3)
        rhsFn(env, t + 0.5 * h);
        for (let s = 0; s < numStates; s++) {
          k3[s] = env[derVarIndices[s]!] ?? 0;
          env[stateVarIndices[s]!] = savedStates[s]! + h * k3[s]!;
        }

        // Stage 4 (k4)
        rhsFn(env, t + h);
        for (let s = 0; s < numStates; s++) {
          k4[s] = env[derVarIndices[s]!] ?? 0;
          // Update state: y += (h / 6) * (k1 + 2k2 + 2k3 + k4)
          env[stateVarIndices[s]!] = savedStates[s]! + (h / 6.0) * (k1[s]! + 2.0 * k2[s]! + 2.0 * k3[s]! + k4[s]!);
        }
      }

      t += h;
      times.push(t);
      const yRow: number[] = new Array(numStates);
      for (let s = 0; s < numStates; s++) {
        yRow[s] = env[stateVarIndices[s]!] ?? 0;
      }
      trajectories.push(yRow);
    }

    const executionTimeMs = performance.now() - tExecStart;
    const totalTimeMs = performance.now() - tStart;

    return {
      t: times,
      y: trajectories,
      states: stateVarNames,
      modeUsed: "v8",
      compilationTimeMs,
      executionTimeMs,
      totalTimeMs,
      cacheHit,
    };
  }

  /**
   * Compiles the DAE RHS into a single V8 JavaScript function.
   */
  private compileRhsV8(
    arena: DAEBuilder,
    overrides?: Map<string, number> | Record<string, number>,
  ): {
    rhsFn: (env: Float64Array, t: number) => void;
    stateVarNames: string[];
    stateVarIndices: number[];
    derVarIndices: number[];
    initialEnv: Float64Array;
    cacheHit: boolean;
  } {
    // Ensure all derivative variables referenced in equations exist in arena
    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      const lhs = arena.getEqLhs(eqIdx);
      if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Der) {
        const argId = arena.getExprData1(lhs);
        if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
          const sName = arena.interner.resolve(arena.getExprData1(argId));
          const derName = `der(${sName})`;
          if (arena.getVarIdxByName(derName) === -1) {
            const baseVarIdx = arena.getVarIdxByName(sName);
            const varType = baseVarIdx !== -1 ? arena.getVarType(baseVarIdx) : 0;
            arena.addVariable(derName, varType, Variability.Continuous, 0, 0.0);
          }
        }
      }
    }

    const varCount = arena.varCount;
    const initialEnv = new Float64Array(varCount);

    const stateVarNames: string[] = [];
    const stateVarIndices: number[] = [];
    const derVarIndices: number[] = [];

    const varNameToIdx = new Map<string, number>();

    // 1. Initialize environment and identify states
    for (let v = 0; v < varCount; v++) {
      const name = arena.getVarName(v);
      varNameToIdx.set(name, v);
      initialEnv[v] = arena.getVarStartValue(v);

      if (arena.getVarVariability(v) === Variability.Parameter) {
        const expr = arena.getVarExpression(v);
        if (expr >= 0 && arena.getExprKind(expr) === ExprKind.RealLiteral) {
          initialEnv[v] = arena.getExprRealValue(expr);
        }
      }
    }

    // Apply overrides
    if (overrides) {
      if (overrides instanceof Map) {
        for (const [k, val] of overrides.entries()) {
          const idx = varNameToIdx.get(k);
          if (idx !== undefined) initialEnv[idx] = val;
        }
      } else {
        for (const [k, val] of Object.entries(overrides)) {
          const idx = varNameToIdx.get(k);
          if (idx !== undefined) initialEnv[idx] = val;
        }
      }
    }

    // Identify derivative variables and continuous states
    for (let v = 0; v < varCount; v++) {
      const name = arena.getVarName(v);
      if (name.startsWith("der(")) {
        const inner = name.slice(4, -1);
        const innerIdx = varNameToIdx.get(inner);
        if (innerIdx !== undefined) {
          stateVarNames.push(inner);
          stateVarIndices.push(innerIdx);
          derVarIndices.push(v);
        }
      }
    }

    // Compute topology signature for caching
    const signature = `dae_${varCount}_${arena.eqCount}_${stateVarIndices.join("_")}`;
    if (v8FunctionCache.has(signature)) {
      return {
        rhsFn: v8FunctionCache.get(signature)!,
        stateVarNames,
        stateVarIndices,
        derVarIndices,
        initialEnv,
        cacheHit: true,
      };
    }

    // 2. Generate JavaScript code for equations
    const lines: string[] = [];
    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      const kind = arena.getEqKind(eqIdx);
      if (kind !== EqKind.Simple && kind !== EqKind.InitialSimple) continue;

      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);

      const lhsKind = arena.getExprKind(lhs);
      let targetIdx = -1;

      if (lhsKind === ExprKind.Der) {
        const arg = arena.getExprData1(lhs);
        if (arena.getExprKind(arg) === ExprKind.Name) {
          const sName = arena.interner.resolve(arena.getExprData1(arg));
          targetIdx = varNameToIdx.get(`der(${sName})`) ?? -1;
        }
      } else if (lhsKind === ExprKind.Name) {
        const name = arena.interner.resolve(arena.getExprData1(lhs));
        targetIdx = varNameToIdx.get(name) ?? -1;
      }

      if (targetIdx !== -1) {
        const rhsJs = this.exprToJs(arena, rhs, varNameToIdx);
        lines.push(`env[${targetIdx}] = ${rhsJs};`);
      }
    }

    const code = lines.join("\n");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const compiled = new Function("env", "t", code) as (env: Float64Array, t: number) => void;
    v8FunctionCache.set(signature, compiled);

    return {
      rhsFn: compiled,
      stateVarNames,
      stateVarIndices,
      derVarIndices,
      initialEnv,
      cacheHit: false,
    };
  }

  private exprToJs(dae: DAEBuilder, id: number, varMap: Map<string, number>): string {
    if (id < 0) return "0.0";
    const kind = dae.getExprKind(id);

    switch (kind) {
      case ExprKind.RealLiteral:
        return `${dae.getExprRealValue(id)}`;
      case ExprKind.IntLiteral:
        return `${dae.getExprData1(id)}`;
      case ExprKind.BoolLiteral:
        return dae.getExprData1(id) !== 0 ? "1" : "0";
      case ExprKind.Name: {
        const name = dae.interner.resolve(dae.getExprData1(id));
        if (name === "time") return "t";
        const idx = varMap.get(name);
        return idx !== undefined ? `env[${idx}]` : "0.0";
      }
      case ExprKind.Der: {
        const arg = dae.getExprData1(id);
        const name = dae.interner.resolve(dae.getExprData1(arg));
        const idx = varMap.get(`der(${name})`);
        return idx !== undefined ? `env[${idx}]` : "0.0";
      }
      case ExprKind.Unary: {
        const uop = dae.getExprData1(id) as UnaryOp;
        const op = uop === UnaryOp.Not ? "!" : "-";
        return `(${op}${this.exprToJs(dae, dae.getExprLeft(id), varMap)})`;
      }
      case ExprKind.Negate:
        return `(-${this.exprToJs(dae, dae.getExprLeft(id), varMap)})`;
      case ExprKind.Binary: {
        const op = dae.getExprData1(id) as BinOp;
        const lhs = this.exprToJs(dae, dae.getExprLeft(id), varMap);
        const rhs = this.exprToJs(dae, dae.getExprRight(id), varMap);
        let opStr = "+";
        if (op === BinOp.Sub) opStr = "-";
        else if (op === BinOp.Mul) opStr = "*";
        else if (op === BinOp.Div) opStr = "/";
        else if (op === BinOp.Pow) return `Math.pow(${lhs}, ${rhs})`;
        return `(${lhs} ${opStr} ${rhs})`;
      }
      case ExprKind.Call: {
        const fname = dae.interner.resolve(dae.getExprData1(id));
        const count = dae.getExprRight(id);
        const args: string[] = [];
        for (let i = 0; i < count; i++) {
          args.push(this.exprToJs(dae, dae.getExprLeft(id + i), varMap));
        }
        if (
          fname === "sin" ||
          fname === "cos" ||
          fname === "tan" ||
          fname === "exp" ||
          fname === "log" ||
          fname === "sqrt"
        ) {
          return `Math.${fname}(${args.join(", ")})`;
        }
        return `0.0`;
      }
      case ExprKind.IfElse: {
        const c = this.exprToJs(dae, dae.getExprData1(id), varMap);
        const t = this.exprToJs(dae, dae.getExprLeft(id), varMap);
        const e = this.exprToJs(dae, dae.getExprRight(id), varMap);
        return `(${c} ? ${t} : ${e})`;
      }
      default:
        return "0.0";
    }
  }

  /**
   * Native C JIT execution.
   * Compiles standalone C simulation code to a cached binary and executes it.
   */
  private async simulateNative(
    arena: DAEBuilder,
    options: JitSimulateOptions | undefined,
    tStart: number,
  ): Promise<JitSimulateResult> {
    const cSource = options?.cSource;
    if (!cSource) {
      // If no C source passed, fallback to V8 JIT
      return this.simulateV8(arena, options, tStart);
    }

    const hash = this.computeSourceHash(cSource);
    const binFile = path.join(this.cacheDir, `msx_sim_${hash}`);
    let cacheHit = false;
    let compilationTimeMs = 0;

    if (nativeBinaryCache.has(hash) && fs.existsSync(binFile)) {
      cacheHit = true;
    } else {
      const tCompStart = performance.now();
      const cFile = path.join(this.cacheDir, `msx_sim_${hash}.c`);
      fs.writeFileSync(cFile, cSource);

      const cmd = `${this.compiler} ${this.optFlag} -w "${cFile}" -o "${binFile}" -lm`;
      try {
        execSync(cmd, { stdio: "pipe", timeout: 30000 });
        nativeBinaryCache.set(hash, binFile);
        compilationTimeMs = performance.now() - tCompStart;
      } catch {
        // Fallback to V8 JIT if gcc/clang is not available
        return this.simulateV8(arena, options, tStart);
      }
    }

    // Execute cached native binary
    const tExecStart = performance.now();
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(binFile, [], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      child.on("close", (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`Native JIT simulation exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
      child.on("error", reject);
    });

    const executionTimeMs = performance.now() - tExecStart;
    const totalTimeMs = performance.now() - tStart;

    // Parse CSV output
    const lines = output.trim().split("\n");
    const header = lines[0]?.split(",") ?? [];
    const rows = lines.slice(1).map((l: string) => l.split(",").map(Number));
    const times = rows.map((r: number[]) => r[0] ?? 0);
    const y = rows.map((r: number[]) => r.slice(1));
    const states = header.slice(1);

    return {
      t: times,
      y,
      states,
      modeUsed: "native",
      compilationTimeMs,
      executionTimeMs,
      totalTimeMs,
      cacheHit,
    };
  }

  private computeSourceHash(source: string): string {
    return crypto.createHash("sha256").update(source).update(this.optFlag).digest("hex").slice(0, 16);
  }
}

/** Global singleton JIT engine instance */
export const defaultJitEngine = new ArenaJitEngine();

/** Convenience helper: execute DAE simulation with in-memory JIT compiler */
export async function simulateArenaJit(arena: DAEBuilder, options?: JitSimulateOptions): Promise<JitSimulateResult> {
  return defaultJitEngine.simulate(arena, options);
}
