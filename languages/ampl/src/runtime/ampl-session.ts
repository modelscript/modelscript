// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Stateful Imperative `.run` Scripting Engine & Session Runtime (`AmplSession`).
 *
 * Executes iterative optimization algorithms (Benders decomposition, column generation,
 * sensitivity sweeps, rolling-horizon MPC) using AMPL's imperative scripting commands:
 * `for`, `repeat while/until`, `if-then-else`, `let`, `fix`, `unfix`, `drop`, `restore`,
 * `objective`, `solve`, `display`, `printf`, `read table`, `write table`, and `reset`.
 */

import fs from "node:fs";
import path from "node:path";
import { instantiateAmpl } from "../instantiator/model-instantiator.js";
import { SetEvaluator, stringifyTuple } from "../instantiator/set-evaluator.js";
import { parseAmplData } from "../parser/ampl-dat-parser.js";
import { parseAmplModel } from "../parser/ampl-mod-parser.js";
import { solveAmpl } from "../solvers/ampl-solver.js";
import {
  createSuffixResolver,
  readAmplTable,
  writeAmplTable,
} from "../tables/table-handler.js";
import type {
  AmplData,
  AmplExpr,
  AmplModel,
  AmplSolverOptions,
  AmplSolverResult,
  AmplStmt,
  InstantiatedProblem,
  SetElement,
} from "../types.js";

export interface AmplSessionOptions {
  baseDir?: string | undefined;
  cwd?: string | undefined;
  virtualFiles?: Record<string, string> | undefined;
  solverOptions?: AmplSolverOptions | undefined;
  onOutput?: ((text: string) => void) | undefined;
}

export interface AmplSessionResult {
  session: AmplSession;
  lastProblem?: InstantiatedProblem | undefined;
  lastResult?: AmplSolverResult | undefined;
  solveHistory: AmplSolverResult[];
  output: string;
  outputLines: string[];
  tableOutputs: Record<string, string>;
}

type LoopSignal = "none" | "break" | "continue";

export class AmplSession {
  public model: AmplModel = {
    sets: new Map(),
    params: new Map(),
    vars: new Map(),
    objectives: new Map(),
    constraints: new Map(),
    nodes: new Map(),
    arcs: new Map(),
    functions: new Map(),
    problems: new Map(),
    suffixes: new Map(),
    tables: new Map(),
    checks: [],
    statements: [],
  };
  public data: AmplData = {
    sets: new Map(),
    params: new Map(),
  };

  public options = new Map<string, string | number>();
  public activeObjective: string | undefined;
  public fixedVars = new Map<string, number>();
  public droppedConstraints = new Set<string>();
  public varBoundOverrides = new Map<
    string,
    {
      lb?: number | undefined;
      ub?: number | undefined;
      init?: number | undefined;
      sosno?: number | undefined;
      ref?: number | undefined;
      customSuffixes?: Map<string, number | string> | undefined;
    }
  >();

  public lastProblem: InstantiatedProblem | undefined;
  public lastResult: AmplSolverResult | undefined;
  public solveHistory: AmplSolverResult[] = [];
  public outputLines: string[] = [];
  public virtualFiles = new Map<string, string>();
  public tableOutputs = new Map<string, string>();

  private baseDir: string;
  private defaultSolverOptions: AmplSolverOptions;
  private onOutput?: ((text: string) => void) | undefined;

  constructor(sessionOpts?: AmplSessionOptions) {
    this.baseDir = sessionOpts?.baseDir ?? sessionOpts?.cwd ?? process.cwd();
    this.defaultSolverOptions = sessionOpts?.solverOptions ?? {};
    this.onOutput = sessionOpts?.onOutput;
    if (sessionOpts?.virtualFiles) {
      for (const [k, v] of Object.entries(sessionOpts.virtualFiles)) {
        this.virtualFiles.set(k, v);
      }
    }
  }

  public loadModelText(modText: string): void {
    const parsed = parseAmplModel(modText);
    this.mergeModel(parsed);
  }

  public loadDataText(datText: string): void {
    const parsed = parseAmplData(datText);
    this.mergeData(parsed);
  }

  public async evalScript(scriptText: string): Promise<AmplSessionResult> {
    const parsed = parseAmplModel(scriptText);
    this.mergeModel(parsed);
    if (parsed.statements && parsed.statements.length > 0) {
      await this.executeStatements(parsed.statements, new Map());
    }
    return this.getResult();
  }

  public async executeText(scriptText: string): Promise<AmplSessionResult> {
    return this.evalScript(scriptText);
  }

  public async solve(): Promise<AmplSolverResult> {
    await this.executeSingleStatement({ kind: "solve_cmd" }, new Map());
    if (!this.lastResult) {
      throw new Error("Solve produced no result.");
    }
    return this.lastResult;
  }

  public getLastResult(): AmplSolverResult | undefined {
    return this.lastResult;
  }

  public reset(mode: "all" | "data" = "all", targets?: string[] | undefined): void {
    if (mode === "all") {
      this.model.sets.clear();
      this.model.params.clear();
      this.model.vars.clear();
      this.model.objectives.clear();
      this.model.constraints.clear();
      this.model.nodes?.clear();
      this.model.arcs?.clear();
      this.model.functions?.clear();
      this.model.problems?.clear();
      this.model.suffixes?.clear();
      this.model.tables?.clear();
      this.data.sets.clear();
      this.data.params.clear();
      this.fixedVars.clear();
      this.droppedConstraints.clear();
      this.varBoundOverrides.clear();
      this.lastProblem = undefined;
      this.lastResult = undefined;
    } else {
      if (targets && targets.length > 0) {
        for (const t of targets) {
          this.data.sets.delete(t);
          this.data.params.delete(t);
        }
      } else {
        this.data.sets.clear();
        this.data.params.clear();
      }
    }
  }

  public getResult(): AmplSessionResult {
    const tblOut: Record<string, string> = {};
    for (const [k, v] of this.tableOutputs.entries()) {
      tblOut[k] = v;
    }
    return {
      session: this,
      lastProblem: this.lastProblem,
      lastResult: this.lastResult,
      solveHistory: this.solveHistory,
      output: this.outputLines.join("\n"),
      outputLines: [...this.outputLines],
      tableOutputs: tblOut,
    };
  }

  private mergeModel(incoming: AmplModel): void {
    for (const [k, v] of incoming.sets.entries()) this.model.sets.set(k, v);
    for (const [k, v] of incoming.params.entries()) this.model.params.set(k, v);
    for (const [k, v] of incoming.vars.entries()) this.model.vars.set(k, v);
    for (const [k, v] of incoming.objectives.entries()) this.model.objectives.set(k, v);
    for (const [k, v] of incoming.constraints.entries()) this.model.constraints.set(k, v);
    if (incoming.nodes) {
      for (const [k, v] of incoming.nodes.entries()) this.model.nodes!.set(k, v);
    }
    if (incoming.arcs) {
      for (const [k, v] of incoming.arcs.entries()) this.model.arcs!.set(k, v);
    }
    if (incoming.functions) {
      for (const [k, v] of incoming.functions.entries()) this.model.functions!.set(k, v);
    }
    if (incoming.problems) {
      for (const [k, v] of incoming.problems.entries()) this.model.problems!.set(k, v);
    }
    if (incoming.suffixes) {
      for (const [k, v] of incoming.suffixes.entries()) this.model.suffixes!.set(k, v);
    }
    if (incoming.tables) {
      for (const [k, v] of incoming.tables.entries()) this.model.tables!.set(k, v);
    }
    if (incoming.checks) {
      this.model.checks!.push(...incoming.checks);
    }
  }

  private mergeData(incoming: AmplData): void {
    for (const [k, v] of incoming.sets.entries()) {
      this.data.sets.set(k, [...v]);
    }
    for (const [k, v] of incoming.params.entries()) {
      let existing = this.data.params.get(k);
      if (!existing) {
        existing = new Map();
        this.data.params.set(k, existing);
      }
      for (const [pk, pv] of v.entries()) {
        existing.set(pk, pv);
      }
    }
  }

  private readFileText(filePath: string): string {
    if (this.virtualFiles.has(filePath)) {
      return this.virtualFiles.get(filePath)!;
    }
    const resolved = path.resolve(this.baseDir, filePath);
    if (this.virtualFiles.has(resolved)) {
      return this.virtualFiles.get(resolved)!;
    }
    return fs.readFileSync(resolved, "utf-8");
  }

  private makeSetEvaluator(): SetEvaluator {
    return new SetEvaluator(this.model, this.data, createSuffixResolver(this.lastResult));
  }

  private emitOutput(text: string): void {
    this.outputLines.push(text);
    if (this.onOutput) this.onOutput(text);
  }

  public async executeStatements(
    stmts: AmplStmt[],
    env: Map<string, SetElement>,
  ): Promise<LoopSignal> {
    for (const stmt of stmts) {
      const sig = await this.executeSingleStatement(stmt, env);
      if (sig !== "none") return sig;
    }
    return "none";
  }

  private async executeSingleStatement(
    stmt: AmplStmt,
    env: Map<string, SetElement>,
  ): Promise<LoopSignal> {
    switch (stmt.kind) {
      case "break_cmd":
        return "break";

      case "continue_cmd":
        return "continue";

      case "model_cmd": {
        const text = this.readFileText(stmt.filePath);
        this.loadModelText(text);
        break;
      }

      case "data_cmd": {
        const text = this.readFileText(stmt.filePath);
        this.loadDataText(text);
        break;
      }

      case "include_cmd": {
        const text = this.readFileText(stmt.filePath);
        const parsed = parseAmplModel(text);
        this.mergeModel(parsed);
        if (parsed.statements && parsed.statements.length > 0) {
          return this.executeStatements(parsed.statements, env);
        }
        break;
      }

      case "option_cmd": {
        this.options.set(stmt.name.toLowerCase(), stmt.value);
        break;
      }

      case "objective_cmd": {
        this.activeObjective = stmt.name;
        break;
      }

      case "problem_cmd": {
        this.switchProblem(stmt.name);
        break;
      }

      case "reset_cmd": {
        if (stmt.mode === "all") {
          this.model.sets.clear();
          this.model.params.clear();
          this.model.vars.clear();
          this.model.objectives.clear();
          this.model.constraints.clear();
          this.model.tables?.clear();
          this.data.sets.clear();
          this.data.params.clear();
          this.fixedVars.clear();
          this.droppedConstraints.clear();
          this.varBoundOverrides.clear();
          this.lastProblem = undefined;
          this.lastResult = undefined;
        } else {
          if (stmt.targets && stmt.targets.length > 0) {
            for (const t of stmt.targets) {
              this.data.sets.delete(t);
              this.data.params.delete(t);
            }
          } else {
            this.data.sets.clear();
            this.data.params.clear();
          }
        }
        break;
      }

      case "solve_cmd": {
        const mpecOpt = String(this.options.get("mpec_mode") ?? this.defaultSolverOptions.mpecMode ?? "milp") as "milp" | "nlp";
        const bigMOpt = Number(this.options.get("big_m") ?? this.defaultSolverOptions.bigM ?? 1e4);
        const presolveOpt =
          this.options.has("presolve")
            ? Boolean(Number(this.options.get("presolve"))) && String(this.options.get("presolve")) !== "off"
            : this.defaultSolverOptions.presolve;
        const solverName = (this.options.get("solver") ?? this.defaultSolverOptions.solver) as AmplSolverOptions["solver"];

        const problem = instantiateAmpl(this.model, this.data, {
          activeObjective: this.activeObjective,
          mpecMode: mpecOpt,
          bigM: bigMOpt,
          fixedVars: this.fixedVars,
          droppedConstraints: this.droppedConstraints,
          varBoundOverrides: this.varBoundOverrides,
        });

        const res = await solveAmpl(problem, {
          ...this.defaultSolverOptions,
          solver: solverName,
          presolve: presolveOpt,
          mpecMode: mpecOpt,
          bigM: bigMOpt,
        });

        this.lastProblem = problem;
        this.lastResult = res;
        this.solveHistory.push(res);

        // Update variable initial values with current primal solution for subsequent solves
        for (const [vName, vVal] of Object.entries(res.variables)) {
          const cur = this.varBoundOverrides.get(vName) ?? {};
          cur.init = vVal;
          this.varBoundOverrides.set(vName, cur);
        }
        break;
      }

      case "let_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          this.applyLetAssignment(stmt.target, stmt.value, cEnv, setEval);
        }
        break;
      }

      case "fix_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          const names = this.resolveTargetEntityNames(stmt.target, cEnv, setEval, "var");
          for (const vName of names) {
            let val: number;
            if (stmt.value) {
              val = setEval.evalScalar(stmt.value, cEnv);
            } else {
              val =
                this.lastResult?.variables[vName] ??
                this.varBoundOverrides.get(vName)?.init ??
                0;
            }
            this.fixedVars.set(vName, val);
          }
        }
        break;
      }

      case "unfix_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          const names = this.resolveTargetEntityNames(stmt.target, cEnv, setEval, "var");
          for (const vName of names) {
            this.fixedVars.delete(vName);
          }
        }
        break;
      }

      case "drop_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          const names = this.resolveTargetEntityNames(stmt.target, cEnv, setEval, "con");
          for (const cName of names) {
            this.droppedConstraints.add(cName);
          }
        }
        break;
      }

      case "restore_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          const names = this.resolveTargetEntityNames(stmt.target, cEnv, setEval, "con");
          for (const cName of names) {
            this.droppedConstraints.delete(cName);
          }
        }
        break;
      }

      case "read_table_cmd": {
        const tbl = this.model.tables?.get(stmt.name);
        if (!tbl) throw new Error(`Table '${stmt.name}' is not declared.`);
        const vContent = this.virtualFiles.get(tbl.filePath);
        readAmplTable(tbl, this.data, {
          baseDir: this.baseDir,
          fileContent: vContent,
        });
        break;
      }

      case "write_table_cmd": {
        const tbl = this.model.tables?.get(stmt.name);
        if (!tbl) throw new Error(`Table '${stmt.name}' is not declared.`);
        const writeDisk = !this.virtualFiles.has(tbl.filePath);
        const out = writeAmplTable(tbl, this.model, this.data, this.lastResult, {
          baseDir: this.baseDir,
          writeToDisk: writeDisk,
        });
        this.tableOutputs.set(stmt.name, out.content);
        this.virtualFiles.set(tbl.filePath, out.content);
        break;
      }

      case "display_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          for (const expr of stmt.exprs) {
            this.formatDisplayExpr(expr, cEnv, setEval);
          }
        }
        break;
      }

      case "printf_cmd": {
        const setEval = this.makeSetEvaluator();
        const envs = stmt.indexing
          ? setEval.generateCombinations(stmt.indexing, env)
          : [env];
        for (const cEnv of envs) {
          const argVals = stmt.args.map((a) => setEval.evalValue(a, cEnv));
          const formatted = formatPrintfString(stmt.format, argVals);
          this.emitOutput(formatted);
        }
        break;
      }

      case "for_cmd": {
        const setEval = this.makeSetEvaluator();
        const combos = setEval.generateCombinations(stmt.indexing, env);
        for (const iterEnv of combos) {
          const sig = await this.executeStatements(stmt.body, iterEnv);
          if (sig === "break") break;
        }
        break;
      }

      case "repeat_cmd": {
        let safety = 0;
        while (safety++ < 1000) {
          if (stmt.condition && !stmt.isUntil) {
            const setEval = this.makeSetEvaluator();
            if (!setEval.evalCondition(stmt.condition, env)) break;
          }
          const sig = await this.executeStatements(stmt.body, env);
          if (sig === "break") break;
          if (stmt.condition && stmt.isUntil) {
            const setEval = this.makeSetEvaluator();
            if (setEval.evalCondition(stmt.condition, env)) break;
          }
          if (!stmt.condition) break;
        }
        break;
      }

      case "if_cmd": {
        const setEval = this.makeSetEvaluator();
        if (setEval.evalCondition(stmt.condition, env)) {
          return this.executeStatements(stmt.thenBody, env);
        } else if (stmt.elseBody) {
          return this.executeStatements(stmt.elseBody, env);
        }
        break;
      }
    }

    return "none";
  }

  private applyLetAssignment(
    target: AmplExpr,
    valueExpr: AmplExpr,
    env: Map<string, SetElement>,
    setEval: SetEvaluator,
  ): void {
    // 1. Suffix assignment e.g. `let x[i].lb := 10;` or `let x[i].sosno := 1;` or custom suffix `let x[i].priority := 5;`
    if (target.kind === "suffix") {
      const val = setEval.evalScalar(valueExpr, env);
      const isCon = target.target.kind === "identifier" && this.model.constraints.has(target.target.name);
      const names = this.resolveTargetEntityNames(target.target, env, setEval, isCon ? "con" : "var");
      const suf = target.suffix.toLowerCase();
      for (const vName of names) {
        const cur = this.varBoundOverrides.get(vName) ?? {};
        if (suf === "lb") cur.lb = val;
        else if (suf === "ub") cur.ub = val;
        else if (suf === "init" || suf === "val") {
          cur.init = val;
          if (this.lastResult) this.lastResult.variables[vName] = val;
        } else if (suf === "sosno") cur.sosno = Math.round(val);
        else if (suf === "ref") cur.ref = val;
        else {
          if (!cur.customSuffixes) cur.customSuffixes = new Map();
          cur.customSuffixes.set(target.suffix, val);
        }
        this.varBoundOverrides.set(vName, cur);
      }
      return;
    }

    // 2. Identifier assignment: Set, Scalar Param, or Scalar Var
    if (target.kind === "identifier") {
      if (this.model.sets.has(target.name)) {
        const members = setEval.evalSetExpr(valueExpr, env);
        this.data.sets.set(target.name, members);
        return;
      }
      const val = setEval.evalValue(valueExpr, env);
      if (this.model.vars.has(target.name)) {
        const numVal = Number(val) || 0;
        const cur = this.varBoundOverrides.get(target.name) ?? {};
        cur.init = numVal;
        this.varBoundOverrides.set(target.name, cur);
        if (this.lastResult) this.lastResult.variables[target.name] = numVal;
        return;
      }
      // Parameter (scalar or broadcast over all indices if indexed)
      const pDecl = this.model.params.get(target.name);
      let pMap = this.data.params.get(target.name);
      if (!pMap) {
        pMap = new Map();
        this.data.params.set(target.name, pMap);
      }
      if (pDecl?.indexing && pDecl.indexing.iterators.length > 0) {
        const combos = setEval.generateCombinations(pDecl.indexing, env);
        for (const cEnv of combos) {
          const idxList: (string | number)[] = [];
          for (const it of pDecl.indexing.iterators) {
            for (const vn of it.variables) {
              const v = cEnv.get(vn)!;
              if (Array.isArray(v)) idxList.push(...v);
              else idxList.push(v);
            }
          }
          pMap.set(idxList.join(","), setEval.evalValue(valueExpr, cEnv));
        }
      } else {
        pMap.set("", val);
      }
      return;
    }

    // 3. Subscript assignment: `let demand[i] := 120;` or `let x[i] := 5;`
    if (target.kind === "subscript") {
      const idxVals = target.indices.map((idx) => setEval.evalValue(idx, env));
      const key = idxVals.join(",");
      const fullName = `${target.name}[${key}]`;
      const val = setEval.evalValue(valueExpr, env);

      if (this.model.vars.has(target.name)) {
        const numVal = Number(val) || 0;
        const cur = this.varBoundOverrides.get(fullName) ?? {};
        cur.init = numVal;
        this.varBoundOverrides.set(fullName, cur);
        if (this.lastResult) this.lastResult.variables[fullName] = numVal;
        return;
      }

      let pMap = this.data.params.get(target.name);
      if (!pMap) {
        pMap = new Map();
        this.data.params.set(target.name, pMap);
      }
      pMap.set(key, val);
    }
  }

  private resolveTargetEntityNames(
    target: AmplExpr,
    env: Map<string, SetElement>,
    setEval: SetEvaluator,
    kind: "var" | "con",
  ): string[] {
    if (target.kind === "subscript") {
      const idxVals = target.indices.map((idx) => setEval.evalValue(idx, env));
      return [`${target.name}[${idxVals.join(",")}]`];
    }
    if (target.kind === "identifier") {
      const decl =
        kind === "var"
          ? this.model.vars.get(target.name)
          : this.model.constraints.get(target.name);
      if (decl?.indexing && decl.indexing.iterators.length > 0) {
        const combos = setEval.generateCombinations(decl.indexing, env);
        const names: string[] = [];
        for (const cEnv of combos) {
          const idxList: (string | number)[] = [];
          for (const it of decl.indexing.iterators) {
            for (const vn of it.variables) {
              const v = cEnv.get(vn)!;
              if (Array.isArray(v)) idxList.push(...v);
              else idxList.push(v);
            }
          }
          names.push(`${target.name}[${idxList.join(",")}]`);
        }
        return names;
      }
      return [target.name];
    }
    return [];
  }

  private formatDisplayExpr(
    expr: AmplExpr,
    env: Map<string, SetElement>,
    setEval: SetEvaluator,
  ): void {
    if (expr.kind === "identifier") {
      const name = expr.name;
      // If bare variable name, display all variable instances
      if (this.model.vars.has(name) && this.lastResult) {
        const vDecl = this.model.vars.get(name)!;
        if (vDecl.indexing && vDecl.indexing.iterators.length > 0) {
          const lines: string[] = [`${name} [* :=`];
          for (const [k, v] of Object.entries(this.lastResult.variables)) {
            if (k.startsWith(`${name}[`)) {
              const inner = k.slice(name.length + 1, -1);
              lines.push(`  ${inner}  ${v}`);
            }
          }
          lines.push(";");
          this.emitOutput(lines.join("\n"));
          return;
        }
        this.emitOutput(`${name} = ${this.lastResult.variables[name] ?? 0}`);
        return;
      }

      // If bare objective name
      if (this.model.objectives.has(name) && this.lastResult) {
        this.emitOutput(`${name} = ${this.lastResult.objectiveValue}`);
        return;
      }

      // If bare constraint name, display duals
      if (this.model.constraints.has(name) && this.lastResult?.duals) {
        const cDecl = this.model.constraints.get(name)!;
        if (cDecl.indexing && cDecl.indexing.iterators.length > 0) {
          const lines: string[] = [`${name} [* :=`];
          for (const [k, v] of Object.entries(this.lastResult.duals)) {
            if (k.startsWith(`${name}[`)) {
              const inner = k.slice(name.length + 1, -1);
              lines.push(`  ${inner}  ${v}`);
            }
          }
          lines.push(";");
          this.emitOutput(lines.join("\n"));
          return;
        }
        this.emitOutput(`${name} = ${this.lastResult.duals[name] ?? 0}`);
        return;
      }

      // If bare set name
      if (this.model.sets.has(name) || this.data.sets.has(name)) {
        const members = setEval.getSet(name);
        this.emitOutput(`set ${name} := ${members.map(stringifyTuple).join(" ")};`);
        return;
      }
    }

    // Suffix on unsubscripted indexed variable/constraint e.g. `display Buy.rc;` or `display Supply.dual;`
    if (expr.kind === "suffix" && expr.target.kind === "identifier") {
      const base = expr.target.name;
      const suf = expr.suffix.toLowerCase();
      if (this.model.vars.has(base) && this.lastResult?.variableSuffixes) {
        const vDecl = this.model.vars.get(base)!;
        if (vDecl.indexing && vDecl.indexing.iterators.length > 0) {
          const lines: string[] = [`${base}.${expr.suffix} [* :=`];
          const resolver = createSuffixResolver(this.lastResult);
          for (const k of Object.keys(this.lastResult.variables)) {
            if (k.startsWith(`${base}[`)) {
              const inner = k.slice(base.length + 1, -1);
              lines.push(`  ${inner}  ${resolver(k, suf) ?? 0}`);
            }
          }
          lines.push(";");
          this.emitOutput(lines.join("\n"));
          return;
        }
      }
      if (this.model.constraints.has(base) && this.lastResult?.constraintSuffixes) {
        const cDecl = this.model.constraints.get(base)!;
        if (cDecl.indexing && cDecl.indexing.iterators.length > 0) {
          const lines: string[] = [`${base}.${expr.suffix} [* :=`];
          const resolver = createSuffixResolver(this.lastResult);
          for (const k of Object.keys(this.lastResult.constraintSuffixes)) {
            if (k.startsWith(`${base}[`)) {
              const inner = k.slice(base.length + 1, -1);
              lines.push(`  ${inner}  ${resolver(k, suf) ?? 0}`);
            }
          }
          lines.push(";");
          this.emitOutput(lines.join("\n"));
          return;
        }
      }
    }

    const val = setEval.evalValue(expr, env);
    this.emitOutput(String(val));
  }

  public switchProblem(name: string): void {
    if (!name || name === "default") {
      this.droppedConstraints.clear();
      this.activeObjective = undefined;
      return;
    }

    const probDecl = this.model.problems?.get(name);
    if (!probDecl) {
      return;
    }

    const elemSet = new Set(probDecl.elements);

    // If an objective is in elements, set it as activeObjective
    for (const elem of probDecl.elements) {
      if (this.model.objectives.has(elem)) {
        this.activeObjective = elem;
        break;
      }
    }

    // Drop constraints not in probDecl.elements
    this.droppedConstraints.clear();
    for (const conName of this.model.constraints.keys()) {
      if (!elemSet.has(conName)) {
        this.droppedConstraints.add(conName);
      }
    }
  }
}

function formatPrintfString(fmt: string, args: (string | number)[]): string {
  let argIdx = 0;
  return fmt.replace(/%(-?\d+)?(?:\.(\d+))?([dfsge])/gi, (_match, widthStr, precStr, spec) => {
    const val = args[argIdx++] ?? "";
    const s = String(spec).toLowerCase();
    let formatted: string;
    if (s === "d") {
      formatted = String(Math.round(Number(val) || 0));
    } else if (s === "f" || s === "e" || s === "g") {
      const num = Number(val) || 0;
      const prec = precStr !== undefined ? Number(precStr) : 4;
      formatted = s === "e" ? num.toExponential(prec) : num.toFixed(prec);
    } else {
      formatted = String(val);
    }
    if (widthStr !== undefined) {
      const w = Number(widthStr);
      if (w < 0) formatted = formatted.padEnd(Math.abs(w), " ");
      else if (w > 0) formatted = formatted.padStart(w, " ");
    }
    return formatted;
  });
}

export async function runAmplScript(
  scriptText: string,
  options?: AmplSessionOptions,
): Promise<AmplSessionResult> {
  const session = new AmplSession(options);
  return session.evalScript(scriptText);
}
