// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cycle-Accurate Synchronous Stepper & Safety-Property Observer Checker for `@modelscript/lustre`.
 *
 * Implements exact Lustre synchronous dataflow semantics:
 *   - Topological scheduling of equations (breaking dependencies at `pre`)
 *   - Clock-aware `->` (first-tick on expression's clock) and `pre(...)` registers
 *   - Sub-sampling (`when`), projection (`current`), and clocked multiplexing (`merge`)
 *   - Hierarchical node instantiation with isolated per-call-site state (including stdlib operators)
 *   - Runtime `assert` verification and synchronous observer safety-property checking
 */

import { LUSTRE_OPERATOR_SPECS } from "../catalog/lustre-std-schemas.js";
import { parseLustre } from "../parser/lustre-parser.js";
import type {
  LustreEquation,
  LustreExpr,
  LustreNodeDecl,
  LustreProgram,
  LustreRuntimeValue,
  LustreScalarValue,
} from "../types.js";

export type LustreStepInputs = Record<string, LustreScalarValue>;
export type LustreStepOutputs = Record<string, LustreRuntimeValue>;

export interface LustreStepResult {
  step: number;
  inputs: LustreStepInputs;
  outputs: LustreStepOutputs;
  locals: Record<string, LustreRuntimeValue>;
  assertionsPassed: boolean;
  failedAssertions: number[];
}

export interface LustreSimulationResult {
  nodeName: string;
  steps: LustreStepResult[];
  outputs: LustreStepOutputs[];
  assertionsPassed: boolean;
  assertionViolations: Array<{ step: number; assertionIndex: number }>;
}

export interface LustreObserverResult {
  observerNode: string;
  propertyOutput: string;
  satisfied: boolean;
  firstViolationStep: number | null;
  violations: number[];
  steps: LustreStepResult[];
}

export interface LustreStepper {
  readonly nodeName: string;
  step(inputs?: LustreStepInputs): LustreStepResult;
  reset(): void;
  getStepCount(): number;
  getTrace(): LustreStepResult[];
}

let cachedStdlibNodes: Map<string, LustreNodeDecl> | null = null;

function getStdlibNodeMap(): Map<string, LustreNodeDecl> {
  if (cachedStdlibNodes) return cachedStdlibNodes;
  const map = new Map<string, LustreNodeDecl>();
  for (const spec of LUSTRE_OPERATOR_SPECS) {
    const parsed = parseLustre(spec.lustreDefinition);
    const node = parsed.nodes[0];
    if (node) {
      map.set(spec.name, node);
      for (const alias of spec.aliases ?? []) {
        map.set(alias, node);
      }
    }
  }
  cachedStdlibNodes = map;
  return map;
}

function collectInstantaneousDeps(expr: LustreExpr, out: Set<string>): void {
  switch (expr.kind) {
    case "bool":
    case "int":
    case "real":
      return;
    case "var":
      out.add(expr.name);
      return;
    case "unary":
      if (expr.op === "pre") return; // pre breaks instantaneous dependency
      collectInstantaneousDeps(expr.operand, out);
      return;
    case "binary":
      collectInstantaneousDeps(expr.left, out);
      collectInstantaneousDeps(expr.right, out);
      return;
    case "if":
      collectInstantaneousDeps(expr.cond, out);
      collectInstantaneousDeps(expr.thenExpr, out);
      collectInstantaneousDeps(expr.elseExpr, out);
      return;
    case "merge":
      out.add(expr.clockVar);
      collectInstantaneousDeps(expr.trueExpr, out);
      collectInstantaneousDeps(expr.falseExpr, out);
      return;
    case "call":
      for (const a of expr.args) collectInstantaneousDeps(a, out);
      return;
    case "tuple":
    case "array":
      for (const e of expr.elements) collectInstantaneousDeps(e, out);
      return;
    case "index":
      collectInstantaneousDeps(expr.array, out);
      collectInstantaneousDeps(expr.index, out);
      return;
  }
}

function topoSortEquations(equations: LustreEquation[]): LustreEquation[] {
  const lhsToEqIdx = new Map<string, number>();
  for (let i = 0; i < equations.length; i++) {
    for (const v of equations[i]!.lhs) {
      lhsToEqIdx.set(v, i);
    }
  }

  const visited = new Uint8Array(equations.length);
  const order: LustreEquation[] = [];

  const visit = (idx: number): void => {
    if (visited[idx] !== 0) return;
    visited[idx] = 1;
    const eq = equations[idx]!;
    const deps = new Set<string>();
    collectInstantaneousDeps(eq.rhs, deps);
    for (const d of deps) {
      const depEqIdx = lhsToEqIdx.get(d);
      if (depEqIdx !== undefined && depEqIdx !== idx) {
        visit(depEqIdx);
      }
    }
    visited[idx] = 2;
    order.push(eq);
  };

  for (let i = 0; i < equations.length; i++) {
    visit(i);
  }
  return order;
}

class NodeInstance {
  private readonly sortedEquations: LustreEquation[];
  private tickCount = 0;
  // Per-expression-site registers keyed by unique path ID
  private readonly preRegisters = new Map<string, LustreRuntimeValue>();
  private readonly nextPreUpdates = new Map<string, LustreRuntimeValue>();
  private readonly arrowFired = new Set<string>();
  private readonly currentHold = new Map<string, LustreRuntimeValue>();
  private readonly childInstances = new Map<string, NodeInstance>();

  constructor(
    private readonly node: LustreNodeDecl,
    private readonly allNodes: Map<string, LustreNodeDecl>,
    private readonly constEnv: Map<string, LustreScalarValue>,
  ) {
    this.sortedEquations = topoSortEquations(node.equations);
  }

  public reset(): void {
    this.tickCount = 0;
    this.preRegisters.clear();
    this.nextPreUpdates.clear();
    this.arrowFired.clear();
    this.currentHold.clear();
    for (const child of this.childInstances.values()) {
      child.reset();
    }
  }

  public getStepCount(): number {
    return this.tickCount;
  }

  public step(inputs: LustreStepInputs): LustreStepResult {
    const env = new Map<string, LustreRuntimeValue>();
    for (const [k, v] of this.constEnv) {
      env.set(k, v);
    }
    for (const inp of this.node.inputs) {
      if (inputs[inp.name] !== undefined) {
        env.set(inp.name, inputs[inp.name]);
      } else {
        env.set(inp.name, inp.type.kind === "base" && inp.type.name === "bool" ? false : 0);
      }
    }

    this.nextPreUpdates.clear();

    // Evaluate equations in topological order
    for (let eqIdx = 0; eqIdx < this.sortedEquations.length; eqIdx++) {
      const eq = this.sortedEquations[eqIdx]!;
      const val = this.evalExpr(eq.rhs, env, `e${eqIdx}`);
      if (eq.lhs.length === 1) {
        const single = Array.isArray(val) ? val[0] : val;
        env.set(eq.lhs[0]!, single);
      } else if (Array.isArray(val)) {
        for (let i = 0; i < eq.lhs.length; i++) {
          env.set(eq.lhs[i]!, val[i]);
        }
      }
    }

    // Re-evaluate pending `pre(...)` operand expressions now that all current-tick variables are computed
    for (let eqIdx = 0; eqIdx < this.sortedEquations.length; eqIdx++) {
      this.commitPreSites(this.sortedEquations[eqIdx]!.rhs, env, `e${eqIdx}`);
    }
    for (let aIdx = 0; aIdx < this.node.assertions.length; aIdx++) {
      this.commitPreSites(this.node.assertions[aIdx]!.expr, env, `a${aIdx}`);
    }

    // Commit next pre registers
    for (const [site, v] of this.nextPreUpdates) {
      if (v !== undefined) {
        this.preRegisters.set(site, v);
      }
    }

    // Evaluate assertions
    const failedAssertions: number[] = [];
    for (let aIdx = 0; aIdx < this.node.assertions.length; aIdx++) {
      const res = this.evalExpr(this.node.assertions[aIdx]!.expr, env, `a${aIdx}`);
      if (res === false) {
        failedAssertions.push(aIdx);
      }
    }

    const outputs: LustreStepOutputs = {};
    for (const out of this.node.outputs) {
      outputs[out.name] = env.get(out.name);
    }

    const locals: Record<string, LustreRuntimeValue> = {};
    for (const loc of this.node.locals) {
      locals[loc.name] = env.get(loc.name);
    }

    const stepIndex = this.tickCount;
    this.tickCount++;

    return {
      step: stepIndex,
      inputs: { ...inputs },
      outputs,
      locals,
      assertionsPassed: failedAssertions.length === 0,
      failedAssertions,
    };
  }

  private commitPreSites(expr: LustreExpr, env: Map<string, LustreRuntimeValue>, site: string): void {
    switch (expr.kind) {
      case "unary":
        if (expr.op === "pre") {
          const curVal = this.evalExpr(expr.operand, env, `${site}.p`);
          if (curVal !== undefined && !Array.isArray(curVal)) {
            this.nextPreUpdates.set(site, curVal);
          }
          this.commitPreSites(expr.operand, env, `${site}.p`);
        } else {
          this.commitPreSites(expr.operand, env, `${site}.u`);
        }
        return;
      case "binary":
        this.commitPreSites(expr.left, env, `${site}.l`);
        this.commitPreSites(expr.right, env, `${site}.r`);
        return;
      case "if":
        this.commitPreSites(expr.cond, env, `${site}.c`);
        this.commitPreSites(expr.thenExpr, env, `${site}.t`);
        this.commitPreSites(expr.elseExpr, env, `${site}.f`);
        return;
      case "merge":
        this.commitPreSites(expr.trueExpr, env, `${site}.mt`);
        this.commitPreSites(expr.falseExpr, env, `${site}.mf`);
        return;
      case "call":
        for (let i = 0; i < expr.args.length; i++) {
          this.commitPreSites(expr.args[i]!, env, `${site}.a${i}`);
        }
        return;
      case "tuple":
      case "array":
        for (let i = 0; i < expr.elements.length; i++) {
          this.commitPreSites(expr.elements[i]!, env, `${site}.i${i}`);
        }
        return;
      case "index":
        this.commitPreSites(expr.array, env, `${site}.arr`);
        this.commitPreSites(expr.index, env, `${site}.idx`);
        return;
      default:
        return;
    }
  }

  private evalExpr(
    expr: LustreExpr,
    env: Map<string, LustreRuntimeValue>,
    site: string,
  ): LustreRuntimeValue | LustreRuntimeValue[] {
    switch (expr.kind) {
      case "bool":
        return expr.value;
      case "int":
      case "real":
        return expr.value;
      case "var":
        return env.get(expr.name);
      case "unary": {
        if (expr.op === "pre") {
          return this.preRegisters.get(site);
        }
        if (expr.op === "current") {
          const val = this.evalExpr(expr.operand, env, `${site}.u`);
          if (val !== undefined && !Array.isArray(val)) {
            this.currentHold.set(site, val);
            return val;
          }
          return this.currentHold.get(site);
        }
        const inner = this.evalExpr(expr.operand, env, `${site}.u`);
        if (inner === undefined || Array.isArray(inner)) return undefined;
        if (expr.op === "not") return !inner;
        return -Number(inner);
      }
      case "binary": {
        if (expr.op === "->") {
          const lVal = this.evalExpr(expr.left, env, `${site}.l`);
          const rVal = this.evalExpr(expr.right, env, `${site}.r`);
          if (!this.arrowFired.has(site)) {
            if (lVal !== undefined) {
              this.arrowFired.add(site);
              return lVal;
            }
            return undefined;
          }
          return rVal;
        }
        if (expr.op === "when") {
          const cond = this.evalExpr(expr.right, env, `${site}.r`);
          if (cond === true) {
            return this.evalExpr(expr.left, env, `${site}.l`);
          }
          return undefined;
        }

        const lv = this.evalExpr(expr.left, env, `${site}.l`);
        const rv = this.evalExpr(expr.right, env, `${site}.r`);
        if (lv === undefined || rv === undefined || Array.isArray(lv) || Array.isArray(rv)) {
          return undefined;
        }

        switch (expr.op) {
          case "+":
            return Number(lv) + Number(rv);
          case "-":
            return Number(lv) - Number(rv);
          case "*":
            return Number(lv) * Number(rv);
          case "/":
            return Number(rv) === 0 ? 0 : Number(lv) / Number(rv);
          case "div":
            return Number(rv) === 0 ? 0 : Math.trunc(Number(lv) / Number(rv));
          case "mod":
            return Number(rv) === 0 ? 0 : Number(lv) % Number(rv);
          case "and":
            return Boolean(lv) && Boolean(rv);
          case "or":
            return Boolean(lv) || Boolean(rv);
          case "xor":
            return Boolean(lv) !== Boolean(rv);
          case "=>":
            return !lv || Boolean(rv);
          case "=":
            return lv === rv;
          case "<>":
            return lv !== rv;
          case "<":
            return Number(lv) < Number(rv);
          case "<=":
            return Number(lv) <= Number(rv);
          case ">":
            return Number(lv) > Number(rv);
          case ">=":
            return Number(lv) >= Number(rv);
        }
        return undefined;
      }
      case "if": {
        const cond = this.evalExpr(expr.cond, env, `${site}.c`);
        if (cond === undefined) return undefined;
        // Evaluate both branches so nested `pre`/`->` sites stay clock-synchronized on base clock
        const tv = this.evalExpr(expr.thenExpr, env, `${site}.t`);
        const fv = this.evalExpr(expr.elseExpr, env, `${site}.f`);
        return cond ? tv : fv;
      }
      case "merge": {
        const clk = env.get(expr.clockVar);
        if (clk === true) return this.evalExpr(expr.trueExpr, env, `${site}.mt`);
        if (clk === false) return this.evalExpr(expr.falseExpr, env, `${site}.mf`);
        return undefined;
      }
      case "call": {
        const argVals = expr.args.map((a, i) => this.evalExpr(a, env, `${site}.a${i}`));
        if (argVals.some((v) => v === undefined)) return undefined;
        const flatArgs = argVals.map((v) => (Array.isArray(v) ? v[0] : v)) as LustreScalarValue[];

        // Built-in casts
        if (expr.callee === "int" || expr.callee === "floor") {
          return Math.trunc(Number(flatArgs[0] ?? 0));
        }
        if (expr.callee === "real") {
          return Number(flatArgs[0] ?? 0);
        }

        const calleeNode = this.allNodes.get(expr.callee);
        if (!calleeNode) return undefined;

        let child = this.childInstances.get(site);
        if (!child) {
          child = new NodeInstance(calleeNode, this.allNodes, this.constEnv);
          this.childInstances.set(site, child);
        }

        const childInputs: LustreStepInputs = {};
        for (let i = 0; i < calleeNode.inputs.length; i++) {
          const inpName = calleeNode.inputs[i]!.name;
          childInputs[inpName] = flatArgs[i]!;
        }
        const childRes = child.step(childInputs);
        const outVals = calleeNode.outputs.map((o) => childRes.outputs[o.name]);
        return outVals.length === 1 ? outVals[0] : outVals;
      }
      case "tuple":
        return expr.elements.map((e, i) => {
          const v = this.evalExpr(e, env, `${site}.i${i}`);
          return Array.isArray(v) ? v[0] : v;
        });
      case "array":
        return expr.elements.map((e, i) => {
          const v = this.evalExpr(e, env, `${site}.i${i}`);
          return Array.isArray(v) ? v[0] : v;
        });
      case "index": {
        const arr = this.evalExpr(expr.array, env, `${site}.arr`);
        const idx = this.evalExpr(expr.index, env, `${site}.idx`);
        if (Array.isArray(arr) && typeof idx === "number") {
          return arr[Math.trunc(idx)];
        }
        return undefined;
      }
    }
  }
}

function evaluateConstants(program: LustreProgram): Map<string, LustreScalarValue> {
  const constEnv = new Map<string, LustreScalarValue>();
  const evalConst = (expr: LustreExpr): LustreScalarValue | undefined => {
    switch (expr.kind) {
      case "bool":
        return expr.value;
      case "int":
      case "real":
        return expr.value;
      case "var":
        return constEnv.get(expr.name);
      case "unary": {
        const v = evalConst(expr.operand);
        if (v === undefined) return undefined;
        if (expr.op === "not") return !v;
        if (expr.op === "-") return -Number(v);
        return v;
      }
      case "binary": {
        const l = evalConst(expr.left);
        const r = evalConst(expr.right);
        if (l === undefined || r === undefined) return undefined;
        switch (expr.op) {
          case "+":
            return Number(l) + Number(r);
          case "-":
            return Number(l) - Number(r);
          case "*":
            return Number(l) * Number(r);
          case "/":
            return Number(r) === 0 ? 0 : Number(l) / Number(r);
          case "div":
            return Number(r) === 0 ? 0 : Math.trunc(Number(l) / Number(r));
          case "mod":
            return Number(r) === 0 ? 0 : Number(l) % Number(r);
          default:
            return undefined;
        }
      }
      default:
        return undefined;
    }
  };
  for (const c of program.consts) {
    if (c.value) {
      const val = evalConst(c.value);
      if (val !== undefined) constEnv.set(c.name, val);
    }
  }
  return constEnv;
}

/**
 * Creates a stateful, cycle-accurate synchronous stepper for a Lustre node.
 */
export function createLustreStepper(program: LustreProgram, nodeName?: string): LustreStepper {
  const allNodes = new Map<string, LustreNodeDecl>(getStdlibNodeMap());
  for (const n of program.nodes) {
    allNodes.set(n.name, n);
  }

  const targetNode = nodeName ? allNodes.get(nodeName) : program.nodes[program.nodes.length - 1];

  if (!targetNode) {
    throw new Error(`Lustre node '${nodeName ?? "<default>"}' not found in program.`);
  }

  const constEnv = evaluateConstants(program);
  const instance = new NodeInstance(targetNode, allNodes, constEnv);
  const trace: LustreStepResult[] = [];

  return {
    nodeName: targetNode.name,
    step(inputs: LustreStepInputs = {}): LustreStepResult {
      const res = instance.step(inputs);
      trace.push(res);
      return res;
    },
    reset(): void {
      instance.reset();
      trace.length = 0;
    },
    getStepCount(): number {
      return instance.getStepCount();
    },
    getTrace(): LustreStepResult[] {
      return trace;
    },
  };
}

/**
 * Simulates a Lustre node over a finite sequence of synchronous input ticks.
 */
export function simulateLustre(
  program: LustreProgram,
  inputTrace: LustreStepInputs[],
  options: { nodeName?: string } = {},
): LustreSimulationResult {
  const stepper = createLustreStepper(program, options.nodeName);
  const steps: LustreStepResult[] = [];
  const outputs: LustreStepOutputs[] = [];
  const assertionViolations: Array<{ step: number; assertionIndex: number }> = [];

  for (const inp of inputTrace) {
    const res = stepper.step(inp);
    steps.push(res);
    outputs.push(res.outputs);
    for (const aIdx of res.failedAssertions) {
      assertionViolations.push({ step: res.step, assertionIndex: aIdx });
    }
  }

  return {
    nodeName: stepper.nodeName,
    steps,
    outputs,
    assertionsPassed: assertionViolations.length === 0,
    assertionViolations,
  };
}

/**
 * Runs a Lustre synchronous safety-property observer node over an input trace and checks
 * that its boolean invariant output holds (`true`) on every tick.
 */
export function checkLustreObserver(
  program: LustreProgram,
  observerNodeName: string,
  inputTrace: LustreStepInputs[],
  options: { propertyOutput?: string } = {},
): LustreObserverResult {
  const target = program.nodes.find((n) => n.name === observerNodeName);
  const propertyOutput = options.propertyOutput ?? target?.outputs[0]?.name ?? "ok";
  const sim = simulateLustre(program, inputTrace, { nodeName: observerNodeName });
  const violations: number[] = [];

  for (const s of sim.steps) {
    if (s.outputs[propertyOutput] !== true || !s.assertionsPassed) {
      violations.push(s.step);
    }
  }

  return {
    observerNode: observerNodeName,
    propertyOutput,
    satisfied: violations.length === 0,
    firstViolationStep: violations.length > 0 ? violations[0]! : null,
    violations,
    steps: sim.steps,
  };
}
