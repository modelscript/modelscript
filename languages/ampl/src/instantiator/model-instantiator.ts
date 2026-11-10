// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Instantiator: Unrolls high-level AMPL models and data into flat canonical optimization problems.
 */

import type {
  AmplArcDecl,
  AmplConstraintDecl,
  AmplData,
  AmplExpr,
  AmplIndexing,
  AmplModel,
  AmplNodeDecl,
  AmplObjectiveDecl,
  AmplVarColumnSpec,
  AmplVarDecl,
  ConicConstraint,
  FlatAffineTerm,
  FlatExpression,
  InstantiatedConstraint,
  InstantiatedObjective,
  InstantiatedProblem,
  InstantiatedVar,
  ProblemClass,
  SetElement,
} from "../types.js";
import { reformulateMpecComplements } from "./mpec-reformulator.js";
import {
  instantiateLogicalConstraint,
  instantiateNonSmoothCall,
  type MpReformulatorContext,
} from "./mp-reformulator.js";
import {
  instantiatePiecewiseLinearTerm,
  reformulateSemicontAndSos,
} from "./pwl-reformulator.js";
import { SetEvaluator, stringifyTuple } from "./set-evaluator.js";

export interface InstantiateOptions {
  activeObjective?: string | undefined;
  preferQp?: boolean | undefined;
  preferConic?: boolean | undefined;
  mpecMode?: "milp" | "nlp" | undefined;
  bigM?: number | undefined;
  fixedVars?: Map<string, number> | undefined;
  droppedConstraints?: Set<string> | undefined;
  varBoundOverrides?: Map<
    string,
    {
      lb?: number | undefined;
      ub?: number | undefined;
      init?: number | undefined;
      sosno?: number | undefined;
      ref?: number | undefined;
      customSuffixes?: Map<string, number | string> | undefined;
    }
  > | undefined;
}

export class ModelInstantiator {
  private model: AmplModel;
  private data: AmplData;
  private setEval: SetEvaluator;
  private options: InstantiateOptions;

  private variables: InstantiatedVar[] = [];
  private varNameMap = new Map<string, number>();
  private constraints: InstantiatedConstraint[] = [];
  private objectives: InstantiatedObjective[] = [];
  private objective: InstantiatedObjective = {
    name: "obj",
    direction: "minimize",
    expr: { constant: 0, linearTerms: [] },
  };

  private hasNonlinear = false;
  private hasIntegerOrBinary = false;

  constructor(
    model: AmplModel,
    data?: AmplData | undefined,
    options?: InstantiateOptions | undefined,
  ) {
    this.model = model;
    this.data = data ?? { sets: new Map(), params: new Map() };
    this.options = options ?? {};
    this.setEval = new SetEvaluator(this.model, this.data);
  }

  public instantiate(): InstantiatedProblem {
    // 1. Unroll decision variables
    const pendingDefinedVars: { varObj: InstantiatedVar; expr: AmplExpr; env: Map<string, SetElement> }[] = [];
    const pendingColumnVars: { varObj: InstantiatedVar; columnSpec: AmplVarColumnSpec; env: Map<string, SetElement> }[] = [];
    for (const [varName, varDecl] of this.model.vars.entries()) {
      this.instantiateVariable(varName, varDecl, pendingDefinedVars, pendingColumnVars);
    }

    // 1b. Unroll network arcs as decision variables
    const arcInstances: { varObj: InstantiatedVar; decl: AmplArcDecl; env: Map<string, SetElement> }[] = [];
    if (this.model.arcs) {
      for (const [arcName, arcDecl] of this.model.arcs.entries()) {
        this.instantiateArc(arcName, arcDecl, arcInstances);
      }
    }

    // 1c. Unroll network nodes as flow conservation constraints
    if (this.model.nodes) {
      for (const [nodeName, nodeDecl] of this.model.nodes.entries()) {
        this.instantiateNode(nodeName, nodeDecl, arcInstances);
      }
    }

    // 1d. Evaluate defined variables (`var Revenue {i in I} = ...`) and emit defining equality constraints
    for (const defItem of pendingDefinedVars) {
      const flatDef = this.evaluateFlatExpression(defItem.expr, defItem.env);
      defItem.varObj.definedExpr = flatDef;
      // Add equality constraint: var - definedExpr == 0
      const diff = this.subtractFlatExpressions(
        { constant: 0, linearTerms: [{ varId: defItem.varObj.id, coeff: 1 }] },
        flatDef,
      );
      this.constraints.push({
        id: this.constraints.length,
        name: `_def_${defItem.varObj.name}`,
        expr: {
          constant: 0,
          linearTerms: diff.linearTerms,
          nonlinearTree: diff.nonlinearTree,
        },
        lb: -diff.constant,
        ub: -diff.constant,
      });
    }

    // 2. Unroll objectives
    for (const [objName, objDecl] of this.model.objectives.entries()) {
      this.instantiateObjective(objName, objDecl);
    }
    if (this.objectives.length > 0) {
      const targetName = this.options.activeObjective;
      const chosen = targetName
        ? this.objectives.find((o) => o.name === targetName || o.name.startsWith(`${targetName}[`))
        : this.objectives[0];
      this.objective = chosen ?? this.objectives[0]!;
    }

    // 2b. Add arc objective cost terms
    for (const arc of arcInstances) {
      if (arc.decl.objClause) {
        const cost = this.setEval.evalScalar(arc.decl.objClause.cost, arc.env);
        const objName = arc.decl.objClause.objName;
        const targetObj = objName
          ? this.objectives.find((o) => o.name === objName || o.name.startsWith(`${objName}[`))
          : this.objective;
        if (targetObj) {
          targetObj.expr.linearTerms.push({ varId: arc.varObj.id, coeff: cost });
        }
      }
    }

    // 3. Unroll constraints
    for (const [conName, conDecl] of this.model.constraints.entries()) {
      this.instantiateConstraint(conName, conDecl);
    }

    // 3b. Apply Column-Wise modeling accumulation (obj & coeff clauses on vars)
    for (const item of pendingColumnVars) {
      // Accumulate into objectives
      for (const objClause of item.columnSpec.objClauses) {
        const cost = this.setEval.evalScalar(objClause.coeffExpr, item.env);
        const targetObj = objClause.objName
          ? this.objectives.find((o) => o.name === objClause.objName || o.name.startsWith(`${objClause.objName}[`))
          : this.objective;
        if (targetObj) {
          targetObj.expr.linearTerms.push({ varId: item.varObj.id, coeff: cost });
        }
      }
      // Accumulate into constraints
      for (const coeffClause of item.columnSpec.coeffClauses) {
        const envs = coeffClause.indexing
          ? this.generateCombinations(coeffClause.indexing, item.env)
          : [item.env];
        for (const cEnv of envs) {
          let targetFullName = coeffClause.targetConstraint;
          if (coeffClause.constraintIndices && coeffClause.constraintIndices.length > 0) {
            const idxVals = coeffClause.constraintIndices.map((idx) => this.evalSubscriptIndex(idx, cEnv));
            targetFullName = `${coeffClause.targetConstraint}[${idxVals.join(",")}]`;
          }
          const coeffVal = this.setEval.evalScalar(coeffClause.coeffExpr, cEnv);
          const targetCon = this.constraints.find((c) => c.name === targetFullName);
          if (targetCon) {
            const existing = targetCon.expr.linearTerms.find((t) => t.varId === item.varObj.id);
            if (existing) {
              existing.coeff += coeffVal;
            } else {
              targetCon.expr.linearTerms.push({ varId: item.varObj.id, coeff: coeffVal });
            }
          }
        }
      }
    }

    // 3c. Extract quadratic terms from objectives and constraints
    this.extractAllQuadraticTerms();

    // 4. Classify problem
    this.hasNonlinear =
      this.objectives.some((o) => o.expr.nonlinearTree !== undefined) ||
      this.constraints.some((c) => c.expr.nonlinearTree !== undefined);

    const hasQuadraticObj = this.objectives.some(
      (o) => o.expr.quadraticTerms && o.expr.quadraticTerms.length > 0,
    );
    const hasQuadraticCon = this.constraints.some(
      (c) => c.expr.quadraticTerms && c.expr.quadraticTerms.length > 0,
    );

    const cones = this.detectConicConstraints();

    let problemClass: ProblemClass = "LP";
    if (this.hasNonlinear) {
      if (this.options.preferConic && cones.length > 0) {
        problemClass = this.hasIntegerOrBinary ? "MISOCP" : "SOCP";
      } else if (this.options.preferQp) {
        if (hasQuadraticCon) {
          problemClass = this.hasIntegerOrBinary ? "MIQCP" : "QCP";
        } else if (hasQuadraticObj) {
          problemClass = this.hasIntegerOrBinary ? "MIQP" : "QP";
        } else {
          problemClass = this.hasIntegerOrBinary ? "MINLP" : "NLP";
        }
      } else {
        problemClass = this.hasIntegerOrBinary ? "MINLP" : "NLP";
      }
    } else if (cones.length > 0) {
      problemClass = this.hasIntegerOrBinary ? "MISOCP" : "SOCP";
    } else if (hasQuadraticCon) {
      problemClass = this.hasIntegerOrBinary ? "MIQCP" : "QCP";
    } else if (hasQuadraticObj) {
      problemClass = this.hasIntegerOrBinary ? "MIQP" : "QP";
    } else if (this.hasIntegerOrBinary) {
      problemClass = "MILP";
    }

    const problem: InstantiatedProblem = {
      name: this.objective.name || "AmplProblem",
      problemClass,
      variables: this.variables,
      varNameMap: this.varNameMap,
      objective: this.objective,
      objectives: this.objectives,
      constraints: this.constraints,
      cones: cones.length > 0 ? cones : undefined,
    };

    // 5. Apply Semicontinuous / SOS1 / SOS2 and MPEC Complementarity reformulations if present
    const hasSemiOrSos = problem.variables.some(
      (v) => v.type === "semicont" || v.type === "semiint" || (v.sosno !== undefined && v.sosno !== 0),
    );
    if (hasSemiOrSos) {
      reformulateSemicontAndSos(problem, this.options.bigM ?? 1e4);
    }

    const hasMpec = problem.constraints.some((c) => c.complements !== undefined);
    if (hasMpec) {
      reformulateMpecComplements(problem, this.options.mpecMode ?? "milp", this.options.bigM ?? 1e4);
    }

    return problem;
  }

  // ── Variable Instantiation ──

  private instantiateVariable(
    baseName: string,
    decl: AmplVarDecl,
    pendingDefinedVars: { varObj: InstantiatedVar; expr: AmplExpr; env: Map<string, SetElement> }[],
    pendingColumnVars?: { varObj: InstantiatedVar; columnSpec: AmplVarColumnSpec; env: Map<string, SetElement> }[],
  ): void {
    const isBinary = decl.type === "binary";
    const isInt = decl.type === "integer" || isBinary || decl.type === "semiint";
    if (isInt || decl.type === "semicont") this.hasIntegerOrBinary = true;

    const createOneVar = (
      fullName: string,
      indices: (string | number)[],
      env: Map<string, SetElement>,
    ) => {
      const id = this.variables.length;
      let lb = isBinary ? 0 : Number.NEGATIVE_INFINITY;
      let ub = isBinary ? 1 : Number.POSITIVE_INFINITY;

      if (decl.lowerBound) lb = this.setEval.evalScalar(decl.lowerBound, env);
      if (decl.upperBound) ub = this.setEval.evalScalar(decl.upperBound, env);
      const semiLb = decl.semiLowerBound
        ? this.setEval.evalScalar(decl.semiLowerBound, env)
        : undefined;
      let initVal = decl.initial ? this.setEval.evalScalar(decl.initial, env) : 0;
      let sosno = decl.sosno ? Math.round(this.setEval.evalScalar(decl.sosno, env)) : undefined;
      let ref = decl.ref ? this.setEval.evalScalar(decl.ref, env) : undefined;

      // Apply session overrides (`let x.lb := ...`, `fix x := ...`)
      const override = this.options.varBoundOverrides?.get(fullName);
      if (override) {
        if (override.lb !== undefined) lb = override.lb;
        if (override.ub !== undefined) ub = override.ub;
        if (override.init !== undefined) initVal = override.init;
        if (override.sosno !== undefined) sosno = override.sosno;
        if (override.ref !== undefined) ref = override.ref;
      }

      let fixed = false;
      if (this.options.fixedVars?.has(fullName)) {
        const fixVal = this.options.fixedVars.get(fullName)!;
        lb = fixVal;
        ub = fixVal;
        initVal = fixVal;
        fixed = true;
      }

      let customSuffixes: Map<string, number | string> | undefined;
      if (override?.customSuffixes) {
        customSuffixes = new Map(override.customSuffixes);
      }

      const v: InstantiatedVar = {
        id,
        name: fullName,
        baseName,
        indices,
        type: decl.type,
        lb,
        ub,
        semiLb,
        initVal,
        fixed: fixed || undefined,
        sosno,
        ref,
        customSuffixes,
      };
      this.variables.push(v);
      this.varNameMap.set(fullName, id);

      if (decl.definedExpr) {
        pendingDefinedVars.push({ varObj: v, expr: decl.definedExpr, env: new Map(env) });
      }
      if (decl.columnSpec && pendingColumnVars) {
        pendingColumnVars.push({ varObj: v, columnSpec: decl.columnSpec, env: new Map(env) });
      }
    };

    if (!decl.indexing || decl.indexing.iterators.length === 0) {
      createOneVar(baseName, [], new Map());
      return;
    }

    const indexCombinations = this.generateCombinations(decl.indexing, new Map());
    for (const env of indexCombinations) {
      const idxList: (string | number)[] = [];
      for (const iter of decl.indexing.iterators) {
        for (const vName of iter.variables) {
          const val = env.get(vName)!;
          if (Array.isArray(val)) idxList.push(...val);
          else idxList.push(val);
        }
      }
      const fullName = `${baseName}[${idxList.join(",")}]`;
      createOneVar(fullName, idxList, env);
    }
  }

  private instantiateArc(
    arcName: string,
    decl: AmplArcDecl,
    arcInstances: { varObj: InstantiatedVar; decl: AmplArcDecl; env: Map<string, SetElement> }[],
  ): void {
    const createOneArc = (
      fullName: string,
      indices: (string | number)[],
      env: Map<string, SetElement>,
    ) => {
      const id = this.variables.length;
      let lb = 0; // standard AMPL default for arcs: flow >= 0
      let ub = Number.POSITIVE_INFINITY;

      if (decl.lowerBound) lb = this.setEval.evalScalar(decl.lowerBound, env);
      if (decl.upperBound) ub = this.setEval.evalScalar(decl.upperBound, env);

      const v: InstantiatedVar = {
        id,
        name: fullName,
        baseName: arcName,
        indices,
        type: decl.varType ?? "continuous",
        lb,
        ub,
        initVal: 0,
      };
      this.variables.push(v);
      this.varNameMap.set(fullName, id);

      arcInstances.push({ varObj: v, decl, env: new Map(env) });
    };

    if (!decl.indexing || decl.indexing.iterators.length === 0) {
      createOneArc(arcName, [], new Map());
      return;
    }

    const combos = this.generateCombinations(decl.indexing, new Map());
    for (const env of combos) {
      const idxList: (string | number)[] = [];
      for (const iter of decl.indexing.iterators) {
        for (const vn of iter.variables) {
          const val = env.get(vn)!;
          if (Array.isArray(val)) idxList.push(...val);
          else idxList.push(val);
        }
      }
      createOneArc(`${arcName}[${idxList.join(",")}]`, idxList, env);
    }
  }

  private instantiateNode(
    nodeName: string,
    decl: AmplNodeDecl,
    arcInstances: { varObj: InstantiatedVar; decl: AmplArcDecl; env: Map<string, SetElement> }[],
  ): void {
    const createOneNode = (
      fullName: string,
      indices: (string | number)[],
      env: Map<string, SetElement>,
    ) => {
      const rhsVal = decl.rhs ? this.setEval.evalScalar(decl.rhs, env) : 0;
      const indexStr = indices.join(",");

      // Find outgoing arcs and incoming arcs
      const outgoing: { varId: number; gain: number }[] = [];
      const incoming: { varId: number; gain: number }[] = [];

      for (const arc of arcInstances) {
        if (arc.decl.from && arc.decl.from.nodeName === nodeName) {
          let matches = true;
          if (arc.decl.from.nodeIndices && arc.decl.from.nodeIndices.length > 0) {
            const arcNodeIdx = arc.decl.from.nodeIndices
              .map((idx) => this.evalSubscriptIndex(idx, arc.env))
              .join(",");
            matches = arcNodeIdx === indexStr;
          } else if (indices.length > 0) {
            matches = false;
          }
          if (matches) {
            const gain = arc.decl.from.gain ? this.setEval.evalScalar(arc.decl.from.gain, arc.env) : 1;
            outgoing.push({ varId: arc.varObj.id, gain });
          }
        }

        if (arc.decl.to && arc.decl.to.nodeName === nodeName) {
          let matches = true;
          if (arc.decl.to.nodeIndices && arc.decl.to.nodeIndices.length > 0) {
            const arcNodeIdx = arc.decl.to.nodeIndices
              .map((idx) => this.evalSubscriptIndex(idx, arc.env))
              .join(",");
            matches = arcNodeIdx === indexStr;
          } else if (indices.length > 0) {
            matches = false;
          }
          if (matches) {
            const gain = arc.decl.to.gain ? this.setEval.evalScalar(arc.decl.to.gain, arc.env) : 1;
            incoming.push({ varId: arc.varObj.id, gain });
          }
        }
      }

      const linearTerms: FlatAffineTerm[] = [];
      if (decl.netDirection === "net_in") {
        for (const i of incoming) linearTerms.push({ varId: i.varId, coeff: i.gain });
        for (const o of outgoing) linearTerms.push({ varId: o.varId, coeff: -o.gain });
      } else {
        // net_out (default)
        for (const o of outgoing) linearTerms.push({ varId: o.varId, coeff: o.gain });
        for (const i of incoming) linearTerms.push({ varId: i.varId, coeff: -i.gain });
      }

      let lb = -Number.POSITIVE_INFINITY;
      let ub = Number.POSITIVE_INFINITY;
      const op = decl.operator ?? "=";
      if (op === "=" || op === "==") {
        lb = rhsVal;
        ub = rhsVal;
      } else if (op === ">=") {
        lb = rhsVal;
      } else if (op === "<=") {
        ub = rhsVal;
      }

      this.constraints.push({
        id: this.constraints.length,
        name: fullName,
        expr: { constant: 0, linearTerms },
        lb,
        ub,
      });
    };

    if (!decl.indexing || decl.indexing.iterators.length === 0) {
      createOneNode(nodeName, [], new Map());
      return;
    }

    const combos = this.generateCombinations(decl.indexing, new Map());
    for (const env of combos) {
      const idxList: (string | number)[] = [];
      for (const iter of decl.indexing.iterators) {
        for (const vn of iter.variables) {
          const val = env.get(vn)!;
          if (Array.isArray(val)) idxList.push(...val);
          else idxList.push(val);
        }
      }
      createOneNode(`${nodeName}[${idxList.join(",")}]`, idxList, env);
    }
  }

  // ── Objective Instantiation ──

  private instantiateObjective(baseName: string, decl: AmplObjectiveDecl): void {
    if (!decl.indexing || decl.indexing.iterators.length === 0) {
      const env = new Map<string, SetElement>();
      const flat = this.evaluateFlatExpression(decl.expr, env);
      this.objectives.push({
        name: baseName,
        direction: decl.direction,
        expr: flat,
      });
      return;
    }

    const combos = this.generateCombinations(decl.indexing, new Map());
    for (const env of combos) {
      const idxList: (string | number)[] = [];
      for (const iter of decl.indexing.iterators) {
        for (const vName of iter.variables) {
          const val = env.get(vName)!;
          if (Array.isArray(val)) idxList.push(...val);
          else idxList.push(val);
        }
      }
      const fullName = `${baseName}[${idxList.join(",")}]`;
      const flat = this.evaluateFlatExpression(decl.expr, env);
      this.objectives.push({
        name: fullName,
        direction: decl.direction,
        expr: flat,
      });
    }
  }

  // ── Constraint Instantiation ──

  private instantiateConstraint(baseName: string, decl: AmplConstraintDecl): void {
    if (!decl.indexing || decl.indexing.iterators.length === 0) {
      this.addFlatConstraint(baseName, decl, new Map());
      return;
    }

    const combos = this.generateCombinations(decl.indexing, new Map());
    for (const env of combos) {
      const idxList: (string | number)[] = [];
      for (const iter of decl.indexing.iterators) {
        for (const vName of iter.variables) {
          const val = env.get(vName)!;
          if (Array.isArray(val)) idxList.push(...val);
          else idxList.push(val);
        }
      }
      const fullName = `${baseName}[${idxList.join(",")}]`;
      this.addFlatConstraint(fullName, decl, env);
    }
  }

  private addFlatConstraint(name: string, decl: AmplConstraintDecl, env: Map<string, SetElement>): void {
    if (this.options.droppedConstraints?.has(name) || this.options.droppedConstraints?.has(decl.name)) {
      return;
    }

    if (decl.isLogical) {
      const mpCtx: MpReformulatorContext = {
        variables: this.variables,
        varNameMap: this.varNameMap,
        constraints: this.constraints,
        setEval: this.setEval,
        evaluateFlat: (e, ev) => this.evaluateFlatExpression(e, ev),
        subtractFlat: (a, b) => this.subtractFlatExpressions(a, b),
        onMilpCreated: () => {
          this.hasIntegerOrBinary = true;
        },
        defaultBigM: this.options.bigM ?? 1e4,
      };
      instantiateLogicalConstraint(name, decl.lhs, env, mpCtx);
      return;
    }

    const mainSide = this.evaluateRelationalBounds(decl.lhs, decl.operator, decl.rhs, decl.rhsUpper, env);
    let compSide: { expr: FlatExpression; lb: number; ub: number } | undefined;
    if (decl.complements) {
      compSide = this.evaluateRelationalBounds(
        decl.complements.lhs,
        decl.complements.operator,
        decl.complements.rhs,
        decl.complements.rhsUpper,
        env,
      );
    }

    this.constraints.push({
      id: this.constraints.length,
      name,
      expr: mainSide.expr,
      lb: mainSide.lb,
      ub: mainSide.ub,
      complements: compSide,
    });
  }

  private evaluateRelationalBounds(
    lhsExpr: AmplExpr,
    operator: string,
    rhsExpr: AmplExpr,
    rhsUpperExpr: AmplExpr | undefined,
    env: Map<string, SetElement>,
  ): { expr: FlatExpression; lb: number; ub: number } {
    const lhs = this.evaluateFlatExpression(lhsExpr, env);
    const rhs = this.evaluateFlatExpression(rhsExpr, env);
    const diff = this.subtractFlatExpressions(lhs, rhs);

    let lb = Number.NEGATIVE_INFINITY;
    let ub = Number.POSITIVE_INFINITY;

    if (rhsUpperExpr) {
      const upperVal = this.setEval.evalScalar(rhsUpperExpr, env);
      const lowerVal = this.setEval.evalScalar(rhsExpr, env);
      lb = lowerVal - lhs.constant;
      ub = upperVal - lhs.constant;
      return {
        expr: {
          constant: 0,
          linearTerms: lhs.linearTerms,
          nonlinearTree: lhs.nonlinearTree,
        },
        lb,
        ub,
      };
    }

    switch (operator) {
      case "<=":
      case "<":
        ub = -diff.constant;
        break;
      case ">=":
      case ">":
        lb = -diff.constant;
        break;
      case "=":
      case "==":
        lb = -diff.constant;
        ub = -diff.constant;
        break;
    }

    return {
      expr: {
        constant: 0,
        linearTerms: diff.linearTerms,
        nonlinearTree: diff.nonlinearTree,
      },
      lb,
      ub,
    };
  }

  // ── Expression Flattening ──

  private evaluateFlatExpression(expr: AmplExpr, env: Map<string, SetElement>): FlatExpression {
    switch (expr.kind) {
      case "number":
        return { constant: expr.value, linearTerms: [] };

      case "identifier": {
        if (this.varNameMap.has(expr.name)) {
          return {
            constant: 0,
            linearTerms: [{ varId: this.varNameMap.get(expr.name)!, coeff: 1 }],
          };
        }
        const val = this.setEval.evalScalar(expr, env);
        return { constant: val, linearTerms: [] };
      }

      case "subscript": {
        const idxVals = expr.indices.map((idxExpr) => this.evalSubscriptIndex(idxExpr, env));
        const key = idxVals.join(",");
        const fullName = `${expr.name}[${key}]`;

        if (this.varNameMap.has(fullName)) {
          return {
            constant: 0,
            linearTerms: [{ varId: this.varNameMap.get(fullName)!, coeff: 1 }],
          };
        }

        const val = this.setEval.lookupParam(expr.name, key, env);
        return { constant: val, linearTerms: [] };
      }

      case "suffix": {
        const val = this.setEval.evalScalar(expr, env);
        return { constant: val, linearTerms: [] };
      }

      case "if_then_else": {
        const cond = this.setEval.evalCondition(expr.condition, env);
        return cond
          ? this.evaluateFlatExpression(expr.thenExpr, env)
          : this.evaluateFlatExpression(expr.elseExpr, env);
      }

      case "piecewise": {
        const argFlat = this.evaluateFlatExpression(expr.argument, env);
        const breaks = expr.breakpoints.map((b) => this.setEval.evalScalar(b, env));
        const slopes = expr.slopes.map((s) => this.setEval.evalScalar(s, env));
        const x0 = expr.zeroPoint ? this.setEval.evalScalar(expr.zeroPoint, env) : 0;

        if (argFlat.linearTerms.length === 0 && !argFlat.nonlinearTree) {
          return {
            constant: this.setEval.evalScalar(expr, env),
            linearTerms: [],
          };
        }

        return instantiatePiecewiseLinearTerm(
          breaks,
          slopes,
          argFlat,
          x0,
          this.variables,
          this.varNameMap,
          this.constraints,
          () => {
            this.hasIntegerOrBinary = true;
          },
        );
      }

      case "unary": {
        const inner = this.evaluateFlatExpression(expr.expr, env);
        if (expr.op === "-") {
          return {
            constant: -inner.constant,
            linearTerms: inner.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
            nonlinearTree: inner.nonlinearTree
              ? { kind: "unary", op: "-", expr: inner.nonlinearTree }
              : undefined,
          };
        }
        return inner;
      }

      case "binary": {
        const left = this.evaluateFlatExpression(expr.left, env);
        const right = this.evaluateFlatExpression(expr.right, env);

        if (expr.op === "+") {
          return this.addFlatExpressions(left, right);
        }
        if (expr.op === "-") {
          return this.subtractFlatExpressions(left, right);
        }
        if (expr.op === "*") {
          if (left.linearTerms.length === 0 && !left.nonlinearTree) {
            return this.scaleFlatExpression(right, left.constant);
          }
          if (right.linearTerms.length === 0 && !right.nonlinearTree) {
            return this.scaleFlatExpression(left, right.constant);
          }
          this.hasNonlinear = true;
          return {
            constant: 0,
            linearTerms: [],
            nonlinearTree: this.resolveNonlinearTree(expr, env),
          };
        }
        if (expr.op === "/") {
          if (right.linearTerms.length === 0 && !right.nonlinearTree && right.constant !== 0) {
            return this.scaleFlatExpression(left, 1 / right.constant);
          }
          this.hasNonlinear = true;
          return {
            constant: 0,
            linearTerms: [],
            nonlinearTree: this.resolveNonlinearTree(expr, env),
          };
        }
        if (expr.op === "^" || expr.op === "**") {
          if (
            left.linearTerms.length === 0 &&
            !left.nonlinearTree &&
            right.linearTerms.length === 0 &&
            !right.nonlinearTree
          ) {
            return { constant: Math.pow(left.constant, right.constant), linearTerms: [] };
          }
          if (right.linearTerms.length === 0 && !right.nonlinearTree && right.constant === 1) {
            return left;
          }
          if (right.linearTerms.length === 0 && !right.nonlinearTree && right.constant === 0) {
            return { constant: 1, linearTerms: [] };
          }
          this.hasNonlinear = true;
          return {
            constant: 0,
            linearTerms: [],
            nonlinearTree: this.resolveNonlinearTree(expr, env),
          };
        }
        break;
      }

      case "reduction": {
        if (expr.reduction === "sum") {
          let accum: FlatExpression = { constant: 0, linearTerms: [] };
          const iterCombos = this.generateCombinations({ iterators: expr.iterators }, env);
          for (const iterEnv of iterCombos) {
            const term = this.evaluateFlatExpression(expr.expr, iterEnv);
            accum = this.addFlatExpressions(accum, term);
          }
          return accum;
        }
        if (expr.reduction === "prod") {
          const iterCombos = this.generateCombinations({ iterators: expr.iterators }, env);
          let prodTree: AmplExpr | undefined;
          let constProd = 1;
          for (const iterEnv of iterCombos) {
            const term = this.evaluateFlatExpression(expr.expr, iterEnv);
            if (term.linearTerms.length === 0 && !term.nonlinearTree) {
              constProd *= term.constant;
            } else {
              const resolved = this.resolveNonlinearTree(expr.expr, iterEnv);
              prodTree = prodTree
                ? { kind: "binary", op: "*", left: prodTree, right: resolved }
                : resolved;
            }
          }
          if (!prodTree) {
            return { constant: constProd, linearTerms: [] };
          }
          this.hasNonlinear = true;
          if (Math.abs(constProd - 1) > 1e-15) {
            prodTree = {
              kind: "binary",
              op: "*",
              left: { kind: "number", value: constProd },
              right: prodTree,
            };
          }
          return { constant: 0, linearTerms: [], nonlinearTree: prodTree };
        }
        if (expr.reduction === "min" || expr.reduction === "max") {
          const iterCombos = this.generateCombinations({ iterators: expr.iterators }, env);
          const argFlats = iterCombos.map((cEnv) => this.evaluateFlatExpression(expr.expr, cEnv));
          const hasVars = argFlats.some((f) => f.linearTerms.length > 0 || f.nonlinearTree);
          if (!hasVars) {
            return { constant: this.setEval.evalScalar(expr, env), linearTerms: [] };
          }
          const mpCtx: MpReformulatorContext = {
            variables: this.variables,
            varNameMap: this.varNameMap,
            constraints: this.constraints,
            setEval: this.setEval,
            evaluateFlat: (e, ev) => this.evaluateFlatExpression(e, ev),
            subtractFlat: (a, b) => this.subtractFlatExpressions(a, b),
            onMilpCreated: () => {
              this.hasIntegerOrBinary = true;
            },
            defaultBigM: this.options.bigM ?? 1e4,
          };
          return instantiateNonSmoothCall(expr.reduction, argFlats, mpCtx);
        }
        break;
      }

      case "call": {
        const fn = expr.fn.toLowerCase();
        // Check for user-defined function in this.model.functions
        const userFn = this.model.functions?.get(expr.fn) ??
          (this.model.functions ? Array.from(this.model.functions.values()).find((f) => f.name.toLowerCase() === fn) : undefined);
        if (userFn && !userFn.isExternal && userFn.body) {
          const subExpr = this.substituteFunctionArgs(userFn.body, userFn.params, expr.args);
          return this.evaluateFlatExpression(subExpr, env);
        }

        // Set / ordinal functions evaluate directly to scalar constants
        if (
          fn === "card" ||
          fn === "ord" ||
          fn === "ord0" ||
          fn === "first" ||
          fn === "last" ||
          fn === "next" ||
          fn === "prev" ||
          fn === "nextw" ||
          fn === "prevw" ||
          fn === "member"
        ) {
          return { constant: this.setEval.evalScalar(expr, env), linearTerms: [] };
        }

        const argFlats = expr.args.map((a) => this.evaluateFlatExpression(a, env));
        const allConst = argFlats.every((f) => f.linearTerms.length === 0 && !f.nonlinearTree);
        if (allConst) {
          return { constant: this.setEval.evalScalar(expr, env), linearTerms: [] };
        }

        // MP non-smooth linearizations for abs, min, max over linear arguments
        if (
          (fn === "abs" || fn === "min" || fn === "max") &&
          argFlats.every((f) => !f.nonlinearTree)
        ) {
          const mpCtx: MpReformulatorContext = {
            variables: this.variables,
            varNameMap: this.varNameMap,
            constraints: this.constraints,
            setEval: this.setEval,
            evaluateFlat: (e, ev) => this.evaluateFlatExpression(e, ev),
            subtractFlat: (a, b) => this.subtractFlatExpressions(a, b),
            onMilpCreated: () => {
              this.hasIntegerOrBinary = true;
            },
            defaultBigM: this.options.bigM ?? 1e4,
          };
          return instantiateNonSmoothCall(fn, argFlats, mpCtx);
        }

        this.hasNonlinear = true;
        return {
          constant: 0,
          linearTerms: [],
          nonlinearTree: this.resolveNonlinearTree(expr, env),
        };
      }
    }

    return { constant: 0, linearTerms: [] };
  }

  /**
   * Resolves all iterator variables, parameter subscripts, and reductions inside a nonlinear
   * expression tree so that only numeric constants and instantiated decision variable identifiers remain.
   */
  private resolveNonlinearTree(expr: AmplExpr, env: Map<string, SetElement>): AmplExpr {
    switch (expr.kind) {
      case "number":
        return expr;
      case "identifier": {
        if (this.varNameMap.has(expr.name)) {
          return { kind: "identifier", name: expr.name };
        }
        return { kind: "number", value: this.setEval.evalScalar(expr, env) };
      }
      case "subscript": {
        const idxVals = expr.indices.map((idxExpr) => this.evalSubscriptIndex(idxExpr, env));
        const key = idxVals.join(",");
        const fullName = `${expr.name}[${key}]`;
        if (this.varNameMap.has(fullName)) {
          return { kind: "identifier", name: fullName };
        }
        return { kind: "number", value: this.setEval.lookupParam(expr.name, key, env) };
      }
      case "unary": {
        const inner = this.resolveNonlinearTree(expr.expr, env);
        if (inner.kind === "number" && expr.op === "-") {
          return { kind: "number", value: -inner.value };
        }
        return { kind: "unary", op: expr.op, expr: inner };
      }
      case "binary": {
        const left = this.resolveNonlinearTree(expr.left, env);
        const right = this.resolveNonlinearTree(expr.right, env);
        if (left.kind === "number" && right.kind === "number") {
          return { kind: "number", value: this.setEval.evalScalar({ kind: "binary", op: expr.op, left, right }, env) };
        }
        return { kind: "binary", op: expr.op, left, right };
      }
      case "call": {
        const args = expr.args.map((a) => this.resolveNonlinearTree(a, env));
        return { kind: "call", fn: expr.fn, args };
      }
      case "reduction": {
        const combos = this.generateCombinations({ iterators: expr.iterators }, env);
        if (combos.length === 0) {
          return { kind: "number", value: expr.reduction === "prod" ? 1 : 0 };
        }
        const op = expr.reduction === "prod" ? "*" : "+";
        let acc = this.resolveNonlinearTree(expr.expr, combos[0]!);
        for (let k = 1; k < combos.length; k++) {
          const next = this.resolveNonlinearTree(expr.expr, combos[k]!);
          acc = { kind: "binary", op, left: acc, right: next };
        }
        return acc;
      }
      case "if_then_else": {
        const cond = this.setEval.evalCondition(expr.condition, env);
        return cond
          ? this.resolveNonlinearTree(expr.thenExpr, env)
          : this.resolveNonlinearTree(expr.elseExpr, env);
      }
      default:
        return expr;
    }
  }

  // ── Flat Expression Algebra ──

  private addFlatExpressions(a: FlatExpression, b: FlatExpression): FlatExpression {
    const termMap = new Map<number, number>();
    for (const t of a.linearTerms) termMap.set(t.varId, (termMap.get(t.varId) ?? 0) + t.coeff);
    for (const t of b.linearTerms) termMap.set(t.varId, (termMap.get(t.varId) ?? 0) + t.coeff);

    const linearTerms: FlatAffineTerm[] = [];
    for (const [varId, coeff] of termMap.entries()) {
      if (Math.abs(coeff) > 1e-15) linearTerms.push({ varId, coeff });
    }

    let nonlinearTree: AmplExpr | undefined;
    if (a.nonlinearTree && b.nonlinearTree) {
      nonlinearTree = { kind: "binary", op: "+", left: a.nonlinearTree, right: b.nonlinearTree };
    } else {
      nonlinearTree = a.nonlinearTree ?? b.nonlinearTree;
    }

    return {
      constant: a.constant + b.constant,
      linearTerms,
      nonlinearTree,
    };
  }

  private subtractFlatExpressions(a: FlatExpression, b: FlatExpression): FlatExpression {
    const negB: FlatExpression = {
      constant: -b.constant,
      linearTerms: b.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
      nonlinearTree: b.nonlinearTree ? { kind: "unary", op: "-", expr: b.nonlinearTree } : undefined,
    };
    return this.addFlatExpressions(a, negB);
  }

  private scaleFlatExpression(a: FlatExpression, factor: number): FlatExpression {
    if (Math.abs(factor) < 1e-15) {
      return { constant: 0, linearTerms: [] };
    }
    return {
      constant: a.constant * factor,
      linearTerms: a.linearTerms.map((t) => ({ varId: t.varId, coeff: t.coeff * factor })),
      nonlinearTree: a.nonlinearTree
        ? {
            kind: "binary",
            op: "*",
            left: { kind: "number", value: factor },
            right: a.nonlinearTree,
          }
        : undefined,
    };
  }

  private evalSubscriptIndex(expr: AmplExpr, env: Map<string, SetElement>): string | number {
    return this.setEval.evalValue(expr, env);
  }

  private substituteFunctionArgs(body: AmplExpr, params: string[], args: AmplExpr[]): AmplExpr {
    const paramMap = new Map<string, AmplExpr>();
    for (let i = 0; i < params.length && i < args.length; i++) {
      paramMap.set(params[i]!, args[i]!);
    }

    const substitute = (e: AmplExpr): AmplExpr => {
      switch (e.kind) {
        case "identifier":
          if (paramMap.has(e.name)) {
            return paramMap.get(e.name)!;
          }
          return e;
        case "unary":
          return { ...e, expr: substitute(e.expr) };
        case "binary":
          return { ...e, left: substitute(e.left), right: substitute(e.right) };
        case "if_then_else":
          return {
            ...e,
            condition: substitute(e.condition),
            thenExpr: substitute(e.thenExpr),
            elseExpr: substitute(e.elseExpr),
          };
        case "call":
          return { ...e, args: e.args.map(substitute) };
        case "subscript":
          return { ...e, indices: e.indices.map(substitute) };
        case "reduction":
          return { ...e, expr: substitute(e.expr) };
        default:
          return e;
      }
    };

    return substitute(body);
  }

  private extractAllQuadraticTerms(): void {
    interface Monomial {
      coeff: number;
      vars: number[];
    }

    const mergeSorted = (a: number[], b: number[]): number[] => {
      const res: number[] = [];
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        if (a[i]! <= b[j]!) {
          res.push(a[i]!);
          i++;
        } else {
          res.push(b[j]!);
          j++;
        }
      }
      while (i < a.length) res.push(a[i++]!);
      while (j < b.length) res.push(b[j++]!);
      return res;
    };

    const mergeMonomials = (monomials: Monomial[]): Monomial[] => {
      const map = new Map<string, Monomial>();
      for (const m of monomials) {
        if (Math.abs(m.coeff) < 1e-15) continue;
        const key = m.vars.join(",");
        const existing = map.get(key);
        if (existing) {
          existing.coeff += m.coeff;
        } else {
          map.set(key, { coeff: m.coeff, vars: [...m.vars] });
        }
      }
      const res: Monomial[] = [];
      for (const m of map.values()) {
        if (Math.abs(m.coeff) > 1e-15) {
          res.push(m);
        }
      }
      return res;
    };

    const extractMonomials = (e: AmplExpr): Monomial[] | null => {
      switch (e.kind) {
        case "number":
          return [{ coeff: e.value, vars: [] }];
        case "identifier": {
          const id = this.varNameMap.get(e.name);
          if (id !== undefined) return [{ coeff: 1, vars: [id] }];
          return null;
        }
        case "unary": {
          if (e.op === "-") {
            const sub = extractMonomials(e.expr);
            if (!sub) return null;
            return sub.map((m) => ({ coeff: -m.coeff, vars: m.vars }));
          }
          if (e.op === "+") return extractMonomials(e.expr);
          return null;
        }
        case "binary": {
          if (e.op === "+" || e.op === "-") {
            const left = extractMonomials(e.left);
            const right = extractMonomials(e.right);
            if (!left || !right) return null;
            const rScaled = e.op === "-" ? right.map((m) => ({ coeff: -m.coeff, vars: m.vars })) : right;
            return mergeMonomials([...left, ...rScaled]);
          }
          if (e.op === "*") {
            const left = extractMonomials(e.left);
            const right = extractMonomials(e.right);
            if (!left || !right) return null;
            const res: Monomial[] = [];
            for (const l of left) {
              for (const r of right) {
                res.push({ coeff: l.coeff * r.coeff, vars: mergeSorted(l.vars, r.vars) });
              }
            }
            return mergeMonomials(res);
          }
          if (e.op === "^" || e.op === "**") {
            if (e.right.kind === "number") {
              const p = Math.round(e.right.value);
              if (p === 0) return [{ coeff: 1, vars: [] }];
              if (p === 1) return extractMonomials(e.left);
              if (p === 2) {
                const left = extractMonomials(e.left);
                if (!left) return null;
                const res: Monomial[] = [];
                for (const l1 of left) {
                  for (const l2 of left) {
                    res.push({ coeff: l1.coeff * l2.coeff, vars: mergeSorted(l1.vars, l2.vars) });
                  }
                }
                return mergeMonomials(res);
              }
            }
            return null;
          }
          if (e.op === "/") {
            const rExpr = e.right;
            if (rExpr.kind === "number" && rExpr.value !== 0) {
              const left = extractMonomials(e.left);
              if (!left) return null;
              const divisor = rExpr.value;
              return left.map((m) => ({ coeff: m.coeff / divisor, vars: m.vars }));
            }
            return null;
          }
          return null;
        }
        default:
          return null;
      }
    };

    const processFlatExpr = (flat: FlatExpression) => {
      if (!flat.nonlinearTree) return;
      const monos = extractMonomials(flat.nonlinearTree);
      if (!monos) return;
      const maxDeg = monos.reduce((max, m) => Math.max(max, m.vars.length), 0);
      if (maxDeg <= 2) {
        for (const m of monos) {
          if (m.vars.length === 2) {
            if (!flat.quadraticTerms) flat.quadraticTerms = [];
            const v1 = Math.min(m.vars[0]!, m.vars[1]!);
            const v2 = Math.max(m.vars[0]!, m.vars[1]!);
            const existing = flat.quadraticTerms.find((q) => q.var1Id === v1 && q.var2Id === v2);
            if (existing) existing.coeff += m.coeff;
            else flat.quadraticTerms.push({ var1Id: v1, var2Id: v2, coeff: m.coeff });
          }
        }
      }
    };

    for (const obj of this.objectives) {
      processFlatExpr(obj.expr);
    }
    for (const con of this.constraints) {
      processFlatExpr(con.expr);
    }
  }

  private detectConicConstraints(): ConicConstraint[] {
    const cones: ConicConstraint[] = [];

    for (const con of this.constraints) {
      if (con.dropped) continue;
      // Case 1: Quadratic terms in constraint
      // E.g. x1^2 + x2^2 - t^2 <= 0, or x1^2 + x2^2 - 2*u*v <= 0
      const qTerms = con.expr.quadraticTerms;
      if (qTerms && qTerms.length >= 2 && con.expr.linearTerms.length === 0) {
        const posDiag: { varId: number; coeff: number }[] = [];
        const negDiag: { varId: number; coeff: number }[] = [];
        const negOffDiag: { var1Id: number; var2Id: number; coeff: number }[] = [];

        for (const q of qTerms) {
          if (q.var1Id === q.var2Id) {
            if (q.coeff > 0) posDiag.push({ varId: q.var1Id, coeff: q.coeff });
            else if (q.coeff < 0) negDiag.push({ varId: q.var1Id, coeff: q.coeff });
          } else {
            if (q.coeff < 0) negOffDiag.push(q);
          }
        }

        // Standard SOC: sum(x_i^2) - t^2 <= 0
        if (negDiag.length === 1 && posDiag.length >= 1 && negOffDiag.length === 0 && Math.abs(con.ub) < 1e-6) {
          const tVar = this.variables[negDiag[0]!.varId];
          if (tVar && tVar.lb >= 0) {
            cones.push({
              type: "SOC",
              name: con.name,
              coneVarId: tVar.id,
              variables: posDiag,
              rhs: con.ub,
            });
            continue;
          }
        }

        // Rotated SOC: sum(x_i^2) - 2*u*v <= 0 (or coeff < 0)
        if (negDiag.length === 0 && posDiag.length >= 1 && negOffDiag.length === 1 && Math.abs(con.ub) < 1e-6) {
          const uVar = this.variables[negOffDiag[0]!.var1Id];
          const vVar = this.variables[negOffDiag[0]!.var2Id];
          if (uVar && vVar && uVar.lb >= 0 && vVar.lb >= 0) {
            cones.push({
              type: "RSOC",
              name: con.name,
              coneVarId: uVar.id,
              rotVarId: vVar.id,
              coneMultiplier: Math.abs(negOffDiag[0]!.coeff),
              variables: posDiag,
              rhs: con.ub,
            });
            continue;
          }
        }
      }

      // Case 2: Norm constraint sqrt(sum(x_i^2)) <= t
      if (
        con.expr.nonlinearTree &&
        con.expr.nonlinearTree.kind === "call" &&
        con.expr.nonlinearTree.fn.toLowerCase() === "sqrt" &&
        con.expr.linearTerms.length === 1 &&
        con.expr.linearTerms[0]!.coeff < 0 &&
        Math.abs(con.ub) < 1e-6
      ) {
        const tVar = this.variables[con.expr.linearTerms[0]!.varId];
        if (tVar && tVar.lb >= 0) {
          cones.push({
            type: "SOC",
            name: con.name,
            coneVarId: tVar.id,
            variables: [],
            rhs: con.ub,
          });
        }
      }
    }

    return cones;
  }

  private generateCombinations(
    indexing: AmplIndexing,
    baseEnv: Map<string, SetElement>,
  ): Map<string, SetElement>[] {
    return this.setEval.generateCombinations(indexing, baseEnv);
  }
}

export function instantiateAmpl(
  model: AmplModel,
  data?: AmplData | undefined,
  options?: InstantiateOptions | undefined,
): InstantiatedProblem {
  return new ModelInstantiator(model, data, options).instantiate();
}

export { stringifyTuple };
