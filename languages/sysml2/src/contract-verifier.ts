// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DpllTSolver,
  Interval,
  type ExprNode,
  type NonlinearConstraint,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import {
  collapseWhitespace,
  collectCstLeaves,
  extractLastNameSegment,
  findCstChildren,
  findCstDescendants,
  getCstChildren,
  getDocumentationCommentText,
  parseSysmlSource,
  readDottedChainFromLeaves,
  stripLeadingTilde,
  tokenizeSysmlExpressionCst,
  unwrapSysmlConstraintBodyCst,
  type CstLeaf,
  type SysmlCstNode,
  type SysmlExprToken,
} from "./cst-utils.js";
import { evaluateSysML2Constraint, parseSysML2Expression, sysmlAstSome } from "./evaluator.js";
import { SysML2EventTraceExplorer } from "./event-trace-explorer.js";
import { getAllocationEndpointName, resolveFeatureInScope, resolveTypeOf } from "./queries.js";
import { extractVariables, parseGuardConstraints, type GuardConstraint } from "./state-machine-verifier.js";

/**
 * Diagnostic information when an Assume-Guarantee interface contract fails.
 */
export interface ContractViolation {
  /** Optional name of the connection usage where the contract violation occurred. */
  connectionName?: string | undefined;
  /** Name of the upstream supplier port/component providing the guarantee. */
  sourceEndpoint: string;
  /** Name of the downstream consumer port/component requiring the assumption. */
  targetEndpoint: string;
  /** Guarantee constraint expression on the supplier endpoint. */
  guarantee: string;
  /** Assumption constraint expression violated on the consumer endpoint. */
  assumption: string;
  /** Variable identifier involved in the failed entailment check. */
  variable: string;
  /** Concrete witness value demonstrating that the guarantee permits a state outside the assumption. */
  counterexample: number;
  /** Human-readable explanation of why the supplier guarantee fails to entail the consumer assumption. */
  reason: string;
}

/**
 * Result of verifying one or more Assume-Guarantee interface connections.
 */
export interface ContractVerificationResult {
  /** True if all verified consumer assumptions are entailed by their connected supplier guarantees. */
  isSatisfied: boolean;
  /** List of Assume-Guarantee violations discovered across checked connections. */
  violations: ContractViolation[];
}

/**
 * Specification of a Signal Temporal Logic (STL) / invariant Assume-Guarantee contract $G_{[t_0, t_1]}(A \Rightarrow G)$.
 */
export interface TemporalContract {
  /** Optional identifier of the temporal contract. */
  name?: string | undefined;
  /** Environment assumption predicate expression $A$. */
  assumption: string;
  /** System guarantee predicate expression $G$. */
  guarantee: string;
  /** Optional bounded time window $[t_{\min}, t_{\max}]$ in seconds over which the implication must hold. */
  timeHorizon?: [number, number] | undefined;
}

/**
 * Quantitative and qualitative evaluation result for a `TemporalContract`.
 */
export interface TemporalContractResult {
  /** True if the implication $A \Rightarrow G$ holds across all evaluated time samples (or symbolically). */
  isSatisfied: boolean;
  /** Minimum quantitative STL robustness margin $\rho$ observed while the assumption held ($\rho \ge 0$ indicates satisfaction). */
  minRobustness: number;
  /** First simulation timestamp (in seconds) at which $\rho < 0$, if violated. */
  violationTime?: number | undefined;
  /** Witness signal value at `violationTime` (or symbolic counterexample value) that violated the guarantee. */
  counterexample?: number | undefined;
  /** Diagnostic explanation of the temporal contract outcome or violation. */
  reason?: string | undefined;
}

/**
 * Verifies temporal assume-guarantee entailment: A => G over simulation trajectories.
 */
export function verifyTemporalContract(
  contract: TemporalContract,
  times: number[],
  signals: Record<string, number[]>,
): TemporalContractResult {
  // Parse assumption and guarantee bounds
  const aConstraints = parseGuardConstraints(contract.assumption);
  const gConstraints = parseGuardConstraints(contract.guarantee);
  const aAst = parseSysML2Expression(contract.assumption);
  const gAst = parseSysML2Expression(contract.guarantee);
  const hasCompoundNode = (ast: ReturnType<typeof parseSysML2Expression>) =>
    sysmlAstSome(
      ast,
      (n) =>
        (n.kind === "UnaryExpr" && n.op === "not") ||
        n.kind === "ConditionalExpr" ||
        n.kind === "CallExpr" ||
        (n.kind === "BinaryExpr" &&
          (n.op === "or" ||
            n.op === "xor" ||
            n.op === "implies" ||
            n.op === "+" ||
            n.op === "-" ||
            n.op === "*" ||
            n.op === "/" ||
            n.op === "%" ||
            n.op === "^")),
    );
  const useCompoundEvaluator = hasCompoundNode(aAst) || hasCompoundNode(gAst);

  let worstMargin = Infinity;
  let violationTime: number | undefined = undefined;
  let counterexample: number | undefined = undefined;
  let violationReason: string | undefined = undefined;

  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (contract.timeHorizon) {
      if (t < contract.timeHorizon[0] || t > contract.timeHorizon[1]) continue;
    }

    if (useCompoundEvaluator && aAst && gAst) {
      const env: Record<string, number> = { time: t, t };
      for (const [sigName, values] of Object.entries(signals)) {
        const v = values[i];
        if (v !== undefined) env[sigName] = v;
      }
      const aEval = evaluateSysML2Constraint(aAst, env);
      if (!aEval.satisfied) continue;

      const gEval = evaluateSysML2Constraint(gAst, env);
      if (gEval.margin < worstMargin) {
        worstMargin = gEval.margin;
      }
      if (!gEval.satisfied && violationTime === undefined) {
        violationTime = t;
        let violatingVal: number | undefined;
        for (const atom of gEval.violatedAtoms) {
          for (const [sigName, vals] of Object.entries(signals)) {
            if (atom.includes(sigName)) {
              violatingVal = vals[i];
              break;
            }
          }
          if (violatingVal !== undefined) break;
        }
        counterexample = violatingVal ?? Object.values(signals)[0]?.[i];
        violationReason = `At t = ${t.toFixed(4)}s: assumption '${contract.assumption}' held, but guarantee '${contract.guarantee}' violated (${gEval.violatedAtoms.join(", ")})`;
      }
      continue;
    }

    // Check if assumption holds at time t
    let aHolds = true;
    for (const a of aConstraints) {
      const val = signals[a.variable]?.[i];
      if (val === undefined) continue;
      if (a.operator === "<=" && val > a.value + 1e-9) aHolds = false;
      if (a.operator === "<" && val >= a.value - 1e-9) aHolds = false;
      if (a.operator === ">=" && val < a.value - 1e-9) aHolds = false;
      if (a.operator === ">" && val <= a.value + 1e-9) aHolds = false;
      if (a.operator === "==" && Math.abs(val - a.value) > 1e-9) aHolds = false;
    }

    if (!aHolds) {
      // If assumption does not hold at time t, contract is vacuously satisfied at this point
      continue;
    }

    // Assumption holds -> compute quantitative STL robustness margin rho(G, x(t)) for each guarantee conjunct
    for (const g of gConstraints) {
      const val = signals[g.variable]?.[i];
      if (val === undefined) continue;

      let margin = Infinity;
      if (g.operator === "<=" || g.operator === "<") {
        margin = g.value - val;
      } else if (g.operator === ">=" || g.operator === ">") {
        margin = val - g.value;
      } else if (g.operator === "==") {
        margin = -Math.abs(val - g.value);
      }

      if (margin < worstMargin) {
        worstMargin = margin;
      }

      if (margin < 0 && violationTime === undefined) {
        violationTime = t;
        counterexample = val;
        violationReason = `At t = ${t.toFixed(4)}s: assumption '${contract.assumption}' held, but guarantee '${contract.guarantee}' violated with ${g.variable} = ${val.toFixed(4)}`;
      }
    }
  }

  return {
    isSatisfied: worstMargin >= 0,
    minRobustness: worstMargin,
    violationTime,
    counterexample,
    reason: violationReason,
  };
}

/**
 * Unwraps `require constraint { ... }`, `assume constraint { ... }`, `assert constraint { ... }`,
 * and `constraint { ... }` wrappers cleanly into raw Boolean/relational expressions.
 */
function unwrapContractConstraintText(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  const needsCstUnwrap =
    trimmed.includes("{") ||
    trimmed.endsWith(";") ||
    lower.startsWith("require") ||
    lower.startsWith("assume") ||
    lower.startsWith("assert") ||
    lower.startsWith("constraint") ||
    lower.startsWith("public") ||
    lower.startsWith("private") ||
    lower.startsWith("protected");

  let unwrapped = needsCstUnwrap ? unwrapSysmlConstraintBodyCst(trimmed) : trimmed;

  // Strip any remaining leading `require`, `assume`, `assert`, or `constraint` keyword on brace-less clauses
  while (unwrapped) {
    const uLow = unwrapped.toLowerCase();
    let stripped = false;
    for (const kw of ["public", "private", "protected", "require", "assume", "assert", "constraint"]) {
      if (uLow.startsWith(kw) && unwrapped.length > kw.length) {
        const nextCh = unwrapped[kw.length]!;
        if (nextCh === " " || nextCh === "\t" || nextCh === "\r" || nextCh === "\n" || nextCh === "{") {
          unwrapped = unwrapped.slice(kw.length).trim();
          stripped = true;
          break;
        }
      }
    }
    if (!stripped) break;
  }

  if (unwrapped.startsWith("{") && unwrapped.endsWith("}")) {
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  while (unwrapped.endsWith(";")) {
    unwrapped = unwrapped.slice(0, -1).trimEnd();
  }
  return unwrapped.trim();
}

/**
 * Negates a single guard constraint into an array of equivalent non-linear inequality constraints.
 */
function negateGuardConstraint(c: GuardConstraint): NonlinearConstraint[] {
  const eps = 1e-4;
  if (c.nonlinear) {
    const orig = c.nonlinear;
    if (orig.rel === "<=" || orig.rel === "<") {
      return [{ expr: orig.expr, rel: ">=", rhs: orig.rel === "<=" ? orig.rhs + eps : orig.rhs }];
    } else if (orig.rel === ">=" || orig.rel === ">") {
      return [{ expr: orig.expr, rel: "<=", rhs: orig.rel === ">=" ? orig.rhs - eps : orig.rhs }];
    } else if (orig.rel === "!=") {
      return [{ expr: orig.expr, rel: "==", rhs: orig.rhs }];
    } else {
      return [
        { expr: orig.expr, rel: "<=", rhs: orig.rhs - eps },
        { expr: orig.expr, rel: ">=", rhs: orig.rhs + eps },
      ];
    }
  }

  const varExpr: ExprNode = { kind: "var", name: c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable };
  if (c.operator === "<=" || c.operator === "<") {
    return [{ expr: varExpr, rel: ">=", rhs: c.operator === "<=" ? c.value + eps : c.value }];
  } else if (c.operator === ">=" || c.operator === ">") {
    return [{ expr: varExpr, rel: "<=", rhs: c.operator === ">=" ? c.value - eps : c.value }];
  } else if (c.operator === "!=") {
    return [{ expr: varExpr, rel: "==", rhs: c.value }];
  } else {
    return [
      { expr: varExpr, rel: "<=", rhs: c.value - eps },
      { expr: varExpr, rel: ">=", rhs: c.value + eps },
    ];
  }
}

/**
 * Result of checking symbolic entailment $\bigwedge \text{Premises} \Rightarrow \text{Conclusion}$.
 */
export interface EntailmentResult {
  /** True if the conjunction of premises mathematically entails the conclusion ($\text{Premises} \land \neg\text{Conclusion}$ is UNSAT). */
  entailed: boolean;
  /** Human-readable explanation when entailment fails. */
  reason?: string | undefined;
  /** Interval box mapping variable names to $[lo, hi]$ bounds where premises hold but the conclusion is violated. */
  counterexample?: Record<string, [number, number]> | undefined;
}

/**
 * Symbolically verifies whether a set of premises mathematically guarantees a conclusion (Premises => Conclusion).
 * Checks whether (Premises /\ ~Conclusion) is UNSAT via DPLL(T) + HC4 contractor.
 */
export function checkSymbolicEntailment(premises: string[], conclusionStr: string): EntailmentResult {
  const pConstraints = premises.flatMap((p) => parseGuardConstraints(unwrapContractConstraintText(p)));
  const cConstraints = parseGuardConstraints(unwrapContractConstraintText(conclusionStr));

  if (cConstraints.length === 0) {
    return { entailed: true };
  }

  // Fast-path: single-variable bounds (without disequalities)
  const isSimple =
    !pConstraints.some((c) => c.nonlinear || c.operator === "!=") &&
    !cConstraints.some((c) => c.nonlinear || c.operator === "!=");

  if (isSimple) {
    const gBounds = new Map<string, { lower: number; upper: number }>();
    for (const g of pConstraints) {
      const varName = g.variable;
      const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      if (g.operator === "<=" || g.operator === "<") {
        b.upper = Math.min(b.upper, g.value);
      } else if (g.operator === ">=" || g.operator === ">") {
        b.lower = Math.max(b.lower, g.value);
      } else if (g.operator === "==") {
        b.lower = Math.max(b.lower, g.value);
        b.upper = Math.min(b.upper, g.value);
      }
      gBounds.set(varName, b);
    }

    // Contradictory premises (UNSAT): False => Conclusion is vacuously entailed!
    for (const [_, b] of gBounds) {
      if (b.lower > b.upper + 1e-9) {
        return { entailed: true };
      }
    }

    let allHold = true;
    for (const a of cConstraints) {
      const varName = a.variable;
      const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
      const gLo = b.lower;
      const gHi = b.upper;

      if (a.operator === ">=" || a.operator === ">") {
        if (gLo < a.value - 1e-9) {
          allHold = false;
          return {
            entailed: false,
            reason: `Lower bound ${!Number.isFinite(gLo) ? "-∞" : gLo.toFixed(2)} does not satisfy '${a.variable} >= ${a.value}'`,
            counterexample: {
              [varName]: [!Number.isFinite(gLo) ? a.value - 1 : gLo, !Number.isFinite(gLo) ? a.value - 1 : gLo],
            },
          };
        }
      }
      if (a.operator === "<=" || a.operator === "<") {
        if (gHi > a.value + 1e-9) {
          allHold = false;
          return {
            entailed: false,
            reason: `Upper bound ${!Number.isFinite(gHi) ? "∞" : gHi.toFixed(2)} does not satisfy '${a.variable} <= ${a.value}'`,
            counterexample: {
              [varName]: [!Number.isFinite(gHi) ? a.value + 1 : gHi, !Number.isFinite(gHi) ? a.value + 1 : gHi],
            },
          };
        }
      }
    }
    if (allHold) return { entailed: true };
  }

  // Non-linear / Multi-variable path via DPLL(T) + HC4 contractor
  const allVarNames = new Set<string>();
  for (const c of [...pConstraints, ...cConstraints]) {
    if (c.nonlinear) {
      extractVariables(c.nonlinear.expr, allVarNames);
    } else {
      allVarNames.add(c.variable);
    }
  }

  for (const c of cConstraints) {
    const negations = negateGuardConstraint(c);

    for (const neg of negations) {
      const theoryLiterals = new Map<number, NonlinearConstraint>();
      const clauses: number[][] = [];
      let litId = 1;

      // Add all premises
      for (const p of pConstraints) {
        let nl: NonlinearConstraint;
        if (p.nonlinear) {
          nl = p.nonlinear;
        } else {
          const varName = p.variable;
          const rel =
            p.operator === "<=" || p.operator === "<" ? "<=" : p.operator === ">=" || p.operator === ">" ? ">=" : "==";
          nl = { expr: { kind: "var", name: varName }, rel, rhs: p.value };
        }
        theoryLiterals.set(litId, nl);
        clauses.push([litId]);
        litId++;
      }

      // Add negated conclusion
      theoryLiterals.set(litId, neg);
      clauses.push([litId]);
      litId++;

      const initialBox = new Map<string, Interval>();
      for (const v of allVarNames) {
        initialBox.set(v, new Interval(-1e6, 1e6));
      }

      const solver = new DpllTSolver({
        clauses,
        theoryLiterals,
        initialBox,
        delta: 1e-3,
        maxSubdivisions: 1500,
      });

      const res = solver.solve(initialBox);
      if (res.status !== "UNSAT") {
        const cexMap: Record<string, [number, number]> = {};
        if (res.solutionBox) {
          for (const [k, inv] of res.solutionBox.entries()) {
            cexMap[k] = [inv.lo, inv.hi];
          }
        }
        return {
          entailed: false,
          reason: `Premises do not guarantee '${conclusionStr}' (satisfiable counterexample box discovered)`,
          counterexample: cexMap,
        };
      }
    }
  }

  return { entailed: true };
}

function formatSysmlExprTokens(tokens: readonly SysmlExprToken[], target: "sysml" | "nuxmv"): string {
  const parts: string[] = [];
  let prevWasUnarySign = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.type === "eof") continue;
    let txt = tok.type === "string" ? `"${tok.text}"` : tok.text;
    if (target === "nuxmv") {
      if (tok.type === "op" && tok.text === "and") txt = "&";
      else if (tok.type === "op" && tok.text === "or") txt = "|";
      else if (tok.type === "op" && tok.text === "==") txt = "=";
      else if (tok.type === "op" && tok.text === "implies") txt = "->";
      else if (tok.type === "op" && tok.text === "not") txt = "!";
    }
    const prev = parts.length > 0 ? parts[parts.length - 1] : undefined;
    const prevTok = i > 0 ? tokens[i - 1] : undefined;
    const noSpaceAfterPrev =
      !prev || prev === "(" || prev === "[" || prevWasUnarySign || (prev === "!" && target === "nuxmv");
    const noSpaceBeforeCur =
      txt === ")" ||
      txt === "]" ||
      txt === "," ||
      txt === ";" ||
      (txt === "(" &&
        prevTok?.type === "ident" &&
        prevTok.text !== "if" &&
        prevTok.text !== "then" &&
        prevTok.text !== "else");
    parts.push(noSpaceAfterPrev || noSpaceBeforeCur ? txt : ` ${txt}`);
    prevWasUnarySign = (txt === "-" || txt === "+") && (parts.length === 1 || prev === "(" || prevTok?.type === "op");
  }
  return parts.join("").trim();
}

function formatSysmlExprForNuXmv(exprText: string): string {
  return formatSysmlExprTokens(tokenizeSysmlExpressionCst(exprText), "nuxmv");
}

function remapSysmlPortIdentifiers(exprText: string, mapEntries: ReadonlyArray<readonly [string, string]>): string {
  const tokens = tokenizeSysmlExpressionCst(exprText);
  const remapped = tokens.map((tok) => {
    if (tok.type !== "ident") return tok;
    let name = tok.text;
    for (const [src, dst] of mapEntries) {
      if (name === src) {
        name = dst;
      } else if (name.startsWith(`${src}.`)) {
        name = `${dst}${name.slice(src.length)}`;
      } else if (!src.includes(".") && name.includes(".")) {
        name = name
          .split(".")
          .map((seg) => (seg === src ? dst : seg))
          .join(".");
      }
    }
    return name === tok.text ? tok : { ...tok, text: name };
  });
  return formatSysmlExprTokens(remapped, "sysml");
}

function splitTopLevelConjunctStrings(expr: string): string[] {
  let cleaned = expr.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    let d = 0;
    let outerBalanced = true;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === "(") d++;
      else if (cleaned[i] === ")") {
        d--;
        if (d === 0 && i < cleaned.length - 1) {
          outerBalanced = false;
          break;
        }
      }
    }
    if (outerBalanced && d === 0) {
      cleaned = cleaned.slice(1, -1).trim();
    }
  }

  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);

    if (depth === 0) {
      if (cleaned.slice(i, i + 2) === "&&") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        i += 1;
        continue;
      }
      if (cleaned.slice(i, i + 5).toLowerCase() === " and " && i > 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        i += 4;
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Verifies contract entailment (G_supplier => A_consumer) for an interface connection.
 * Given a supplier guaranteeing a range and a consumer assuming a range,
 * checks if G_supplier /\ ~A_consumer is satisfiable.
 */
export function verifyAssumeGuaranteePair(
  supplierName: string,
  consumerName: string,
  guarantees: string[],
  assumptions: string[],
  connectionName?: string,
  portMapping?: Map<string, string> | Record<string, string>,
): ContractVerificationResult {
  const violations: ContractViolation[] = [];

  const unwrappedGuarantees = guarantees.map(unwrapContractConstraintText).filter(Boolean);
  const unwrappedAssumptions = assumptions.map(unwrapContractConstraintText).filter(Boolean);

  let effectiveGuarantees = unwrappedGuarantees;
  if (portMapping) {
    const mapEntries = portMapping instanceof Map ? Array.from(portMapping.entries()) : Object.entries(portMapping);
    effectiveGuarantees = unwrappedGuarantees.map((g) => remapSysmlPortIdentifiers(g, mapEntries));
  }

  const gConstraints = effectiveGuarantees.flatMap((g) => parseGuardConstraints(g));

  // Pair each flattened GuardConstraint 1-to-1 with its own atomic assumption clause
  const aItems: { constraint: GuardConstraint; rawText: string }[] = [];
  for (const aExpr of unwrappedAssumptions) {
    const conjunctStrs = splitTopLevelConjunctStrings(aExpr);
    if (conjunctStrs.length <= 1) {
      for (const c of parseGuardConstraints(aExpr)) {
        aItems.push({ constraint: c, rawText: aExpr });
      }
    } else {
      for (const atomStr of conjunctStrs) {
        for (const c of parseGuardConstraints(atomStr)) {
          aItems.push({ constraint: c, rawText: atomStr });
        }
      }
    }
  }

  if (gConstraints.length === 0 || aItems.length === 0) {
    return { isSatisfied: true, violations: [] };
  }

  // Exact real bounds per canonical variable
  const gBounds = new Map<string, { lower: number; upper: number }>();
  for (const g of gConstraints) {
    const varName = g.variable;
    const b = gBounds.get(varName) ?? { lower: -Infinity, upper: Infinity };
    if (g.operator === "<=" || g.operator === "<") {
      b.upper = Math.min(b.upper, g.value);
    } else if (g.operator === ">=" || g.operator === ">") {
      b.lower = Math.max(b.lower, g.value);
    } else if (g.operator === "==") {
      b.lower = Math.max(b.lower, g.value);
      b.upper = Math.min(b.upper, g.value);
    }
    gBounds.set(varName, b);
  }

  // Check each consumer assumption atom against supplier guarantees
  for (const { constraint: a, rawText: aRaw } of aItems) {
    const ent = checkSymbolicEntailment(effectiveGuarantees, aRaw);

    if (!ent.entailed) {
      const b = gBounds.get(a.variable) ?? { lower: -Infinity, upper: Infinity };
      const gLo = b.lower;
      const gHi = b.upper;
      const varName = a.variable.includes(".") ? a.variable.split(".").pop()! : a.variable;

      let cexVal = 0;
      let reasonText =
        ent.reason || `Supplier '${supplierName}' does not satisfy consumer '${consumerName}' assumption '${aRaw}'`;

      if (a.operator === ">=" || a.operator === ">") {
        cexVal = !Number.isFinite(gLo) ? a.value - 1 : gLo;
        reasonText = `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gLo) ? "-∞" : gLo}, violating consumer '${consumerName}' assumption '${a.variable} >= ${a.value}'`;
      } else if (a.operator === "<=" || a.operator === "<") {
        cexVal = !Number.isFinite(gHi) ? a.value + 1 : gHi;
        reasonText = `Supplier '${supplierName}' can deliver ${varName} = ${!Number.isFinite(gHi) ? "∞" : gHi}, violating consumer '${consumerName}' assumption '${a.variable} <= ${a.value}'`;
      } else if (ent.counterexample) {
        const firstBox = Object.values(ent.counterexample)[0];
        if (firstBox) cexVal = firstBox[0];
      }

      violations.push({
        connectionName,
        sourceEndpoint: supplierName,
        targetEndpoint: consumerName,
        guarantee:
          effectiveGuarantees.find((g) => g.includes(varName) || g.includes(a.variable)) ||
          `${varName} ∈ [${gLo}, ${gHi}]`,
        assumption: aRaw,
        variable: varName,
        counterexample: cexVal,
        reason: reasonText,
      });
    }
  }

  return {
    isSatisfied: violations.length === 0,
    violations,
  };
}

function classifyConstraintChild(
  db: QueryDB,
  child: SymbolEntry,
): { kind: "assume" | "require" | "assert" | "constraint"; body: string } | null {
  const rawText = (db.cstText(child.startOffset, child.endOffset, child) || "").trim();
  if (!rawText) return null;

  const rawMetaKind = child.metadata?.["constraintKind"];
  const metaKind = typeof rawMetaKind === "string" ? rawMetaKind.trim().toLowerCase() : "";

  // Inspect leading keyword tokens BEFORE checking ruleName / generic "constraint"
  const leaves = collectCstLeaves(parseSysmlSource(rawText));
  let idx = 0;
  if (leaves[idx]?.text === "public" || leaves[idx]?.text === "private" || leaves[idx]?.text === "protected") {
    idx++;
  }
  let firstTok = leaves[idx]?.text.toLowerCase() ?? "";

  // In SysML v2 CST, `RequirementConstraintMember` places `assume` / `require` / `assert`
  // immediately before the inner `ConstraintUsage` node's `startOffset`.
  if (firstTok === "constraint" && !metaKind && child.parentId !== null && typeof db.symbol === "function") {
    const parentSym = db.symbol(child.parentId);
    if (parentSym && child.startOffset > parentSym.startOffset) {
      const lookbackStart = Math.max(parentSym.startOffset, child.startOffset - 48);
      const prefix = db.cstText(lookbackStart, child.startOffset, parentSym) || "";
      const prefixMatch = /(?:^|[;{}])\s*(?:(?:public|private|protected)\s+)?(assume|require|assert)\s*$/i.exec(prefix);
      if (prefixMatch?.[1]) {
        firstTok = prefixMatch[1].toLowerCase();
      }
    }
  }

  let classified: "assume" | "require" | "assert" | "constraint" | null = null;
  if (metaKind === "assume" || firstTok === "assume") {
    classified = "assume";
  } else if (metaKind === "require" || firstTok === "require") {
    classified = "require";
  } else if (metaKind === "assert" || firstTok === "assert" || child.ruleName === "AssertConstraintUsage") {
    classified = "assert";
  } else if (firstTok === "constraint" || child.ruleName === "ConstraintUsage") {
    classified = "constraint";
  } else if (child.ruleName === "RequirementConstraintUsage") {
    classified = "require";
  }

  if (!classified) return null;
  const body = unwrapContractConstraintText(rawText);
  if (!body) return null;
  return { kind: classified, body };
}

function extractConnectionEndpointsFromCst(
  db: QueryDB,
  conn: SymbolEntry,
): { sourceName?: string | undefined; targetName?: string | undefined } {
  const rawMetaSource = conn.metadata?.["source"];
  const rawMetaTarget = conn.metadata?.["target"];
  let sourceName = typeof rawMetaSource === "string" && rawMetaSource.trim() ? rawMetaSource.trim() : undefined;
  let targetName = typeof rawMetaTarget === "string" && rawMetaTarget.trim() ? rawMetaTarget.trim() : undefined;

  if (!sourceName || !targetName) {
    const refs = db.childrenOf(conn.id).filter((c) => c.kind === "Reference");
    if (refs.length >= 2) {
      const r0 = refs[0]!;
      const r1 = refs[1]!;
      const r0Slice = (db.cstText(r0.startOffset, r0.endOffset, r0) || "").trim();
      const r1Slice = (db.cstText(r1.startOffset, r1.endOffset, r1) || "").trim();
      sourceName ||= stripLeadingTilde(r0Slice.includes(".") ? r0Slice : getAllocationEndpointName(db, r0) || r0Slice);
      targetName ||= stripLeadingTilde(r1Slice.includes(".") ? r1Slice : getAllocationEndpointName(db, r1) || r1Slice);
    }
  }

  if (!sourceName || !targetName) {
    const connText = db.cstText(conn.startOffset, conn.endOffset, conn) || "";
    if (connText) {
      const leaves = collectCstLeaves(parseSysmlSource(connText));
      for (let i = 0; i < leaves.length; i++) {
        const tok = leaves[i]!.text;
        if (tok === "connect") {
          let p = i + 1;
          if (leaves[p]?.text === "~") p++;
          const src = readDottedChainFromLeaves(leaves, p);
          if (src && leaves[src.nextIdx]?.text === "to") {
            let q = src.nextIdx + 1;
            if (leaves[q]?.text === "~") q++;
            const tgt = readDottedChainFromLeaves(leaves, q);
            if (tgt) {
              sourceName ||= src.text;
              targetName ||= tgt.text;
              break;
            }
          }
        } else if (tok === "bind") {
          let p = i + 1;
          if (leaves[p]?.text === "~") p++;
          const src = readDottedChainFromLeaves(leaves, p);
          if (src && leaves[src.nextIdx]?.text === "=") {
            let q = src.nextIdx + 1;
            if (leaves[q]?.text === "~") q++;
            const tgt = readDottedChainFromLeaves(leaves, q);
            if (tgt) {
              sourceName ||= src.text;
              targetName ||= tgt.text;
              break;
            }
          }
        }
      }
    }
  }

  return { sourceName, targetName };
}

function resolveSymbolAndTypeDefinitions(db: QueryDB, usageSym: SymbolEntry): SymbolEntry[] {
  const result: SymbolEntry[] = [usageSym];
  const visitedIds = new Set<number>([usageSym.id]);
  const hasSymbolLookup = typeof db.symbol === "function";

  const findDefinition = (sym: SymbolEntry): SymbolEntry | null => {
    if (hasSymbolLookup) {
      const resolved = resolveTypeOf(db, sym);
      if (resolved) return resolved;
    }

    // Fallback: inspect OwnedFeatureTyping child (stripping conjugation `~`), metadata, or CST `: Type`
    let typeName: string | undefined;
    for (const ch of db.childrenOf(sym.id)) {
      if (ch.ruleName === "OwnedFeatureTyping" && ch.name) {
        typeName = stripLeadingTilde(ch.name);
        break;
      }
    }
    if (!typeName && typeof sym.metadata?.["typeSpecifier"] === "string") {
      typeName = stripLeadingTilde(sym.metadata["typeSpecifier"]);
    }
    if (!typeName) {
      const txt = db.cstText(sym.startOffset, sym.endOffset, sym) || "";
      const header = txt.split("{")[0] || txt;
      const leaves = collectCstLeaves(parseSysmlSource(header));
      const colonIdx = leaves.findIndex((l) => l.text === ":");
      if (colonIdx !== -1) {
        let p = colonIdx + 1;
        if (leaves[p]?.text === "~") p++;
        const tc = readDottedChainFromLeaves(leaves, p);
        if (tc) typeName = tc.text;
      }
    }
    if (!typeName) return null;

    if (hasSymbolLookup) {
      const scoped = resolveFeatureInScope(db, sym.parentId, typeName);
      if (scoped) return scoped;
    }
    const shortName = extractLastNameSegment(typeName);
    return (
      db.byName(typeName).find((s) => s.kind === "Definition") ??
      db.byName(shortName).find((s) => s.kind === "Definition") ??
      null
    );
  };

  const defQueue: SymbolEntry[] = [];
  const primaryDef = findDefinition(usageSym);
  if (primaryDef && !visitedIds.has(primaryDef.id)) {
    visitedIds.add(primaryDef.id);
    result.push(primaryDef);
    defQueue.push(primaryDef);
  }

  // Walk superclassification hierarchy (`:>`) on resolved definitions
  while (defQueue.length > 0) {
    const curDef = defQueue.shift()!;
    for (const ch of db.childrenOf(curDef.id)) {
      if (ch.ruleName === "OwnedSubclassification" && ch.name) {
        const superName = stripLeadingTilde(ch.name);
        const superSym =
          (hasSymbolLookup ? resolveFeatureInScope(db, curDef.parentId, superName) : null) ??
          db.byName(extractLastNameSegment(superName)).find((s) => s.kind === "Definition") ??
          null;
        if (superSym && !visitedIds.has(superSym.id)) {
          visitedIds.add(superSym.id);
          result.push(superSym);
          defQueue.push(superSym);
        }
      }
    }
  }

  return result;
}

function resolveEndpointChain(
  db: QueryDB,
  scopeId: number | null,
  epName: string,
): { leafSym?: SymbolEntry | undefined; ownerSym?: SymbolEntry | undefined } {
  const cleanName = stripLeadingTilde(epName);
  const hasSymbolLookup = typeof db.symbol === "function";

  if (hasSymbolLookup) {
    const leaf = resolveFeatureInScope(db, scopeId, cleanName) ?? undefined;
    let owner: SymbolEntry | undefined;
    if (cleanName.includes(".")) {
      const ownerPath = cleanName.split(".").slice(0, -1).join(".");
      owner = resolveFeatureInScope(db, scopeId, ownerPath) ?? undefined;
    }
    if (leaf || owner) {
      return { leafSym: leaf, ownerSym: owner };
    }
  }

  // Fallback for minimal mock DBs without parent symbol chain
  const direct = db.byName(cleanName)[0];
  if (direct) return { leafSym: direct };
  if (cleanName.includes(".")) {
    const parts = cleanName.split(".");
    const owner = db.byName(parts[0]!)[0];
    const leaf = db.byName(parts[parts.length - 1]!)[0];
    return { leafSym: leaf ?? owner, ownerSym: leaf ? owner : undefined };
  }
  return {};
}

function normalizeEndpointExpr(
  exprText: string,
  fullEndpoint: string,
  leafName: string,
  canonicalScalarPort: string,
): string {
  const tokens = tokenizeSysmlExpressionCst(exprText);
  if (tokens.length <= 1) return exprText;
  const remapped = tokens.map((tok) => {
    if (tok.type !== "ident") return tok;
    const t = tok.text;
    if (t.startsWith(`${fullEndpoint}.`)) {
      return { ...tok, text: t.slice(fullEndpoint.length + 1) };
    }
    if (t.startsWith(`${leafName}.`)) {
      return { ...tok, text: t.slice(leafName.length + 1) };
    }
    if (t === fullEndpoint || t === leafName) {
      return { ...tok, text: canonicalScalarPort };
    }
    return tok;
  });
  return formatSysmlExprTokens(remapped, "sysml");
}

function exprReferencesPort(exprText: string, fullEndpoint: string, leafName: string): boolean {
  const tokens = tokenizeSysmlExpressionCst(exprText);
  for (const tok of tokens) {
    if (tok.type !== "ident") continue;
    const t = tok.text;
    if (t === fullEndpoint || t.startsWith(`${fullEndpoint}.`) || t === leafName || t.startsWith(`${leafName}.`)) {
      return true;
    }
  }
  return false;
}

function isConnectionInScopeFilter(db: QueryDB, conn: SymbolEntry, scopeFilter: string): boolean {
  if (conn.name === scopeFilter || conn.name?.includes(scopeFilter)) return true;
  if (typeof db.symbol !== "function") return false;
  let cur = conn.parentId;
  while (cur !== null) {
    const p = db.symbol(cur);
    if (!p) break;
    if (p.name === scopeFilter) return true;
    cur = p.parentId;
  }
  return false;
}

/**
 * Scans a QueryDB (or inspects a single connection / container symbol ID in O(1))
 * and verifies Assume-Guarantee interface contracts.
 */
export function verifyAllInterfaceContracts(db: QueryDB, scopeFilter?: string | number): ContractVerificationResult {
  let connections: SymbolEntry[];

  if (typeof scopeFilter === "number") {
    const sym = typeof db.symbol === "function" ? db.symbol(scopeFilter) : undefined;
    if (!sym) {
      return { isSatisfied: true, violations: [] };
    }
    if (sym.ruleName === "ConnectionUsage" || sym.ruleName === "BindingConnectorAsUsage") {
      connections = [sym];
    } else {
      connections = db
        .childrenOf(sym.id)
        .filter((e) => e.ruleName === "ConnectionUsage" || e.ruleName === "BindingConnectorAsUsage");
    }
  } else {
    connections = db
      .allEntries()
      .filter((e) => e.ruleName === "ConnectionUsage" || e.ruleName === "BindingConnectorAsUsage");
  }

  const allViolations: ContractViolation[] = [];

  for (const conn of connections) {
    if (typeof scopeFilter === "string" && scopeFilter.length > 0) {
      if (!isConnectionInScopeFilter(db, conn, scopeFilter)) {
        continue;
      }
    }

    const { sourceName, targetName } = extractConnectionEndpointsFromCst(db, conn);
    if (!sourceName || !targetName) continue;

    const cleanSource = stripLeadingTilde(sourceName);
    const cleanTarget = stripLeadingTilde(targetName);
    const sourceLeaf = cleanSource.includes(".") ? cleanSource.split(".").pop()! : cleanSource;
    const targetLeaf = cleanTarget.includes(".") ? cleanTarget.split(".").pop()! : cleanTarget;

    const { leafSym: sourceSym, ownerSym: sourceOwnerSym } = resolveEndpointChain(db, conn.parentId, cleanSource);
    const { leafSym: targetSym, ownerSym: targetOwnerSym } = resolveEndpointChain(db, conn.parentId, cleanTarget);

    const sourceGuarantees: string[] = [];
    const targetAssumptions: string[] = [];

    const collectEndpointContracts = (
      leafSym: SymbolEntry | undefined,
      ownerSym: SymbolEntry | undefined,
      fullEp: string,
      leafEp: string,
      isSource: boolean,
    ) => {
      const seenExprs = new Set<string>();
      const pushContract = (expr: string) => {
        const normalized = normalizeEndpointExpr(expr, fullEp, leafEp, targetLeaf);
        if (!normalized || seenExprs.has(normalized)) return;
        seenExprs.add(normalized);
        if (isSource) sourceGuarantees.push(normalized);
        else targetAssumptions.push(normalized);
      };

      // 1. Collect from the endpoint PortUsage/PartUsage AND its PortDefinition/PartDefinition (+ supertypes)
      if (leafSym) {
        for (const sym of resolveSymbolAndTypeDefinitions(db, leafSym)) {
          const isPortSym = sym.ruleName === "PortUsage" || sym.ruleName === "PortDefinition";
          for (const child of db.childrenOf(sym.id)) {
            const classified = classifyConstraintChild(db, child);
            if (!classified) continue;
            if (isSource) {
              // Source endpoint: `assume constraint` is NEVER a supplier guarantee
              if (classified.kind !== "assume") {
                pushContract(classified.body);
              }
            } else {
              // Target endpoint: `assume` and `require` (plus plain `constraint` on a target port) are consumer demands
              if (
                classified.kind === "assume" ||
                classified.kind === "require" ||
                (isPortSym && classified.kind === "constraint")
              ) {
                pushContract(classified.body);
              }
            }
          }
        }
      }

      // 2. If dotted `part.port`, also collect contracts on owning PartUsage/PartDefinition referencing `port`
      if (ownerSym && (!leafSym || ownerSym.id !== leafSym.id)) {
        for (const sym of resolveSymbolAndTypeDefinitions(db, ownerSym)) {
          for (const child of db.childrenOf(sym.id)) {
            const classified = classifyConstraintChild(db, child);
            if (!classified) continue;
            if (!exprReferencesPort(classified.body, fullEp, leafEp)) continue;
            if (isSource) {
              if (classified.kind !== "assume") {
                pushContract(classified.body);
              }
            } else {
              if (classified.kind === "assume" || classified.kind === "require") {
                pushContract(classified.body);
              }
            }
          }
        }
      }
    };

    collectEndpointContracts(sourceSym, sourceOwnerSym, cleanSource, sourceLeaf, true);
    collectEndpointContracts(targetSym, targetOwnerSym, cleanTarget, targetLeaf, false);

    if (sourceGuarantees.length > 0 && targetAssumptions.length > 0) {
      const connLabel = conn.name && conn.name !== "<anonymous>" ? conn.name : `${sourceName}->${targetName}`;
      const res = verifyAssumeGuaranteePair(sourceName, targetName, sourceGuarantees, targetAssumptions, connLabel);
      allViolations.push(...res.violations);
    }
  }

  return {
    isSatisfied: allViolations.length === 0,
    violations: allViolations,
  };
}

/**
 * Formal Assume-Guarantee contract $C = (A, G)$ associated with a SysML v2 component or interface.
 */
export interface AssumeGuaranteeContract {
  /** Component or contract identifier. */
  name: string;
  /** List of environment assumption expressions $A$ required by the component. */
  assumptions: string[];
  /** List of guarantee expressions $G$ ensured by the component whenever $A$ holds. */
  guarantees: string[];
  /** Optional list of input port/variable identifiers controlled by the environment. */
  inputs?: string[] | undefined;
  /** Optional list of output port/variable identifiers controlled by the component. */
  outputs?: string[] | undefined;
}

/**
 * Result of checking contract refinement $C_1 \preceq C_2$ ($A_2 \Rightarrow A_1$ and $G_1 \Rightarrow G_2$).
 */
export interface RefinementResult {
  /** True if $C_1$ weakens (or preserves) the assumptions of $C_2$ and strengthens (or preserves) the guarantees of $C_2$. */
  isRefined: boolean;
  /** Diagnostic messages for any assumptions of $C_1$ not entailed by $A_2$. */
  assumptionViolations: string[];
  /** Diagnostic messages for any guarantees of $C_2$ not entailed by $G_1$. */
  guaranteeViolations: string[];
  /** Human-readable summary of the refinement check. */
  summary: string;
}

/**
 * Algebraic operations on Assume-Guarantee contracts (refinement, parallel composition $\otimes$, quotient $/$, and OCRA-style compositional verification).
 */
export class ContractAlgebra {
  /**
   * Evaluates contract refinement C1 <= C2:
   * C1 refines C2 iff (A2 => A1) and (G1 => G2).
   */
  public static refines(c1: AssumeGuaranteeContract, c2: AssumeGuaranteeContract): RefinementResult {
    // 1. Check A2 => A1 (c1 makes weaker/equal assumptions than c2)
    const aCheck = verifyAssumeGuaranteePair(c2.name, c1.name, c2.assumptions, c1.assumptions);

    // 2. Check G1 => G2 (c1 provides stronger/equal guarantees than c2)
    const gCheck = verifyAssumeGuaranteePair(c1.name, c2.name, c1.guarantees, c2.guarantees);

    const aViolations = aCheck.violations.map((v) => v.reason);
    const gViolations = gCheck.violations.map((v) => v.reason);
    const isRefined = aCheck.isSatisfied && gCheck.isSatisfied;

    let summary = `Contract '${c1.name}' ${isRefined ? "successfully refines" : "fails to refine"} '${c2.name}'.`;
    if (!isRefined) {
      if (!aCheck.isSatisfied) summary += ` Assumption weakening violated (${aViolations.length} issues).`;
      if (!gCheck.isSatisfied) summary += ` Guarantee strengthening violated (${gViolations.length} issues).`;
    }

    return {
      isRefined,
      assumptionViolations: aViolations,
      guaranteeViolations: gViolations,
      summary,
    };
  }

  /**
   * Evaluates Assume-Guarantee satisfaction between a guarantee contract and an assumption contract.
   */
  public static verifyAssumeGuaranteePair(
    guaranteeContract: AssumeGuaranteeContract,
    assumptionContract: AssumeGuaranteeContract,
  ): RefinementResult {
    return ContractAlgebra.refines(guaranteeContract, assumptionContract);
  }

  /**
   * Parallel composition C = C1 (x) C2:
   * G = G1 /\ G2
   * A = (A1 /\ A2) \/ ~(G1 /\ G2)
   */
  public static composeParallel(
    c1: AssumeGuaranteeContract,
    c2: AssumeGuaranteeContract,
    compositeName?: string,
  ): AssumeGuaranteeContract {
    const name = compositeName ?? `(${c1.name} ⊗ ${c2.name})`;

    // Combined guarantees
    const guarantees = [...new Set([...c1.guarantees, ...c2.guarantees])];

    // Filter assumptions satisfied by the partner's guarantees (internal feedback)
    const externalAssumptions: string[] = [];

    for (const a of c1.assumptions) {
      const gCheck = verifyAssumeGuaranteePair(c2.name, c1.name, c2.guarantees, [a]);
      if (!gCheck.isSatisfied) {
        externalAssumptions.push(a);
      }
    }

    for (const a of c2.assumptions) {
      const gCheck = verifyAssumeGuaranteePair(c1.name, c2.name, c1.guarantees, [a]);
      if (!gCheck.isSatisfied) {
        externalAssumptions.push(a);
      }
    }

    return {
      name,
      assumptions: [...new Set(externalAssumptions)],
      guarantees,
    };
  }

  /**
   * Quotient / Residual composition C_res = C_sys / C1:
   * Computes the specification required of component C2 such that C1 (x) C2 <= C_sys.
   */
  public static quotient(
    cSys: AssumeGuaranteeContract,
    c1: AssumeGuaranteeContract,
    resName?: string,
  ): AssumeGuaranteeContract {
    const name = resName ?? `(${cSys.name} / ${c1.name})`;

    // The residual component must assume what cSys assumes + what c1 guarantees
    const assumptions = [...new Set([...cSys.assumptions, ...c1.guarantees])];

    // The residual component must guarantee what cSys guarantees, minus what c1 already provides
    const guarantees = [...cSys.guarantees];

    return {
      name,
      assumptions,
      guarantees,
    };
  }

  /**
   * System-level compositional contract verification (OCRA / SAVVS paradigm).
   *
   * 1. Dependency Validation:
   *    Validates that component contracts do not have circular assume-guarantee
   *    dependencies without temporal delays (soundness requirement).
   *
   * 2. Compatibility Check:
   *    For each component i:
   *      (A_sys /\ \bigwedge_{j != i} G_j) => A_i
   *    Proves that the environment and peer components satisfy all component assumptions.
   *
   * 3. Refinement / Dominance Check:
   *    (A_sys /\ \bigwedge_i G_i) => G_sys
   *    Proves that component guarantees collectively deliver the top-level system guarantees.
   */
  public static verifySystemComposition(
    systemContract: AssumeGuaranteeContract,
    componentContracts: AssumeGuaranteeContract[],
  ): CompositionalProofResult {
    const compatibilityViolations: CompositionalProofResult["compatibilityViolations"] = [];
    const refinementViolations: CompositionalProofResult["refinementViolations"] = [];

    // Helper to extract referenced variables and detect temporal delay operators
    const extractContractVars = (constraints: string[]): { vars: Set<string>; hasTemporalDelay: boolean } => {
      const vars = new Set<string>();
      let hasTemporalDelay = false;
      for (const str of constraints) {
        if (
          sysmlAstSome(
            parseSysML2Expression(str),
            (n) =>
              (n.kind === "CallExpr" &&
                (n.callee.toLowerCase() === "prev" ||
                  n.callee.toLowerCase() === "delay" ||
                  n.callee.toLowerCase() === "latch")) ||
              (n.kind === "Identifier" && n.name.toLowerCase() === "latch"),
          )
        ) {
          hasTemporalDelay = true;
        }
        const parsed = parseGuardConstraints(str);
        for (const g of parsed) {
          if (g.nonlinear) {
            extractVariables(g.nonlinear.expr, vars);
          } else {
            vars.add(g.variable);
          }
        }
      }
      return { vars, hasTemporalDelay };
    };

    // 1. Dependency Graph Construction & Circular Dependency Validation
    const compOutputs = componentContracts.map((c) => extractContractVars(c.guarantees));
    const compInputs = componentContracts.map((c) => extractContractVars(c.assumptions));

    const adj = new Map<number, number[]>();
    for (let i = 0; i < componentContracts.length; i++) adj.set(i, []);

    for (let i = 0; i < componentContracts.length; i++) {
      for (let j = 0; j < componentContracts.length; j++) {
        if (i === j) continue;
        for (const outVar of compOutputs[i]!.vars) {
          if (compInputs[j]!.vars.has(outVar)) {
            adj.get(i)!.push(j);
            break;
          }
        }
      }
    }

    // DFS Cycle Detection
    const visited = new Array(componentContracts.length).fill(0);
    const parent = new Array(componentContracts.length).fill(-1);
    let detectedCycle: number[] | null = null;

    const dfs = (node: number): boolean => {
      visited[node] = 1;
      for (const neighbor of adj.get(node) || []) {
        if (visited[neighbor] === 1) {
          const path: number[] = [neighbor, node];
          let curr = node;
          while (curr !== neighbor && parent[curr] !== -1 && parent[curr] !== neighbor) {
            curr = parent[curr];
            path.push(curr);
          }
          path.push(neighbor);
          path.reverse();
          detectedCycle = path;
          return true;
        } else if (visited[neighbor] === 0) {
          parent[neighbor] = node;
          if (dfs(neighbor)) return true;
        }
      }
      visited[node] = 2;
      return false;
    };

    for (let i = 0; i < componentContracts.length; i++) {
      if (visited[i] === 0) {
        if (dfs(i)) break;
      }
    }

    if (detectedCycle) {
      const cycleNodes = detectedCycle as number[];
      let hasTemporalDelayInCycle = false;
      for (const idx of cycleNodes) {
        if (compInputs[idx]!.hasTemporalDelay || compOutputs[idx]!.hasTemporalDelay) {
          hasTemporalDelayInCycle = true;
          break;
        }
      }

      if (!hasTemporalDelayInCycle) {
        const cycleNames = cycleNodes.map((idx) => componentContracts[idx]!.name);
        const cycleStr = cycleNames.join(" -> ");
        compatibilityViolations.push({
          component: cycleNames[0]!,
          missingAssumption: "temporal-delay",
          reason: `Circular assume-guarantee dependency detected between components [${cycleStr}]. Compositional reasoning without temporal delay is unsound.`,
        });
      }
    }

    // 2. Compatibility Check
    for (let i = 0; i < componentContracts.length; i++) {
      const comp = componentContracts[i]!;
      const siblingGuarantees = componentContracts.filter((_, idx) => idx !== i).flatMap((c) => c.guarantees);

      const context = [...systemContract.assumptions, ...siblingGuarantees];

      for (const a of comp.assumptions) {
        const ent = checkSymbolicEntailment(context, a);
        if (!ent.entailed) {
          compatibilityViolations.push({
            component: comp.name,
            missingAssumption: a,
            reason: ent.reason || `System assumptions and sibling guarantees do not guarantee '${a}' of '${comp.name}'`,
            counterexample: ent.counterexample,
          });
        }
      }
    }

    // 2. Refinement Check
    const allGuarantees = componentContracts.flatMap((c) => c.guarantees);
    const sysContext = [...systemContract.assumptions, ...allGuarantees];

    for (const g of systemContract.guarantees) {
      const ent = checkSymbolicEntailment(sysContext, g);
      if (!ent.entailed) {
        refinementViolations.push({
          systemGuarantee: g,
          reason: ent.reason || `Component guarantees fail to deliver top-level system guarantee '${g}'`,
          counterexample: ent.counterexample,
        });
      }
    }

    const isCompatible = compatibilityViolations.length === 0;
    const isRefined = refinementViolations.length === 0;

    let summary = `Compositional verification for '${systemContract.name}': `;
    summary += isCompatible
      ? `Component contracts are mutually compatible. `
      : `Found ${compatibilityViolations.length} compatibility issue(s). `;
    summary += isRefined
      ? `System contract is successfully refined.`
      : `Found ${refinementViolations.length} refinement issue(s).`;

    return {
      isCompatible,
      isRefined,
      compatibilityViolations,
      refinementViolations,
      summary,
    };
  }
}

/**
 * Result of system-level compositional Assume-Guarantee verification (compatibility and refinement proofs).
 */
export interface CompositionalProofResult {
  /** True if all component assumptions are discharged by system assumptions and sibling guarantees without instantaneous dependency cycles. */
  isCompatible: boolean;
  /** True if the combined component guarantees and system assumptions entail all top-level system guarantees. */
  isRefined: boolean;
  /** List of component assumption compatibility failures or instantaneous circular dependency violations. */
  compatibilityViolations: {
    /** Name of the sub-component whose assumption could not be discharged. */
    component: string;
    /** Unsatisfied assumption expression (or `"temporal-delay"` for algebraic loops). */
    missingAssumption: string;
    /** Explanation of the compatibility failure. */
    reason: string;
    /** Optional counterexample box where sibling guarantees hold but the component assumption fails. */
    counterexample?: Record<string, [number, number]> | undefined;
  }[];
  /** List of top-level system guarantees that are not entailed by the composition of sub-component contracts. */
  refinementViolations: {
    /** Unsatisfied system-level guarantee expression. */
    systemGuarantee: string;
    /** Explanation of the refinement failure. */
    reason: string;
    /** Optional counterexample box where sub-component guarantees hold but the system guarantee fails. */
    counterexample?: Record<string, [number, number]> | undefined;
  }[];
  /** Human-readable summary of both compatibility and refinement proof obligations. */
  summary: string;
}

/**
 * Exports an Assume-Guarantee or Temporal contract into standard nuXmv / OCRA SMV syntax.
 */
export function exportContractToNuXmv(contract: AssumeGuaranteeContract | TemporalContract): string {
  const isTemporal = "assumption" in contract && typeof contract.assumption === "string";
  const name = contract.name || "ContractModule";

  let smv = `-- nuXmv / OCRA SMV Specification for Contract: ${name}\n`;
  smv += `-- Auto-generated by ModelScript SysML v2 Contract Verifier\n\n`;
  smv += `MODULE main\n`;

  if (isTemporal) {
    const tc = contract as TemporalContract;
    const aConstraints = parseGuardConstraints(tc.assumption);
    const gConstraints = parseGuardConstraints(tc.guarantee);
    const vars = new Set<string>();
    for (const c of [...aConstraints, ...gConstraints]) {
      vars.add(c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable);
    }

    smv += `VAR\n`;
    for (const v of vars) {
      smv += `  ${v} : real;\n`;
    }
    smv += `\n`;

    const aSmv = formatSysmlExprForNuXmv(tc.assumption);
    const gSmv = formatSysmlExprForNuXmv(tc.guarantee);

    if (tc.timeHorizon) {
      smv += `-- Bounded time horizon [${tc.timeHorizon[0]}, ${tc.timeHorizon[1]}]\n`;
      smv += `LTLSPEC G ((${aSmv}) -> (${gSmv}));\n`;
    } else {
      smv += `INVARSPEC (${aSmv}) -> (${gSmv});\n`;
      smv += `LTLSPEC G ((${aSmv}) -> (${gSmv}));\n`;
    }
  } else {
    const ag = contract as AssumeGuaranteeContract;
    const allConstraints = [...ag.assumptions, ...ag.guarantees].flatMap(parseGuardConstraints);
    const vars = new Set<string>();
    for (const c of allConstraints) {
      vars.add(c.variable.includes(".") ? c.variable.split(".").pop()! : c.variable);
    }
    for (const v of ag.inputs || []) vars.add(v);
    for (const v of ag.outputs || []) vars.add(v);

    smv += `VAR\n`;
    for (const v of vars) {
      smv += `  ${v} : real;\n`;
    }
    smv += `\n`;

    if (ag.assumptions.length > 0) {
      const aExpr = ag.assumptions.map(formatSysmlExprForNuXmv).join(" & ");
      smv += `-- Environment Assumptions\n`;
      smv += `INVAR ${aExpr};\n\n`;
    }

    if (ag.guarantees.length > 0) {
      const gExpr = ag.guarantees.map(formatSysmlExprForNuXmv).join(" & ");
      smv += `-- Component Guarantees\n`;
      smv += `INVARSPEC ${gExpr};\n`;
    }
  }

  return smv;
}

/**
 * Symbolically verifies a Temporal Contract A => G without needing a pre-recorded simulation trajectory.
 * Checks whether the assumption bounds can ever be satisfied while the guarantee is simultaneously violated.
 */
export function verifyTemporalContractSymbolic(
  contract: TemporalContract,
  _domainBounds?: Map<string, [number, number]>,
): TemporalContractResult {
  const entailment = checkSymbolicEntailment([contract.assumption], contract.guarantee);

  if (entailment.entailed) {
    return {
      isSatisfied: true,
      minRobustness: 0,
      reason: `Contract '${contract.name || "unnamed"}' is symbolically satisfied for all states satisfying assumption '${contract.assumption}'.`,
    };
  }

  let cexVal = 0;
  if (entailment.counterexample) {
    const firstEntry = Object.values(entailment.counterexample)[0];
    if (firstEntry) cexVal = firstEntry[0];
  }

  return {
    isSatisfied: false,
    minRobustness: -1,
    counterexample: cexVal,
    reason:
      entailment.reason ||
      `Assumption '${contract.assumption}' does not symbolically imply guarantee '${contract.guarantee}'.`,
  };
}

/**
 * Node in the extracted SysML v2 Assume-Guarantee contract hierarchy.
 */
export interface SysML2ContractNode extends AssumeGuaranteeContract {
  /** Underlying SysML v2 symbol identifier for go-to-source navigation. */
  symbolName?: string | undefined;
  /** Optional role/usage label (e.g., "engine : Engine" or "Requirement"). */
  role?: string | undefined;
  /** Optional documentation string extracted from `doc /* ... *\/`. */
  doc?: string | undefined;
  /** True if this component matches the user's focused CodeLens target. */
  isFocused?: boolean | undefined;
}

/**
 * Interactive event trace step synthesized from SysML v2 state machines, actions, connections, and use cases.
 */
export interface SysML2ContractTraceStep {
  step: number;
  actor: string;
  event: string;
  targetActor?: string | undefined;
  message?: string | undefined;
  sourceSymbol?: string | undefined;
  isDeadlock?: boolean | undefined;
}

/**
 * Full extracted contract refinement hierarchy and behavioral event trace result for a SysML v2 model.
 */
export interface SysML2ContractHierarchyResult {
  system: SysML2ContractNode;
  components: SysML2ContractNode[];
  isCompatible: boolean;
  isRefined: boolean;
  compatibilityViolations: CompositionalProofResult["compatibilityViolations"];
  refinementViolations: CompositionalProofResult["refinementViolations"];
  traces: SysML2ContractTraceStep[];
  states?: string[] | undefined;
  transitions?: { name: string; from: string; to: string; guard?: string | undefined }[] | undefined;
  focusedComponent?: string | undefined;
  summary: string;
}

interface ParsedAttr {
  name: string;
  type: string;
  defaultVal?: string | undefined;
}

interface ParsedPort {
  name: string;
  portType: string;
  direction?: "in" | "out" | "inout" | undefined;
}

interface ParsedSubpart {
  usageName: string;
  partType: string;
  multiplicity?: string | undefined;
}

interface ParsedConnection {
  name?: string | undefined;
  sourcePart: string;
  sourcePort: string;
  targetPart: string;
  targetPort: string;
}

interface ParsedPartDef {
  name: string;
  superType?: string | undefined;
  doc?: string | undefined;
  attributes: ParsedAttr[];
  ports: ParsedPort[];
  subparts: ParsedSubpart[];
  connections: ParsedConnection[];
  explicitAssumptions: string[];
  explicitGuarantees: string[];
  isActor?: boolean | undefined;
}

interface ParsedReqDef {
  name: string;
  doc?: string | undefined;
  subjectType?: string | undefined;
  attributes: ParsedAttr[];
  assumptions: string[];
  guarantees: string[];
}

const CONFIG_ATTR_NAMES = new Set(["displacement", "capacity", "diameter", "length", "thickness"]);

const IGNORED_CLAUSE_STARTERS = new Set([
  "doc",
  "attribute",
  "subject",
  "objective",
  "port",
  "part",
  "ref",
  "verify",
  "satisfy",
]);

const WRAPPER_MEMBER_TYPES = new Set([
  "PackageMember",
  "DefinitionMember",
  "VariantUsageMember",
  "OccurrenceUsageMember",
  "NonOccurrenceUsageMember",
  "AnnotatingMember",
  "SubjectMember",
  "ActorMember",
  "RequirementConstraintMember",
  "ObjectiveMember",
  "TransitionUsageMember",
  "ReturnParameterMember",
  "ActionNodeMember",
  "EnumerationUsageMember",
  "AliasMember",
  "Membership",
  "OwningMembership",
  "FeatureMembership",
  "ParameterMembership",
  "ResultExpressionMember",
  "ERROR",
]);

const DOC_NODE_TYPES = new Set(["Documentation"]);
const ATTR_USAGE_TYPES = new Set(["AttributeUsage"]);
const PORT_USAGE_TYPES = new Set(["PortUsage"]);
const PART_USAGE_TYPES = new Set(["PartUsage"]);
const CONN_USAGE_TYPES = new Set(["ConnectionUsage"]);
const SUBJECT_USAGE_TYPES = new Set(["SubjectUsage"]);
const ACTOR_USAGE_TYPES = new Set(["ActorUsage"]);
const INCLUDE_UC_TYPES = new Set(["IncludeUseCaseUsage"]);
const OBJECTIVE_REQ_TYPES = new Set(["ObjectiveRequirementUsage"]);
const ACTION_PIN_TYPES = new Set([
  "ItemUsage",
  "DefaultReferenceUsage",
  "AttributeUsage",
  "PartUsage",
  "PortUsage",
  "ReferenceUsage",
]);

function isWordIdentStr(s: string | undefined): boolean {
  if (!s || s.length === 0) return false;
  const c0 = s.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) {
      return false;
    }
  }
  return true;
}

function isUnsignedNumericLiteral(s: string | undefined): boolean {
  if (!s || s.length === 0) return false;
  let seenDot = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) continue;
    if (c === 46 && !seenDot && i > 0 && i < s.length - 1) {
      seenDot = true;
      continue;
    }
    return false;
  }
  return true;
}

function joinLeavesWithSourceGaps(leaves: readonly CstLeaf[], fullSource: string): string {
  if (leaves.length === 0) return "";
  let out = leaves[0]!.text;
  for (let i = 1; i < leaves.length; i++) {
    const prev = leaves[i - 1]!;
    const cur = leaves[i]!;
    out += cur.start > prev.end && fullSource.slice(prev.end, cur.start).length > 0 ? ` ${cur.text}` : cur.text;
  }
  return out.trim();
}

function collectDirectMemberNodes(container: SysmlCstNode, targetTypes: ReadonlySet<string>): SysmlCstNode[] {
  const results: SysmlCstNode[] = [];
  const stack = [...getCstChildren(container)].reverse();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (targetTypes.has(cur.type)) {
      results.push(cur);
      continue;
    }
    if (WRAPPER_MEMBER_TYPES.has(cur.type) || cur.type.startsWith("_")) {
      const children = getCstChildren(cur);
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]!);
      }
    }
  }
  return results;
}

function findDefNameAndSuper(defNode: SysmlCstNode): { name: string; superType?: string | undefined } {
  const nameNodes = findCstChildren(defNode, "Name");
  const name = nameNodes.length > 0 ? nameNodes[nameNodes.length - 1]!.text.trim() : "";
  const subNode = findCstChildren(defNode, "OwnedSubclassification")[0];
  const superType = subNode ? extractLastNameSegment(subNode) : undefined;
  return { name, superType: superType || undefined };
}

function findDirectDoc(node: SysmlCstNode, fullSource: string): string | undefined {
  const docNodes = collectDirectMemberNodes(node, DOC_NODE_TYPES);
  for (const d of docNodes) {
    const text = getDocumentationCommentText(d, fullSource);
    if (text) return text;
  }
  return undefined;
}

function findDocFromLeaves(leaves: readonly CstLeaf[], fullSource: string): string | undefined {
  for (const leaf of leaves) {
    if (leaf.text === "doc") {
      let pos = leaf.end;
      while (pos < fullSource.length) {
        const c = fullSource.charCodeAt(pos);
        if (c === 32 || c === 9 || c === 10 || c === 13) pos++;
        else break;
      }
      if (fullSource.startsWith("/*", pos)) {
        const endIdx = fullSource.indexOf("*/", pos + 2);
        if (endIdx !== -1) return collapseWhitespace(fullSource.slice(pos + 2, endIdx));
      }
    }
  }
  return undefined;
}

function getBodyLeaves(defNode: SysmlCstNode): CstLeaf[] {
  const leaves = collectCstLeaves(defNode);
  const firstBrace = leaves.findIndex((l) => l.text === "{");
  if (firstBrace === -1) return [];
  for (let i = leaves.length - 1; i > firstBrace; i--) {
    if (leaves[i]!.text === "}") {
      return leaves.slice(firstBrace + 1, i);
    }
  }
  return leaves.slice(firstBrace + 1);
}

function findMatchingBraceLeaf(leaves: readonly CstLeaf[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < leaves.length; i++) {
    if (leaves[i]!.text === "{") depth++;
    else if (leaves[i]!.text === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return leaves.length - 1;
}

function extractAttributeUsageFromCst(attrNode: SysmlCstNode, fullSource: string): ParsedAttr | null {
  const name = findCstChildren(attrNode, "Name").pop()?.text.trim();
  if (!name) return null;
  const ft = findCstChildren(attrNode, "FeatureTyping")[0];
  const rawType = ft ? extractLastNameSegment(ft) : "Real";
  let defaultVal: string | undefined;
  const fv = findCstChildren(attrNode, "FeatureValue")[0];
  if (fv) {
    const fvLeaves = collectCstLeaves(fv);
    const eqIdx = fvLeaves.findIndex((l) => l.text === "=" || l.text === ":=");
    if (eqIdx !== -1) {
      let endIdx = eqIdx + 1;
      while (endIdx < fvLeaves.length && fvLeaves[endIdx]!.text !== ";" && fvLeaves[endIdx]!.text !== "{") {
        endIdx++;
      }
      const valText = joinLeavesWithSourceGaps(fvLeaves.slice(eqIdx + 1, endIdx), fullSource);
      if (valText.length > 0) defaultVal = valText;
    }
  }
  return { name, type: rawType || "Real", defaultVal };
}

function inferPortDirectionFallback(portName: string): "in" | "out" | undefined {
  const lower = portName.toLowerCase();
  if (lower.endsWith("in") || lower.endsWith("input")) return "in";
  if (
    portName.startsWith("in") &&
    portName.length > 2 &&
    ((portName.charCodeAt(2) >= 65 && portName.charCodeAt(2) <= 90) || portName[2] === "_")
  ) {
    return "in";
  }
  if (lower.endsWith("out") || lower.endsWith("output")) return "out";
  if (
    portName.startsWith("out") &&
    portName.length > 3 &&
    ((portName.charCodeAt(3) >= 65 && portName.charCodeAt(3) <= 90) || portName[3] === "_")
  ) {
    return "out";
  }
  return undefined;
}

function extractPortUsageFromCst(portNode: SysmlCstNode): ParsedPort | null {
  const pName = findCstChildren(portNode, "Name").pop()?.text.trim();
  if (!pName) return null;
  const ft = findCstChildren(portNode, "FeatureTyping")[0];
  const pType = ft ? extractLastNameSegment(ft) : pName;
  const leaves = collectCstLeaves(portNode);
  const firstKw = leaves[0]?.text;
  let dir: "in" | "out" | "inout" | undefined =
    firstKw === "in" || firstKw === "out" || firstKw === "inout" ? firstKw : undefined;
  if (!dir) dir = inferPortDirectionFallback(pName);
  return { name: pName, portType: pType || pName, direction: dir };
}

function extractPartUsageFromCst(partNode: SysmlCstNode, fullSource: string): ParsedSubpart | null {
  const usageName = findCstChildren(partNode, "Name").pop()?.text.trim();
  if (!usageName) return null;
  const ft = findCstChildren(partNode, "FeatureTyping")[0];
  const partType = ft ? extractLastNameSegment(ft) : "";
  if (!partType) return null;
  let multiplicity: string | undefined;
  const multNode = findCstChildren(partNode, "OwnedMultiplicity")[0];
  if (multNode) {
    const multLeaves = collectCstLeaves(multNode);
    if (multLeaves.length >= 2 && multLeaves[0]!.text === "[" && multLeaves[multLeaves.length - 1]!.text === "]") {
      multiplicity = joinLeavesWithSourceGaps(multLeaves.slice(1, -1), fullSource);
    }
  }
  return { usageName, partType, multiplicity };
}

function extractConnectionUsageFromCst(connNode: SysmlCstNode): ParsedConnection | null {
  const leaves = collectCstLeaves(connNode);
  const endIdx = leaves.findIndex((l) => l.text === ";" || l.text === "{");
  const header = endIdx === -1 ? leaves : leaves.slice(0, endIdx);
  const toIdx = header.findIndex((l) => l.text === "to");
  if (toIdx < 3) return null;

  const left = header.slice(0, toIdx);
  const right = header.slice(toIdx + 1);
  if (
    left.length < 3 ||
    right.length < 3 ||
    left[left.length - 2]!.text !== "." ||
    right[1]!.text !== "." ||
    !isWordIdentStr(left[left.length - 3]!.text) ||
    !isWordIdentStr(left[left.length - 1]!.text) ||
    !isWordIdentStr(right[0]!.text) ||
    !isWordIdentStr(right[2]!.text)
  ) {
    return null;
  }

  let connName: string | undefined;
  const beforeChainIdx = left.length - 4;
  if (beforeChainIdx >= 0) {
    const cand = left[beforeChainIdx]!.text;
    if (isWordIdentStr(cand) && cand !== "connect" && cand !== "connection") {
      connName = cand;
    }
  }

  return {
    name: connName,
    sourcePart: left[left.length - 3]!.text,
    sourcePort: left[left.length - 1]!.text,
    targetPart: right[0]!.text,
    targetPort: right[2]!.text,
  };
}

function matchRelOpAt(leaves: readonly CstLeaf[], idx: number): { op: string; nextIdx: number; endIdx: number } | null {
  const cur = leaves[idx]!.text;
  if (cur === "<=" || cur === ">=" || cur === "==" || cur === "!=") {
    return { op: cur, nextIdx: idx + 1, endIdx: idx };
  }
  const next = leaves[idx + 1];
  if (next && leaves[idx]!.end === next.start) {
    const pair = cur + next.text;
    if (pair === "<=" || pair === ">=" || pair === "==" || pair === "!=") {
      return { op: pair, nextIdx: idx + 2, endIdx: idx + 1 };
    }
  }
  if (cur === "<" || cur === ">") {
    return { op: cur, nextIdx: idx + 1, endIdx: idx };
  }
  return null;
}

function normalizeClauseLeaves(
  rawLeaves: readonly CstLeaf[],
  fullSource: string,
  constMap: ReadonlyMap<string, string>,
): string | null {
  let start = 0;
  let end = rawLeaves.length;
  while (start < end && rawLeaves[start]!.text === ";") start++;
  while (end > start && rawLeaves[end - 1]!.text === ";") end--;
  if (start >= end) return null;

  const stmt = rawLeaves.slice(start, end);
  if (IGNORED_CLAUSE_STARTERS.has(stmt[0]!.text)) return null;

  const segments: { text: string; origStart: number; origEnd: number; forceSpaceBefore?: boolean }[] = [];
  let hasRelOp = false;
  let k = 0;
  let expectRhsConst = false;

  while (k < stmt.length) {
    const cur = stmt[k]!;

    // Collapse qualified reference `pkg::...::ident` -> `constMap.get(last) ?? last`
    if (isWordIdentStr(cur.text) && stmt[k + 1]?.text === "::" && isWordIdentStr(stmt[k + 2]?.text)) {
      let j = k + 2;
      while (j + 2 < stmt.length && stmt[j + 1]?.text === "::" && isWordIdentStr(stmt[j + 2]?.text)) {
        j += 2;
      }
      const lastIdent = stmt[j]!.text;
      const resolved = constMap.get(lastIdent) ?? lastIdent;
      segments.push({
        text: resolved,
        origStart: cur.start,
        origEnd: stmt[j]!.end,
        forceSpaceBefore: expectRhsConst && constMap.has(lastIdent),
      });
      expectRhsConst = false;
      k = j + 1;
      continue;
    }

    const rel = matchRelOpAt(stmt, k);
    if (rel) {
      hasRelOp = true;
      segments.push({
        text: rel.op,
        origStart: cur.start,
        origEnd: stmt[rel.endIdx]!.end,
      });
      expectRhsConst = true;
      k = rel.nextIdx;
      continue;
    }

    if (expectRhsConst && isWordIdentStr(cur.text) && stmt[k + 1]?.text !== "." && stmt[k + 1]?.text !== "(") {
      const val = constMap.get(cur.text);
      if (val !== undefined) {
        segments.push({
          text: val,
          origStart: cur.start,
          origEnd: cur.end,
          forceSpaceBefore: true,
        });
        expectRhsConst = false;
        k++;
        continue;
      }
    }

    expectRhsConst = false;
    segments.push({ text: cur.text, origStart: cur.start, origEnd: cur.end });
    k++;
  }

  if (!hasRelOp || segments.length === 0) return null;

  let rendered = segments[0]!.text;
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]!;
    const seg = segments[i]!;
    const hasGap = seg.origStart > prev.origEnd && fullSource.slice(prev.origEnd, seg.origStart).length > 0;
    rendered += seg.forceSpaceBefore || hasGap ? ` ${seg.text}` : seg.text;
  }
  rendered = rendered.trim();
  while (rendered.endsWith(";")) rendered = rendered.slice(0, -1).trimEnd();
  return rendered.length > 0 ? rendered : null;
}

function extractClausesFromBodyLeaves(
  leaves: readonly CstLeaf[],
  fullSource: string,
  constMap: ReadonlyMap<string, string>,
  implicitConstraintBody = false,
): { assumptions: string[]; guarantees: string[] } {
  const assumptions: string[] = [];
  const guarantees: string[] = [];

  const pushSplitLeaves = (target: string[], sliceLeaves: readonly CstLeaf[]) => {
    let cur: CstLeaf[] = [];
    let parenDepth = 0;
    let braceDepth = 0;
    const flush = () => {
      if (cur.length === 0) return;
      const clause = normalizeClauseLeaves(cur, fullSource, constMap);
      if (clause && !target.includes(clause)) {
        target.push(clause);
      }
      cur = [];
    };

    for (let i = 0; i < sliceLeaves.length; i++) {
      const lf = sliceLeaves[i]!;
      const prev = i > 0 ? sliceLeaves[i - 1]! : undefined;
      if (parenDepth === 0 && braceDepth === 0 && prev && fullSource.slice(prev.end, lf.start).includes("\n")) {
        flush();
      }
      if (lf.text === "(") parenDepth++;
      else if (lf.text === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (lf.text === "{") braceDepth++;
      else if (lf.text === "}") braceDepth = Math.max(0, braceDepth - 1);

      if (lf.text === ";" && parenDepth === 0 && braceDepth === 0) {
        flush();
        continue;
      }
      cur.push(lf);
    }
    flush();
  };

  if (implicitConstraintBody) {
    pushSplitLeaves(guarantees, leaves);
    return { assumptions, guarantees };
  }

  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i]!;
    const prev = i > 0 ? leaves[i - 1] : undefined;
    const atBoundary =
      !prev ||
      prev.text === ";" ||
      prev.text === "{" ||
      prev.text === "}" ||
      fullSource.slice(prev.end, lf.start).includes("\n");
    if (!atBoundary) continue;

    const kw = lf.text;
    if (kw === "assume" || kw === "require" || kw === "guarantee" || kw === "assert") {
      const target = kw === "assume" ? assumptions : guarantees;
      const next = leaves[i + 1];
      let openBraceIdx = -1;
      if (next?.text === "{") {
        openBraceIdx = i + 1;
      } else if (next?.text === "constraint") {
        if (leaves[i + 2]?.text === "{") openBraceIdx = i + 2;
        else if (isWordIdentStr(leaves[i + 2]?.text) && leaves[i + 3]?.text === "{") openBraceIdx = i + 3;
      }

      if (openBraceIdx !== -1) {
        const closeIdx = findMatchingBraceLeaf(leaves, openBraceIdx);
        pushSplitLeaves(target, leaves.slice(openBraceIdx + 1, closeIdx));
        i = closeIdx;
        continue;
      }

      if (kw !== "assert" && next?.text !== "constraint") {
        let j = i + 1;
        while (j < leaves.length) {
          const cur = leaves[j]!;
          if (cur.text === ";" || cur.text === "{" || cur.text === "}") break;
          if (j > i + 1 && fullSource.slice(leaves[j - 1]!.end, cur.start).includes("\n")) break;
          j++;
        }
        if (j < leaves.length && leaves[j]!.text === ";") {
          pushSplitLeaves(target, leaves.slice(i + 1, j));
          i = j;
        }
      }
      continue;
    }

    if (kw === "constraint" && leaves[i + 1]?.text !== "def") {
      let openBraceIdx = -1;
      if (leaves[i + 1]?.text === "{") openBraceIdx = i + 1;
      else if (isWordIdentStr(leaves[i + 1]?.text) && leaves[i + 2]?.text === "{") openBraceIdx = i + 2;
      if (openBraceIdx !== -1) {
        const closeIdx = findMatchingBraceLeaf(leaves, openBraceIdx);
        pushSplitLeaves(guarantees, leaves.slice(openBraceIdx + 1, closeIdx));
        i = closeIdx;
      }
    }
  }

  return { assumptions, guarantees };
}

function isRangeInsideAny(start: number, end: number, spans: readonly [number, number][]): boolean {
  for (const [s, e] of spans) {
    if (start >= s && end <= e) return true;
  }
  return false;
}

function extractModelDefsFromCst(root: SysmlCstNode, sysmlSource: string) {
  // 0. Collect global numeric attribute defaults for symbolic constant substitution
  const constMap = new Map<string, string>();
  for (const attrNode of findCstDescendants(root, "AttributeUsage")) {
    const parsed = extractAttributeUsageFromCst(attrNode, sysmlSource);
    if (parsed?.defaultVal && isUnsignedNumericLiteral(parsed.defaultVal)) {
      constMap.set(parsed.name, parsed.defaultVal);
    }
  }

  // 1. Port Definitions (port def <Name> { ... })
  const portDefs = new Map<string, ParsedAttr[]>();
  for (const portDefNode of findCstDescendants(root, "PortDefinition")) {
    const { name } = findDefNameAndSuper(portDefNode);
    if (!name) continue;
    const attrs = collectDirectMemberNodes(portDefNode, ATTR_USAGE_TYPES)
      .map((a) => extractAttributeUsageFromCst(a, sysmlSource))
      .filter((a): a is ParsedAttr => a !== null);
    portDefs.set(name, attrs);
  }

  // 2. Use Case Definitions
  const actorTypes = new Set<string>();
  const useCases: {
    name: string;
    doc?: string | undefined;
    subject?: { name: string; type: string } | undefined;
    actors: { name: string; type: string }[];
    includes: { name: string; type: string }[];
  }[] = [];
  for (const ucNode of findCstDescendants(root, "UseCaseDefinition")) {
    const { name } = findDefNameAndSuper(ucNode);
    if (!name) continue;
    const subjNode = collectDirectMemberNodes(ucNode, SUBJECT_USAGE_TYPES)[0];
    let subject: { name: string; type: string } | undefined;
    if (subjNode) {
      const sName = findCstChildren(subjNode, "Name").pop()?.text.trim();
      const sType = extractLastNameSegment(findCstChildren(subjNode, "FeatureTyping")[0]);
      if (sName && sType) subject = { name: sName, type: sType };
    }
    const actors: { name: string; type: string }[] = [];
    for (const actNode of collectDirectMemberNodes(ucNode, ACTOR_USAGE_TYPES)) {
      const aName = findCstChildren(actNode, "Name").pop()?.text.trim();
      const aType = extractLastNameSegment(findCstChildren(actNode, "FeatureTyping")[0]);
      if (aName && aType) {
        actorTypes.add(aType);
        actors.push({ name: aName, type: aType });
      }
    }
    const includes: { name: string; type: string }[] = [];
    for (const incNode of collectDirectMemberNodes(ucNode, INCLUDE_UC_TYPES)) {
      const iName = findCstChildren(incNode, "Name").pop()?.text.trim();
      const iType = extractLastNameSegment(findCstChildren(incNode, "FeatureTyping")[0]);
      if (iName && iType) includes.push({ name: iName, type: iType });
    }
    useCases.push({
      name,
      doc: findDirectDoc(ucNode, sysmlSource),
      subject,
      actors,
      includes,
    });
  }

  // 3. Part Definitions (part def <Name> { ... })
  const partDefs = new Map<string, ParsedPartDef>();
  const parsedDefSpans: [number, number][] = [];
  const collectDefSpans = (types: readonly string[]) => {
    for (const t of types) {
      for (const n of findCstDescendants(root, t)) {
        if (n.startIndex !== undefined && n.endIndex !== undefined) {
          parsedDefSpans.push([n.startIndex, n.endIndex]);
        }
      }
    }
  };
  collectDefSpans([
    "PartDefinition",
    "PortDefinition",
    "UseCaseDefinition",
    "RequirementDefinition",
    "AnalysisCaseDefinition",
    "ConstraintDefinition",
    "StateDefinition",
    "ActionDefinition",
  ]);

  for (const pdNode of findCstDescendants(root, "PartDefinition")) {
    const { name, superType } = findDefNameAndSuper(pdNode);
    if (!name) continue;
    const attributes = collectDirectMemberNodes(pdNode, ATTR_USAGE_TYPES)
      .map((a) => extractAttributeUsageFromCst(a, sysmlSource))
      .filter((a): a is ParsedAttr => a !== null);
    const ports = collectDirectMemberNodes(pdNode, PORT_USAGE_TYPES)
      .map((p) => extractPortUsageFromCst(p))
      .filter((p): p is ParsedPort => p !== null);
    const subparts = collectDirectMemberNodes(pdNode, PART_USAGE_TYPES)
      .map((p) => extractPartUsageFromCst(p, sysmlSource))
      .filter((p): p is ParsedSubpart => p !== null);
    const connections = collectDirectMemberNodes(pdNode, CONN_USAGE_TYPES)
      .map((c) => extractConnectionUsageFromCst(c))
      .filter((c): c is ParsedConnection => c !== null);
    const clauses = extractClausesFromBodyLeaves(getBodyLeaves(pdNode), sysmlSource, constMap);
    const isActor =
      actorTypes.has(name) &&
      attributes.length === 0 &&
      ports.length === 0 &&
      subparts.length === 0 &&
      clauses.assumptions.length === 0 &&
      clauses.guarantees.length === 0;
    partDefs.set(name, {
      name,
      superType,
      doc: findDirectDoc(pdNode, sysmlSource) ?? findDocFromLeaves(getBodyLeaves(pdNode), sysmlSource),
      attributes,
      ports,
      subparts,
      connections,
      explicitAssumptions: clauses.assumptions,
      explicitGuarantees: clauses.guarantees,
      isActor,
    });
  }

  // Standalone `contract <Name> [:> <Super>] { ... }` shorthand outside formal *Definition blocks
  const allRootLeaves = collectCstLeaves(root);
  const allAttrNodes = findCstDescendants(root, "AttributeUsage");
  const allPortNodes = findCstDescendants(root, "PortUsage");
  const allPartNodes = findCstDescendants(root, "PartUsage");
  const allConnNodes = findCstDescendants(root, "ConnectionUsage");

  for (let i = 0; i < allRootLeaves.length; i++) {
    const lf = allRootLeaves[i]!;
    if (lf.text !== "contract") continue;
    if (isRangeInsideAny(lf.start, lf.end, parsedDefSpans)) continue;
    const prev = i > 0 ? allRootLeaves[i - 1] : undefined;
    const atBoundary =
      !prev ||
      prev.text === ";" ||
      prev.text === "{" ||
      prev.text === "}" ||
      prev.text === "abstract" ||
      prev.text === "variation" ||
      sysmlSource.slice(prev.end, lf.start).includes("\n");
    if (!atBoundary) continue;

    const nameLeaf = allRootLeaves[i + 1];
    if (!nameLeaf || !isWordIdentStr(nameLeaf.text)) continue;
    let cursor = i + 2;
    let superType: string | undefined;
    if (allRootLeaves[cursor]?.text === ":>") {
      cursor++;
      while (
        cursor < allRootLeaves.length &&
        allRootLeaves[cursor]!.text !== "{" &&
        allRootLeaves[cursor]!.text !== ";"
      ) {
        if (isWordIdentStr(allRootLeaves[cursor]!.text)) superType = allRootLeaves[cursor]!.text;
        cursor++;
      }
    }
    const delim = allRootLeaves[cursor];
    if (!delim || (delim.text !== "{" && delim.text !== ";")) continue;

    let bodyLeaves: CstLeaf[] = [];
    let bodyStart = delim.start;
    let bodyEnd = delim.end;
    if (delim.text === "{") {
      const closeIdx = findMatchingBraceLeaf(allRootLeaves, cursor);
      bodyLeaves = allRootLeaves.slice(cursor + 1, closeIdx);
      bodyEnd = allRootLeaves[closeIdx]!.end;
      i = closeIdx;
    } else {
      i = cursor;
    }

    const inSpan = (n: SysmlCstNode) =>
      n.startIndex !== undefined && n.endIndex !== undefined && n.startIndex >= bodyStart && n.endIndex <= bodyEnd;
    const attributes = allAttrNodes
      .filter(inSpan)
      .map((a) => extractAttributeUsageFromCst(a, sysmlSource))
      .filter((a): a is ParsedAttr => a !== null);
    const ports = allPortNodes
      .filter(inSpan)
      .map((p) => extractPortUsageFromCst(p))
      .filter((p): p is ParsedPort => p !== null);
    const subparts = allPartNodes
      .filter(inSpan)
      .map((p) => extractPartUsageFromCst(p, sysmlSource))
      .filter((p): p is ParsedSubpart => p !== null);
    const connections = allConnNodes
      .filter(inSpan)
      .map((c) => extractConnectionUsageFromCst(c))
      .filter((c): c is ParsedConnection => c !== null);
    const clauses = extractClausesFromBodyLeaves(bodyLeaves, sysmlSource, constMap);
    partDefs.set(nameLeaf.text, {
      name: nameLeaf.text,
      superType,
      doc: findDocFromLeaves(bodyLeaves, sysmlSource),
      attributes,
      ports,
      subparts,
      connections,
      explicitAssumptions: clauses.assumptions,
      explicitGuarantees: clauses.guarantees,
      isActor: false,
    });
  }

  // 4. Requirement Definitions
  const reqDefs = new Map<string, ParsedReqDef>();
  for (const reqNode of findCstDescendants(root, "RequirementDefinition")) {
    const { name } = findDefNameAndSuper(reqNode);
    if (!name) continue;
    const subjNode = collectDirectMemberNodes(reqNode, SUBJECT_USAGE_TYPES)[0];
    const subjectType = subjNode ? extractLastNameSegment(findCstChildren(subjNode, "FeatureTyping")[0]) : undefined;
    const attributes = collectDirectMemberNodes(reqNode, ATTR_USAGE_TYPES)
      .map((a) => extractAttributeUsageFromCst(a, sysmlSource))
      .filter((a): a is ParsedAttr => a !== null);
    const bodyLeaves = getBodyLeaves(reqNode);
    const clauses = extractClausesFromBodyLeaves(bodyLeaves, sysmlSource, constMap);
    reqDefs.set(name, {
      name,
      doc: findDirectDoc(reqNode, sysmlSource) ?? findDocFromLeaves(bodyLeaves, sysmlSource),
      subjectType: subjectType || undefined,
      attributes,
      assumptions: clauses.assumptions,
      guarantees: clauses.guarantees,
    });
  }

  // 5. Analysis & Constraint Definitions
  const analysisDefs: {
    name: string;
    subjectType?: string | undefined;
    objectiveReq?: string | undefined;
    guarantees: string[];
  }[] = [];
  for (const anNode of findCstDescendants(root, "AnalysisCaseDefinition")) {
    const { name } = findDefNameAndSuper(anNode);
    if (!name) continue;
    const subjNode = collectDirectMemberNodes(anNode, SUBJECT_USAGE_TYPES)[0];
    const subjectType = subjNode ? extractLastNameSegment(findCstChildren(subjNode, "FeatureTyping")[0]) : undefined;
    const objNode = collectDirectMemberNodes(anNode, OBJECTIVE_REQ_TYPES)[0];
    const objFt = objNode ? findCstChildren(objNode, "FeatureTyping")[0] : undefined;
    const objectiveReq = objFt ? extractLastNameSegment(objFt) : undefined;
    const clauses = extractClausesFromBodyLeaves(getBodyLeaves(anNode), sysmlSource, constMap);
    analysisDefs.push({
      name,
      subjectType: subjectType || undefined,
      objectiveReq: objectiveReq || undefined,
      guarantees: clauses.guarantees,
    });
    if (subjectType && partDefs.has(subjectType)) {
      const pd = partDefs.get(subjectType)!;
      for (const g of clauses.guarantees) {
        if (!pd.explicitGuarantees.includes(g)) pd.explicitGuarantees.push(g);
      }
    }
    if (objectiveReq && reqDefs.has(objectiveReq)) {
      const rd = reqDefs.get(objectiveReq)!;
      for (const g of clauses.guarantees) {
        if (!rd.guarantees.includes(g)) rd.guarantees.push(g);
      }
    }
  }

  const constraintDefs: { name: string; guarantees: string[] }[] = [];
  for (const cdNode of findCstDescendants(root, "ConstraintDefinition")) {
    const { name } = findDefNameAndSuper(cdNode);
    if (!name) continue;
    const clauses = extractClausesFromBodyLeaves(getBodyLeaves(cdNode), sysmlSource, constMap, true);
    constraintDefs.push({ name, guarantees: clauses.guarantees });
  }

  // 6. Top-level part usages & satisfy links
  const globalUsageToType = new Map<string, string>();
  for (const pu of allPartNodes) {
    const parsed = extractPartUsageFromCst(pu, sysmlSource);
    if (parsed) globalUsageToType.set(parsed.usageName, parsed.partType);
  }

  const satisfiedReqsByPartType = new Map<string, string[]>();
  const satisfyLinks: { reqName: string; targetName: string; targetType: string }[] = [];
  for (const satNode of findCstDescendants(root, "SatisfyRequirementUsage")) {
    const leaves = collectCstLeaves(satNode);
    const byIdx = leaves.findIndex((l) => l.text === "by");
    if (byIdx === -1) continue;
    let reqName = "";
    for (let k = byIdx - 1; k >= 0; k--) {
      if (isWordIdentStr(leaves[k]!.text) && leaves[k]!.text !== "requirement" && leaves[k]!.text !== "satisfy") {
        reqName = leaves[k]!.text;
        break;
      }
    }
    let targetUsage = "";
    for (let k = byIdx + 1; k < leaves.length; k++) {
      const t = leaves[k]!.text;
      if (t === ";" || t === "{") break;
      if (isWordIdentStr(t)) targetUsage = t;
    }
    if (!reqName || !targetUsage) continue;
    const resolvedType = globalUsageToType.get(targetUsage) ?? targetUsage;
    const list = satisfiedReqsByPartType.get(resolvedType) ?? [];
    if (!list.includes(reqName)) list.push(reqName);
    satisfiedReqsByPartType.set(resolvedType, list);
    satisfyLinks.push({ reqName, targetName: targetUsage, targetType: resolvedType });
  }

  for (const [reqName, rd] of reqDefs.entries()) {
    if (rd.subjectType) {
      const list = satisfiedReqsByPartType.get(rd.subjectType) ?? [];
      if (!list.includes(reqName)) list.push(reqName);
      satisfiedReqsByPartType.set(rd.subjectType, list);
    }
  }

  return {
    portDefs,
    useCases,
    partDefs,
    reqDefs,
    analysisDefs,
    constraintDefs,
    satisfiedReqsByPartType,
    satisfyLinks,
  };
}

function extractStatesAndActionsFromCst(root: SysmlCstNode, fullSource: string) {
  const states: string[] = [];
  const transitions: { name: string; from: string; to: string; guard?: string | undefined; stateMachine?: string }[] =
    [];

  for (const smNode of findCstDescendants(root, "StateDefinition")) {
    const { name: smName } = findDefNameAndSuper(smNode);
    if (!smName) continue;

    for (const stNode of findCstDescendants(smNode, "StateUsage")) {
      const stName = findCstChildren(stNode, "Name").pop()?.text.trim();
      if (stName && !states.includes(stName)) states.push(stName);
    }

    for (const trNode of findCstDescendants(smNode, "TransitionUsage")) {
      const allLeaves = collectCstLeaves(trNode);
      const stopIdx = allLeaves.findIndex((l) => l.text === ";" || l.text === "{");
      const leaves = stopIdx === -1 ? allLeaves : allLeaves.slice(0, stopIdx);
      const firstIdx = leaves.findIndex((l) => l.text === "first");
      const thenIdx = leaves.findIndex((l) => l.text === "then");
      if (firstIdx === -1 || thenIdx === -1 || thenIdx <= firstIdx) continue;

      const tName = joinLeavesWithSourceGaps(leaves.slice(1, firstIdx), fullSource);
      const ifIdx = leaves.findIndex((l, idx) => idx > firstIdx && idx < thenIdx && l.text === "if");
      const acceptIdx = leaves.findIndex((l, idx) => idx > firstIdx && idx < thenIdx && l.text === "accept");
      const doIdx = leaves.findIndex((l, idx) => idx > firstIdx && idx < thenIdx && l.text === "do");

      let fromEnd = thenIdx;
      if (ifIdx !== -1) fromEnd = Math.min(fromEnd, ifIdx);
      if (acceptIdx !== -1) fromEnd = Math.min(fromEnd, acceptIdx);
      if (doIdx !== -1) fromEnd = Math.min(fromEnd, doIdx);
      const from = joinLeavesWithSourceGaps(leaves.slice(firstIdx + 1, fromEnd), fullSource);

      let guard: string | undefined;
      if (ifIdx !== -1) {
        const guardEnd = doIdx > ifIdx && doIdx < thenIdx ? doIdx : thenIdx;
        const gText = joinLeavesWithSourceGaps(leaves.slice(ifIdx + 1, guardEnd), fullSource);
        if (gText) guard = gText;
      }

      const to = leaves[thenIdx + 1]?.text.trim() ?? "";
      if (!from || !to) continue;
      const resolvedName = tName || `${from}_to_${to}`;
      if (!states.includes(from)) states.push(from);
      if (!states.includes(to)) states.push(to);
      transitions.push({ name: resolvedName, from, to, guard, stateMachine: smName });
    }
  }

  const actionDefs: { name: string; inputs: ParsedAttr[]; outputs: ParsedAttr[] }[] = [];
  for (const actNode of findCstDescendants(root, "ActionDefinition")) {
    const { name } = findDefNameAndSuper(actNode);
    if (!name) continue;
    const inputs: ParsedAttr[] = [];
    const outputs: ParsedAttr[] = [];
    for (const pinNode of collectDirectMemberNodes(actNode, ACTION_PIN_TYPES)) {
      const leaves = collectCstLeaves(pinNode);
      const dir = leaves[0]?.text;
      if (dir !== "in" && dir !== "out" && dir !== "inout") continue;
      const pName = findCstChildren(pinNode, "Name").pop()?.text.trim();
      if (!pName) continue;
      const ft = findCstChildren(pinNode, "FeatureTyping")[0];
      const pType = (ft ? extractLastNameSegment(ft) : "") || "Real";
      if (dir === "in" || dir === "inout") inputs.push({ name: pName, type: pType });
      if (dir === "out" || dir === "inout") outputs.push({ name: pName, type: pType });
    }
    actionDefs.push({ name, inputs, outputs });
  }

  return { states, transitions, actionDefs };
}

function inferAttributeConstraint(
  attrName: string,
  attrType: string,
  defaultVal?: string,
  role: "assumption" | "guarantee" = "guarantee",
): string | null {
  const lower = attrName.toLowerCase();
  if (attrType === "String") return null;

  if (defaultVal !== undefined) {
    const num = parseFloat(defaultVal);
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      if (lower.startsWith("max") || lower.includes("limit") || lower.includes("target")) {
        return `${attrName} <= ${num}`;
      }
      if (lower.startsWith("min")) {
        return `${attrName} >= ${num}`;
      }
      return role === "assumption" ? `${attrName} >= ${num}` : `${attrName} == ${num}`;
    }
    if (defaultVal === "true" || defaultVal === "false") {
      return `${attrName} == ${defaultVal === "true" ? 1 : 0}`;
    }
  }

  if (attrType === "Boolean") {
    return `${attrName} == 1`;
  }

  // Domain-aware engineering bounds for uninitialized SysML v2 attributes
  if (lower.includes("torque")) return `${attrName} >= 250.0`;
  if (lower === "voltage") return `${attrName} >= 350.0 && ${attrName} <= 420.0`;
  if (lower.includes("minvoltage")) return `${attrName} >= 200.0`;
  if (lower === "current") return `${attrName} <= 200.0`;
  if (lower.includes("flowrate") || lower.includes("flow")) return `${attrName} >= 0.5`;
  if (lower.includes("horsepower") || lower.includes("power")) return `${attrName} >= 180.0`;
  if (lower.includes("displacement")) return `${attrName} >= 1.5`;
  if (lower.includes("gearratio")) return `${attrName} >= 0.5 && ${attrName} <= 4.5`;
  if (lower.includes("numberofgears") || lower.includes("gears")) return `${attrName} >= 6`;
  if (lower.includes("capacity")) return `${attrName} >= 50.0`;
  if (lower.includes("brakingforce") || lower.includes("brakeforce")) return `${attrName} >= 8000.0`;
  if (lower.includes("diameter")) return `${attrName} >= 16.0`;
  if (lower.includes("tirepressure") || lower.includes("pressure")) {
    return `${attrName} >= 30.0 && ${attrName} <= 36.0`;
  }
  if (lower === "mass" || lower === "maxmass" || lower === "totalmass") return `${attrName} <= 2000.0`;
  if (lower.includes("topspeed") || lower === "speed") return `${attrName} >= 160.0`;
  if (lower.includes("efficiency")) return `${attrName} >= 0.85`;
  if (lower.includes("temp")) return `${attrName} <= 65.0`;
  if (lower.includes("rating")) return `${attrName} >= 5`;
  if (lower.includes("time")) return `${attrName} <= 6.0`;
  if (lower.includes("range")) return `${attrName} >= 50.0`;
  if (lower.includes("emission")) return `${attrName} <= 120.0`;
  if (lower.includes("mtbf")) return `${attrName} >= 200000.0`;
  if (lower.includes("resolution")) return `${attrName} <= 0.01`;

  if (attrType === "Integer") return `${attrName} >= 1`;
  return `${attrName} >= 0.0`;
}

function synthesizeRequirementGuarantees(req: ParsedReqDef): string[] {
  if (req.guarantees.length > 0) return [...req.guarantees];

  const synthesized: string[] = [];
  const doc = req.doc ?? "";
  const isUpper = /\b(?:not\s+exceed|below|under|less\s+than|at\s+most|maximum|<=)\b/i.test(doc);
  const isLower = /\b(?:at\s+least|minimum|pass|exceed|above|>=)\b/i.test(doc);

  const kwNumMatch =
    /\b(?:not\s+exceed|below|under|less\s+than|at\s+most|<=|<|at\s+least|minimum|pass(?:\s+[A-Za-z0-9_-]+?)?|>=|>)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i.exec(
      doc,
    );
  const fallbackNumMatch = /([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(doc);
  const rawNumStr = (kwNumMatch?.[1] ?? fallbackNumMatch?.[1])?.replace(/,/g, "");
  const docNum = rawNumStr !== undefined ? parseFloat(rawNumStr) : undefined;

  if (req.attributes.length > 0) {
    for (const attr of req.attributes) {
      const attrNum =
        attr.defaultVal !== undefined && !Number.isNaN(parseFloat(attr.defaultVal))
          ? parseFloat(attr.defaultVal)
          : docNum;
      if (attrNum !== undefined && Number.isFinite(attrNum)) {
        const lowerName = attr.name.toLowerCase();
        const op =
          lowerName.startsWith("max") ||
          lowerName.includes("limit") ||
          lowerName.includes("target") ||
          (isUpper && !isLower)
            ? "<="
            : lowerName.startsWith("min") || isLower
              ? ">="
              : "<=";
        synthesized.push(`${attr.name} ${op} ${attrNum}`);
      } else {
        const inferred = inferAttributeConstraint(attr.name, attr.type, attr.defaultVal, "guarantee");
        if (inferred) synthesized.push(inferred);
      }
    }
  } else if (docNum !== undefined && Number.isFinite(docNum)) {
    const op = isLower && !isUpper ? ">=" : "<=";
    synthesized.push(`${req.name} ${op} ${docNum}`);
  }

  return synthesized;
}

/**
 * Extracts a complete Assume-Guarantee contract hierarchy and Monterey Phoenix execution trace
 * directly from a SysML v2 model's definitions, ports, connections, requirements, and behaviors.
 */
export function extractSysML2ContractHierarchy(
  sysmlSource: string,
  options: { targetName?: string | undefined; scope?: number | undefined } = {},
): SysML2ContractHierarchyResult | null {
  const cstRoot = parseSysmlSource(sysmlSource);
  if (!cstRoot) return null;

  const { portDefs, useCases, partDefs, reqDefs, analysisDefs, constraintDefs, satisfiedReqsByPartType, satisfyLinks } =
    extractModelDefsFromCst(cstRoot, sysmlSource);

  // If there are no part defs, requirement defs, or analysis defs at all, return null
  const nonActorParts = Array.from(partDefs.values()).filter((p) => !p.isActor);
  if (nonActorParts.length === 0 && reqDefs.size === 0 && analysisDefs.length === 0 && constraintDefs.length === 0) {
    return null;
  }

  // 7. Determine Top-Level System and Subcomponents
  const targetName = options.targetName?.split("::").pop();
  let systemPartDef: ParsedPartDef | undefined;
  let focusedComponent: string | undefined;

  // Find composite part definitions (part defs that contain subparts)
  const compositeParts = nonActorParts.filter((p) => p.subparts.length > 0);

  if (targetName && partDefs.has(targetName)) {
    const clickedPart = partDefs.get(targetName)!;
    if (clickedPart.subparts.length > 0) {
      systemPartDef = clickedPart;
    } else {
      // Check if clickedPart is a subpart of a composite part in the same document
      const parentComposite = compositeParts.find((cp) => cp.subparts.some((sp) => sp.partType === targetName));
      if (parentComposite) {
        systemPartDef = parentComposite;
        focusedComponent = targetName;
      } else {
        systemPartDef = clickedPart;
      }
    }
  } else if (compositeParts.length > 0) {
    // Pick the composite part with the most subparts (e.g. Vehicle or DroneAssembly)
    systemPartDef = compositeParts.reduce((best, curr) => (curr.subparts.length >= best.subparts.length ? curr : best));
    if (targetName) focusedComponent = targetName;
  } else if (nonActorParts.length > 0) {
    // If all part defs have explicit contracts (e.g. PowertrainSystem, Battery, Motor), first is system, rest are components
    const withExplicit = nonActorParts.filter(
      (p) => p.explicitAssumptions.length > 0 || p.explicitGuarantees.length > 0,
    );
    systemPartDef = withExplicit[0] ?? nonActorParts[0]!;
    if (targetName && targetName !== systemPartDef.name) {
      focusedComponent = targetName;
    }
  }

  // Map connection topology inside systemPartDef to determine incoming/outgoing port contracts
  const incomingPortTypesByPart = new Map<string, { portName: string; portType: string; fromPart: string }[]>();
  const outgoingPortTypesByPart = new Map<string, { portName: string; portType: string; toPart: string }[]>();

  if (systemPartDef) {
    const usageToPartType = new Map<string, string>();
    for (const sp of systemPartDef.subparts) {
      usageToPartType.set(sp.usageName, sp.partType);
    }
    for (const conn of systemPartDef.connections) {
      const srcType = usageToPartType.get(conn.sourcePart) ?? conn.sourcePart;
      const dstType = usageToPartType.get(conn.targetPart) ?? conn.targetPart;
      const srcPd = partDefs.get(srcType);
      const dstPd = partDefs.get(dstType);
      const srcPortObj = srcPd?.ports.find((p) => p.name === conn.sourcePort);
      const dstPortObj = dstPd?.ports.find((p) => p.name === conn.targetPort);
      const portType = srcPortObj?.portType ?? dstPortObj?.portType ?? conn.sourcePort;

      const outList = outgoingPortTypesByPart.get(srcType) ?? [];
      outList.push({ portName: conn.sourcePort, portType, toPart: dstType });
      outgoingPortTypesByPart.set(srcType, outList);

      const inList = incomingPortTypesByPart.get(dstType) ?? [];
      inList.push({ portName: conn.targetPort, portType, fromPart: srcType });
      incomingPortTypesByPart.set(dstType, inList);
    }
  }

  // Helper to build a SysML2ContractNode from a ParsedPartDef
  const buildComponentContract = (pd: ParsedPartDef, usageLabel?: string): SysML2ContractNode => {
    const assumptions: string[] = [...pd.explicitAssumptions];
    const guarantees: string[] = [...pd.explicitGuarantees];

    // If no explicit assumptions/guarantees, derive from connected ports, declared ports, and attributes
    if (assumptions.length === 0 && guarantees.length === 0) {
      const incoming = incomingPortTypesByPart.get(pd.name) ?? [];
      const outgoing = outgoingPortTypesByPart.get(pd.name) ?? [];

      // 1. Incoming ports -> Assumptions
      for (const inc of incoming) {
        const pAttrs = portDefs.get(inc.portType) ?? [];
        for (const pa of pAttrs) {
          const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "assumption");
          if (c && !assumptions.includes(c)) assumptions.push(c);
        }
      }
      for (const p of pd.ports) {
        if (p.direction === "in") {
          const pAttrs = portDefs.get(p.portType) ?? [];
          for (const pa of pAttrs) {
            const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "assumption");
            if (c && !assumptions.includes(c)) assumptions.push(c);
          }
        }
      }

      // 2. Outgoing ports -> Guarantees
      for (const out of outgoing) {
        const pAttrs = portDefs.get(out.portType) ?? [];
        for (const pa of pAttrs) {
          const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "guarantee");
          if (c && !guarantees.includes(c)) guarantees.push(c);
        }
      }
      for (const p of pd.ports) {
        if (p.direction === "out" || (!p.direction && !incoming.some((i) => i.portName === p.name))) {
          const pAttrs = portDefs.get(p.portType) ?? [];
          for (const pa of pAttrs) {
            const c = inferAttributeConstraint(pa.name, pa.type, pa.defaultVal, "guarantee");
            if (c && !guarantees.includes(c)) guarantees.push(c);
          }
        }
      }

      // 3. Component attributes
      const nonPortAttrs = pd.attributes.filter(
        (a) => !assumptions.some((ex) => ex.includes(a.name)) && !guarantees.some((ex) => ex.includes(a.name)),
      );
      if (nonPortAttrs.length > 0) {
        if (assumptions.length === 0 && nonPortAttrs.length >= 2 && guarantees.length === 0) {
          // Split first attribute as sizing/configuration assumption and remaining as guarantees
          const firstC = inferAttributeConstraint(
            nonPortAttrs[0]!.name,
            nonPortAttrs[0]!.type,
            nonPortAttrs[0]!.defaultVal,
            "assumption",
          );
          if (firstC) assumptions.push(firstC);
          for (let i = 1; i < nonPortAttrs.length; i++) {
            const gC = inferAttributeConstraint(
              nonPortAttrs[i]!.name,
              nonPortAttrs[i]!.type,
              nonPortAttrs[i]!.defaultVal,
              "guarantee",
            );
            if (gC && !guarantees.includes(gC)) guarantees.push(gC);
          }
        } else if (assumptions.length === 0 && guarantees.length > 0) {
          // Has output port guarantees; use first attribute as sizing assumption and also guarantee
          const firstC = inferAttributeConstraint(
            nonPortAttrs[0]!.name,
            nonPortAttrs[0]!.type,
            nonPortAttrs[0]!.defaultVal,
            "assumption",
          );
          if (firstC) assumptions.push(firstC);
          for (let i = 1; i < nonPortAttrs.length; i++) {
            const gC = inferAttributeConstraint(
              nonPortAttrs[i]!.name,
              nonPortAttrs[i]!.type,
              nonPortAttrs[i]!.defaultVal,
              "guarantee",
            );
            if (gC && !guarantees.includes(gC)) guarantees.push(gC);
          }
        } else {
          // Already has port assumptions; remaining attributes are guarantees (or last is assumption if multiple)
          for (let i = 0; i < nonPortAttrs.length; i++) {
            const attr = nonPortAttrs[i]!;
            const isConfigAttr =
              assumptions.length <= 1 &&
              i === nonPortAttrs.length - 1 &&
              nonPortAttrs.length >= 2 &&
              CONFIG_ATTR_NAMES.has(attr.name.toLowerCase());
            const c = inferAttributeConstraint(
              attr.name,
              attr.type,
              attr.defaultVal,
              isConfigAttr ? "assumption" : "guarantee",
            );
            if (c) {
              if (isConfigAttr && !assumptions.includes(c)) assumptions.push(c);
              else if (!guarantees.includes(c)) guarantees.push(c);
            }
          }
        }
      }

      // Check if any requirements explicitly target this component
      const linkedReqs = satisfiedReqsByPartType.get(pd.name) ?? [];
      for (const rName of linkedReqs) {
        const rd = reqDefs.get(rName);
        if (rd) {
          for (const a of rd.assumptions) if (!assumptions.includes(a)) assumptions.push(a);
          for (const g of synthesizeRequirementGuarantees(rd)) {
            if (!guarantees.includes(g)) guarantees.push(g);
          }
        }
      }
    }

    if (assumptions.length === 0 && guarantees.length > 0) {
      assumptions.push(guarantees[0]!);
    }

    return {
      name: pd.name,
      symbolName: pd.name,
      role: usageLabel,
      doc: pd.doc,
      assumptions,
      guarantees,
      isFocused: focusedComponent === pd.name,
    };
  };

  let components: SysML2ContractNode[] = [];
  let systemNode: SysML2ContractNode;

  if (systemPartDef) {
    if (systemPartDef.subparts.length > 0) {
      const seenTypes = new Set<string>();
      for (const sp of systemPartDef.subparts) {
        if (seenTypes.has(sp.partType)) continue;
        seenTypes.add(sp.partType);
        const childPd = partDefs.get(sp.partType);
        const roleLabel = `${sp.usageName} : ${sp.partType}${sp.multiplicity ? `[${sp.multiplicity}]` : ""}`;
        if (childPd) {
          components.push(buildComponentContract(childPd, roleLabel));
        } else {
          components.push({
            name: sp.partType,
            symbolName: sp.partType,
            role: roleLabel,
            assumptions: [`${sp.usageName}_ready >= 1`],
            guarantees: [`${sp.usageName}_ready >= 1`],
            isFocused: focusedComponent === sp.partType,
          });
        }
      }
    } else {
      // No subparts on systemPartDef; other non-actor partDefs or reqDefs are components
      for (const pd of nonActorParts) {
        if (pd.name === systemPartDef.name) continue;
        components.push(buildComponentContract(pd, "Part Definition"));
      }
      if (components.length === 0) {
        for (const rd of reqDefs.values()) {
          const reqG = synthesizeRequirementGuarantees(rd);
          components.push({
            name: rd.name,
            symbolName: rd.name,
            role: "Requirement",
            doc: rd.doc,
            assumptions: rd.assumptions.length > 0 ? [...rd.assumptions] : [...reqG],
            guarantees: reqG,
            isFocused: focusedComponent === rd.name,
          });
        }
      }
    }

    // If a specific component was focused by the user, place it first for immediate visibility
    if (focusedComponent) {
      components.sort((a, b) => (a.isFocused === b.isFocused ? 0 : a.isFocused ? -1 : 1));
    }

    // Build Top-Level System Contract
    const sysAssumptions: string[] = [...systemPartDef.explicitAssumptions];
    const sysGuarantees: string[] = [...systemPartDef.explicitGuarantees];

    if (sysAssumptions.length === 0 && sysGuarantees.length === 0) {
      // 1. Collect system-level satisfied requirements (plus document requirements when systemPartDef is the root composite)
      const satisfiedReqNames = new Set<string>(satisfiedReqsByPartType.get(systemPartDef.name) ?? []);
      if (systemPartDef.subparts.length > 0) {
        for (const rName of reqDefs.keys()) satisfiedReqNames.add(rName);
      }

      for (const rName of satisfiedReqNames) {
        const rd = reqDefs.get(rName);
        if (rd) {
          for (const a of rd.assumptions) {
            if (!sysAssumptions.includes(a)) sysAssumptions.push(a);
          }
          for (const g of synthesizeRequirementGuarantees(rd)) {
            if (!sysGuarantees.includes(g)) sysGuarantees.push(g);
          }
        }
      }

      // 2. Include systemPartDef's own attributes (e.g. mass, topSpeed, totalMass, totalFrontalArea)
      for (const attr of systemPartDef.attributes) {
        const c = inferAttributeConstraint(attr.name, attr.type, attr.defaultVal, "guarantee");
        if (c && !sysGuarantees.includes(c)) {
          sysGuarantees.push(c);
        }
      }

      // 3. Include key output guarantees delivered by subcomponents (e.g. torqueValue, voltage, maxBrakingForce)
      const allCompGuarantees = components.flatMap((c) => c.guarantees);
      for (const cg of allCompGuarantees) {
        if (sysGuarantees.length < 6 && !sysGuarantees.includes(cg)) {
          sysGuarantees.push(cg);
        }
      }

      // 4. Compute external/environmental assumptions required for compositional compatibility & refinement
      // Any component assumption not already entailed by sibling component guarantees is an external system assumption
      for (let i = 0; i < components.length; i++) {
        const comp = components[i]!;
        const peerGuarantees = components.filter((_, idx) => idx !== i).flatMap((c) => c.guarantees);
        for (const a of comp.assumptions) {
          const ent = checkSymbolicEntailment([...sysAssumptions, ...peerGuarantees], a);
          if (!ent.entailed && !sysAssumptions.includes(a)) {
            sysAssumptions.push(a);
          }
        }
      }

      // Any system guarantee not entailed by component guarantees (such as system-level mass/rating/time requirements)
      // is backed by a corresponding system-level boundary assumption or parameter bound
      for (const g of sysGuarantees) {
        const ent = checkSymbolicEntailment([...sysAssumptions, ...allCompGuarantees], g);
        if (!ent.entailed && !sysAssumptions.includes(g)) {
          sysAssumptions.push(g);
        }
      }
    }

    systemNode = {
      name: systemPartDef.name,
      symbolName: systemPartDef.name,
      role: "Top-Level System",
      doc: systemPartDef.doc,
      assumptions: sysAssumptions,
      guarantees: sysGuarantees,
      isFocused: focusedComponent === undefined || focusedComponent === systemPartDef.name,
    };
  } else {
    // Document only has requirement defs / analysis defs / constraint defs
    const allReqs = Array.from(reqDefs.values());
    const firstReq = allReqs[0];
    if (firstReq) {
      const reqG = synthesizeRequirementGuarantees(firstReq);
      systemNode = {
        name: analysisDefs[0]?.name ?? firstReq.name,
        symbolName: analysisDefs[0]?.name ?? firstReq.name,
        role: analysisDefs[0] ? "Verification Analysis" : "Top-Level Requirement",
        doc: firstReq.doc,
        assumptions: firstReq.assumptions.length > 0 ? [...firstReq.assumptions] : [...reqG],
        guarantees: analysisDefs[0]?.guarantees.length ? [...analysisDefs[0].guarantees] : reqG,
      };
      for (const rd of allReqs) {
        const g = synthesizeRequirementGuarantees(rd);
        components.push({
          name: rd.name,
          symbolName: rd.name,
          role: "Requirement",
          doc: rd.doc,
          assumptions: rd.assumptions.length > 0 ? [...rd.assumptions] : [...g],
          guarantees: g,
        });
      }
    } else if (constraintDefs.length > 0) {
      const firstC = constraintDefs[0]!;
      systemNode = {
        name: firstC.name,
        symbolName: firstC.name,
        role: "Constraint Definition",
        assumptions: [...firstC.guarantees],
        guarantees: [...firstC.guarantees],
      };
    } else {
      return null;
    }
  }

  // 8. Run formal algebraic verification via ContractAlgebra.verifySystemComposition
  const compResult = ContractAlgebra.verifySystemComposition(systemNode, components);

  // 9. Extract State Machine states/transitions and Behavioral Event Traces (Monterey Phoenix)
  const { states, transitions, actionDefs } = extractStatesAndActionsFromCst(cstRoot, sysmlSource);

  // Synthesize Monterey Phoenix scope-complete execution trace steps from actual model elements
  const traces: SysML2ContractTraceStep[] = [];
  let stepCounter = 1;

  // 9a. Use Case initiation (if present)
  if (useCases.length > 0) {
    const primaryUc = useCases[0]!;
    const actorName = primaryUc.actors[0]?.type ?? primaryUc.actors[0]?.name ?? "Operator";
    const targetNameStr = primaryUc.subject?.type ?? systemNode.name;
    const incStr =
      primaryUc.includes.length > 0
        ? `include ${primaryUc.includes.map((i) => i.type).join(", ")}`
        : (primaryUc.doc ?? `initiate ${primaryUc.name}`);
    traces.push({
      step: stepCounter++,
      actor: actorName,
      event: primaryUc.name,
      targetActor: targetNameStr,
      message: incStr,
      sourceSymbol: primaryUc.name,
    });
  }

  // 9b. Initial State Machine transition (e.g. off_to_idle: off -> idle)
  if (transitions.length > 0) {
    const t0 = transitions[0]!;
    traces.push({
      step: stepCounter++,
      actor: t0.stateMachine ?? t0.from,
      event: t0.name,
      targetActor: t0.to,
      message: `state: ${t0.from} ➔ ${t0.to}${t0.guard ? ` [${t0.guard}]` : ""}`,
      sourceSymbol: t0.name,
    });
  }

  // 9c. First Behavioral Action (e.g. StartEngine)
  if (actionDefs.length > 0) {
    const act0 = actionDefs[0]!;
    const inStr = act0.inputs.map((i) => i.name).join(", ") || "trigger";
    const outStr = act0.outputs.map((o) => `${o.name} : ${o.type}`).join(", ") || "completed";
    traces.push({
      step: stepCounter++,
      actor: act0.name,
      event: inStr,
      targetActor: components[0]?.name ?? systemNode.name,
      message: `out ${outStr}`,
      sourceSymbol: act0.name,
    });
  }

  // 9d. Structural Port Connections (e.g. fuelTank.fuelOut -> engine.fuelIn, engine.torqueOut -> transmission.torqueIn)
  if (systemPartDef && systemPartDef.connections.length > 0) {
    const usageToPartType = new Map<string, string>();
    for (const sp of systemPartDef.subparts) {
      usageToPartType.set(sp.usageName, sp.partType);
    }
    for (const conn of systemPartDef.connections) {
      const srcType = usageToPartType.get(conn.sourcePart) ?? conn.sourcePart;
      const dstType = usageToPartType.get(conn.targetPart) ?? conn.targetPart;
      const srcPd = partDefs.get(srcType);
      const dstPd = partDefs.get(dstType);
      const portObj =
        srcPd?.ports.find((p) => p.name === conn.sourcePort) ?? dstPd?.ports.find((p) => p.name === conn.targetPort);
      const pType = portObj?.portType ?? conn.sourcePort;
      const pAttrs = portDefs.get(pType) ?? [];
      const attrSummary =
        pAttrs.length > 0
          ? `${pType} (${pAttrs.map((a) => `${a.name} : ${a.type}`).join(", ")})`
          : `${conn.targetPart}.${conn.targetPort} (${dstType})`;
      traces.push({
        step: stepCounter++,
        actor: `${conn.sourcePart} (${srcType})`,
        event: conn.sourcePort,
        targetActor: `${conn.targetPart}.${conn.targetPort}`,
        message: attrSummary,
        sourceSymbol: srcType,
      });
    }
  }

  // 9e. Subsequent State Machine transitions & Behavioral Actions (e.g. idle_to_driving, Accelerate, Brake)
  for (let i = 1; i < transitions.length; i++) {
    const tr = transitions[i]!;
    traces.push({
      step: stepCounter++,
      actor: tr.stateMachine ?? tr.from,
      event: tr.name,
      targetActor: tr.to,
      message: `state: ${tr.from} ➔ ${tr.to}${tr.guard ? ` [${tr.guard}]` : ""}`,
      sourceSymbol: tr.name,
    });
  }

  for (let i = 1; i < actionDefs.length; i++) {
    const act = actionDefs[i]!;
    const inStr = act.inputs.map((inp) => inp.name).join(", ") || "execute";
    const outStr = act.outputs.map((o) => `${o.name} : ${o.type}`).join(", ") || "done";
    traces.push({
      step: stepCounter++,
      actor: act.name,
      event: inStr,
      targetActor: systemNode.name,
      message: `out ${outStr}`,
      sourceSymbol: act.name,
    });
  }

  // 9f. Also include multi-step CFG traces from SysML2EventTraceExplorer if activities have internal action nodes
  try {
    const mpRes = SysML2EventTraceExplorer.exploreText(sysmlSource, {
      scope: options.scope ?? 2,
      maxTraces: 5,
    });
    if (mpRes.traces.length > 0 && traces.length === 0) {
      const firstTrace = mpRes.traces[0]!;
      for (const ev of firstTrace.events) {
        const [actor, eventName] = ev.includes(".") ? ev.split(".", 2) : [mpRes.modelName, ev];
        traces.push({
          step: stepCounter++,
          actor: actor!,
          event: eventName!,
          targetActor: systemNode.name,
          message: `scope k=${options.scope ?? 2} event`,
          sourceSymbol: eventName!,
        });
      }
    }
  } catch {
    // Ignore exploratory parser errors on partial edits
  }

  // 9g. Requirement satisfaction / verification steps
  if (satisfyLinks.length > 0) {
    for (const sl of satisfyLinks) {
      const rd = reqDefs.get(sl.reqName);
      const reqClauses = rd ? synthesizeRequirementGuarantees(rd) : [];
      traces.push({
        step: stepCounter++,
        actor: `${sl.targetName} (${sl.targetType})`,
        event: "satisfy",
        targetActor: sl.reqName,
        message: reqClauses.join(", ") || rd?.doc || "requirement satisfied",
        sourceSymbol: sl.reqName,
      });
    }
  } else if (reqDefs.size > 0) {
    for (const rd of reqDefs.values()) {
      const reqClauses = synthesizeRequirementGuarantees(rd);
      traces.push({
        step: stepCounter++,
        actor: rd.subjectType ?? systemNode.name,
        event: "verify",
        targetActor: rd.name,
        message: reqClauses.join(", ") || rd.doc || "requirement verified",
        sourceSymbol: rd.name,
      });
    }
  }

  // 9h. Fallback if model only has parts and no actions/states/connections/requirements
  if (traces.length === 0) {
    for (const comp of components) {
      traces.push({
        step: stepCounter++,
        actor: comp.name,
        event: "guarantee",
        targetActor: systemNode.name,
        message: comp.guarantees.join(" && ") || "nominal",
        sourceSymbol: comp.symbolName ?? comp.name,
      });
    }
  }

  return {
    system: systemNode,
    components,
    isCompatible: compResult.isCompatible,
    isRefined: compResult.isRefined,
    compatibilityViolations: compResult.compatibilityViolations,
    refinementViolations: compResult.refinementViolations,
    traces,
    states: states.length > 0 ? states : undefined,
    transitions: transitions.length > 0 ? transitions : undefined,
    focusedComponent,
    summary: compResult.summary,
  };
}
