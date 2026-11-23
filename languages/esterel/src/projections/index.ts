// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Polyglot projections from Esterel synchronous reactive modules to:
 *  1. Modelica 3.3+ clocked synchronous state machines (`esterelToModelica`)
 *  2. Lustre v6 synchronous dataflow nodes (`esterelToLustre`)
 */

import { parseEsterel } from "../parser/esterel-parser.js";
import type { EsterelModule, EsterelProgram, EsterelSignalExpr, EsterelStatement } from "../types.js";

export interface EsterelProjectionOptions {
  moduleName?: string | undefined;
  samplePeriod?: number | undefined;
}

interface CircuitRegister {
  name: string;
  init: boolean;
  nextExpr: string;
}

interface CompiledCircuit {
  module: EsterelModule;
  registers: CircuitRegister[];
  localSignals: string[];
  signalEquations: Map<string, string>;
}

function resolveModule(programOrSource: EsterelProgram | EsterelModule | string, moduleName?: string): EsterelModule {
  let mod: EsterelModule | undefined;
  if (typeof programOrSource === "string") {
    const prog = parseEsterel(programOrSource);
    mod = moduleName ? prog.modules.find((m) => m.name === moduleName) : prog.modules[0];
  } else if ("modules" in programOrSource) {
    mod = moduleName ? programOrSource.modules.find((m) => m.name === moduleName) : programOrSource.modules[0];
  } else {
    mod = programOrSource;
  }
  if (!mod) {
    throw new Error(moduleName ? `Esterel module '${moduleName}' not found.` : "No Esterel module found.");
  }
  return mod;
}

function simplifyAnd(a: string, b: string): string {
  if (a === "false" || b === "false") return "false";
  if (a === "true") return b;
  if (b === "true") return a;
  return `(${a} and ${b})`;
}

function simplifyOr(a: string, b: string): string {
  if (a === "true" || b === "true") return "true";
  if (a === "false") return b;
  if (b === "false") return a;
  return `(${a} or ${b})`;
}

function simplifyNot(a: string): string {
  if (a === "true") return "false";
  if (a === "false") return "true";
  return `(not ${a})`;
}

function formatSignalExpr(expr: EsterelSignalExpr): string {
  switch (expr.kind) {
    case "tick":
      return "true";
    case "signal":
      return expr.name;
    case "not":
      return simplifyNot(formatSignalExpr(expr.operand));
    case "and":
      return simplifyAnd(formatSignalExpr(expr.left), formatSignalExpr(expr.right));
    case "or":
      return simplifyOr(formatSignalExpr(expr.left), formatSignalExpr(expr.right));
  }
}

/**
 * Compiles an Esterel module into Berry's boolean register circuit representation
 * shared by both Modelica clocked state machine and Lustre dataflow projections.
 */
function compileToBooleanCircuit(mod: EsterelModule, prevFn: (reg: string) => string): CompiledCircuit {
  const registers: CircuitRegister[] = [];
  const localSignals: string[] = [];
  const emitGuards = new Map<string, string[]>();
  let regId = 0;

  for (const sig of mod.signals) {
    if (sig.direction === "output" || sig.direction === "inputoutput") {
      emitGuards.set(sig.name, []);
    }
  }

  function addReg(label: string, init: boolean): string {
    const name = `s_${label}_${regId++}`;
    registers.push({ name, init, nextExpr: "false" });
    return name;
  }

  function setRegNext(name: string, nextExpr: string): void {
    const r = registers.find((x) => x.name === name);
    if (r) r.nextExpr = nextExpr;
  }

  function recordEmit(sig: string, guard: string): void {
    const list = emitGuards.get(sig) ?? [];
    list.push(guard);
    emitGuards.set(sig, list);
  }

  function compileStmt(stmt: EsterelStatement, go: string, res: string, kill: string): string {
    const alive = simplifyNot(kill);

    switch (stmt.kind) {
      case "nothing":
        return go;
      case "emit":
        recordEmit(stmt.signal, simplifyAnd(go, alive));
        return go;
      case "pause": {
        const reg = addReg("pause", false);
        setRegNext(reg, simplifyAnd(go, alive));
        return simplifyAnd(simplifyAnd(prevFn(reg), res), alive);
      }
      case "halt": {
        const reg = addReg("halt", false);
        setRegNext(reg, simplifyAnd(simplifyOr(go, simplifyAnd(prevFn(reg), res)), alive));
        return "false";
      }
      case "sustain": {
        const reg = addReg(`sustain_${stmt.signal}`, false);
        const active = simplifyAnd(simplifyOr(go, simplifyAnd(prevFn(reg), res)), alive);
        setRegNext(reg, active);
        recordEmit(stmt.signal, active);
        return "false";
      }
      case "present": {
        const c = formatSignalExpr(stmt.expr);
        const tTerm = compileStmt(stmt.thenBranch, simplifyAnd(go, c), res, kill);
        const eTerm = stmt.elseBranch
          ? compileStmt(stmt.elseBranch, simplifyAnd(go, simplifyNot(c)), res, kill)
          : simplifyAnd(go, simplifyNot(c));
        return simplifyOr(tTerm, eTerm);
      }
      case "await": {
        const reg = addReg("await", false);
        const trig = formatSignalExpr(stmt.expr);
        const waiting = simplifyAnd(prevFn(reg), res);
        const fire = stmt.immediate ? simplifyAnd(simplifyOr(go, waiting), trig) : simplifyAnd(waiting, trig);
        setRegNext(reg, simplifyAnd(simplifyAnd(simplifyOr(go, waiting), simplifyNot(fire)), alive));
        if (stmt.body) {
          return compileStmt(stmt.body, simplifyAnd(fire, alive), res, kill);
        }
        return simplifyAnd(fire, alive);
      }
      case "seq": {
        let curGo = go;
        for (const s of stmt.statements) {
          curGo = compileStmt(s, curGo, res, kill);
        }
        return curGo;
      }
      case "par": {
        let allTerm = "true";
        for (const b of stmt.branches) {
          allTerm = simplifyAnd(allTerm, compileStmt(b, go, res, kill));
        }
        return allTerm;
      }
      case "loop": {
        if (stmt.eachExpr) {
          const resetSig = formatSignalExpr(stmt.eachExpr);
          const reg = addReg("loop_each", false);
          const restart = simplifyAnd(simplifyAnd(prevFn(reg), res), resetSig);
          compileStmt(stmt.body, simplifyOr(go, restart), res, simplifyOr(kill, restart));
          setRegNext(reg, simplifyAnd(simplifyOr(go, simplifyAnd(prevFn(reg), res)), alive));
          return "false";
        }
        compileStmt(stmt.body, go, res, kill);
        return "false";
      }
      case "every": {
        const reg = addReg("every", false);
        const trig = formatSignalExpr(stmt.expr);
        const active = simplifyAnd(prevFn(reg), res);
        const triggerNow = stmt.immediate ? simplifyAnd(simplifyOr(go, active), trig) : simplifyAnd(active, trig);
        compileStmt(stmt.body, triggerNow, res, simplifyOr(kill, triggerNow));
        setRegNext(reg, simplifyAnd(simplifyOr(go, active), alive));
        return "false";
      }
      case "abort": {
        const trig = formatSignalExpr(stmt.expr);
        const abortActive = stmt.immediate ? simplifyOr(go, res) : res;
        const preempt = simplifyAnd(abortActive, trig);
        const bodyKill = stmt.weak ? kill : simplifyOr(kill, preempt);
        const bTerm = compileStmt(stmt.body, go, res, bodyKill);
        if (stmt.handler) {
          const hTerm = compileStmt(stmt.handler, simplifyAnd(preempt, alive), res, kill);
          return simplifyOr(bTerm, hTerm);
        }
        return simplifyOr(bTerm, simplifyAnd(preempt, alive));
      }
      case "suspend": {
        const trig = formatSignalExpr(stmt.expr);
        const suspActive = stmt.immediate ? simplifyOr(go, res) : res;
        const frozen = simplifyAnd(suspActive, trig);
        return compileStmt(stmt.body, go, simplifyAnd(res, simplifyNot(frozen)), kill);
      }
      case "trap": {
        let term = compileStmt(stmt.body, go, res, kill);
        for (const h of stmt.handlers) {
          term = simplifyOr(term, compileStmt(h.body, "false", res, kill));
        }
        return term;
      }
      case "exit":
        return go;
      case "signal": {
        for (const s of stmt.signals) {
          if (!localSignals.includes(s.name)) localSignals.push(s.name);
          if (!emitGuards.has(s.name)) emitGuards.set(s.name, []);
        }
        return compileStmt(stmt.body, go, res, kill);
      }
      case "run":
        return go;
    }
  }

  const bootReg = addReg("boot", true);
  setRegNext(bootReg, "false");
  const goExpr = prevFn(bootReg);
  const resExpr = simplifyNot(goExpr);
  compileStmt(mod.body, goExpr, resExpr, "false");

  const signalEquations = new Map<string, string>();
  for (const [sig, guards] of emitGuards) {
    let combined = "false";
    for (const g of guards) {
      combined = simplifyOr(combined, g);
    }
    signalEquations.set(sig, combined);
  }

  return { module: mod, registers, localSignals, signalEquations };
}

/**
 * Projects an Esterel module to a Modelica 3.3+ clocked synchronous state machine block.
 */
export function esterelToModelica(
  programOrSource: EsterelProgram | EsterelModule | string,
  options: EsterelProjectionOptions = {},
): string {
  const mod = resolveModule(programOrSource, options.moduleName);
  const samplePeriod = options.samplePeriod ?? 0.01;
  const circuit = compileToBooleanCircuit(mod, (r) => `previous(${r})`);

  const lines: string[] = [];
  lines.push(`// Projected from Esterel module '${mod.name}' to Modelica 3.3+ clocked state machine`);
  lines.push(`block ${mod.name}`);
  lines.push(`  parameter Real samplePeriod = ${samplePeriod};`);
  lines.push(`  Clock clk = Clock(samplePeriod);`);

  for (const sig of mod.signals) {
    if (sig.direction === "input" || sig.direction === "sensor") {
      lines.push(`  input Boolean ${sig.name};`);
    } else if (sig.direction === "output") {
      lines.push(`  output Boolean ${sig.name}(start = false);`);
    } else {
      lines.push(`  Boolean ${sig.name}(start = false);`);
    }
  }

  for (const loc of circuit.localSignals) {
    lines.push(`  Boolean ${loc}(start = false);`);
  }

  for (const reg of circuit.registers) {
    lines.push(`  Boolean ${reg.name}(start = ${reg.init ? "true" : "false"});`);
  }

  lines.push(`equation`);
  lines.push(`  // Clocked Mealy state register transitions`);
  for (const reg of circuit.registers) {
    lines.push(`  ${reg.name} = ${reg.nextExpr};`);
  }
  lines.push(`  // Instantaneous signal presence equations`);
  for (const [sig, expr] of circuit.signalEquations) {
    lines.push(`  ${sig} = ${expr};`);
  }
  lines.push(`end ${mod.name};`);

  return lines.join("\n") + "\n";
}

/**
 * Projects an Esterel module to a Lustre v6 synchronous dataflow `node`.
 */
export function esterelToLustre(
  programOrSource: EsterelProgram | EsterelModule | string,
  options: EsterelProjectionOptions = {},
): string {
  const mod = resolveModule(programOrSource, options.moduleName);
  const circuit = compileToBooleanCircuit(mod, (r) => `pre(${r})`);

  const inputs = mod.signals.filter((s) => s.direction === "input" || s.direction === "sensor");
  const outputs = mod.signals.filter((s) => s.direction === "output" || s.direction === "inputoutput");

  const inSig = inputs.length > 0 ? inputs.map((s) => `${s.name}: bool`).join("; ") : "_tick: bool";
  const outSig = outputs.length > 0 ? outputs.map((s) => `${s.name}: bool`).join("; ") : "_done: bool";

  const lines: string[] = [];
  lines.push(`-- Projected from Esterel module '${mod.name}' to Lustre v6 synchronous dataflow`);
  lines.push(`node ${mod.name}(${inSig}) returns (${outSig});`);

  const varDecls: string[] = [];
  for (const loc of circuit.localSignals) {
    varDecls.push(`  ${loc}: bool;`);
  }
  for (const reg of circuit.registers) {
    varDecls.push(`  ${reg.name}: bool;`);
  }
  if (varDecls.length > 0) {
    lines.push(`var`);
    lines.push(...varDecls);
  }

  lines.push(`let`);
  for (const reg of circuit.registers) {
    const initLit = reg.init ? "true" : "false";
    lines.push(`  ${reg.name} = ${initLit} -> ${reg.nextExpr};`);
  }
  if (outputs.length === 0) {
    lines.push(`  _done = true;`);
  } else {
    for (const [sig, expr] of circuit.signalEquations) {
      lines.push(`  ${sig} = ${expr};`);
    }
  }
  lines.push(`tel`);

  return lines.join("\n") + "\n";
}
