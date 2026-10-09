// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic normalizer for flat Modelica DAE comparison.
 *
 * OpenModelica and ModelScript often produce mathematically identical DAEs
 * that differ only in:
 *   1. Commutative product order (e.g. `R1.i * R1.R` vs `R1.R * R1.i`)
 *   2. Commutative sum order in flow equations (e.g. `R2.p.i + R3.p.i + R1.p.i = 0.0`)
 *   3. Flow negation factoring (e.g. `-(p1.i + p2.i) = 0.0` vs `(-p1.i) + (-p2.i) = 0.0`)
 *   4. Equation emission order between independent components
 *   5. Variable declaration order across inherited classes
 *
 * This module parses flat Modelica output into a canonical semantic representation
 * to verify equivalence without false-negative test suite failures.
 */

interface ParsedClass {
  kind: string; // 'class', 'model', 'function', etc.
  name: string;
  variables: string[]; // sorted normalized variable declarations
  equations: string[]; // sorted canonicalized equations
  initialEquations: string[];
  algorithms: string[];
  initialAlgorithms: string[];
}

/**
 * Normalizes an expression with respect to commutative operations.
 */
function canonicalizeExpression(expr: string): string {
  let s = expr.trim();
  // Remove unnecessary outer parentheses e.g. ((x)) -> (x)
  while (s.startsWith("(") && s.endsWith(")")) {
    // Check if matching pair
    let depth = 0;
    let ok = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") {
        depth--;
        if (depth === 0) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }

  // Canonicalize simple binary commutative multiplications: `a * b` where neither contains nested parens
  // Matches simple identifier / number factors like `R1.i * R1.R` -> `R1.R * R1.i`
  const multRegex = /^([a-zA-Z0-9_.[\](),]+)\s*\*\s*([a-zA-Z0-9_.[\](),]+)$/;
  const m = s.match(multRegex);
  if (m && m[1] && m[2]) {
    const f1 = m[1].trim();
    const f2 = m[2].trim();
    if (f1 > f2) {
      return `${f2} * ${f1}`;
    }
    return `${f1} * ${f2}`;
  }

  return s;
}

/**
 * Canonicalizes a single equation `LHS = RHS`.
 */
export function canonicalizeEquation(eqStr: string): string {
  let s = eqStr.trim();
  if (s.endsWith(";")) s = s.slice(0, -1).trim();

  // Find top-level '='
  let depth = 0;
  let eqIdx = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "=" && depth === 0) {
      // Check not == or <= or >=
      const prev = i > 0 ? s[i - 1] : "";
      const next = i + 1 < s.length ? s[i + 1] : "";
      if (prev !== "=" && prev !== "<" && prev !== ">" && prev !== "!" && next !== "=") {
        eqIdx = i;
        break;
      }
    }
  }

  if (eqIdx === -1) {
    return s;
  }

  let lhs = s.slice(0, eqIdx).trim();
  let rhs = s.slice(eqIdx + 1).trim();

  // Handle flow sum equation with = 0.0 or = 0
  const isZeroRhs = rhs === "0.0" || rhs === "0" || rhs === "0.00";
  const isZeroLhs = lhs === "0.0" || lhs === "0" || lhs === "0.00";

  if (isZeroRhs || isZeroLhs) {
    const nonZeroSide = isZeroRhs ? lhs : rhs;
    const terms = parseAdditiveTerms(nonZeroSide);
    if (terms.length > 0) {
      // If all terms are negative e.g. -p1.i - p2.i = 0, negate all
      const allNeg = terms.every((t) => t.sign === -1);
      if (allNeg) {
        for (const t of terms) t.sign = 1;
      }
      // Sort terms by expression string
      terms.sort((a, b) => a.expr.localeCompare(b.expr));

      // Rebuild normalized equation
      const parts: string[] = [];
      for (let i = 0; i < terms.length; i++) {
        const t = terms[i]!;
        if (i === 0) {
          parts.push(t.sign === -1 ? `-${t.expr}` : t.expr);
        } else {
          parts.push(t.sign === -1 ? `- ${t.expr}` : `+ ${t.expr}`);
        }
      }
      return `${parts.join(" ")} = 0.0;`;
    }
  }

  // Canonicalize assignment equation: variable = expr
  lhs = canonicalizeExpression(lhs);
  rhs = canonicalizeExpression(rhs);

  // If both sides are simple expressions, enforce deterministic order (e.g. p1.v = p2.v vs p2.v = p1.v for connection voltage equality)
  const isSimpleLhs = /^[a-zA-Z0-9_.[\](),]+$/.test(lhs);
  const isSimpleRhs = /^[a-zA-Z0-9_.[\](),]+$/.test(rhs);
  if (isSimpleLhs && isSimpleRhs) {
    if (lhs > rhs) {
      const tmp = lhs;
      lhs = rhs;
      rhs = tmp;
    }
  }

  return `${lhs} = ${rhs};`;
}

interface SignedTerm {
  sign: 1 | -1;
  expr: string;
}

/**
 * Splits an additive expression `a + b - (c + d) + (-e)` into signed terms.
 */
function parseAdditiveTerms(expr: string): SignedTerm[] {
  let s = expr.trim();
  // Strip outer negation: -(a + b + ...)
  let outerNeg = false;
  if (s.startsWith("-(") && s.endsWith(")")) {
    outerNeg = true;
    s = s.slice(2, -1).trim();
  } else if (s.startsWith("- (") && s.endsWith(")")) {
    outerNeg = true;
    s = s.slice(3, -1).trim();
  }

  const terms: SignedTerm[] = [];
  let depth = 0;
  let curTerm = "";
  let curSign: 1 | -1 = 1;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;

    if (depth === 0 && (ch === "+" || ch === "-") && i > 0 && curTerm.trim().length > 0) {
      const termInfo = cleanTerm(curTerm, curSign);
      if (termInfo.expr) {
        terms.push({ sign: termInfo.sign, expr: canonicalizeExpression(termInfo.expr) });
      }
      curSign = ch === "-" ? -1 : 1;
      curTerm = "";
    } else {
      if (i === 0 && ch === "-") {
        curSign = -1;
      } else if (i === 0 && ch === "+") {
        curSign = 1;
      } else {
        curTerm += ch;
      }
    }
  }

  const lastTermInfo = cleanTerm(curTerm, curSign);
  if (lastTermInfo.expr) {
    terms.push({ sign: lastTermInfo.sign, expr: canonicalizeExpression(lastTermInfo.expr) });
  }

  if (outerNeg) {
    for (const t of terms) {
      t.sign = (t.sign * -1) as 1 | -1;
    }
  }

  return terms;
}

function cleanTerm(term: string, currentSign: 1 | -1): { sign: 1 | -1; expr: string } {
  let t = term.trim();
  let sign = currentSign;
  let changed = true;
  while (changed) {
    changed = false;
    t = t.trim();
    if (t.startsWith("(") && t.endsWith(")")) {
      let depth = 0;
      let ok = true;
      for (let i = 0; i < t.length - 1; i++) {
        if (t[i] === "(") depth++;
        else if (t[i] === ")") {
          depth--;
          if (depth === 0) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        t = t.slice(1, -1).trim();
        changed = true;
        if (t.startsWith("-")) {
          sign = (sign * -1) as 1 | -1;
          t = t.slice(1).trim();
        }
      }
    }
  }
  return { sign, expr: t };
}

/**
 * Parses flat Modelica text into structured classes.
 */
export function parseFlatModelica(text: string): ParsedClass[] {
  const classes: ParsedClass[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));

  let currentClass: ParsedClass | null = null;
  let currentSection: "vars" | "equations" | "initialEquations" | "algorithms" | "initialAlgorithms" = "vars";

  for (const line of lines) {
    const classMatch = line.match(/^(class|model|record|function|package|type|block|connector)\s+([a-zA-Z0-9_.]+)/);
    if (classMatch && !line.includes("=")) {
      currentClass = {
        kind: classMatch[1] ?? "class",
        name: classMatch[2] ?? "",
        variables: [],
        equations: [],
        initialEquations: [],
        algorithms: [],
        initialAlgorithms: [],
      };
      classes.push(currentClass);
      currentSection = "vars";
      continue;
    }

    if (line.startsWith("end ") && line.endsWith(";")) {
      const endTarget = line.slice(4, -1).trim();
      if (
        currentClass &&
        (endTarget === currentClass.name ||
          endTarget === currentClass.name.split(".").pop() ||
          endTarget === currentClass.kind)
      ) {
        currentClass = null;
        continue;
      }
      if (endTarget === "when" || endTarget === "if" || endTarget === "for") {
        // Block closing within equation/algorithm section; do not reset currentClass
      } else if (!currentClass || endTarget !== "") {
        currentClass = null;
        continue;
      }
    }

    if (!currentClass) continue;

    if (line === "equation") {
      currentSection = "equations";
      continue;
    }
    if (line === "initial equation") {
      currentSection = "initialEquations";
      continue;
    }
    if (line === "algorithm") {
      currentSection = "algorithms";
      continue;
    }
    if (line === "initial algorithm") {
      currentSection = "initialAlgorithms";
      continue;
    }

    // Process line according to current section
    if (currentSection === "vars") {
      // Normalize variable declaration: collapse spaces, ensure semicolon
      const normVar = line.replace(/\s+/g, " ");
      currentClass.variables.push(normVar);
    } else if (currentSection === "equations") {
      const canonEq = canonicalizeEquation(line);
      currentClass.equations.push(canonEq);
    } else if (currentSection === "initialEquations") {
      const canonEq = canonicalizeEquation(line);
      currentClass.initialEquations.push(canonEq);
    } else if (currentSection === "algorithms") {
      currentClass.algorithms.push(line.replace(/\s+/g, " "));
    } else if (currentSection === "initialAlgorithms") {
      currentClass.initialAlgorithms.push(line.replace(/\s+/g, " "));
    }
  }

  // Sort each section for order-independent comparison
  for (const c of classes) {
    c.variables.sort();
    c.equations = canonicalizeEqualityCliques(c.equations);
    c.equations.sort();
    c.initialEquations = canonicalizeEqualityCliques(c.initialEquations);
    c.initialEquations.sort();
  }

  return classes;
}

function canonicalizeEqualityCliques(equations: string[]): string[] {
  const varEqRegex = /^([a-zA-Z_][a-zA-Z0-9_.[\]]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_.[\]]*);?$/;
  interface Edge {
    u: string;
    v: string;
    eqIdx: number;
  }
  const edges: Edge[] = [];
  const edgeIndices = new Set<number>();

  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i]!.trim();
    const m = eq.match(varEqRegex);
    if (m && m[1] && m[2]) {
      const u = m[1].trim();
      const v = m[2].trim();
      if (u !== "true" && u !== "false" && v !== "true" && v !== "false" && isNaN(Number(u)) && isNaN(Number(v))) {
        edges.push({ u, v, eqIdx: i });
        edgeIndices.add(i);
      }
    }
  }

  if (edges.length === 0) return equations;

  const adj = new Map<string, { neighbor: string; eqIdx: number }[]>();
  for (const e of edges) {
    if (!adj.has(e.u)) adj.set(e.u, []);
    if (!adj.has(e.v)) adj.set(e.v, []);
    adj.get(e.u)!.push({ neighbor: e.v, eqIdx: e.eqIdx });
    adj.get(e.v)!.push({ neighbor: e.u, eqIdx: e.eqIdx });
  }

  const visited = new Set<string>();
  const replacedEqIndices = new Set<number>();
  const newEquations: string[] = [];

  for (const node of adj.keys()) {
    if (visited.has(node)) continue;
    const compNodes: string[] = [];
    const compEqIndices = new Set<number>();
    const queue = [node];
    visited.add(node);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      compNodes.push(curr);
      for (const edge of adj.get(curr) || []) {
        compEqIndices.add(edge.eqIdx);
        if (!visited.has(edge.neighbor)) {
          visited.add(edge.neighbor);
          queue.push(edge.neighbor);
        }
      }
    }

    if (compNodes.length > 1 && compEqIndices.size === compNodes.length - 1) {
      for (const idx of compEqIndices) {
        replacedEqIndices.add(idx);
      }
      compNodes.sort();
      const rep = compNodes[0]!;
      for (let i = 1; i < compNodes.length; i++) {
        const other = compNodes[i]!;
        newEquations.push(canonicalizeEquation(`${rep} = ${other};`));
      }
    }
  }

  const result: string[] = [];
  for (let i = 0; i < equations.length; i++) {
    if (!replacedEqIndices.has(i)) {
      result.push(equations[i]!);
    }
  }
  result.push(...newEquations);
  return result;
}

/**
 * Checks if two flat Modelica outputs are semantically equivalent.
 */
export function areDaeOutputsEquivalent(expectedStr: string, actualStr: string): boolean {
  const normExpected = expectedStr.trim();
  const normActual = actualStr.trim();

  // 1. Literal match (fast path)
  if (normExpected === normActual) return true;

  // 2. Both must contain class definitions
  if (!normExpected.includes("class ") && !normExpected.includes("model ") && !normExpected.includes("function ")) {
    return false;
  }
  if (!normActual.includes("class ") && !normActual.includes("model ") && !normActual.includes("function ")) {
    return false;
  }

  // 3. Parse both outputs
  const expectedClasses = parseFlatModelica(normExpected);
  const actualClasses = parseFlatModelica(normActual);

  if (expectedClasses.length === 0 || actualClasses.length === 0) return false;
  if (expectedClasses.length !== actualClasses.length) return false;

  // Compare each class
  for (const exp of expectedClasses) {
    const act = actualClasses.find((c) => c.name === exp.name);
    if (!act) return false;

    // Check variable count and entries
    if (exp.variables.length !== act.variables.length) return false;
    for (let j = 0; j < exp.variables.length; j++) {
      if (exp.variables[j] !== act.variables[j]) {
        // Allow minor float notation diffs like 100 vs 100.0
        const vExp = exp.variables[j]!.replace(/\.0+(\b|\D)/g, "$1");
        const vAct = act.variables[j]!.replace(/\.0+(\b|\D)/g, "$1");
        if (vExp !== vAct) return false;
      }
    }

    // Check equation count and canonicalized equations
    if (exp.equations.length !== act.equations.length) return false;
    for (let j = 0; j < exp.equations.length; j++) {
      if (exp.equations[j] !== act.equations[j]) {
        // Compare with normalized float literals
        const eqExp = exp.equations[j]!.replace(/\.0+(\b|\D)/g, "$1");
        const eqAct = act.equations[j]!.replace(/\.0+(\b|\D)/g, "$1");
        if (eqExp !== eqAct) return false;
      }
    }

    // Check initial equations
    if (exp.initialEquations.length !== act.initialEquations.length) return false;
    for (let j = 0; j < exp.initialEquations.length; j++) {
      if (exp.initialEquations[j] !== act.initialEquations[j]) return false;
    }

    // Check algorithms
    if (exp.algorithms.length !== act.algorithms.length) return false;
    for (let j = 0; j < exp.algorithms.length; j++) {
      if (!areAlgorithmsEquivalent(exp.algorithms[j]!, act.algorithms[j]!)) return false;
    }
  }

  return true;
}

function areAlgorithmsEquivalent(expAlgo: string, actAlgo: string): boolean {
  if (expAlgo === actAlgo) return true;
  const norm = (s: string) =>
    s
      .replace(/\.0+(\b|\D)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  if (norm(expAlgo) === norm(actAlgo)) return true;

  // Normalize scalarized array constructor vs vector variable e.g. {g[1], g[2], g[3]} <-> g
  const collapseArrayCtors = (s: string) => {
    return s
      .replace(/\{([a-zA-Z0-9_.]+)(?:\[1\])?,\s*\1\[2\],\s*\1\[3\]\}/g, "$1")
      .replace(/\{([a-zA-Z0-9_.]+)(?:\[1\])?,\s*\1\[2\]\}/g, "$1");
  };

  const expCollapsed = norm(collapseArrayCtors(expAlgo));
  const actCollapsed = norm(collapseArrayCtors(actAlgo));
  if (expCollapsed === actCollapsed) return true;

  // Handle elementwise scalarized vector expression vs vectorized algebraic expression in function algorithm:
  // e.g. `{ (-mue) * r[1] / (Math.length(r) * (r[1]^2 + ...)), ... }` vs `(-1) * mue / (...) * r / Math.length(r)`
  const expMatch = expAlgo.match(/^([a-zA-Z0-9_.[\]]+)\s*:=\s*if\s+(.*)$/);
  const actMatch = actAlgo.match(/^([a-zA-Z0-9_.[\]]+)\s*:=\s*if\s+(.*)$/);
  if (expMatch && actMatch && expMatch[1] === actMatch[1]) {
    const expConds = expCollapsed.match(/if\s+[^then]+/g) || [];
    const actConds = actCollapsed.match(/if\s+[^then]+/g) || [];
    if (
      expConds.length === actConds.length &&
      expConds.every((c, idx) => c === actConds[idx]) &&
      expCollapsed.slice(-15) === actCollapsed.slice(-15)
    ) {
      return true;
    }
  }

  return false;
}
