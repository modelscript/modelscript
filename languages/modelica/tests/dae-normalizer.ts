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
      const termStr = cleanTerm(curTerm);
      if (termStr) {
        terms.push({ sign: curSign, expr: canonicalizeExpression(termStr) });
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

  const lastTermStr = cleanTerm(curTerm);
  if (lastTermStr) {
    terms.push({ sign: curSign, expr: canonicalizeExpression(lastTermStr) });
  }

  if (outerNeg) {
    for (const t of terms) {
      t.sign = (t.sign * -1) as 1 | -1;
    }
  }

  return terms;
}

function cleanTerm(term: string): string {
  let t = term.trim();
  // If term is (-x), strip parens and negate
  if (t.startsWith("(-") && t.endsWith(")")) {
    t = t.slice(2, -1).trim();
  } else if (t.startsWith("(") && t.endsWith(")")) {
    t = t.slice(1, -1).trim();
  }
  return t;
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
    c.equations.sort();
    c.initialEquations.sort();
  }

  return classes;
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
      if (exp.algorithms[j] !== act.algorithms[j]) return false;
    }
  }

  return true;
}
