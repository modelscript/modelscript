// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Relational Set Evaluator, Ordered/Circular Set Operations, and Parameter Evaluator.
 */

import type { AmplData, AmplExpr, AmplIndexing, AmplModel, SetElement } from "../types.js";
import {
  besselJ0,
  besselJ1,
  besselY0,
  besselY1,
  erf,
  erfc,
  gamma,
  lgamma,
  normal,
  normal01,
  normalPdf,
} from "./special-functions.js";

export function stringifyTuple(element: SetElement): string {
  if (Array.isArray(element)) {
    return element.join(",");
  }
  return String(element);
}

export function parseTupleKey(key: string): (string | number)[] {
  return key.split(",").map((s) => {
    const n = Number(s);
    return Number.isFinite(n) && !Number.isNaN(n) && String(n) === s.trim() ? n : s.trim();
  });
}

export class SetEvaluator {
  private evaluatedSets = new Map<string, SetElement[]>();
  private model: AmplModel;
  private data: AmplData;
  private suffixResolver?: ((targetName: string, suffix: string) => number | undefined) | undefined;

  constructor(
    model: AmplModel,
    data: AmplData,
    suffixResolver?: ((targetName: string, suffix: string) => number | undefined) | undefined,
  ) {
    this.model = model;
    this.data = data;
    this.suffixResolver = suffixResolver;

    // Load pre-populated sets from .dat
    for (const [name, members] of data.sets.entries()) {
      this.evaluatedSets.set(name, [...members]);
    }
  }

  public setSuffixResolver(
    resolver: ((targetName: string, suffix: string) => number | undefined) | undefined,
  ): void {
    this.suffixResolver = resolver;
  }

  public invalidateCache(): void {
    this.evaluatedSets.clear();
    for (const [name, members] of this.data.sets.entries()) {
      this.evaluatedSets.set(name, [...members]);
    }
  }

  public getSet(name: string): SetElement[] {
    if (this.evaluatedSets.has(name)) {
      return this.evaluatedSets.get(name)!;
    }

    const decl = this.model.sets.get(name);
    if (!decl) {
      throw new Error(`Undeclared set '${name}'.`);
    }

    if (decl.assignExpr) {
      const res = this.evalSetExpr(decl.assignExpr, new Map());
      this.evaluatedSets.set(name, res);
      return res;
    }

    if (decl.default) {
      const res = this.evalSetExpr(decl.default, new Map());
      this.evaluatedSets.set(name, res);
      return res;
    }

    const empty: SetElement[] = [];
    this.evaluatedSets.set(name, empty);
    return empty;
  }

  public isCircularSet(name: string): boolean {
    return Boolean(this.model.sets.get(name)?.circular);
  }

  public evalSetExpr(expr: AmplExpr, env: Map<string, SetElement>): SetElement[] {
    switch (expr.kind) {
      case "identifier":
        if (env.has(expr.name)) {
          const val = env.get(expr.name)!;
          return Array.isArray(val) ? (val as SetElement[]) : [val];
        }
        return this.getSet(expr.name);

      case "set_literal": {
        const result: SetElement[] = [];
        for (const el of expr.elements) {
          if (el.kind === "number") result.push(el.value);
          else if (el.kind === "string" || el.kind === "identifier") {
            const raw = el.kind === "string" ? el.value : el.name;
            if (el.kind === "identifier" && env.has(raw)) {
              result.push(env.get(raw)!);
            } else {
              result.push(raw);
            }
          } else {
            const v = this.evalValue(el, env);
            result.push(v);
          }
        }
        return result;
      }

      case "range": {
        const startVal = Math.round(this.evalScalar(expr.start, env));
        const endVal = Math.round(this.evalScalar(expr.end, env));
        const stepVal = expr.step ? Math.round(this.evalScalar(expr.step, env)) : 1;
        const result: SetElement[] = [];
        if (stepVal > 0) {
          for (let i = startVal; i <= endVal; i += stepVal) {
            result.push(i);
          }
        } else if (stepVal < 0) {
          for (let i = startVal; i >= endVal; i += stepVal) {
            result.push(i);
          }
        }
        return result;
      }

      case "set_op": {
        const left = this.evalSetExpr(expr.left, env);
        const right = this.evalSetExpr(expr.right, env);
        return this.applySetOp(expr.op, left, right);
      }

      case "binary": {
        if (
          expr.op === "cross" ||
          expr.op === "union" ||
          expr.op === "diff" ||
          expr.op === "symdiff" ||
          expr.op === "inter"
        ) {
          const left = this.evalSetExpr(expr.left, env);
          const right = this.evalSetExpr(expr.right, env);
          return this.applySetOp(expr.op, left, right);
        }
        break;
      }

      case "subscript": {
        // Slice projection on a multi-dimensional set or parameter keys e.g. ARCS[i, *]
        if (this.model.sets.has(expr.name)) {
          const baseSet = this.getSet(expr.name);
          const hasWildcard = expr.indices.some((idx) => idx.kind === "wildcard");
          if (hasWildcard) {
            const matched: SetElement[] = [];
            for (const el of baseSet) {
              const tuple = Array.isArray(el) ? el : [el];
              if (tuple.length !== expr.indices.length) continue;
              let ok = true;
              const projected: (string | number)[] = [];
              for (let k = 0; k < expr.indices.length; k++) {
                const idxExpr = expr.indices[k]!;
                if (idxExpr.kind === "wildcard") {
                  projected.push(tuple[k]!);
                } else {
                  const target = this.evalValue(idxExpr, env);
                  if (String(tuple[k]) !== String(target)) {
                    ok = false;
                    break;
                  }
                }
              }
              if (ok) {
                matched.push(projected.length === 1 ? projected[0]! : projected);
              }
            }
            return matched;
          }
        }
        break;
      }
    }

    throw new Error(`Cannot evaluate expression of kind '${expr.kind}' as a set.`);
  }

  public applySetOp(
    op: "union" | "inter" | "diff" | "symdiff" | "cross",
    left: SetElement[],
    right: SetElement[],
  ): SetElement[] {
    const leftStrings = new Map<string, SetElement>();
    for (const el of left) leftStrings.set(stringifyTuple(el), el);

    const rightStrings = new Map<string, SetElement>();
    for (const el of right) rightStrings.set(stringifyTuple(el), el);

    switch (op) {
      case "union": {
        const res = [...left];
        for (const [k, el] of rightStrings.entries()) {
          if (!leftStrings.has(k)) res.push(el);
        }
        return res;
      }
      case "inter": {
        const res: SetElement[] = [];
        for (const [k, el] of leftStrings.entries()) {
          if (rightStrings.has(k)) res.push(el);
        }
        return res;
      }
      case "diff": {
        const res: SetElement[] = [];
        for (const [k, el] of leftStrings.entries()) {
          if (!rightStrings.has(k)) res.push(el);
        }
        return res;
      }
      case "symdiff": {
        const res: SetElement[] = [];
        for (const [k, el] of leftStrings.entries()) {
          if (!rightStrings.has(k)) res.push(el);
        }
        for (const [k, el] of rightStrings.entries()) {
          if (!leftStrings.has(k)) res.push(el);
        }
        return res;
      }
      case "cross": {
        const res: SetElement[] = [];
        for (const l of left) {
          for (const r of right) {
            const lArr = Array.isArray(l) ? l : [l];
            const rArr = Array.isArray(r) ? r : [r];
            res.push([...lArr, ...rArr]);
          }
        }
        return res;
      }
    }
  }

  public generateCombinations(
    indexing: AmplIndexing,
    baseEnv: Map<string, SetElement>,
  ): Map<string, SetElement>[] {
    let envs: Map<string, SetElement>[] = [new Map(baseEnv)];

    for (const iter of indexing.iterators) {
      const nextEnvs: Map<string, SetElement>[] = [];
      for (const currentEnv of envs) {
        const setMembers = this.evalSetExpr(iter.setExpr, currentEnv);
        for (const member of setMembers) {
          const candidateEnv = new Map(currentEnv);
          if (iter.variables.length === 1) {
            candidateEnv.set(iter.variables[0]!, member);
          } else if (Array.isArray(member) && member.length >= iter.variables.length) {
            for (let k = 0; k < iter.variables.length; k++) {
              candidateEnv.set(iter.variables[k]!, member[k]!);
            }
          } else if (iter.variables.length > 0) {
            candidateEnv.set(iter.variables[0]!, member);
          }

          if (iter.condition) {
            const condVal = this.evalCondition(iter.condition, candidateEnv);
            if (!condVal) continue;
          }

          nextEnvs.push(candidateEnv);
        }
      }
      envs = nextEnvs;
    }

    return envs;
  }

  public evalCondition(cond: AmplExpr, env: Map<string, SetElement>): boolean {
    if (cond.kind === "binary") {
      if (cond.op === "and") {
        return this.evalCondition(cond.left, env) && this.evalCondition(cond.right, env);
      }
      if (cond.op === "or") {
        return this.evalCondition(cond.left, env) || this.evalCondition(cond.right, env);
      }
      if (cond.op === "==>") {
        return !this.evalCondition(cond.left, env) || this.evalCondition(cond.right, env);
      }
      if (cond.op === "<==>") {
        return this.evalCondition(cond.left, env) === this.evalCondition(cond.right, env);
      }
      const l = this.evalValue(cond.left, env);
      const r = this.evalValue(cond.right, env);
      switch (cond.op) {
        case "=":
        case "==":
          return String(l) === String(r) || (typeof l === "number" && typeof r === "number" && Math.abs(l - r) < 1e-12);
        case "!=":
        case "<>":
          return String(l) !== String(r);
        case "<":
          return Number(l) < Number(r);
        case "<=":
          return Number(l) <= Number(r);
        case ">":
          return Number(l) > Number(r);
        case ">=":
          return Number(l) >= Number(r);
      }
    }
    if (cond.kind === "unary" && (cond.op === "not" || cond.op === "!")) {
      return !this.evalCondition(cond.expr, env);
    }
    return this.evalScalar(cond, env) !== 0;
  }

  /**
   * Evaluates an expression that may return either a string/symbolic element or a numeric value
   * (e.g. `first(T)`, `next(t, T)`, `member(k, T)`, or an iterator symbol).
   */
  public evalValue(expr: AmplExpr, env: Map<string, SetElement>): string | number {
    if (expr.kind === "string") return expr.value;
    if (expr.kind === "number") return expr.value;
    if (expr.kind === "identifier") {
      if (env.has(expr.name)) {
        const v = env.get(expr.name)!;
        return Array.isArray(v) ? stringifyTuple(v) : v;
      }
      const paramMap = this.data.params.get(expr.name);
      if (paramMap && paramMap.has("")) {
        return paramMap.get("")!;
      }
      const paramDecl = this.model.params.get(expr.name);
      if (paramDecl) {
        if (paramDecl.assignExpr) return this.evalValue(paramDecl.assignExpr, env);
        if (paramDecl.default) return this.evalValue(paramDecl.default, env);
        return 0;
      }
      if (this.suffixResolver) {
        const sufVal = this.suffixResolver(expr.name, "val");
        if (sufVal !== undefined) return sufVal;
      }
      const varDecl = this.model.vars.get(expr.name);
      if (varDecl?.definedExpr) {
        return this.evalScalar(varDecl.definedExpr, env);
      }
      if (this.model.objectives.has(expr.name)) {
        const objDecl = this.model.objectives.get(expr.name)!;
        return this.evalScalar(objDecl.expr, env);
      }
      return expr.name;
    }
    if (expr.kind === "call") {
      const fn = expr.fn.toLowerCase();
      const userFn = this.model.functions?.get(expr.fn) ??
        (this.model.functions ? Array.from(this.model.functions.values()).find((f) => f.name.toLowerCase() === fn) : undefined);
      if (userFn && !userFn.isExternal && userFn.body) {
        const fnEnv = new Map(env);
        for (let i = 0; i < userFn.params.length && i < expr.args.length; i++) {
          const argVal = this.evalValue(expr.args[i]!, env);
          fnEnv.set(userFn.params[i]!, argVal);
        }
        return this.evalValue(userFn.body, fnEnv);
      }

      if (fn === "first" || fn === "last") {
        const setArg = expr.args[0];
        if (!setArg) throw new Error(`${fn}() requires a set argument.`);
        const members = this.evalSetExpr(setArg, env);
        if (members.length === 0) throw new Error(`Set passed to ${fn}() is empty.`);
        const chosen = fn === "first" ? members[0]! : members[members.length - 1]!;
        return Array.isArray(chosen) ? stringifyTuple(chosen) : chosen;
      }
      if (fn === "member") {
        const k = Math.round(this.evalScalar(expr.args[0]!, env));
        const members = this.evalSetExpr(expr.args[1]!, env);
        if (k < 1 || k > members.length) {
          throw new Error(`member(${k}, S) index out of bounds [1..${members.length}].`);
        }
        const chosen = members[k - 1]!;
        return Array.isArray(chosen) ? stringifyTuple(chosen) : chosen;
      }
      if (fn === "next" || fn === "prev" || fn === "nextw" || fn === "prevw") {
        const elemVal = this.evalValue(expr.args[0]!, env);
        let setExpr = expr.args[1];
        let step = 1;
        let isCircular = fn === "nextw" || fn === "prevw";

        if (setExpr && (setExpr.kind === "number" || (!this.isSetLikeExpr(setExpr, env)))) {
          // Syntax `next(t, k)` where set is inferred from first ordered set containing `t`
          step = Math.round(this.evalScalar(setExpr, env));
          setExpr = undefined;
        } else if (expr.args[2]) {
          step = Math.round(this.evalScalar(expr.args[2], env));
        }

        const { members, circular } = this.resolveOrderedSetForElement(elemVal, setExpr, env);
        if (circular) isCircular = true;
        const idx = members.findIndex((m) => String(stringifyTuple(m)) === String(elemVal));
        if (idx < 0) {
          throw new Error(`Element '${elemVal}' not found in ordered set for ${fn}().`);
        }
        const delta = fn.startsWith("next") ? step : -step;
        let targetIdx = idx + delta;
        if (isCircular && members.length > 0) {
          targetIdx = ((targetIdx % members.length) + members.length) % members.length;
        }
        if (targetIdx < 0 || targetIdx >= members.length) {
          throw new Error(`${fn}('${elemVal}') stepped out of ordered set bounds.`);
        }
        const res = members[targetIdx]!;
        return Array.isArray(res) ? stringifyTuple(res) : res;
      }
    }
    return this.evalScalar(expr, env);
  }

  private isSetLikeExpr(expr: AmplExpr, env: Map<string, SetElement>): boolean {
    if (expr.kind === "identifier") {
      return this.model.sets.has(expr.name) || (this.data.sets.has(expr.name) && !env.has(expr.name));
    }
    return expr.kind === "set_literal" || expr.kind === "range" || expr.kind === "set_op";
  }

  private resolveOrderedSetForElement(
    elemVal: string | number,
    setExpr: AmplExpr | undefined,
    env: Map<string, SetElement>,
  ): { members: SetElement[]; circular: boolean } {
    if (setExpr) {
      const members = this.evalSetExpr(setExpr, env);
      const circular = setExpr.kind === "identifier" ? this.isCircularSet(setExpr.name) : false;
      return { members, circular };
    }
    for (const [setName, decl] of this.model.sets.entries()) {
      const members = this.getSet(setName);
      if (members.some((m) => String(stringifyTuple(m)) === String(elemVal))) {
        return { members, circular: Boolean(decl.circular) };
      }
    }
    throw new Error(`Could not infer ordered set containing element '${elemVal}'.`);
  }

  public lookupParam(name: string, key: string, env: Map<string, SetElement>): number {
    const paramMap = this.data.params.get(name);
    if (paramMap && paramMap.has(key)) {
      const val = paramMap.get(key)!;
      if (typeof val === "number") return val;
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    }

    const decl = this.model.params.get(name);
    if (decl) {
      const localEnv = new Map(env);
      if (decl.indexing && decl.indexing.iterators.length > 0 && key.length > 0) {
        const keyParts = parseTupleKey(key);
        const allVars: string[] = [];
        for (const it of decl.indexing.iterators) {
          allVars.push(...it.variables);
        }
        for (let k = 0; k < allVars.length && k < keyParts.length; k++) {
          localEnv.set(allVars[k]!, keyParts[k]!);
        }
      }
      if (decl.assignExpr) {
        return this.evalScalar(decl.assignExpr, localEnv);
      }
      if (decl.default) {
        return this.evalScalar(decl.default, localEnv);
      }
    }
    return 0;
  }

  public evalScalar(expr: AmplExpr, env: Map<string, SetElement>): number {
    switch (expr.kind) {
      case "number":
        return expr.value;

      case "identifier": {
        if (env.has(expr.name)) {
          const val = env.get(expr.name)!;
          if (typeof val === "number") return val;
          const parsed = Number(val);
          if (Number.isFinite(parsed)) return parsed;
        }
        if (this.suffixResolver) {
          const sufVal = this.suffixResolver(expr.name, "val");
          if (sufVal !== undefined) return sufVal;
        }
        const varDecl = this.model.vars.get(expr.name);
        if (varDecl?.definedExpr) {
          return this.evalScalar(varDecl.definedExpr, env);
        }
        if (this.model.objectives.has(expr.name)) {
          const objDecl = this.model.objectives.get(expr.name)!;
          return this.evalScalar(objDecl.expr, env);
        }
        return this.lookupParam(expr.name, "", env);
      }

      case "subscript": {
        // Check for wildcard slice inside reduction e.g. cost[i, *]
        const idxVals = expr.indices.map((idx) => this.evalValue(idx, env));
        const key = idxVals.join(",");
        const fullName = `${expr.name}[${key}]`;
        if (this.suffixResolver) {
          const sufVal = this.suffixResolver(fullName, "val");
          if (sufVal !== undefined) return sufVal;
        }
        return this.lookupParam(expr.name, key, env);
      }

      case "suffix": {
        let targetName = "";
        if (expr.target.kind === "identifier") {
          targetName = expr.target.name;
        } else if (expr.target.kind === "subscript") {
          const idxVals = expr.target.indices.map((idx) => this.evalValue(idx, env));
          targetName = `${expr.target.name}[${idxVals.join(",")}]`;
        }
        if (this.suffixResolver && targetName) {
          const v = this.suffixResolver(targetName, expr.suffix);
          if (v !== undefined) return v;
        }
        return 0;
      }

      case "if_then_else": {
        return this.evalCondition(expr.condition, env)
          ? this.evalScalar(expr.thenExpr, env)
          : this.evalScalar(expr.elseExpr, env);
      }

      case "reduction": {
        const combos = this.generateCombinations({ iterators: expr.iterators }, env);
        if (expr.reduction === "sum") {
          let s = 0;
          for (const cEnv of combos) s += this.evalScalar(expr.expr, cEnv);
          return s;
        }
        if (expr.reduction === "prod") {
          let p = 1;
          for (const cEnv of combos) p *= this.evalScalar(expr.expr, cEnv);
          return p;
        }
        if (expr.reduction === "min") {
          let m = Number.POSITIVE_INFINITY;
          for (const cEnv of combos) m = Math.min(m, this.evalScalar(expr.expr, cEnv));
          return m;
        }
        if (expr.reduction === "max") {
          let m = Number.NEGATIVE_INFINITY;
          for (const cEnv of combos) m = Math.max(m, this.evalScalar(expr.expr, cEnv));
          return m;
        }
        if (expr.reduction === "count") {
          let c = 0;
          for (const cEnv of combos) {
            if (this.evalCondition(expr.expr, cEnv)) c++;
          }
          return c;
        }
        if (expr.reduction === "forall") {
          for (const cEnv of combos) {
            if (!this.evalCondition(expr.expr, cEnv)) return 0;
          }
          return 1;
        }
        if (expr.reduction === "exists") {
          for (const cEnv of combos) {
            if (this.evalCondition(expr.expr, cEnv)) return 1;
          }
          return 0;
        }
        return 0;
      }

      case "piecewise": {
        const x = this.evalScalar(expr.argument, env);
        const x0 = expr.zeroPoint ? this.evalScalar(expr.zeroPoint, env) : 0;
        const breaks = expr.breakpoints.map((b) => this.evalScalar(b, env));
        const slopes = expr.slopes.map((s) => this.evalScalar(s, env));
        return evaluatePiecewiseScalar(breaks, slopes, x, x0);
      }

      case "binary": {
        if (
          expr.op === "=" ||
          expr.op === "==" ||
          expr.op === "!=" ||
          expr.op === "<>" ||
          expr.op === "<" ||
          expr.op === "<=" ||
          expr.op === ">" ||
          expr.op === ">=" ||
          expr.op === "and" ||
          expr.op === "or" ||
          expr.op === "==>" ||
          expr.op === "<==>"
        ) {
          return this.evalCondition(expr, env) ? 1 : 0;
        }
        const l = this.evalScalar(expr.left, env);
        const r = this.evalScalar(expr.right, env);
        switch (expr.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return r !== 0 ? l / r : 0;
          case "^":
          case "**":
            return Math.pow(l, r);
          case "mod":
            return l % r;
          case "div":
            return Math.trunc(l / r);
        }
        break;
      }

      case "unary": {
        if (expr.op === "not" || expr.op === "!") {
          return this.evalCondition(expr.expr, env) ? 0 : 1;
        }
        const v = this.evalScalar(expr.expr, env);
        return expr.op === "-" ? -v : v;
      }

      case "call": {
        const fn = expr.fn.toLowerCase();
        const userFn = this.model.functions?.get(expr.fn) ??
          (this.model.functions ? Array.from(this.model.functions.values()).find((f) => f.name.toLowerCase() === fn) : undefined);
        if (userFn && !userFn.isExternal && userFn.body) {
          const fnEnv = new Map(env);
          for (let i = 0; i < userFn.params.length && i < expr.args.length; i++) {
            const argVal = this.evalValue(expr.args[i]!, env);
            fnEnv.set(userFn.params[i]!, argVal);
          }
          return this.evalScalar(userFn.body, fnEnv);
        }

        if (fn === "card") {
          const setArg = expr.args[0];
          if (!setArg) return 0;
          return this.evalSetExpr(setArg, env).length;
        }
        if (fn === "ord" || fn === "ord0") {
          const elemVal = this.evalValue(expr.args[0]!, env);
          const { members } = this.resolveOrderedSetForElement(elemVal, expr.args[1], env);
          const idx = members.findIndex((m) => String(stringifyTuple(m)) === String(elemVal));
          if (idx < 0) {
            if (fn === "ord0") return 0;
            throw new Error(`Element '${elemVal}' not found in ordered set for ord().`);
          }
          return idx + 1;
        }
        if (fn === "first" || fn === "last" || fn === "next" || fn === "prev" || fn === "nextw" || fn === "prevw" || fn === "member") {
          const v = this.evalValue(expr, env);
          return typeof v === "number" ? v : Number(v) || 0;
        }

        const args = expr.args.map((a) => this.evalScalar(a, env));
        switch (fn) {
          case "abs":
            return Math.abs(args[0] ?? 0);
          case "sqrt":
            return Math.sqrt(args[0] ?? 0);
          case "exp":
            return Math.exp(args[0] ?? 0);
          case "log":
            return Math.log(args[0] ?? 0);
          case "log10":
            return Math.log10(args[0] ?? 0);
          case "sin":
            return Math.sin(args[0] ?? 0);
          case "cos":
            return Math.cos(args[0] ?? 0);
          case "tan":
            return Math.tan(args[0] ?? 0);
          case "asin":
            return Math.asin(args[0] ?? 0);
          case "acos":
            return Math.acos(args[0] ?? 0);
          case "atan":
            return Math.atan(args[0] ?? 0);
          case "atan2":
            return Math.atan2(args[0] ?? 0, args[1] ?? 1);
          case "sinh":
            return Math.sinh(args[0] ?? 0);
          case "cosh":
            return Math.cosh(args[0] ?? 0);
          case "tanh":
            return Math.tanh(args[0] ?? 0);
          case "floor":
            return Math.floor(args[0] ?? 0);
          case "ceil":
            return Math.ceil(args[0] ?? 0);
          case "round":
            return Math.round(args[0] ?? 0);
          case "trunc":
            return Math.trunc(args[0] ?? 0);
          case "min":
            return Math.min(...args);
          case "max":
            return Math.max(...args);
          case "erf":
            return erf(args[0] ?? 0);
          case "erfc":
            return erfc(args[0] ?? 0);
          case "gamma":
            return gamma(args[0] ?? 0);
          case "lgamma":
            return lgamma(args[0] ?? 0);
          case "bessel_j0":
          case "besselj0":
            return besselJ0(args[0] ?? 0);
          case "bessel_j1":
          case "besselj1":
            return besselJ1(args[0] ?? 0);
          case "bessel_y0":
          case "bessely0":
            return besselY0(args[0] ?? 0);
          case "bessel_y1":
          case "bessely1":
            return besselY1(args[0] ?? 0);
          case "normal01":
            return normal01(args[0] ?? 0);
          case "normal":
            return normal(args[0] ?? 0, args[1] ?? 0, args[2] ?? 1);
          case "normal_pdf":
          case "normalpdf":
            return normalPdf(args[0] ?? 0, args[1] ?? 0, args[2] ?? 1);
        }
        break;
      }
    }
    return 0;
  }
}

/**
 * Evaluates an AMPL piecewise-linear function `<<b_1, ..., b_k; s_1, ..., s_{k+1}>> (x, x0)` at scalar `x`.
 * By AMPL convention, the function equals 0 at `x = x0` (where `x0 = 0` by default).
 */
export function evaluatePiecewiseScalar(
  breakpoints: number[],
  slopes: number[],
  x: number,
  x0 = 0,
): number {
  if (slopes.length === 0) return 0;
  if (breakpoints.length === 0) return slopes[0]! * (x - x0);

  const getSlopeAt = (pt: number): number => {
    for (let i = 0; i < breakpoints.length; i++) {
      if (pt < breakpoints[i]!) return slopes[i]!;
    }
    return slopes[breakpoints.length] ?? slopes[slopes.length - 1]!;
  };

  if (Math.abs(x - x0) < 1e-15) return 0;

  const dir = x >= x0 ? 1 : -1;
  const low = Math.min(x, x0);
  const high = Math.max(x, x0);

  const pts = [low];
  for (const b of breakpoints) {
    if (b > low && b < high) pts.push(b);
  }
  pts.push(high);

  let integral = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const mid = 0.5 * (a + b);
    integral += getSlopeAt(mid) * (b - a);
  }

  return dir * integral;
}
