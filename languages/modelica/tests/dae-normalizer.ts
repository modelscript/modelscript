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

function collapseArrayCtors(s: string): string {
  return s
    .replace(/\{([a-zA-Z0-9_.]+)(?:\[1\])?,\s*\1\[2\],\s*\1\[3\]\}/g, "$1")
    .replace(/\{([a-zA-Z0-9_.]+)(?:\[1\])?,\s*\1\[2\]\}/g, "$1");
}

function normalizeReciprocalAndProducts(s: string): string {
  return (
    collapseArrayCtors(s)
      .replace(/\.0+(\b|\D)/g, "$1")
      // General decimal reciprocal multiplier: c * 1 / (expr) or c * 1 / expr or c * expr where 1/c is an integer >= 2
      .replace(/\b(0\.\d+)\s*\*\s*1\s*\/\s*(\([^()]+\)|[a-zA-Z0-9_.[\]]+)/g, (match, decStr: string, denom: string) => {
        const val = Number(decStr);
        const inv = val > 0 ? Math.round(1 / val) : 0;
        if (inv >= 2 && Math.abs(1 / val - inv) < 1e-12) {
          return `1 / ${denom} / ${inv}`;
        }
        return match;
      })
      .replace(/\b(0\.\d+)\s*\*\s*([a-zA-Z0-9_.[\]]+)/g, (match, decStr: string, factor: string) => {
        const val = Number(decStr);
        const inv = val > 0 ? Math.round(1 / val) : 0;
        if (inv >= 2 && Math.abs(1 / val - inv) < 1e-12) {
          return `${factor} / ${inv}`;
        }
        return match;
      })
      // + (-num) * X -> - num * X
      .replace(/\+\s*\(-([0-9.]+)\)\s*\*\s*/g, "- $1 * ")
      // elseif noEvent(a < (-b)) -> elseif noEvent(a < -b)
      .replace(/<\s*\(-([a-zA-Z_][a-zA-Z0-9_.[\]]*)\)/g, "< -$1")
  );
}

function compareFactors(a: string, b: string): number {
  const aIsNum = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(a);
  const bIsNum = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(b);
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalizeMultiplicativeChain(s: string): string {
  // Do not split if expression has top-level additive, relational, conditional, or logical operators
  let depth = 0;
  let inQuotes = false;
  const ops: { op: "*" | "/"; idx: number }[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0) {
      if (ch === "*" || ch === "/") {
        ops.push({ op: ch, idx: i });
      } else if (ch === "+" || ch === "<" || ch === ">" || ch === "=" || ch === ":" || ch === ";") {
        return s;
      } else if (ch === "-" && i > 0) {
        const prev = s.slice(0, i).trimEnd();
        const prevCh = prev[prev.length - 1];
        if (prevCh && prevCh !== "*" && prevCh !== "/" && prevCh !== "^" && prevCh !== "e" && prevCh !== "E") {
          return s;
        }
      }
    }
  }
  if (ops.length === 0) return s;
  if (/^(?:if|for|when)\b|\b(?:then|else|elseif|and|or)\b/.test(s)) return s;

  const numerators: string[] = [];
  const denominators: string[] = [];
  let lastIdx = 0;
  let lastOp: "*" | "/" = "*";
  for (const { op, idx } of ops) {
    const part = s.slice(lastIdx, idx).trim();
    if (!part) return s;
    if (lastOp === "*") numerators.push(part);
    else denominators.push(part);
    lastIdx = idx + 1;
    lastOp = op;
  }
  const tail = s.slice(lastIdx).trim();
  if (!tail) return s;
  if (lastOp === "*") numerators.push(tail);
  else denominators.push(tail);

  const canonPart = (p: string): string => {
    const trimmed = p.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      const inner = canonicalizeExpression(trimmed.slice(1, -1));
      if (inner.includes(" * ") || inner.includes(" / ") || inner.includes(" + ") || inner.includes(" - ")) {
        return `(${inner})`;
      }
      return inner;
    }
    return trimmed;
  };

  const canonNums = numerators.map(canonPart);
  const canonDens = denominators.map(canonPart);
  canonNums.sort(compareFactors);

  const numFiltered = canonNums.length > 1 ? canonNums.filter((f) => f !== "1") : canonNums;
  const numPart = (numFiltered.length > 0 ? numFiltered : ["1"]).join(" * ");
  if (canonDens.length === 0) return numPart;
  return `${numPart} / ${canonDens.join(" / ")}`;
}

/**
 * Normalizes an expression with respect to commutative operations.
 */
function canonicalizeExpression(expr: string): string {
  let s = normalizeReciprocalAndProducts(expr.trim());
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

  // Normalize `x ^ 2` or `x ^ 2.0` (including array subscripts) to `x * x`
  s = s.replace(/\b([a-zA-Z_][a-zA-Z0-9_.[\],]*)\s*\^\s*2(?:\.0+)?\b/g, "$1 * $1");

  return canonicalizeMultiplicativeChain(s);
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
    return canonicalizeExpression(s);
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
  if (rhs.includes("+") || rhs.includes("-")) {
    const rhsTerms = parseAdditiveTerms(rhs);
    if (rhsTerms.length > 1) {
      rhsTerms.sort((a, b) => a.expr.localeCompare(b.expr));
      const parts: string[] = [];
      for (let i = 0; i < rhsTerms.length; i++) {
        const t = rhsTerms[i]!;
        if (i === 0) {
          parts.push(t.sign === -1 ? `-${t.expr}` : t.expr);
        } else {
          parts.push(t.sign === -1 ? `- ${t.expr}` : `+ ${t.expr}`);
        }
      }
      rhs = parts.join(" ");
    }
  }

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
  let s = expr
    .trim()
    .replace(/\s*"[^"]*"\s*$/, "")
    .trim()
    .replace(/-\s*\((\([^()]+\)\s*\*\s*[^+]+\+\s*\([^()]+\)\s*\*\s*[^()]+)\)/g, "- $1");
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
  if (t.startsWith("(-") && t.includes(")")) {
    const closeIdx = t.indexOf(")");
    const inner = t.slice(2, closeIdx).trim();
    if (!inner.includes("(") && !inner.includes("+") && !inner.includes("-")) {
      sign = (sign * -1) as 1 | -1;
      t = `${inner}${t.slice(closeIdx + 1)}`;
    }
  }
  return { sign, expr: t };
}

function normalizeVariableDeclaration(line: string): string {
  return normalizeReciprocalAndProducts(line.replace(/\s+/g, " "))
    .replace(/,\s*/g, ", ")
    .replace(/\s*\(start\s*=\s*([0-9.+-]+)\)\s*=\s*\1\b/g, " = $1")
    .replace(/\b(\d+(?:\.\d+)?)[eE]([+-]?\d+)\b/g, (m, mant, expStr) => {
      const exp = parseInt(expStr, 10);
      if (exp >= 0 && exp <= 8) {
        const val = Number(m);
        if (!isNaN(val) && Number.isFinite(val)) return String(val);
      }
      if (mant && mant.length >= 16) {
        const val = Number(m);
        if (!isNaN(val) && Number.isFinite(val)) return val.toExponential(13).replace(/e\+/g, "e");
      }
      return m;
    });
}

export interface DaeComparisonOptions {
  sortVariables?: boolean;
  sortEquations?: boolean;
}

/**
 * Parses flat Modelica text into structured classes.
 */
export function parseFlatModelica(text: string, options?: DaeComparisonOptions): ParsedClass[] {
  const sortVariables = options?.sortVariables ?? true;
  const sortEquations = options?.sortEquations ?? true;
  const classes: ParsedClass[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));

  let currentClass: ParsedClass | null = null;
  let currentSection: "vars" | "equations" | "initialEquations" | "algorithms" | "initialAlgorithms" = "vars";

  for (const line of lines) {
    const classMatch = line.match(/^(class|model|record|function|package|type|block|connector)\s+([^\s";]+)/);
    const beforeQuote = line.split('"')[0] ?? line;
    if (classMatch && !beforeQuote.includes("=")) {
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
      const normVar = normalizeVariableDeclaration(line);
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

  // Sort each section when order-independent comparison is enabled
  for (const c of classes) {
    if (sortVariables) {
      c.variables.sort();
    }
    c.equations = canonicalizeEqualityCliques(c.equations);
    if (sortEquations) {
      c.equations.sort();
    }
    c.initialEquations = canonicalizeEqualityCliques(c.initialEquations);
    if (sortEquations) {
      c.initialEquations.sort();
    }
  }

  return classes;
}

function canonicalizeEqualityCliques(equations: string[]): string[] {
  const varEqRegex = /^([a-zA-Z_][a-zA-Z0-9_.[\],]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_.[\],]*);?$/;
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
export function areDaeOutputsEquivalent(
  expectedStr: string,
  actualStr: string,
  options?: DaeComparisonOptions,
): boolean {
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
  const expectedClasses = parseFlatModelica(normExpected, options);
  const actualClasses = parseFlatModelica(normActual, options);

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
        const vExp = exp.variables[j]!.replace(/\.0+(\b|\D)/g, "$1").replace(/,\s*/g, ", ");
        const vAct = act.variables[j]!.replace(/\.0+(\b|\D)/g, "$1").replace(/,\s*/g, ", ");
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

function splitTopLevelComma(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function canonicalizeAdditiveSignExpression(expr: string): string {
  let s = canonicalizeExpression(expr.trim());
  s = stripOuterParens(s);
  // Rewrite -(a - b) -> b - a and (-a) * b + c * d into canonical signed additive terms
  s = s.replace(/^-\s*\(\s*([^()]+?)\s*-\s*([^()]+?)\s*\)$/, "$2 - $1");
  // Split top-level + and - into signed terms
  const terms: { sign: "+" | "-"; term: string }[] = [];
  let depth = 0;
  let start = 0;
  let currentSign: "+" | "-" = "+";
  const trimmed = s.trim();
  let idx = 0;
  if (trimmed.startsWith("-")) {
    currentSign = "-";
    idx = 1;
    start = 1;
  } else if (trimmed.startsWith("+")) {
    idx = 1;
    start = 1;
  }
  for (; idx < trimmed.length; idx++) {
    const ch = trimmed[idx];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if ((ch === "+" || ch === "-") && depth === 0) {
      const prev = trimmed.slice(0, idx).trimEnd();
      const prevCh = prev[prev.length - 1];
      if (prevCh && prevCh !== "*" && prevCh !== "/" && prevCh !== "^" && prevCh !== "e" && prevCh !== "E") {
        const raw = trimmed.slice(start, idx).trim();
        if (raw) terms.push({ sign: currentSign, term: raw });
        currentSign = ch;
        start = idx + 1;
      }
    }
  }
  const lastRaw = trimmed.slice(start).trim();
  if (lastRaw) terms.push({ sign: currentSign, term: lastRaw });
  if (terms.length === 0) return s;

  const normalizedTerms = terms.map(({ sign, term }) => {
    let t = stripOuterParens(term);
    let effectiveSign = sign;
    const negPrefix = t.match(/^-\s*(.+)$/) || t.match(/^\(-\s*([^()]+)\)\s*\*\s*(.+)$/);
    if (t.startsWith("(-") && t.includes(") * ")) {
      const m = t.match(/^\(-([^()]+)\)\s*\*\s*(.+)$/);
      if (m && m[1] && m[2]) {
        effectiveSign = effectiveSign === "+" ? "-" : "+";
        t = `${m[1].trim()} * ${m[2].trim()}`;
      }
    } else if (negPrefix && negPrefix[1] && !negPrefix[2]) {
      effectiveSign = effectiveSign === "+" ? "-" : "+";
      t = stripOuterParens(negPrefix[1].trim());
    }
    t = canonicalizeExpression(t);
    return `${effectiveSign}${t}`;
  });
  normalizedTerms.sort();
  return normalizedTerms.join(" ");
}

export function areAlgorithmsEquivalent(expAlgo: string, actAlgo: string): boolean {
  if (expAlgo === actAlgo) return true;
  const norm = (s: string) =>
    s
      .replace(/\.0+(\b|\D)/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/sqrt\(sqrt\(([^()]+)\)\)/g, "($1) ^ 0.25")
      .replace(/(\b[a-zA-Z_][a-zA-Z0-9_.[\],]*)\s*\^\s*2\b/g, "$1 * $1")
      .replace(/(\b[a-zA-Z_][a-zA-Z0-9_.[\],]*|\(-[a-zA-Z_][a-zA-Z0-9_.[\],]*\))\s*\*\s*2\b/g, "2 * $1")
      .replace(/\bnoEvent\(\s*if\s+(.+?)\s+then\s+(.+)\)(?=\s*\)\s*;$)/g, "if noEvent($1) then $2")
      .replace(/\+\s*\(-([^()]+)\)/g, "- $1")
      .replace(/-\s*\(-([^()]+)\)/g, "+ $1")
      .replace(/\(\s*0\s*-\s*([^()]+)\)/g, "(-($1))")
      .replace(
        /\b([a-zA-Z_][a-zA-Z0-9_.[\],]*)\s*\*\s*([a-zA-Z_][a-zA-Z0-9_.[\],]*)\s*\+\s*\(-\(\1\s*\*\s*\2\)\)\s*\*\s*cos\(angle\)/g,
        "($1 - $1 * cos(angle)) * $2",
      )
      .replace(
        /\(-([a-zA-Z_][a-zA-Z0-9_.[\],]*)\)\s*\*\s*([a-zA-Z_][a-zA-Z0-9_.[\],]*)/g,
        (_m, a: string, b: string) => (a < b ? `(-${a}) * ${b}` : `(-${b}) * ${a}`),
      )
      .trim();
  if (norm(expAlgo) === norm(actAlgo)) return true;

  const expCollapsed = norm(collapseArrayCtors(expAlgo));
  const actCollapsed = norm(collapseArrayCtors(actAlgo));
  if (expCollapsed === actCollapsed) return true;

  // Compare atan2(y, x) expressions structurally by canonicalizing each argument's signed additive & multiplicative terms
  const atan2Re = /^(.+?)\s*:=\s*atan2\((.+)\)\s*;?$/;
  const expAtan = expCollapsed.match(atan2Re);
  const actAtan = actCollapsed.match(atan2Re);
  if (expAtan && actAtan && expAtan[1]!.trim() === actAtan[1]!.trim()) {
    const expArgs = splitTopLevelComma(expAtan[2]!);
    const actArgs = splitTopLevelComma(actAtan[2]!);
    if (expArgs.length === 2 && actArgs.length === 2) {
      const expY = canonicalizeAdditiveSignExpression(expArgs[0]!);
      const actY = canonicalizeAdditiveSignExpression(actArgs[0]!);
      const expX = canonicalizeAdditiveSignExpression(expArgs[1]!);
      const actX = canonicalizeAdditiveSignExpression(actArgs[1]!);
      if (expY === actY && expX === actX) {
        return true;
      }
    }
  }

  // Handle elementwise scalarized vector expression vs vectorized algebraic expression in function algorithm:
  // e.g. `{ (-mue) * r[1] / (Math.length(r) * (r[1]^2 + ...)), ... }` vs `(-1) * mue / (...) * r / Math.length(r)`
  const expMatch = expCollapsed.match(/^([a-zA-Z0-9_.[\]]+)\s*:=\s*if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+);?$/);
  const actMatch = actCollapsed.match(/^([a-zA-Z0-9_.[\]]+)\s*:=\s*if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+);?$/);
  if (
    expMatch &&
    actMatch &&
    expMatch[1] === actMatch[1] &&
    expMatch[2] === actMatch[2] &&
    expMatch[4] === actMatch[4]
  ) {
    const expThen = expMatch[3]!.trim();
    const actThen = actMatch[3]!.trim();
    if (expThen === actThen) return true;
    const isCtorExp = expThen.startsWith("{") && expThen.endsWith("}");
    const isCtorAct = actThen.startsWith("{") && actThen.endsWith("}");
    if (isCtorExp !== isCtorAct) {
      const ctorSide = isCtorExp ? expThen : actThen;
      const vecSide = isCtorExp ? actThen : expThen;
      const elements = splitTopLevelComma(ctorSide.slice(1, -1));
      if (elements.length >= 2) {
        // Identify vector variable names that are indexed 1..N across the constructor elements
        const indexedVars = new Set<string>();
        const idxMatches = ctorSide.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_.]*)\[\d+\]/g);
        for (const m of idxMatches) {
          if (m[1]) indexedVars.add(m[1]);
        }
        let allComponentsMatch = indexedVars.size > 0;
        for (let i = 0; i < elements.length && allComponentsMatch; i++) {
          const idx1 = i + 1;
          let projectedVec = vecSide;
          for (const v of indexedVars) {
            // Project unindexed occurrences of `v` that are not function arguments like `length(v)`
            const vEsc = v.replace(/\./g, "\\.");
            projectedVec = projectedVec.replace(
              new RegExp(`\\b${vEsc}\\b(?!\\s*[\\[\\(])(?<!\\([\\s]*)(?!\\s*\\))`, "g"),
              `${v}[${idx1}]`,
            );
          }
          const canonElem = canonicalizeExpression(norm(elements[i]!)).replace(/\(-1\)\s*\*\s*/g, "-");
          const canonProj = canonicalizeExpression(norm(projectedVec)).replace(/\(-1\)\s*\*\s*/g, "-");
          if (canonElem !== canonProj) {
            allComponentsMatch = false;
          }
        }
        if (allComponentsMatch) return true;
      }
    }
  }

  return false;
}
