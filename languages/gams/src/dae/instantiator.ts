// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Relational Set Instantiator.
 *
 * Evaluates GAMS sets, aliases, parameters, tables, computed assignments, `$`-conditionals,
 * and indexed operators (`sum`, `prod`, `smin`, `smax`, `ord`, `card`, `sameas`) to produce
 * a flat `InstantiatedGamsProblem` ready for LP/MIP solving, DAE lowering, or MPS projection.
 */

import { parseGams } from "../parser/gams-parser.js";
import type {
  FlatAffineExpr,
  FlatConstraintSense,
  GamsExpr,
  GamsModel,
  GamsOptSense,
  GamsSolverType,
  InstantiatedGamsConstraint,
  InstantiatedGamsProblem,
  InstantiatedGamsVar,
  LinearTerm,
} from "../types.js";

interface IndexEnv {
  /** Maps lowercase index name -> current set element label (lowercase) */
  bindings: Map<string, string>;
  /** Maps lowercase index name -> 1-based ordinal position in its set */
  ordinals: Map<string, number>;
  /** Maps lowercase index name -> set name it iterates over */
  setOfIndex: Map<string, string>;
}

function emptyEnv(): IndexEnv {
  return {
    bindings: new Map(),
    ordinals: new Map(),
    setOfIndex: new Map(),
  };
}

function cloneEnv(env: IndexEnv): IndexEnv {
  return {
    bindings: new Map(env.bindings),
    ordinals: new Map(env.ordinals),
    setOfIndex: new Map(env.setOfIndex),
  };
}

function mergeTerms(terms: LinearTerm[]): LinearTerm[] {
  const acc = new Map<number, number>();
  for (const t of terms) {
    acc.set(t.varId, (acc.get(t.varId) ?? 0) + t.coeff);
  }
  const out: LinearTerm[] = [];
  for (const [varId, coeff] of acc) {
    if (Math.abs(coeff) > 1e-14) {
      out.push({ varId, coeff });
    }
  }
  out.sort((a, b) => a.varId - b.varId);
  return out;
}

function cartesianProduct(lists: string[][]): string[][] {
  if (lists.length === 0) return [[]];
  let acc: string[][] = [[]];
  for (const list of lists) {
    const next: string[][] = [];
    for (const prefix of acc) {
      for (const item of list) {
        next.push([...prefix, item]);
      }
    }
    acc = next;
  }
  return acc;
}

function formatVarName(base: string, indices: string[]): string {
  if (indices.length === 0) return base;
  return `${base}(${indices.map((s) => `'${s}'`).join(",")})`;
}

/**
 * Instantiates a parsed `GamsModel` (or GAMS source string) into a flat optimization problem.
 */
export function instantiateGams(sourceOrModel: string | GamsModel): InstantiatedGamsProblem {
  const model = typeof sourceOrModel === "string" ? parseGams(sourceOrModel) : sourceOrModel;

  // 1. Evaluate sets & aliases
  const sets = new Map<string, string[]>();
  const evaluatedSets: Record<string, string[]> = {};
  for (const s of model.sets) {
    const key = s.name.toLowerCase();
    const elems = s.elements.map((e) => e.toLowerCase());
    sets.set(key, elems);
    evaluatedSets[s.name] = [...s.elements];
  }
  for (const a of model.aliases) {
    if (a.names.length >= 2) {
      const base = sets.get(a.names[0]!.toLowerCase()) ?? [];
      for (let i = 1; i < a.names.length; i++) {
        const aliasName = a.names[i]!;
        sets.set(aliasName.toLowerCase(), [...base]);
        evaluatedSets[aliasName] = [...base];
      }
    }
  }

  // 2. Initialize parameters, scalars, and tables
  const params = new Map<string, Record<string, number>>();
  const paramMeta = new Map<string, { name: string; domain: string[] }>();
  for (const p of model.parameters) {
    const key = p.name.toLowerCase();
    const copy: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.values)) {
      copy[k.toLowerCase()] = v;
    }
    params.set(key, copy);
    paramMeta.set(key, { name: p.name, domain: p.domain });
  }

  // Variable lookup maps (populated in step 4, but we declare early for evaluator)
  const variables: InstantiatedGamsVar[] = [];
  const varLookup = new Map<string, Map<string, number>>(); // lowerBaseName -> (lowerTupleKey -> varId)
  const varDeclsByLower = new Map<string, { name: string; domain: string[] }>();

  const resolveSetElements = (setName: string): string[] => {
    return sets.get(setName.toLowerCase()) ?? [];
  };

  // Evaluate a pure numeric expression (for parameters, conditions, bounds)
  const evalScalar = (expr: GamsExpr, env: IndexEnv): number => {
    const aff = evalAffine(expr, env);
    return aff.constant;
  };

  const resolveIndexLabel = (expr: GamsExpr, env: IndexEnv): string => {
    if (expr.kind === "string") return expr.value.toLowerCase();
    if (expr.kind === "ref" && expr.indices.length === 0) {
      const k = expr.name.toLowerCase();
      const bound = env.bindings.get(k);
      if (bound !== undefined) return bound;
      return k;
    }
    if (expr.kind === "number") return String(expr.value);
    return String(evalScalar(expr, env));
  };

  const evalAffine = (expr: GamsExpr, env: IndexEnv): FlatAffineExpr => {
    switch (expr.kind) {
      case "number":
        return { constant: expr.value, terms: [], isNonlinear: false };
      case "string":
        return { constant: 0, terms: [], isNonlinear: false };
      case "unary": {
        const inner = evalAffine(expr.operand, env);
        if (expr.op === "+") return inner;
        if (expr.op === "-") {
          return {
            constant: -inner.constant,
            terms: inner.terms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
            isNonlinear: inner.isNonlinear,
          };
        }
        // logical not
        return { constant: Math.abs(inner.constant) < 1e-12 ? 1 : 0, terms: [], isNonlinear: false };
      }
      case "dollar": {
        const condVal = evalScalar(expr.condition, env);
        if (Math.abs(condVal) < 1e-12) {
          return { constant: 0, terms: [], isNonlinear: false };
        }
        return evalAffine(expr.expr, env);
      }
      case "binary": {
        const l = evalAffine(expr.left, env);
        const r = evalAffine(expr.right, env);
        switch (expr.op) {
          case "+":
            return {
              constant: l.constant + r.constant,
              terms: mergeTerms([...l.terms, ...r.terms]),
              isNonlinear: l.isNonlinear || r.isNonlinear,
            };
          case "-":
            return {
              constant: l.constant - r.constant,
              terms: mergeTerms([...l.terms, ...r.terms.map((t) => ({ varId: t.varId, coeff: -t.coeff }))]),
              isNonlinear: l.isNonlinear || r.isNonlinear,
            };
          case "*": {
            const lHasVar = l.terms.length > 0;
            const rHasVar = r.terms.length > 0;
            if (!lHasVar && !rHasVar) {
              return { constant: l.constant * r.constant, terms: [], isNonlinear: l.isNonlinear || r.isNonlinear };
            }
            if (!lHasVar && rHasVar) {
              return {
                constant: l.constant * r.constant,
                terms: mergeTerms(r.terms.map((t) => ({ varId: t.varId, coeff: l.constant * t.coeff }))),
                isNonlinear: l.isNonlinear || r.isNonlinear,
              };
            }
            if (lHasVar && !rHasVar) {
              return {
                constant: l.constant * r.constant,
                terms: mergeTerms(l.terms.map((t) => ({ varId: t.varId, coeff: r.constant * t.coeff }))),
                isNonlinear: l.isNonlinear || r.isNonlinear,
              };
            }
            // Nonlinear product of two variable expressions
            return {
              constant: l.constant * r.constant,
              terms: mergeTerms([...l.terms, ...r.terms]),
              isNonlinear: true,
              nonlinearExpr: expr,
            };
          }
          case "/": {
            if (r.terms.length > 0) {
              return { constant: 0, terms: l.terms, isNonlinear: true, nonlinearExpr: expr };
            }
            const denom = Math.abs(r.constant) < 1e-15 ? 1e-15 : r.constant;
            return {
              constant: l.constant / denom,
              terms: mergeTerms(l.terms.map((t) => ({ varId: t.varId, coeff: t.coeff / denom }))),
              isNonlinear: l.isNonlinear || r.isNonlinear,
            };
          }
          case "**":
          case "^": {
            if (l.terms.length > 0 || r.terms.length > 0) {
              return {
                constant: Math.pow(l.constant, r.constant),
                terms: l.terms,
                isNonlinear: true,
                nonlinearExpr: expr,
              };
            }
            return { constant: Math.pow(l.constant, r.constant), terms: [], isNonlinear: false };
          }
          case "<":
          case "lt":
            return { constant: l.constant < r.constant ? 1 : 0, terms: [], isNonlinear: false };
          case "<=":
          case "le":
            return { constant: l.constant <= r.constant ? 1 : 0, terms: [], isNonlinear: false };
          case ">":
          case "gt":
            return { constant: l.constant > r.constant ? 1 : 0, terms: [], isNonlinear: false };
          case ">=":
          case "ge":
            return { constant: l.constant >= r.constant ? 1 : 0, terms: [], isNonlinear: false };
          case "=":
          case "==":
          case "eq":
            return { constant: Math.abs(l.constant - r.constant) < 1e-12 ? 1 : 0, terms: [], isNonlinear: false };
          case "<>":
          case "!=":
          case "ne":
            return { constant: Math.abs(l.constant - r.constant) >= 1e-12 ? 1 : 0, terms: [], isNonlinear: false };
          case "and":
            return {
              constant: Math.abs(l.constant) > 1e-12 && Math.abs(r.constant) > 1e-12 ? 1 : 0,
              terms: [],
              isNonlinear: false,
            };
          case "or":
            return {
              constant: Math.abs(l.constant) > 1e-12 || Math.abs(r.constant) > 1e-12 ? 1 : 0,
              terms: [],
              isNonlinear: false,
            };
          case "xor": {
            const lb = Math.abs(l.constant) > 1e-12;
            const rb = Math.abs(r.constant) > 1e-12;
            return { constant: lb !== rb ? 1 : 0, terms: [], isNonlinear: false };
          }
          default:
            return { constant: 0, terms: [], isNonlinear: false };
        }
      }
      case "indexedOp": {
        const domainLists = expr.domains.map((d) => resolveSetElements(d.setName ?? d.index));
        const tuples = cartesianProduct(domainLists);
        if (expr.op === "sum") {
          let constant = 0;
          const terms: LinearTerm[] = [];
          let isNonlinear = false;
          for (const tuple of tuples) {
            const sub = cloneEnv(env);
            for (let k = 0; k < expr.domains.length; k++) {
              const dName = expr.domains[k]!.index.toLowerCase();
              const setName = (expr.domains[k]!.setName ?? expr.domains[k]!.index).toLowerCase();
              const elem = tuple[k]!;
              sub.bindings.set(dName, elem);
              sub.setOfIndex.set(dName, setName);
              const setElems = resolveSetElements(setName);
              sub.ordinals.set(dName, setElems.indexOf(elem) + 1);
            }
            if (expr.condition && Math.abs(evalScalar(expr.condition, sub)) < 1e-12) {
              continue;
            }
            const val = evalAffine(expr.body, sub);
            constant += val.constant;
            terms.push(...val.terms);
            if (val.isNonlinear) isNonlinear = true;
          }
          return { constant, terms: mergeTerms(terms), isNonlinear };
        }
        // prod, smin, smax (scalar reductions)
        let acc = expr.op === "prod" ? 1 : expr.op === "smin" ? Infinity : -Infinity;
        let hasAny = false;
        let isNonlinear = false;
        for (const tuple of tuples) {
          const sub = cloneEnv(env);
          for (let k = 0; k < expr.domains.length; k++) {
            const dName = expr.domains[k]!.index.toLowerCase();
            const setName = (expr.domains[k]!.setName ?? expr.domains[k]!.index).toLowerCase();
            const elem = tuple[k]!;
            sub.bindings.set(dName, elem);
            sub.setOfIndex.set(dName, setName);
            const setElems = resolveSetElements(setName);
            sub.ordinals.set(dName, setElems.indexOf(elem) + 1);
          }
          if (expr.condition && Math.abs(evalScalar(expr.condition, sub)) < 1e-12) {
            continue;
          }
          const val = evalAffine(expr.body, sub);
          if (val.terms.length > 0) isNonlinear = true;
          hasAny = true;
          if (expr.op === "prod") acc *= val.constant;
          else if (expr.op === "smin") acc = Math.min(acc, val.constant);
          else acc = Math.max(acc, val.constant);
        }
        return { constant: hasAny ? acc : 0, terms: [], isNonlinear };
      }
      case "call": {
        const fn = expr.name.toLowerCase();
        if (fn === "ord" && expr.args.length >= 1) {
          const arg = expr.args[0]!;
          if (arg.kind === "ref" && arg.indices.length === 0) {
            const ordVal = env.ordinals.get(arg.name.toLowerCase()) ?? 0;
            return { constant: ordVal, terms: [], isNonlinear: false };
          }
          return { constant: 0, terms: [], isNonlinear: false };
        }
        if (fn === "card" && expr.args.length >= 1) {
          const arg = expr.args[0]!;
          if (arg.kind === "ref" && arg.indices.length === 0) {
            const elems = resolveSetElements(arg.name);
            return { constant: elems.length, terms: [], isNonlinear: false };
          }
          return { constant: 0, terms: [], isNonlinear: false };
        }
        if (fn === "sameas" && expr.args.length >= 2) {
          const a = resolveIndexLabel(expr.args[0]!, env);
          const b = resolveIndexLabel(expr.args[1]!, env);
          return { constant: a === b ? 1 : 0, terms: [], isNonlinear: false };
        }
        const argVals = expr.args.map((a) => evalAffine(a, env));
        const hasVar = argVals.some((a) => a.terms.length > 0);
        const c0 = argVals[0]?.constant ?? 0;
        const c1 = argVals[1]?.constant ?? 0;
        let res = 0;
        switch (fn) {
          case "abs":
            res = Math.abs(c0);
            break;
          case "sqrt":
            res = Math.sqrt(Math.max(0, c0));
            break;
          case "sqr":
            res = c0 * c0;
            break;
          case "exp":
            res = Math.exp(c0);
            break;
          case "log":
            res = Math.log(Math.max(1e-15, c0));
            break;
          case "log10":
            res = Math.log10(Math.max(1e-15, c0));
            break;
          case "log2":
            res = Math.log2(Math.max(1e-15, c0));
            break;
          case "sin":
            res = Math.sin(c0);
            break;
          case "cos":
            res = Math.cos(c0);
            break;
          case "tan":
            res = Math.tan(c0);
            break;
          case "power":
            res = Math.pow(c0, c1);
            break;
          case "min":
            res = Math.min(...argVals.map((a) => a.constant));
            break;
          case "max":
            res = Math.max(...argVals.map((a) => a.constant));
            break;
          case "mod":
            res = c1 !== 0 ? c0 % c1 : 0;
            break;
          case "floor":
            res = Math.floor(c0);
            break;
          case "ceil":
            res = Math.ceil(c0);
            break;
          case "round":
            res = Math.round(c0);
            break;
          case "sign":
            res = Math.sign(c0);
            break;
          default:
            res = c0;
        }
        return { constant: res, terms: [], isNonlinear: hasVar };
      }
      case "ref": {
        const key = expr.name.toLowerCase();
        const tupleKey = expr.indices.map((idx) => resolveIndexLabel(idx, env)).join(".");

        // Check variable table first
        const vMap = varLookup.get(key);
        if (vMap) {
          const varId = vMap.get(tupleKey);
          if (varId !== undefined) {
            if (expr.suffix === "lo") return { constant: variables[varId]!.lb, terms: [], isNonlinear: false };
            if (expr.suffix === "up") return { constant: variables[varId]!.ub, terms: [], isNonlinear: false };
            if (expr.suffix === "l") return { constant: variables[varId]!.initVal, terms: [], isNonlinear: false };
            return { constant: 0, terms: [{ varId, coeff: 1 }], isNonlinear: false };
          }
        }

        // Check parameter table
        const pTable = params.get(key);
        if (pTable) {
          const val = pTable[tupleKey] ?? 0;
          return { constant: val, terms: [], isNonlinear: false };
        }

        return { constant: 0, terms: [], isNonlinear: false };
      }
    }
  };

  // 3. Evaluate parameter assignments (before variable bounds & equations)
  for (const stmt of model.assignments) {
    if (stmt.suffix && ["lo", "up", "fx", "l", "m"].includes(stmt.suffix)) continue;
    const key = stmt.target.toLowerCase();
    let pTable = params.get(key);
    if (!pTable) {
      pTable = {};
      params.set(key, pTable);
    }

    if (stmt.indices.length === 0) {
      const env = emptyEnv();
      if (!stmt.condition || Math.abs(evalScalar(stmt.condition, env)) > 1e-12) {
        pTable[""] = evalScalar(stmt.value, env);
      }
    } else {
      // Determine free index variables vs literal labels
      const pDeclDomain = paramMeta.get(key)?.domain ?? [];
      const freeIndexPositions: Array<{ pos: number; idxName: string; setName: string }> = [];
      const fixedLabels: Array<string | null> = [];

      for (let i = 0; i < stmt.indices.length; i++) {
        const idxExpr = stmt.indices[i]!;
        if (idxExpr.kind === "string") {
          fixedLabels.push(idxExpr.value.toLowerCase());
        } else if (idxExpr.kind === "ref" && idxExpr.indices.length === 0) {
          const idxLower = idxExpr.name.toLowerCase();
          if (sets.has(idxLower)) {
            fixedLabels.push(null);
            freeIndexPositions.push({ pos: i, idxName: idxLower, setName: idxLower });
          } else if (pDeclDomain[i] && sets.has(pDeclDomain[i]!.toLowerCase())) {
            // Check if idxLower is actually a literal element of the domain set
            const domElems = resolveSetElements(pDeclDomain[i]!);
            if (domElems.includes(idxLower)) {
              fixedLabels.push(idxLower);
            } else {
              fixedLabels.push(null);
              freeIndexPositions.push({ pos: i, idxName: idxLower, setName: pDeclDomain[i]!.toLowerCase() });
            }
          } else {
            fixedLabels.push(idxLower);
          }
        } else {
          fixedLabels.push(resolveIndexLabel(idxExpr, emptyEnv()));
        }
      }

      const domainLists = freeIndexPositions.map((f) => resolveSetElements(f.setName));
      const tuples = cartesianProduct(domainLists);
      for (const tuple of tuples) {
        const env = emptyEnv();
        const keyParts = [...fixedLabels];
        for (let k = 0; k < freeIndexPositions.length; k++) {
          const fi = freeIndexPositions[k]!;
          const elem = tuple[k]!;
          keyParts[fi.pos] = elem;
          env.bindings.set(fi.idxName, elem);
          env.setOfIndex.set(fi.idxName, fi.setName);
          env.ordinals.set(fi.idxName, resolveSetElements(fi.setName).indexOf(elem) + 1);
        }
        if (stmt.condition && Math.abs(evalScalar(stmt.condition, env)) < 1e-12) {
          continue;
        }
        pTable[keyParts.join(".")] = evalScalar(stmt.value, env);
      }
    }
  }

  // 4. Instantiate variables
  for (const v of model.variables) {
    const key = v.name.toLowerCase();
    varDeclsByLower.set(key, { name: v.name, domain: v.domain });
    const vMap = new Map<string, number>();
    varLookup.set(key, vMap);

    const domainLists = v.domain.map((d) => resolveSetElements(d));
    const tuples = cartesianProduct(domainLists);

    let defaultLb = -Infinity;
    let defaultUb = Infinity;
    if (v.varKind === "positive") {
      defaultLb = 0;
    } else if (v.varKind === "negative") {
      defaultUb = 0;
    } else if (v.varKind === "binary") {
      defaultLb = 0;
      defaultUb = 1;
    } else if (v.varKind === "integer") {
      defaultLb = 0;
    }

    for (const tuple of tuples) {
      const varId = variables.length;
      const tupleKey = tuple.join(".");
      vMap.set(tupleKey, varId);
      variables.push({
        id: varId,
        name: formatVarName(v.name, tuple),
        baseName: v.name,
        indices: tuple,
        varKind: v.varKind,
        lb: defaultLb,
        ub: defaultUb,
        initVal: 0,
      });
    }
  }

  // 5. Apply variable suffix assignments (.lo, .up, .fx, .l)
  for (const stmt of model.assignments) {
    if (!stmt.suffix || !["lo", "up", "fx", "l"].includes(stmt.suffix)) continue;
    const key = stmt.target.toLowerCase();
    const vMap = varLookup.get(key);
    const vDecl = varDeclsByLower.get(key);
    if (!vMap || !vDecl) continue;

    if (stmt.indices.length === 0) {
      const varId = vMap.get("");
      if (varId !== undefined) {
        const val = evalScalar(stmt.value, emptyEnv());
        const v = variables[varId]!;
        if (stmt.suffix === "lo") v.lb = val;
        else if (stmt.suffix === "up") v.ub = val;
        else if (stmt.suffix === "fx") {
          v.lb = val;
          v.ub = val;
        } else if (stmt.suffix === "l") v.initVal = val;
      }
    } else {
      const freeIndexPositions: Array<{ pos: number; idxName: string; setName: string }> = [];
      const fixedLabels: Array<string | null> = [];
      for (let i = 0; i < stmt.indices.length; i++) {
        const idxExpr = stmt.indices[i]!;
        if (idxExpr.kind === "string") {
          fixedLabels.push(idxExpr.value.toLowerCase());
        } else if (idxExpr.kind === "ref" && idxExpr.indices.length === 0) {
          const idxLower = idxExpr.name.toLowerCase();
          if (sets.has(idxLower)) {
            fixedLabels.push(null);
            freeIndexPositions.push({ pos: i, idxName: idxLower, setName: idxLower });
          } else {
            fixedLabels.push(idxLower);
          }
        } else {
          fixedLabels.push(resolveIndexLabel(idxExpr, emptyEnv()));
        }
      }
      const domainLists = freeIndexPositions.map((f) => resolveSetElements(f.setName));
      const tuples = cartesianProduct(domainLists);
      for (const tuple of tuples) {
        const env = emptyEnv();
        const keyParts = [...fixedLabels];
        for (let k = 0; k < freeIndexPositions.length; k++) {
          const fi = freeIndexPositions[k]!;
          const elem = tuple[k]!;
          keyParts[fi.pos] = elem;
          env.bindings.set(fi.idxName, elem);
          env.setOfIndex.set(fi.idxName, fi.setName);
          env.ordinals.set(fi.idxName, resolveSetElements(fi.setName).indexOf(elem) + 1);
        }
        if (stmt.condition && Math.abs(evalScalar(stmt.condition, env)) < 1e-12) continue;
        const varId = vMap.get(keyParts.join("."));
        if (varId !== undefined) {
          const val = evalScalar(stmt.value, env);
          const v = variables[varId]!;
          if (stmt.suffix === "lo") v.lb = val;
          else if (stmt.suffix === "up") v.ub = val;
          else if (stmt.suffix === "fx") {
            v.lb = val;
            v.ub = val;
          } else if (stmt.suffix === "l") v.initVal = val;
        }
      }
    }
  }

  // 6. Determine solve metadata & active equations
  const solveStmt = model.solves[model.solves.length - 1];
  const modelDecl = solveStmt
    ? model.models.find((m) => m.name.toLowerCase() === solveStmt.modelName.toLowerCase())
    : model.models[0];

  const activeEqSet =
    modelDecl && !modelDecl.allEquations && modelDecl.equations.length > 0
      ? new Set(modelDecl.equations.map((e) => e.toLowerCase()))
      : null;

  const sense: GamsOptSense = solveStmt?.sense ?? "minimizing";
  const solverType = (solveStmt?.solverType || "lp").toLowerCase() as GamsSolverType;
  const objectiveVarName = solveStmt?.objectiveVar || (variables[variables.length - 1]?.name ?? "z");
  const objectiveVarId = varLookup.get(objectiveVarName.toLowerCase())?.get("") ?? -1;

  // 7. Instantiate active equations
  const constraints: InstantiatedGamsConstraint[] = [];
  for (const def of model.equationDefs) {
    if (activeEqSet && !activeEqSet.has(def.name.toLowerCase())) continue;

    const domainLists = def.domain.map((d) => resolveSetElements(d));
    const tuples = cartesianProduct(domainLists);

    for (const tuple of tuples) {
      const env = emptyEnv();
      for (let k = 0; k < def.domain.length; k++) {
        const dName = def.domain[k]!.toLowerCase();
        const elem = tuple[k]!;
        env.bindings.set(dName, elem);
        env.setOfIndex.set(dName, dName);
        env.ordinals.set(dName, resolveSetElements(dName).indexOf(elem) + 1);
      }

      if (def.condition && Math.abs(evalScalar(def.condition, env)) < 1e-12) {
        continue;
      }

      const lhsAff = evalAffine(def.lhs, env);
      const rhsAff = evalAffine(def.rhs, env);

      // Standard form: (lhsTerms - rhsTerms) (sense) (rhsConst - lhsConst)
      const combinedTerms = mergeTerms([
        ...lhsAff.terms,
        ...rhsAff.terms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
      ]);
      const rhs = rhsAff.constant - lhsAff.constant;
      let flatSense: FlatConstraintSense = "=";
      if (def.relation === "=l=") flatSense = "<=";
      else if (def.relation === "=g=") flatSense = ">=";

      constraints.push({
        id: constraints.length,
        name: formatVarName(def.name, tuple),
        baseName: def.name,
        indices: tuple,
        terms: combinedTerms,
        sense: flatSense,
        rhs,
        isNonlinear: lhsAff.isNonlinear || rhsAff.isNonlinear,
      });
    }
  }

  // Build evaluatedParams output map
  const evaluatedParams: Record<string, Record<string, number>> = {};
  for (const [k, v] of params) {
    const origName = paramMeta.get(k)?.name ?? k;
    evaluatedParams[origName] = { ...v };
  }

  const objectiveTerms: LinearTerm[] = objectiveVarId >= 0 ? [{ varId: objectiveVarId, coeff: 1 }] : [];

  return {
    name: modelDecl?.name ?? model.title ?? "GamsModel",
    sense,
    solverType,
    objectiveVarName,
    objectiveVarId,
    variables,
    constraints,
    objectiveConstant: 0,
    objectiveTerms,
    evaluatedSets,
    evaluatedParams,
  };
}
