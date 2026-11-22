// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCScript, type CExpr, type CStmt } from "@modelscript/c";
import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
import { parseFortranScript, type FortranExpr, type FortranStmt } from "@modelscript/fortran";
import { globalLibraryRegistry } from "@modelscript/runtime";
import type { EmtCustomFortranBlock, EmtNetlist } from "../types.js";

function sanitizeIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

interface WasmLibraryExports {
  memory?: WebAssembly.Memory;
  [fnName: string]: unknown;
}

const compiledCache = new WeakMap<Uint8Array, WebAssembly.Instance>();

function getOrInstantiateWasm(wasmBytes: Uint8Array): WebAssembly.Instance | undefined {
  let inst = compiledCache.get(wasmBytes);
  if (inst) return inst;
  try {
    const copy = new Uint8Array(wasmBytes);
    const mod = new WebAssembly.Module(copy);
    inst = new WebAssembly.Instance(mod, {
      env: {
        abort: () => {},
        emtdc_host_io: (_op: number, _a0: number, a1: number) => a1,
        emtdc_host_plot: () => {},
      },
    });
    compiledCache.set(wasmBytes, inst);
    return inst;
  } catch {
    return undefined;
  }
}

/**
 * Instantiates `fmi-ls-emt` Norton-companion callbacks from any loaded `package.json#modelscript`
 * PSCAD library package that provides `runtime.wasm` (`pkg.wasmBytes`), matching `fmuInstances`
 * in `netlist` by component/model name (`<Component>_stampCompanion` / `<Component>_doStep`).
 */
export function instantiateWasmCompanionsForNetlist(netlist: EmtNetlist): Map<string, FmiLsEmtCompanionInstance> {
  const companions = new Map<string, FmiLsEmtCompanionInstance>();
  const fmus = netlist.fmuInstances ?? [];
  if (fmus.length === 0) return companions;

  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("pscad")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  if (pkgs.length === 0) return companions;

  const instanceCounterByType = new Map<string, number>();

  for (const fmu of fmus) {
    const rawName = (fmu as unknown as { modelName?: string; defn?: string }).modelName ?? fmu.id;
    const shortName = rawName.includes(":") ? rawName.split(":").pop()! : rawName;
    const safe = sanitizeIdent(shortName);

    for (const pkg of pkgs) {
      if (!pkg.wasmBytes) continue;
      const instance = getOrInstantiateWasm(pkg.wasmBytes);
      if (!instance) continue;
      const exports = instance.exports as WasmLibraryExports;
      const stampFn =
        (exports[`${safe}_stampCompanion`] as
          | ((t: number, dt: number, gPtr: number, iPtr: number) => void)
          | undefined) ??
        (exports["stampCompanion"] as ((t: number, dt: number, gPtr: number, iPtr: number) => void) | undefined);
      const stepFn =
        (exports[`${safe}_doStep`] as ((t: number, dt: number, vPtr: number) => void) | undefined) ??
        (exports["doStep"] as ((t: number, dt: number, vPtr: number) => void) | undefined);

      if (typeof stampFn !== "function" || typeof stepFn !== "function" || !exports.memory) continue;

      const setInstFn = exports["companion_set_instance"] as ((id: number) => void) | undefined;
      const instId = instanceCounterByType.get(safe) ?? 0;
      instanceCounterByType.set(safe, instId + 1);

      const mem = exports.memory;
      // Reserve 128 bytes at offset 1024 (aligned to 8 bytes): 9 f64s for gEq (72B), 3 f64s for iHist (24B), 3 f64s for vNode (24B)
      const gEqPtr = 1024;
      const iHistPtr = 1096;
      const vNodePtr = 1120;
      const paramsPtr = 1152;

      const initFn =
        (exports[`${safe}_init`] as ((pPtr: number, count: number) => void) | undefined) ??
        (exports["init"] as ((pPtr: number, count: number) => void) | undefined);
      if (typeof initFn === "function") {
        setInstFn?.(instId);
        const rawParams = (fmu as unknown as { params?: Record<string, unknown> }).params ?? {};
        const pickNum = (...keys: string[]): number => {
          for (const k of keys) {
            const v = rawParams[k];
            if (typeof v === "number" && Number.isFinite(v)) return v;
            if (typeof v === "string") {
              const parsed = parseFloat(v);
              if (Number.isFinite(parsed)) return parsed;
            }
          }
          return NaN;
        };
        const vec = [
          pickNum("R", "r", "Rcls", "Ron", "Resistance"),
          pickNum("L", "l", "L_leak", "Inductance"),
          pickNum("C", "c", "Capacitance"),
          pickNum("Vref", "VRef", "V_ref", "vRefKv"),
          pickNum("Kp", "kp", "G"),
          pickNum("Ki", "ki", "T"),
        ];
        const f64 = new Float64Array(mem.buffer);
        for (let i = 0; i < vec.length; i++) {
          f64[(paramsPtr >> 3) + i] = vec[i]!;
        }
        initFn(paramsPtr, vec.length);
      }

      companions.set(fmu.id, {
        stampCompanion(tSec: number, dtSec: number) {
          setInstFn?.(instId);
          stampFn(tSec, dtSec, gEqPtr, iHistPtr);
          const f64 = new Float64Array(mem.buffer);
          const gEq = new Float64Array(9);
          const iHist = new Float64Array(3);
          for (let i = 0; i < 9; i++) gEq[i] = f64[(gEqPtr >> 3) + i] ?? 0;
          for (let i = 0; i < 3; i++) iHist[i] = f64[(iHistPtr >> 3) + i] ?? 0;
          return { gEq, iHist };
        },
        doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>) {
          setInstFn?.(instId);
          const f64 = new Float64Array(mem.buffer);
          f64[(vNodePtr >> 3) + 0] = vNode[0] ?? 0;
          f64[(vNodePtr >> 3) + 1] = vNode[1] ?? 0;
          f64[(vNodePtr >> 3) + 2] = vNode[2] ?? 0;
          stepFn(tSec, dtSec, vNodePtr);
        },
      });
      break;
    }
  }

  return companions;
}

/**
 * Compiles AssemblyScript `fmi-ls-emt` companion source(s) into a `Uint8Array` WebAssembly
 * module in both Node.js and browser environments using `assemblyscript/asc`.
 */
export async function compileAssemblyScriptCompanion(
  sources: string | Record<string, string>,
  options?: { optimizeLevel?: number; memoryBase?: number },
): Promise<{ wasmBytes?: Uint8Array | undefined; stderr: string }> {
  const asc = (await import("assemblyscript/asc")) as unknown as {
    compileString: (
      src: string | Record<string, string>,
      opts?: Record<string, unknown>,
    ) => Promise<{
      error: Error | null;
      stderr: { toString(): string };
      binary: Uint8Array | null;
    }>;
  };
  const result = await asc.compileString(sources, {
    optimizeLevel: options?.optimizeLevel ?? 3,
    noAssert: true,
    memoryBase: options?.memoryBase ?? 2048,
    bindings: "raw",
  });
  return {
    wasmBytes: result.binary ?? undefined,
    stderr: result.stderr ? result.stderr.toString() : "",
  };
}

/**
 * Compiles AssemblyScript companion source(s) in a Web Worker when running in a browser
 * with `Worker`/`Blob` support and a reachable `assemblyscript/asc` module URL, falling back
 * to `compileAssemblyScriptCompanion` in Node.js or when Worker creation is unavailable.
 */
export async function compileAssemblyScriptInWorker(
  sources: string | Record<string, string>,
  options?: { optimizeLevel?: number; memoryBase?: number; ascModuleUrl?: string },
): Promise<{ wasmBytes?: Uint8Array | undefined; stderr: string }> {
  const hasWorker =
    typeof globalThis.Worker === "function" &&
    typeof globalThis.Blob === "function" &&
    typeof globalThis.URL?.createObjectURL === "function" &&
    Boolean(options?.ascModuleUrl);
  if (!hasWorker || !options?.ascModuleUrl) {
    return compileAssemblyScriptCompanion(sources, options);
  }

  const workerCode = `
    self.onmessage = async (event) => {
      const { sources, options, ascModuleUrl } = event.data;
      try {
        const asc = await import(ascModuleUrl);
        const result = await asc.compileString(sources, {
          optimizeLevel: options?.optimizeLevel ?? 3,
          noAssert: true,
          memoryBase: options?.memoryBase ?? 2048,
          bindings: "raw",
        });
        const wasmBytes = result.binary ?? undefined;
        const stderr = result.stderr ? result.stderr.toString() : "";
        self.postMessage({ wasmBytes, stderr }, wasmBytes ? [wasmBytes.buffer] : []);
      } catch (err) {
        self.postMessage({ stderr: err instanceof Error ? err.message : String(err) });
      }
    };
  `;

  const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
  return new Promise((resolve) => {
    const worker = new Worker(blobUrl, { type: "module" });
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };
    worker.onmessage = (e: MessageEvent<{ wasmBytes?: Uint8Array; stderr: string }>) => {
      cleanup();
      resolve(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      cleanup();
      resolve({ stderr: e.message || "AssemblyScript worker compilation failed" });
    };
    worker.postMessage({
      sources,
      options: { optimizeLevel: options.optimizeLevel, memoryBase: options.memoryBase },
      ascModuleUrl: options.ascModuleUrl,
    });
  });
}

function asFloatLit(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  const s = String(n);
  return s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
}

function asMathCall(fn: string, args: string[]): string {
  const f = fn.toLowerCase();
  if (f === "sin" || f === "dsin") return `Math.sin(${args[0] ?? "0.0"})`;
  if (f === "cos" || f === "dcos") return `Math.cos(${args[0] ?? "0.0"})`;
  if (f === "tan" || f === "dtan") return `Math.tan(${args[0] ?? "0.0"})`;
  if (f === "sqrt" || f === "dsqrt") return `Math.sqrt(Math.max(0.0, ${args[0] ?? "0.0"}))`;
  if (f === "abs" || f === "dabs" || f === "fabs") return `Math.abs(${args[0] ?? "0.0"})`;
  if (f === "exp" || f === "dexp") return `Math.exp(${args[0] ?? "0.0"})`;
  if (f === "log" || f === "dlog" || f === "alog") return `Math.log(Math.max(1e-12, ${args[0] ?? "1.0"}))`;
  if (f === "min" || f === "dmin1" || f === "amin1")
    return args.length >= 2 ? `Math.min(${args[0]}, ${args[1]})` : (args[0] ?? "0.0");
  if (f === "max" || f === "dmax1" || f === "amax1")
    return args.length >= 2 ? `Math.max(${args[0]}, ${args[1]})` : (args[0] ?? "0.0");
  if (f === "pow") return `Math.pow(${args[0] ?? "0.0"}, ${args[1] ?? "1.0"})`;
  return args[0] ?? "0.0";
}

function resolvePortReadAs(
  portName: string,
  refPorts: readonly string[],
  params?: Record<string, string | number>,
): string {
  if (params && params[portName] !== undefined) {
    const pv = Number(params[portName]);
    if (Number.isFinite(pv)) return asFloatLit(pv);
  }
  const idx = refPorts.findIndex((p) => p.toLowerCase() === portName.toLowerCase());
  if (idx === 0) return "va";
  if (idx === 1) return "vb";
  if (idx === 2) return "vc";
  return "va";
}

function lowerFortranExprToAs(expr: FortranExpr, block: EmtCustomFortranBlock, locals: Set<string>): string {
  switch (expr.kind) {
    case "number":
      return asFloatLit(expr.value);
    case "boolean":
      return expr.value ? "1.0" : "0.0";
    case "special":
      if (expr.name === "TIME") return "tSec";
      if (expr.name === "DELT") return "dtSec";
      if (expr.name === "FIRSTSTEP") return "(tSec <= dtSec * 0.5)";
      return "0.0";
    case "port":
      return resolvePortReadAs(expr.portName, block.referencedPorts, block.params);
    case "var": {
      const safe = sanitizeIdent(expr.name);
      if (block.params && block.params[expr.name] !== undefined) {
        const pv = Number(block.params[expr.name]);
        if (Number.isFinite(pv)) return asFloatLit(pv);
      }
      if (locals.has(safe)) return safe;
      const refIdx = block.referencedPorts.findIndex((p) => p.toLowerCase() === expr.name.toLowerCase());
      if (refIdx >= 0) return resolvePortReadAs(expr.name, block.referencedPorts, block.params);
      return "0.0";
    }
    case "state": {
      const idx = lowerFortranExprToAs(expr.indexExpr, block, locals);
      return `states[Math.max(0, Math.min(states.length - 1, <i32>Math.round(${idx}) - 1))]`;
    }
    case "unary":
      return expr.op === "!"
        ? `(!(${lowerFortranExprToAs(expr.expr, block, locals)}))`
        : `(-(${lowerFortranExprToAs(expr.expr, block, locals)}))`;
    case "binary": {
      const l = lowerFortranExprToAs(expr.left, block, locals);
      const r = lowerFortranExprToAs(expr.right, block, locals);
      if (expr.op === "^") return `Math.pow(${l}, ${r})`;
      if (expr.op === "/") return `((${r}) != 0.0 ? (${l}) / (${r}) : 0.0)`;
      return `(${l} ${expr.op} ${r})`;
    }
    case "math":
      return asMathCall(
        expr.func,
        expr.args.map((a) => lowerFortranExprToAs(a, block, locals)),
      );
    default:
      return "0.0";
  }
}

function lowerFortranStmtsToAs(
  stmts: FortranStmt[],
  block: EmtCustomFortranBlock,
  locals: Set<string>,
  indent: string,
): string[] {
  const lines: string[] = [];
  for (const st of stmts) {
    if (st.kind === "subroutine" || st.kind === "function") {
      lines.push(...lowerFortranStmtsToAs(st.body, block, locals, indent));
    } else if (st.kind === "assign") {
      const rhs = lowerFortranExprToAs(st.expr, block, locals);
      if (st.target.type === "state") {
        const idx = lowerFortranExprToAs(st.target.indexExpr, block, locals);
        lines.push(`${indent}states[Math.max(0, Math.min(states.length - 1, <i32>Math.round(${idx}) - 1))] = ${rhs};`);
      } else if (st.target.type === "port") {
        const pname = st.target.portName.toLowerCase();
        const outIdx = block.assignedPorts.findIndex((p) => p.toLowerCase() === pname);
        const targetVar = outIdx === 0 ? "iHistA" : outIdx === 1 ? "iHistB" : outIdx === 2 ? "iHistC" : "states[0]";
        lines.push(`${indent}${targetVar} = ${rhs};`);
      } else if (st.target.type === "var") {
        const rawVar = st.target.name.toLowerCase();
        const vname = sanitizeIdent(st.target.name);
        const decl = locals.has(vname) ? "" : "let ";
        locals.add(vname);
        lines.push(`${indent}${decl}${vname}: f64 = ${rhs};`);
        const outIdx = block.assignedPorts.findIndex((p) => p.toLowerCase() === rawVar);
        if (outIdx === 0) lines.push(`${indent}iHistA = ${vname};`);
        else if (outIdx === 1) lines.push(`${indent}iHistB = ${vname};`);
        else if (outIdx === 2) lines.push(`${indent}iHistC = ${vname};`);
      }
    } else if (st.kind === "if") {
      const cond = lowerFortranExprToAs(st.condition, block, locals);
      lines.push(`${indent}if (Boolean(${cond})) {`);
      lines.push(...lowerFortranStmtsToAs(st.thenBody, block, locals, indent + "  "));
      if (st.elseBody && st.elseBody.length > 0) {
        lines.push(`${indent}} else {`);
        lines.push(...lowerFortranStmtsToAs(st.elseBody, block, locals, indent + "  "));
      }
      lines.push(`${indent}}`);
    }
  }
  return lines;
}

function lowerCEstExprToAs(expr: CExpr, block: EmtCustomFortranBlock, locals: Set<string>): string {
  switch (expr.kind) {
    case "number":
      return asFloatLit(expr.value);
    case "boolean":
      return expr.value ? "1.0" : "0.0";
    case "special":
      if (expr.name === "TIME") return "tSec";
      if (expr.name === "DT") return "dtSec";
      return "(tSec <= dtSec * 0.5)";
    case "port":
      return resolvePortReadAs(expr.portName, block.referencedPorts, block.params);
    case "var": {
      const safe = sanitizeIdent(expr.name);
      if (block.params && block.params[expr.name] !== undefined) {
        const pv = Number(block.params[expr.name]);
        if (Number.isFinite(pv)) return asFloatLit(pv);
      }
      if (locals.has(safe)) return safe;
      const refIdx = block.referencedPorts.findIndex((p) => p.toLowerCase() === expr.name.toLowerCase());
      if (refIdx >= 0) return resolvePortReadAs(expr.name, block.referencedPorts, block.params);
      return "0.0";
    }
    case "subscript": {
      const idx = lowerCEstExprToAs(expr.indexExpr, block, locals);
      return `states[Math.max(0, Math.min(states.length - 1, <i32>Math.round(${idx})))]`;
    }
    case "unary": {
      const inner = lowerCEstExprToAs(expr.expr, block, locals);
      return expr.op === "!" ? `(!Boolean(${inner}))` : `(${expr.op}(${inner}))`;
    }
    case "binary": {
      const l = lowerCEstExprToAs(expr.left, block, locals);
      const r = lowerCEstExprToAs(expr.right, block, locals);
      if (expr.op === "/") return `((${r}) != 0.0 ? (${l}) / (${r}) : 0.0)`;
      return `(${l} ${expr.op} ${r})`;
    }
    case "call":
      return asMathCall(
        expr.callee,
        expr.args.map((a) => lowerCEstExprToAs(a, block, locals)),
      );
    default:
      return "0.0";
  }
}

function lowerCStmtsToAs(stmts: CStmt[], block: EmtCustomFortranBlock, locals: Set<string>, indent: string): string[] {
  const lines: string[] = [];
  for (const st of stmts) {
    if (st.kind === "func" || st.kind === "block") {
      lines.push(...lowerCStmtsToAs(st.body, block, locals, indent));
    } else if (st.kind === "decl") {
      const safe = sanitizeIdent(st.name);
      if (!locals.has(safe)) {
        locals.add(safe);
        const init = st.init ? lowerCEstExprToAs(st.init, block, locals) : "0.0";
        lines.push(`${indent}let ${safe}: f64 = ${init};`);
      }
    } else if (st.kind === "assign") {
      const rhs = lowerCEstExprToAs(st.expr, block, locals);
      if (st.target.type === "subscript") {
        const idx = lowerCEstExprToAs(st.target.indexExpr, block, locals);
        lines.push(
          `${indent}states[Math.max(0, Math.min(states.length - 1, <i32>Math.round(${idx})))] ${st.op} ${rhs};`,
        );
      } else if (st.target.type === "port") {
        const pname = st.target.portName.toLowerCase();
        const outIdx = block.assignedPorts.findIndex((p) => p.toLowerCase() === pname);
        const targetVar = outIdx === 0 ? "iHistA" : outIdx === 1 ? "iHistB" : outIdx === 2 ? "iHistC" : "states[0]";
        lines.push(`${indent}${targetVar} ${st.op} ${rhs};`);
      } else if (st.target.type === "var") {
        const rawVar = st.target.name.toLowerCase();
        const vname = sanitizeIdent(st.target.name);
        if (!locals.has(vname)) {
          locals.add(vname);
          lines.push(`${indent}let ${vname}: f64 = 0.0;`);
        }
        lines.push(`${indent}${vname} ${st.op} ${rhs};`);
        const outIdx = block.assignedPorts.findIndex((p) => p.toLowerCase() === rawVar);
        if (outIdx === 0) lines.push(`${indent}iHistA = ${vname};`);
        else if (outIdx === 1) lines.push(`${indent}iHistB = ${vname};`);
        else if (outIdx === 2) lines.push(`${indent}iHistC = ${vname};`);
      }
    } else if (st.kind === "if") {
      const cond = lowerCEstExprToAs(st.condition, block, locals);
      lines.push(`${indent}if (Boolean(${cond})) {`);
      lines.push(...lowerCStmtsToAs(st.thenBody, block, locals, indent + "  "));
      if (st.elseBody && st.elseBody.length > 0) {
        lines.push(`${indent}} else {`);
        lines.push(...lowerCStmtsToAs(st.elseBody, block, locals, indent + "  "));
      }
      lines.push(`${indent}}`);
    }
  }
  return lines;
}

/**
 * Generates an executable clean-room AssemblyScript `fmi-ls-emt` Norton-companion kernel from a
 * parsed PSCAD custom Fortran/C block (`EmtCustomFortranBlock`). When `block.scriptSource` is supplied,
 * compiles real AST statements directly into the WebAssembly `_doStep` function.
 */
export function generateCleanRoomCompanionFromFortran(block: EmtCustomFortranBlock): string {
  const safeName = sanitizeIdent(block.name || block.id || "CustomBlock");
  const inputsList = block.referencedPorts.length > 0 ? block.referencedPorts.join(", ") : "none";
  const outputsList = block.assignedPorts.length > 0 ? block.assignedPorts.join(", ") : "none";
  const stateCount = Math.max(1, block.numRealStates + block.numIntStates);

  let stepBodyLines: string[] = [];
  if (block.scriptSource && block.scriptSource.trim()) {
    try {
      const locals = new Set<string>(["va", "vb", "vc", "tSec", "dtSec", "iHistA", "iHistB", "iHistC"]);
      if (block.scriptLang === "c") {
        const cAst = parseCScript(block.scriptSource);
        stepBodyLines = lowerCStmtsToAs(cAst, block, locals, "  ");
      } else {
        const fAst = parseFortranScript(block.scriptSource);
        stepBodyLines = lowerFortranStmtsToAs(fAst, block, locals, "  ");
      }
    } catch {
      stepBodyLines = [];
    }
  }
  if (stepBodyLines.length === 0) {
    stepBodyLines = ["  states[0] = (va + vb + vc) * dtSec;", "  iHistA = 0.0;", "  iHistB = 0.0;", "  iHistC = 0.0;"];
  }

  return `// Clean-room fmi-ls-emt AssemblyScript companion for ${block.name} (${block.id})
// Referenced inputs: ${inputsList}
// Assigned outputs: ${outputsList}
// Declared states: ${block.numRealStates} real, ${block.numIntStates} integer

const states = new Float64Array(${stateCount});
let gEqDiag: f64 = 1e-6;
let iHistA: f64 = 0.0;
let iHistB: f64 = 0.0;
let iHistC: f64 = 0.0;

export function ${safeName}_init(paramsPtr: usize, count: i32): void {
  if (count > 0) {
    const r = load<f64>(paramsPtr);
    if (!isNaN(r) && r > 1e-9) {
      gEqDiag = 1.0 / r;
    }
  }
  for (let i = 0; i < states.length; i++) {
    states[i] = 0.0;
  }
}

export function ${safeName}_stampCompanion(tSec: f64, dtSec: f64, gEqPtr: usize, iHistPtr: usize): void {
  // Diagonal 3-phase Norton conductance G_eq (3x3 row-major) and history current I_hist
  for (let i = 0; i < 9; i++) {
    store<f64>(gEqPtr + (<usize>i << 3), i === 0 || i === 4 || i === 8 ? gEqDiag : 0.0);
  }
  store<f64>(iHistPtr + 0, iHistA);
  store<f64>(iHistPtr + 8, iHistB);
  store<f64>(iHistPtr + 16, iHistC);
}

export function ${safeName}_doStep(tSec: f64, dtSec: f64, vNodePtr: usize): void {
  const va = load<f64>(vNodePtr + 0);
  const vb = load<f64>(vNodePtr + 8);
  const vc = load<f64>(vNodePtr + 16);
${stepBodyLines.join("\n")}
}

export function init(paramsPtr: usize, count: i32): void {
  ${safeName}_init(paramsPtr, count);
}

export function stampCompanion(tSec: f64, dtSec: f64, gEqPtr: usize, iHistPtr: usize): void {
  ${safeName}_stampCompanion(tSec, dtSec, gEqPtr, iHistPtr);
}

export function doStep(tSec: f64, dtSec: f64, vNodePtr: usize): void {
  ${safeName}_doStep(tSec, dtSec, vNodePtr);
}
`;
}

/**
 * Generates and compiles clean-room AssemblyScript `fmi-ls-emt` companions for all
 * `customFortranBlocks` in `netlist`, returning `FmiLsEmtCompanionInstance` handles
 * ready for `EmtSolver` (`fmuCompanions` option).
 */
export async function compileCleanRoomCompanionsForNetlist(
  netlist: EmtNetlist,
  options?: { optimizeLevel?: number; memoryBase?: number },
): Promise<Map<string, FmiLsEmtCompanionInstance>> {
  const result = new Map<string, FmiLsEmtCompanionInstance>();
  const blocks = netlist.customFortranBlocks ?? [];
  if (blocks.length === 0) return result;

  for (const block of blocks) {
    const src = generateCleanRoomCompanionFromFortran(block);
    const compiled = await compileAssemblyScriptCompanion(src, options);
    if (!compiled.wasmBytes || compiled.wasmBytes.byteLength === 0) continue;
    const instance = getOrInstantiateWasm(compiled.wasmBytes);
    if (!instance) continue;
    const exports = instance.exports as WasmLibraryExports;
    const safe = sanitizeIdent(block.name || block.id || "CustomBlock");
    const stampFn =
      (exports[`${safe}_stampCompanion`] as
        | ((t: number, dt: number, gPtr: number, iPtr: number) => void)
        | undefined) ??
      (exports["stampCompanion"] as ((t: number, dt: number, gPtr: number, iPtr: number) => void) | undefined);
    const stepFn =
      (exports[`${safe}_doStep`] as ((t: number, dt: number, vPtr: number) => void) | undefined) ??
      (exports["doStep"] as ((t: number, dt: number, vPtr: number) => void) | undefined);
    if (typeof stampFn !== "function" || typeof stepFn !== "function" || !exports.memory) continue;

    const mem = exports.memory;
    const gEqPtr = 1024;
    const iHistPtr = 1096;
    const vNodePtr = 1120;
    result.set(block.id, {
      stampCompanion(tSec: number, dtSec: number) {
        stampFn(tSec, dtSec, gEqPtr, iHistPtr);
        const f64 = new Float64Array(mem.buffer);
        const gEq = new Float64Array(9);
        const iHist = new Float64Array(3);
        for (let i = 0; i < 9; i++) gEq[i] = f64[(gEqPtr >> 3) + i] ?? 0;
        for (let i = 0; i < 3; i++) iHist[i] = f64[(iHistPtr >> 3) + i] ?? 0;
        return { gEq, iHist };
      },
      doStep(tSec: number, dtSec: number, vNode: ArrayLike<number>) {
        const f64 = new Float64Array(mem.buffer);
        f64[(vNodePtr >> 3) + 0] = vNode[0] ?? 0;
        f64[(vNodePtr >> 3) + 1] = vNode[1] ?? 0;
        f64[(vNodePtr >> 3) + 2] = vNode[2] ?? 0;
        stepFn(tSec, dtSec, vNodePtr);
      },
    });
  }

  return result;
}

export interface CleanRoomWasmHostCallbacks {
  onHostIo?: ((opCode: number, a0: number, a1: number, a2: number) => number) | undefined;
  onHostPlot?: ((channelId: number, value: number, timeSec: number) => void) | undefined;
}

/**
 * Runtime handle to the compiled cleanroom `@modelscript/pscad-master-lib` WebAssembly
 * module (`dist/runtime.wasm`), exposing all 521 EMTDC external subroutines & functions
 * backed by the multi-instance `STORF`/`STORI`/`STORL`/`STORC` linear-memory arena.
 */
export class CleanRoomEmtdcWasmRuntime {
  private readonly exports: WasmLibraryExports;
  private readonly memory: WebAssembly.Memory;
  private readonly argsPtr = 1360;
  private readonly plottedChannels = new Map<number, { time: number; value: number }[]>();

  constructor(wasmBytes: Uint8Array, callbacks?: CleanRoomWasmHostCallbacks) {
    const mod = new WebAssembly.Module(new Uint8Array(wasmBytes));
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort: () => {},
        emtdc_host_io: (opCode: number, a0: number, a1: number, a2: number) =>
          callbacks?.onHostIo ? callbacks.onHostIo(opCode, a0, a1, a2) : a1,
        emtdc_host_plot: (channelId: number, value: number, timeSec: number) => {
          let series = this.plottedChannels.get(channelId);
          if (!series) {
            series = [];
            this.plottedChannels.set(channelId, series);
          }
          series.push({ time: timeSec, value });
          callbacks?.onHostPlot?.(channelId, value, timeSec);
        },
      },
    });
    this.exports = inst.exports as WasmLibraryExports;
    if (!this.exports.memory) {
      throw new Error("CleanRoomEmtdcWasmRuntime: WebAssembly module does not export linear memory");
    }
    this.memory = this.exports.memory;
  }

  /** Returns all plot/RTPS channel samples recorded via `FPLOT19` / `RTPS_*` / `EXNEWCHCO`. */
  getPlottedChannels(): ReadonlyMap<number, readonly { time: number; value: number }[]> {
    return this.plottedChannels;
  }

  /** Resets the multi-instance STORF/STORI/STORL/STORC linear-memory arena. */
  reset(): void {
    this.plottedChannels.clear();
    const fn = this.exports["emtdc_reset_arena"] as (() => void) | undefined;
    fn?.();
  }

  /** Updates simulation context header (TIME, DELT, TIMEZERO, FIRSTSTEP, LASTSTEP). */
  setContext(timeSec: number, dtSec: number, timeZero: boolean, firstStep: boolean, lastStep = false): void {
    const fn = this.exports["emtdc_set_context"] as
      | ((t: number, dt: number, tz: number, fs: number, ls: number) => void)
      | undefined;
    fn?.(timeSec, dtSec, timeZero ? 1 : 0, firstStep ? 1 : 0, lastStep ? 1 : 0);
  }

  /** Sets active multi-instance state cursors (`NSTORF`, `NSTORI`, `NSTORL`, `NSTORC`). */
  setCursors(nstorf: number, nstori = 1, nstorl = 1, nstorc = 1): void {
    const fn = this.exports["emtdc_set_cursors"] as
      | ((nf: number, ni: number, nl: number, nc: number) => void)
      | undefined;
    fn?.(nstorf, nstori, nstorl, nstorc);
  }

  /** Resolves an exported cleanroom subroutine/function name (handling leading digits). */
  private resolveExportName(name: string): string {
    const cleaned = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Za-z0-9_]/g, "_");
    return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
  }

  /** Returns true if the given EMTDC subroutine or function is exported by `runtime.wasm`. */
  hasSubroutine(name: string): boolean {
    const expName = this.resolveExportName(name);
    return typeof this.exports[expName] === "function";
  }

  /** Lists all exported function names in the WebAssembly module. */
  listExportedSubroutines(): string[] {
    return Object.keys(this.exports).filter((k) => typeof this.exports[k] === "function");
  }

  /**
   * Invokes a cleanroom EMTDC subroutine/function by name, writing `args` into the
   * linear-memory argument buffer and copying any mutated output args back into `args`.
   */
  callSubroutine(name: string, args: number[] = []): number {
    const expName = this.resolveExportName(name);
    const fn = this.exports[expName] as ((argsPtr: number, argCount: number) => number) | undefined;
    if (typeof fn !== "function") {
      throw new Error(`Clean-room EMTDC subroutine '${name}' (export '${expName}') not found in runtime.wasm`);
    }
    const count = Math.min(args.length, 64);
    const f64 = new Float64Array(this.memory.buffer);
    const baseIdx = this.argsPtr >> 3;
    for (let i = 0; i < count; i++) {
      f64[baseIdx + i] = args[i] ?? 0;
    }
    const ret = fn(this.argsPtr, count);
    const afterF64 = new Float64Array(this.memory.buffer);
    for (let i = 0; i < count; i++) {
      args[i] = afterF64[baseIdx + i] ?? 0;
    }
    return ret;
  }
}

/**
 * Instantiates a fresh `CleanRoomEmtdcWasmRuntime` from the registered `@modelscript/pscad-master-lib`
 * package's `runtime.wasm` bytes (if loaded).
 */
export function createCleanRoomEmtdcWasmRuntime(
  callbacks?: CleanRoomWasmHostCallbacks,
): CleanRoomEmtdcWasmRuntime | undefined {
  const pkgs = globalLibraryRegistry
    .getPackagesForLanguage("pscad")
    .filter((p) => p.wasmBytes && p.wasmBytes.byteLength > 0);
  const masterPkg = pkgs.find((p) => p.packageName === "@modelscript/pscad-master-lib") ?? pkgs[0];
  if (!masterPkg?.wasmBytes) return undefined;
  return new CleanRoomEmtdcWasmRuntime(masterPkg.wasmBytes, callbacks);
}
