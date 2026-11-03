// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module @modelscript/ide-client/dap/simulation-debug-session
 *
 * Interactive WebAssembly DAE Simulation Stepper and Debug Session for ModelScript.
 * Supports flattening and stepping real Modelica `.mo` source files on disk via
 * `@modelscript/modelica` (`Context.flattenArena`) and `@modelscript/runtime` (`DAEBuilder`),
 * with a default `dx/dt = -k*x` fallback model when no `.mo` file is present on disk.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  evaluateArenaExpression,
  ExprKind,
  Variability,
  VarType,
} from "@modelscript/runtime";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DebugVariableEntry {
  name: string;
  value: string;
  variablesReference: number;
}

export interface SimulationStepSnapshot {
  time: number;
  step: number;
  variables: Record<string, number>;
}

/**
 * Steps a flattened Modelica `DAEBuilder` arena forward in time for interactive DAP debugging.
 * When `program` points to an existing `.mo` file on disk, flattens and steps the actual Modelica
 * model equations; otherwise falls back to the reference `dx/dt = -k * x` test system.
 */
export class WasmSimulationStepper {
  public arena: DAEBuilder;
  public time = 0;
  public dt: number;
  public stepCount = 0;
  public loadedFromSource = false;
  public modelName = "FallbackExponentialDecay";
  public readonly programPath?: string | undefined;

  public readonly stateValues = new Map<string, number>();
  public readonly derivativeValues = new Map<string, number>();
  public readonly algebraicValues = new Map<string, number>();
  public readonly parameterValues = new Map<string, number>();

  private stateDerivativeExprs = new Map<string, number>();
  private algebraicExprs = new Map<string, number>();
  private sourceText?: string | undefined;

  public constructor(program?: string, dt = 0.01) {
    this.dt = dt;
    this.arena = new DAEBuilder();

    const resolvedPath = this.resolveProgramFilePath(program);
    this.programPath = resolvedPath;

    if (resolvedPath && fs.existsSync(resolvedPath) && resolvedPath.endsWith(".mo")) {
      try {
        const src = fs.readFileSync(resolvedPath, "utf8");
        this.sourceText = src;
        if (this.tryFlattenWithModelicaContextSync(src, resolvedPath) || this.lowerModelicaSourceToArena(src)) {
          this.loadedFromSource = true;
          this.extractSystemFromArena();
          this.evaluateCurrentDerivativesAndAlgebraics();
          return;
        }
      } catch {
        // Fall through to default arena
      }
    } else if (program && /\bmodel\s+[A-Za-z_]/.test(program) && /\bequation\b/.test(program)) {
      this.sourceText = program;
      if (this.lowerModelicaSourceToArena(program)) {
        this.loadedFromSource = true;
        this.extractSystemFromArena();
        this.evaluateCurrentDerivativesAndAlgebraics();
        return;
      }
    }

    this.buildFallbackDecayArena();
    this.extractSystemFromArena();
    this.evaluateCurrentDerivativesAndAlgebraics();
  }

  /**
   * Asynchronously initializes the full `@modelscript/modelica` WASM GLR parser and
   * `Context.flattenArena` pipeline when `program` points to an existing `.mo` file on disk.
   */
  public async init(): Promise<void> {
    if (!this.programPath || !this.sourceText) return;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      const globalRec = globalThis as Record<string, unknown>;
      let parser = globalRec["modelicaParser"];
      if (!parser) {
        let wasmPath: string | undefined;
        try {
          wasmPath = req.resolve("@modelscript/modelica/parser.wasm");
        } catch {
          try {
            wasmPath = req.resolve("@modelscript/modelica/dist/parser.wasm");
          } catch {
            const candidate = path.resolve(process.cwd(), "languages/modelica/dist/parser.wasm");
            if (fs.existsSync(candidate)) wasmPath = candidate;
          }
        }
        if (wasmPath) {
          const { createWasmParser } = await import("@modelscript/dsl/bindings");
          const loaded = await createWasmParser(wasmPath);
          parser = loaded.parser;
          globalRec["modelicaParser"] = parser;
        }
      }
      if (parser) {
        const { Context } = await import("@modelscript/modelica");
        Context.registerParser(".mo", parser as unknown as Parameters<(typeof Context)["registerParser"]>[1]);
        if (this.tryFlattenWithModelicaContextSync(this.sourceText, this.programPath, Context)) {
          this.loadedFromSource = true;
          this.time = 0;
          this.stepCount = 0;
          this.extractSystemFromArena();
          this.evaluateCurrentDerivativesAndAlgebraics();
        }
      }
    } catch {
      // Keep direct arena lowering if WASM parser cannot be loaded
    }
  }

  private resolveProgramFilePath(program?: string): string | undefined {
    if (!program) return undefined;
    let p = program.trim();
    if (p.startsWith("file://")) {
      p = p.slice("file://".length);
    }
    return p;
  }

  private tryFlattenWithModelicaContextSync(source: string, filePath: string, ContextCtor?: unknown): boolean {
    try {
      const globalRec = globalThis as Record<string, unknown>;
      const parser = globalRec["modelicaParser"];
      if (!parser || typeof ContextCtor !== "function") return false;
      const classMatch = source.match(/\b(?:model|class|block)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (!classMatch?.[1]) return false;
      const className = classMatch[1];

      interface ModelicaContextInstance {
        load: (src: string, path: string) => void;
        flattenArena: (className: string, options?: unknown, path?: string) => DAEBuilder | null | undefined;
      }

      interface ModelicaContextStatic {
        new (...args: unknown[]): ModelicaContextInstance;
        registerParser: (ext: string, parser: unknown) => void;
      }

      const Ctor = ContextCtor as unknown as ModelicaContextStatic;
      Ctor.registerParser(".mo", parser);
      const memFiles = new Map<string, string>([[filePath, source]]);
      const memFs = {
        readFile: (p: string) => memFiles.get(p) ?? (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""),
        exists: (p: string) => memFiles.has(p) || fs.existsSync(p),
        readDir: () => [] as string[],
        isDir: () => false,
      };
      const ctx = new Ctor(memFs, undefined, undefined, { loadStdlib: false });
      ctx.load(source, filePath);
      const flattened = ctx.flattenArena(className, undefined, filePath);
      if (flattened && flattened.varCount > 0) {
        this.arena = flattened;
        this.modelName = className;
        return true;
      }
    } catch {
      // Fallback to direct lowering
    }
    return false;
  }

  /**
   * Lowers a Modelica `.mo` source string directly into `DAEBuilder` linear memory
   * so real `.mo` models on disk are flattened and stepped even before async WASM parser init.
   */
  private lowerModelicaSourceToArena(source: string): boolean {
    const clean = source.replace(/\/\/[^\r\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const modelMatch = clean.match(/\b(?:model|class|block)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!modelMatch?.[1]) return false;
    this.modelName = modelMatch[1];

    const arena = new DAEBuilder(undefined, this.modelName);
    const varIds = new Map<string, number>();

    const parts = clean.split(/\bequation\b/);
    const declSection = parts[0] ?? clean;
    const eqSectionRaw = parts.slice(1).join("\n");
    const eqSection = eqSectionRaw.split(/\b(?:algorithm|end\s+[A-Za-z_][A-Za-z0-9_]*)\b/)[0] ?? "";

    // Parse declarations
    const declStmts = declSection
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of declStmts) {
      const m = stmt.match(
        /^(?:(?:public|protected)\s+)?(?:(parameter|constant|discrete)\s+)?(?:(input|output)\s+)?(?:Modelica\.SIunits\.[A-Za-z0-9_]+|Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?(?:\s*=\s*(.+))?$/,
      );
      if (!m) continue;
      const varPrefix = m[1];
      const causPrefix = m[2];
      const name = m[3]!;
      const mods = m[4] ?? "";
      const rhsStr = m[5]?.trim();

      const variability =
        varPrefix === "parameter"
          ? Variability.Parameter
          : varPrefix === "constant"
            ? Variability.Constant
            : varPrefix === "discrete"
              ? Variability.Discrete
              : Variability.Continuous;

      const causality =
        causPrefix === "input" ? Causality.Input : causPrefix === "output" ? Causality.Output : Causality.Local;

      let startValue = 0.0;
      const startMatch = mods.match(/\bstart\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
      if (startMatch?.[1]) {
        startValue = Number(startMatch[1]);
      }

      const id = arena.addVariable(name, VarType.Real, variability, causality, startValue);
      varIds.set(name, id);
      if (startMatch?.[1]) {
        arena.setVarAttr(id, "start", arena.addRealLiteral(startValue));
      }

      if (rhsStr !== undefined) {
        const exprId = this.compileExprToArena(rhsStr, arena, varIds);
        if (exprId >= 0) {
          arena.setVarExpression(id, exprId);
        }
      }
    }

    // Parse equations in equation section
    const eqStmts = eqSection
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const eq of eqStmts) {
      if (eq.startsWith("connect(") || eq.startsWith("assert(") || eq.startsWith("annotation")) continue;
      const eqIdx = eq.indexOf("=");
      if (eqIdx <= 0) continue;
      const lhsStr = eq.slice(0, eqIdx).trim();
      const rhsStr = eq.slice(eqIdx + 1).trim();
      const lhsExpr = this.compileExprToArena(lhsStr, arena, varIds);
      const rhsExpr = this.compileExprToArena(rhsStr, arena, varIds);
      if (lhsExpr >= 0 && rhsExpr >= 0) {
        arena.addEquation(EqKind.Simple, lhsExpr, rhsExpr);
      }
    }

    if (arena.varCount === 0 && arena.eqCount === 0) {
      return false;
    }

    this.arena = arena;
    return true;
  }

  private compileExprToArena(exprStr: string, arena: DAEBuilder, varIds: Map<string, number>): number {
    let s = exprStr.trim();
    if (!s) return -1;

    // Strip outer balanced parentheses
    while (s.startsWith("(") && s.endsWith(")")) {
      let depth = 0;
      let balanced = true;
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
          depth--;
          if (depth === 0) {
            balanced = false;
            break;
          }
        }
      }
      if (balanced) s = s.slice(1, -1).trim();
      else break;
    }

    // Binary Add / Sub at top level (right-to-left for left-associativity)
    let depth = 0;
    for (let i = s.length - 1; i > 0; i--) {
      const ch = s[i];
      if (ch === ")") depth++;
      else if (ch === "(") depth--;
      else if (depth === 0 && (ch === "+" || ch === "-")) {
        const prev = s.slice(0, i).trimEnd();
        const prevChar = prev[prev.length - 1];
        if (prevChar && !/[+\-*/(^,eE]/.test(prevChar)) {
          const left = this.compileExprToArena(s.slice(0, i), arena, varIds);
          const right = this.compileExprToArena(s.slice(i + 1), arena, varIds);
          if (left >= 0 && right >= 0) {
            return arena.addBinaryExpr(ch === "+" ? BinOp.Add : BinOp.Sub, left, right);
          }
        }
      }
    }

    // Binary Mul / Div at top level
    depth = 0;
    for (let i = s.length - 1; i > 0; i--) {
      const ch = s[i];
      if (ch === ")") depth++;
      else if (ch === "(") depth--;
      else if (depth === 0 && (ch === "*" || ch === "/")) {
        const left = this.compileExprToArena(s.slice(0, i), arena, varIds);
        const right = this.compileExprToArena(s.slice(i + 1), arena, varIds);
        if (left >= 0 && right >= 0) {
          return arena.addBinaryExpr(ch === "*" ? BinOp.Mul : BinOp.Div, left, right);
        }
      }
    }

    // Power ^
    depth = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && ch === "^") {
        const left = this.compileExprToArena(s.slice(0, i), arena, varIds);
        const right = this.compileExprToArena(s.slice(i + 1), arena, varIds);
        if (left >= 0 && right >= 0) {
          return arena.addBinaryExpr(BinOp.Pow, left, right);
        }
      }
    }

    // Unary negation
    if (s.startsWith("-")) {
      const inner = this.compileExprToArena(s.slice(1), arena, varIds);
      return inner >= 0 ? arena.addExpression(ExprKind.Negate, 0, inner, 0) : -1;
    }
    if (s.startsWith("+")) {
      return this.compileExprToArena(s.slice(1), arena, varIds);
    }

    // der(x)
    const derMatch = s.match(/^der\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)$/);
    if (derMatch?.[1]) {
      const vName = derMatch[1];
      let vId = varIds.get(vName);
      if (vId === undefined) {
        vId = arena.addVariable(vName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        varIds.set(vName, vId);
      }
      arena.setVarState(vId, true);
      return arena.addDerExpr(arena.addNameExpr(vName));
    }

    // Standard math function call: sin(x), cos(x), exp(x), sqrt(x), abs(x)
    const callMatch = s.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*\((.+)\)$/);
    if (callMatch?.[1] && callMatch[2]) {
      const fnName = callMatch[1];
      const argExpr = this.compileExprToArena(callMatch[2], arena, varIds);
      if (argExpr >= 0) {
        return arena.addCallExpr(fnName, [argExpr]);
      }
    }

    // Numeric literal
    const numVal = Number(s);
    if (Number.isFinite(numVal)) {
      return arena.addRealLiteral(numVal);
    }

    // Variable reference (including `time`)
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s)) {
      if (s !== "time" && !varIds.has(s)) {
        const vId = arena.addVariable(s, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        varIds.set(s, vId);
      }
      return arena.addNameExpr(s);
    }

    return -1;
  }

  private buildFallbackDecayArena(): void {
    const arena = new DAEBuilder(undefined, "FallbackExponentialDecay");
    const kId = arena.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 0.5);
    arena.setVarExpression(kId, arena.addRealLiteral(0.5));

    const xId = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    arena.setVarState(xId, true);

    const derX = arena.addDerExpr(arena.addNameExpr("x"));
    const prod = arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("k"), arena.addNameExpr("x"));
    const rhs = arena.addExpression(ExprKind.Negate, 0, prod, 0);
    arena.addEquation(EqKind.Simple, derX, rhs);

    this.arena = arena;
    this.modelName = "FallbackExponentialDecay";
    this.loadedFromSource = false;
  }

  private resolveDerStateName(exprId: number): string | undefined {
    const arena = this.arena;
    if (exprId < 0 || exprId >= arena.exprCount) return undefined;
    if (arena.getExprKind(exprId) !== ExprKind.Der) return undefined;
    const argId = arena.getExprData1(exprId);
    if (argId >= 0 && argId < arena.exprCount && arena.getExprKind(argId) === ExprKind.Name) {
      return arena.interner.resolve(arena.getExprData1(argId));
    }
    if (argId >= 0 && argId < arena.varCount) {
      const name = arena.getVarName(argId);
      if (name) return name;
    }
    return undefined;
  }

  private extractSystemFromArena(): void {
    this.stateValues.clear();
    this.derivativeValues.clear();
    this.algebraicValues.clear();
    this.parameterValues.clear();
    this.stateDerivativeExprs.clear();
    this.algebraicExprs.clear();

    const arena = this.arena;

    // 1. Identify states referenced inside der(...) across all equations
    const stateNames = new Set<string>();
    const markDerStates = (exprId: number) => {
      if (exprId < 0 || exprId >= arena.exprCount) return;
      const kind = arena.getExprKind(exprId);
      if (kind === ExprKind.Der) {
        const sName = this.resolveDerStateName(exprId);
        if (sName) {
          stateNames.add(sName);
          const vId = arena.lookupVariable(sName);
          if (vId >= 0) arena.setVarState(vId, true);
        }
      } else if (kind === ExprKind.Binary) {
        markDerStates(arena.getExprLeft(exprId));
        markDerStates(arena.getExprRight(exprId));
      } else if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
        markDerStates(arena.getExprLeft(exprId));
      }
    };

    for (let e = 0; e < arena.eqCount; e++) {
      if (arena.getEqKind(e) === EqKind.Simple) {
        markDerStates(arena.getEqLhs(e));
        markDerStates(arena.getEqRhs(e));
      }
    }

    // 2. First pass: parameters and constants
    for (let i = 0; i < arena.varCount; i++) {
      const name = arena.getVarName(i);
      if (!name || name === "time") continue;
      const variability = arena.getVarVariability(i);
      if (variability === Variability.Parameter || variability === Variability.Constant) {
        let val = arena.getVarStartValue(i);
        const bindExpr = arena.getVarExpression(i);
        if (bindExpr !== undefined && bindExpr >= 0) {
          const evalVal = evaluateArenaExpression(arena, bindExpr, this.createEvalContext());
          if (typeof evalVal === "number" && Number.isFinite(evalVal)) {
            val = evalVal;
          }
        }
        this.parameterValues.set(name, val);
      }
    }

    // 3. Second pass: states and algebraic variables
    for (let i = 0; i < arena.varCount; i++) {
      const name = arena.getVarName(i);
      if (!name || name === "time") continue;
      const variability = arena.getVarVariability(i);
      if (variability === Variability.Parameter || variability === Variability.Constant) continue;

      let initVal = arena.getVarStartValue(i);
      const startAttrExpr = arena.getVarAttr(i, "start");
      if (startAttrExpr !== undefined && startAttrExpr >= 0) {
        const evalStart = evaluateArenaExpression(arena, startAttrExpr, this.createEvalContext());
        if (typeof evalStart === "number" && Number.isFinite(evalStart)) {
          initVal = evalStart;
        }
      }
      const bindExpr = arena.getExplicitVarExpression(i);
      if (bindExpr !== undefined && bindExpr >= 0) {
        const evalVal = evaluateArenaExpression(arena, bindExpr, this.createEvalContext());
        if (typeof evalVal === "number" && Number.isFinite(evalVal)) {
          initVal = evalVal;
        }
      }

      if (arena.isVarState(i) || stateNames.has(name)) {
        this.stateValues.set(name, initVal);
        this.derivativeValues.set(name, 0);
      } else {
        this.algebraicValues.set(name, initVal);
        if (bindExpr !== undefined && bindExpr >= 0) {
          this.algebraicExprs.set(name, bindExpr);
        }
      }
    }

    // 4. Map equations to state derivative expressions and algebraic variable expressions
    for (let e = 0; e < arena.eqCount; e++) {
      if (arena.getEqKind(e) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(e);
      const rhs = arena.getEqRhs(e);
      if (lhs < 0 || rhs < 0) continue;

      const lhsKind = arena.getExprKind(lhs);
      const rhsKind = arena.getExprKind(rhs);

      if (lhsKind === ExprKind.Der) {
        const vName = this.resolveDerStateName(lhs);
        if (vName) {
          this.stateDerivativeExprs.set(vName, rhs);
          continue;
        }
      }
      if (rhsKind === ExprKind.Der) {
        const vName = this.resolveDerStateName(rhs);
        if (vName) {
          this.stateDerivativeExprs.set(vName, lhs);
          continue;
        }
      }

      if (lhsKind === ExprKind.Name) {
        const vName = arena.interner.resolve(arena.getExprData1(lhs));
        if (vName && !this.stateValues.has(vName) && !this.parameterValues.has(vName)) {
          this.algebraicExprs.set(vName, rhs);
          continue;
        }
      }
      if (rhsKind === ExprKind.Name) {
        const vName = arena.interner.resolve(arena.getExprData1(rhs));
        if (vName && !this.stateValues.has(vName) && !this.parameterValues.has(vName)) {
          this.algebraicExprs.set(vName, lhs);
        }
      }
    }
  }

  private createEvalContext(overrideStates?: Map<string, number>, overrideTime?: number): Map<string, number> {
    const vars = new Map<string, number>();
    for (const [k, v] of this.parameterValues) vars.set(k, v);
    for (const [k, v] of this.algebraicValues) vars.set(k, v);
    const states = overrideStates ?? this.stateValues;
    for (const [k, v] of states) vars.set(k, v);
    vars.set("time", overrideTime ?? this.time);
    return vars;
  }

  private evaluateCurrentDerivativesAndAlgebraics(): void {
    for (let pass = 0; pass < 2; pass++) {
      const ctx = this.createEvalContext();
      for (const [algName, exprId] of this.algebraicExprs) {
        const val = evaluateArenaExpression(this.arena, exprId, ctx);
        if (typeof val === "number" && Number.isFinite(val)) {
          this.algebraicValues.set(algName, val);
          ctx.set(algName, val);
        }
      }
      for (const [stateName, exprId] of this.stateDerivativeExprs) {
        const dVal = evaluateArenaExpression(this.arena, exprId, ctx);
        if (typeof dVal === "number" && Number.isFinite(dVal)) {
          this.derivativeValues.set(stateName, dVal);
        }
      }
    }
  }

  /**
   * Advances the simulation by one integration step (`dt`) using RK4 on the flattened DAE arena.
   */
  public step(customDt?: number): SimulationStepSnapshot {
    const h = customDt ?? this.dt;
    const t0 = this.time;

    const evalDerivativesAt = (states: Map<string, number>, t: number): Map<string, number> => {
      const ctx = this.createEvalContext(states, t);
      for (const [algName, exprId] of this.algebraicExprs) {
        const val = evaluateArenaExpression(this.arena, exprId, ctx);
        if (typeof val === "number" && Number.isFinite(val)) {
          ctx.set(algName, val);
        }
      }
      const derivs = new Map<string, number>();
      for (const [stateName] of this.stateValues) {
        const exprId = this.stateDerivativeExprs.get(stateName);
        if (exprId !== undefined) {
          const val = evaluateArenaExpression(this.arena, exprId, ctx);
          derivs.set(stateName, typeof val === "number" && Number.isFinite(val) ? val : 0);
        } else {
          derivs.set(stateName, 0);
        }
      }
      return derivs;
    };

    if (this.stateValues.size > 0) {
      const k1 = evalDerivativesAt(this.stateValues, t0);

      const s2 = new Map<string, number>();
      for (const [name, y] of this.stateValues) {
        s2.set(name, y + 0.5 * h * (k1.get(name) ?? 0));
      }
      const k2 = evalDerivativesAt(s2, t0 + 0.5 * h);

      const s3 = new Map<string, number>();
      for (const [name, y] of this.stateValues) {
        s3.set(name, y + 0.5 * h * (k2.get(name) ?? 0));
      }
      const k3 = evalDerivativesAt(s3, t0 + 0.5 * h);

      const s4 = new Map<string, number>();
      for (const [name, y] of this.stateValues) {
        s4.set(name, y + h * (k3.get(name) ?? 0));
      }
      const k4 = evalDerivativesAt(s4, t0 + h);

      for (const [name, y] of this.stateValues) {
        const d1 = k1.get(name) ?? 0;
        const d2 = k2.get(name) ?? 0;
        const d3 = k3.get(name) ?? 0;
        const d4 = k4.get(name) ?? 0;
        this.stateValues.set(name, y + (h / 6) * (d1 + 2 * d2 + 2 * d3 + d4));
      }
    }

    this.time = Number((t0 + h).toFixed(12));
    this.stepCount += 1;
    this.evaluateCurrentDerivativesAndAlgebraics();

    return {
      time: this.time,
      step: this.stepCount,
      variables: this.getVariableSnapshot(),
    };
  }

  public getVariableSnapshot(): Record<string, number> {
    const out: Record<string, number> = {
      time: this.time,
      dt: this.dt,
      step: this.stepCount,
    };
    for (const [k, v] of this.parameterValues) out[k] = v;
    for (const [k, v] of this.stateValues) out[k] = v;
    for (const [k, v] of this.derivativeValues) out[`der(${k})`] = v;
    for (const [k, v] of this.algebraicValues) out[k] = v;
    return out;
  }

  public getDebugVariables(): DebugVariableEntry[] {
    const entries: DebugVariableEntry[] = [];
    for (const [name, val] of this.stateValues) {
      entries.push({ name, value: String(val), variablesReference: 0 });
    }
    for (const [name, val] of this.derivativeValues) {
      entries.push({ name: `der(${name})`, value: String(val), variablesReference: 0 });
    }
    for (const [name, val] of this.algebraicValues) {
      entries.push({ name, value: String(val), variablesReference: 0 });
    }
    for (const [name, val] of this.parameterValues) {
      entries.push({ name, value: String(val), variablesReference: 0 });
    }
    entries.push({ name: "time", value: String(this.time), variablesReference: 0 });
    entries.push({ name: "dt", value: String(this.dt), variablesReference: 0 });
    entries.push({ name: "step", value: String(this.stepCount), variablesReference: 0 });
    return entries;
  }

  public reset(): void {
    this.time = 0;
    this.stepCount = 0;
    this.extractSystemFromArena();
    this.evaluateCurrentDerivativesAndAlgebraics();
  }
}
