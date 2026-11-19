// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bi-directional CAD Parameter Inversion Engine.
 *
 * Propagates optimized 1D Modelica system simulation variables back into
 * procedural MCAD AST / source code, regenerating production STEP CAD models AOT.
 */

export interface ParameterInversionUpdate {
  parameterName: string;
  previousValue: number;
  newValue: number;
  unit?: string | undefined;
  sourceVariable?: string | undefined; // e.g., "chassis.arm_length"
}

export interface InversionResult {
  isSuccess: boolean;
  updatedSource: string;
  appliedUpdates: ParameterInversionUpdate[];
  regeneratedStep?: string | undefined;
}

export interface ParameterConstraintRule {
  name: string;
  evaluate: (params: Record<string, number>) => boolean;
  description?: string | undefined;
}

export interface SafeRegionGuard {
  /** Explicit numeric bounding boxes per parameter */
  parameterBounds?: Record<string, { min?: number | undefined; max?: number | undefined }> | undefined;
  /** Multidisciplinary linear or non-linear constraint rules (e.g. stress, buckling, clearance) */
  constraints?: ParameterConstraintRule[] | undefined;
  /** Optional custom validator predicate */
  customValidator?: ((params: Record<string, number>) => { isSafe: boolean; violations: string[] }) | undefined;
}

export interface CertifiedInversionResult extends InversionResult {
  isCertifiedSafe: boolean;
  violations: string[];
  summary: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces `//...`, `/*...*\/`, `"..."`, and `'...'` spans with spaces while preserving
 * string length and newlines so character offsets remain 1:1 with the original source.
 */
function maskCommentsAndStrings(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && src[i] !== "\n") {
        out[i++] = " ";
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i] = " ";
        if (i + 1 < n) out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i++] = " ";
      while (i < n) {
        if (src[i] === "\\" && i + 1 < n) {
          out[i] = " ";
          if (src[i + 1] !== "\n") out[i + 1] = " ";
          i += 2;
          continue;
        }
        const cur = src[i]!;
        if (cur !== "\n") out[i] = " ";
        i++;
        if (cur === quote) break;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

export class ParameterInversionEngine {
  /**
   * Extracts scalar numeric parameters declared in MCAD source code (ignoring comments and strings).
   */
  static extractParameters(mcadSource: string): Record<string, number> {
    const masked = maskCommentsAndStrings(mcadSource);
    const params: Record<string, number> = {};
    const assignRegex =
      /(?:^|[^\w$])(?:(?:const|let|var)\s+)?([A-Za-z_$]\w*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;/g;
    let m: RegExpExecArray | null;
    while ((m = assignRegex.exec(masked)) !== null) {
      params[m[1]!] = parseFloat(m[2]!);
    }
    const propRegex = /(?:^|[^\w$])([A-Za-z_$]\w*)\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*[,;}]/g;
    while ((m = propRegex.exec(masked)) !== null) {
      const key = m[1]!;
      if (!(key in params)) {
        params[key] = parseFloat(m[2]!);
      }
    }
    return params;
  }

  /**
   * Updates named scalar parameters in procedural MCAD source code while leaving comments and strings untouched.
   * Matches definitions like:
   *   const ARM_LENGTH = 7;
   *   let BODY_WIDTH = 10.0;
   *   ARM_HEIGHT = 1;
   */
  static patchMcadSource(
    mcadSource: string,
    updates: Record<string, number>,
  ): { updatedSource: string; appliedUpdates: ParameterInversionUpdate[] } {
    let result = mcadSource;
    const appliedUpdates: ParameterInversionUpdate[] = [];
    const numPattern = "([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)";

    for (const [paramName, newVal] of Object.entries(updates)) {
      const masked = maskCommentsAndStrings(result);
      const escName = escapeRegExp(paramName);
      const assignRe = new RegExp(`(^|[^\\w$])((?:const|let|var)\\s+)?${escName}(\\s*=\\s*)${numPattern}(\\s*;)`, "g");
      const patches: Array<{ start: number; end: number; prev: number; replacement: string }> = [];

      let m: RegExpExecArray | null;
      while ((m = assignRe.exec(masked)) !== null) {
        const leading = m[1] ?? "";
        const kw = m[2] ?? "";
        const eq = m[3] ?? "";
        const oldValStr = m[4]!;
        const semi = m[5] ?? "";
        const oldVal = parseFloat(oldValStr);
        patches.push({
          start: m.index + leading.length,
          end: m.index + m[0].length,
          prev: oldVal,
          replacement: `${kw}${paramName}${eq}${newVal}${semi}`,
        });
      }

      if (patches.length === 0) {
        const propRe = new RegExp(`(^|[^\\w$])${escName}(\\s*:\\s*)${numPattern}(\\s*[,;}])`, "g");
        while ((m = propRe.exec(masked)) !== null) {
          const leading = m[1] ?? "";
          const colon = m[2] ?? "";
          const oldValStr = m[3]!;
          const tail = m[4] ?? "";
          const oldVal = parseFloat(oldValStr);
          patches.push({
            start: m.index + leading.length,
            end: m.index + m[0].length,
            prev: oldVal,
            replacement: `${paramName}${colon}${newVal}${tail}`,
          });
        }
      }

      for (let i = patches.length - 1; i >= 0; i--) {
        const p = patches[i]!;
        result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
        appliedUpdates.unshift({
          parameterName: paramName,
          previousValue: p.prev,
          newValue: newVal,
        });
      }
    }

    return { updatedSource: result, appliedUpdates };
  }

  /**
   * Patches MCAD source only if the new parameters strictly reside within the certified safe region P_safe.
   * Rejects the update and keeps the original source untouched if any multidisciplinary constraint is violated.
   */
  static patchMcadSourceCertified(
    mcadSource: string,
    updates: Record<string, number>,
    guard: SafeRegionGuard,
  ): CertifiedInversionResult {
    const violations: string[] = [];
    const effectiveParams: Record<string, number> = {
      ...this.extractParameters(mcadSource),
      ...updates,
    };

    // 1. Check explicit parameter bounds
    if (guard.parameterBounds) {
      for (const [param, val] of Object.entries(effectiveParams)) {
        const bound = guard.parameterBounds[param];
        if (bound) {
          if (bound.min !== undefined && val < bound.min) {
            violations.push(`Parameter '${param}' value ${val} violates minimum allowable bound ${bound.min}.`);
          }
          if (bound.max !== undefined && val > bound.max) {
            violations.push(`Parameter '${param}' value ${val} violates maximum allowable bound ${bound.max}.`);
          }
        }
      }
    }

    // 2. Check multidisciplinary constraint rules
    if (guard.constraints) {
      for (const rule of guard.constraints) {
        try {
          const isSatisfied = rule.evaluate(effectiveParams);
          if (!isSatisfied) {
            violations.push(
              rule.description || `Multidisciplinary constraint '${rule.name}' violated by candidate parameter set.`,
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          violations.push(`Constraint '${rule.name}' evaluation error: ${message}`);
        }
      }
    }

    // 3. Check custom validator
    if (guard.customValidator) {
      const customRes = guard.customValidator(effectiveParams);
      if (!customRes.isSafe) {
        violations.push(...customRes.violations);
      }
    }

    // If violated, reject update completely and do NOT patch source code
    if (violations.length > 0) {
      return {
        isSuccess: false,
        isCertifiedSafe: false,
        updatedSource: mcadSource,
        appliedUpdates: [],
        violations,
        summary: `Certified parameter inversion REJECTED: ${violations.length} constraint violation(s) detected.`,
      };
    }

    // Parameters are certified safe, proceed with source patch
    const patchResult = this.patchMcadSource(mcadSource, updates);
    return {
      isSuccess: true,
      isCertifiedSafe: true,
      updatedSource: patchResult.updatedSource,
      appliedUpdates: patchResult.appliedUpdates,
      violations: [],
      summary: `Certified parameter inversion SUCCESSFUL: All ${patchResult.appliedUpdates.length} parameter update(s) mathematically proven safe.`,
    };
  }

  /**
   * Inverts target mass into target dimension for a prismatic part given density.
   *   m = rho * (L * w * h)  =>  L = m / (rho * w * h)
   */
  static solveLengthForMass(targetMassKg: number, densityKgM3: number, widthM: number, heightM: number): number {
    const crossSection = widthM * heightM;
    if (crossSection <= 0 || densityKgM3 <= 0) return 0;
    return targetMassKg / (densityKgM3 * crossSection);
  }

  /**
   * Scales a bounding box isotropically to match a target volume or mass.
   */
  static scaleDimensionsForMass(
    currentDimensions: [number, number, number],
    currentMass: number,
    targetMass: number,
  ): [number, number, number] {
    if (currentMass <= 0 || targetMass <= 0) return currentDimensions;
    const scaleFactor = Math.cbrt(targetMass / currentMass);
    return [currentDimensions[0] * scaleFactor, currentDimensions[1] * scaleFactor, currentDimensions[2] * scaleFactor];
  }

  /**
   * Analytically inverts a single-variable affine scalar expression (`a * x + b = targetValue`),
   * supporting `+`, `-`, `*`, `/`, unary negation `-x`, fractions `x / k`, and parenthesized expressions.
   * Multi-variable expressions (e.g. `w1 + w2`) and non-affine expressions (e.g. `x * x`, `sin(x)`)
   * are explicitly flagged as `locked: true` with an actionable reason instead of mispatching.
   */
  static invertAffineExpression(exprText: string, targetValue: number): AffineInversionResult {
    return invertAffineExpression(exprText, targetValue);
  }
}

export interface AffineInversionResult {
  ok: boolean;
  locked: boolean;
  kind: "literal" | "single_var_affine" | "multi_variable" | "non_affine" | "degenerate_variable" | "invalid";
  variables: string[];
  variableName?: string | undefined;
  solvedValue?: number | undefined;
  slope?: number | undefined;
  intercept?: number | undefined;
  reason?: string | undefined;
}

type ExprToken =
  | { kind: "num"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

function tokenizeAffineExpr(input: string): ExprToken[] | null {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "." && i + 1 < input.length && input[i + 1]! >= "0" && input[i + 1]! <= "9")
    ) {
      const rest = input.slice(i);
      const numMatch = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!numMatch) return null;
      const val = Number(numMatch[0]);
      if (!Number.isFinite(val)) return null;
      tokens.push({ kind: "num", value: val });
      i += numMatch[0].length;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
      let end = i + 1;
      while (end < input.length && /[a-zA-Z0-9_$]/.test(input[end]!)) end++;
      tokens.push({ kind: "ident", value: input.slice(i, end) });
      i = end;
      continue;
    }
    return null;
  }
  return tokens;
}

interface LinearForm {
  /** Coefficient of the single free variable (0 when constant). */
  a: number;
  /** Constant offset `b` in `a * x + b`. */
  b: number;
  /** True when a non-affine operation was encountered. */
  nonAffine: boolean;
}

/**
 * Analytically solves single-variable affine arithmetic expressions (`a * x + b = targetValue`),
 * explicitly locking multi-variable or non-affine compound expressions.
 */
export function invertAffineExpression(exprText: string, targetValue: number): AffineInversionResult {
  const trimmed = exprText.trim();
  if (!trimmed || !Number.isFinite(targetValue)) {
    return {
      ok: false,
      locked: true,
      kind: "invalid",
      variables: [],
      reason: `Cannot invert expression '${exprText}'.`,
    };
  }

  const tokens = tokenizeAffineExpr(trimmed);
  if (!tokens || tokens.length === 0) {
    // Extract identifiers heuristically for clearer lock diagnostics on complex expressions
    const idents = Array.from(new Set(trimmed.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? []));
    if (idents.length > 1) {
      return {
        ok: false,
        locked: true,
        kind: "multi_variable",
        variables: idents,
        reason: `Locked: expression '${trimmed}' depends on multiple variables (${idents.join(", ")}). Edit in code instead.`,
      };
    }
    return {
      ok: false,
      locked: true,
      kind: "non_affine",
      variables: idents,
      reason: `Locked: expression '${trimmed}' is non-affine and cannot be analytically inverted.`,
    };
  }

  // Reject function calls (`ident(...)`) as non-affine, while still collecting variable names
  const variables: string[] = [];
  const varSet = new Set<string>();
  let hasCall = false;
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx]!;
    if (tok.kind === "ident") {
      const next = tokens[idx + 1];
      if (next?.kind === "lparen") {
        hasCall = true;
      } else if (!varSet.has(tok.value)) {
        varSet.add(tok.value);
        variables.push(tok.value);
      }
    }
  }

  if (variables.length > 1) {
    return {
      ok: false,
      locked: true,
      kind: "multi_variable",
      variables,
      reason: `Locked: expression '${trimmed}' depends on multiple variables (${variables.join(", ")}). Edit in code instead.`,
    };
  }

  if (hasCall) {
    return {
      ok: false,
      locked: true,
      kind: "non_affine",
      variables,
      reason: `Locked: expression '${trimmed}' contains function calls and cannot be analytically inverted.`,
    };
  }

  let cursor = 0;
  const peek = (): ExprToken | undefined => tokens[cursor];
  const consume = (): ExprToken | undefined => tokens[cursor++];

  const parseExpr = (): LinearForm | null => {
    let left = parseTerm();
    if (!left) return null;
    while (true) {
      const op = peek();
      if (op?.kind !== "op" || (op.value !== "+" && op.value !== "-")) break;
      consume();
      const right = parseTerm();
      if (!right) return null;
      if (left.nonAffine || right.nonAffine) {
        left = { a: 0, b: 0, nonAffine: true };
      } else if (op.value === "+") {
        left = { a: left.a + right.a, b: left.b + right.b, nonAffine: false };
      } else {
        left = { a: left.a - right.a, b: left.b - right.b, nonAffine: false };
      }
    }
    return left;
  };

  const parseTerm = (): LinearForm | null => {
    let left = parseUnary();
    if (!left) return null;
    while (true) {
      const op = peek();
      if (op?.kind !== "op" || (op.value !== "*" && op.value !== "/")) break;
      consume();
      const right = parseUnary();
      if (!right) return null;
      if (left.nonAffine || right.nonAffine) {
        left = { a: 0, b: 0, nonAffine: true };
        continue;
      }
      if (op.value === "*") {
        if (Math.abs(left.a) <= 1e-12) {
          left = { a: left.b * right.a, b: left.b * right.b, nonAffine: false };
        } else if (Math.abs(right.a) <= 1e-12) {
          left = { a: right.b * left.a, b: right.b * left.b, nonAffine: false };
        } else {
          left = { a: 0, b: 0, nonAffine: true };
        }
      } else {
        // Division: linear only when divisor is non-zero constant (right.a == 0)
        if (Math.abs(right.a) <= 1e-12 && Math.abs(right.b) > 1e-12) {
          left = { a: left.a / right.b, b: left.b / right.b, nonAffine: false };
        } else {
          left = { a: 0, b: 0, nonAffine: true };
        }
      }
    }
    return left;
  };

  const parseUnary = (): LinearForm | null => {
    const tok = peek();
    if (tok?.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      consume();
      const inner = parseUnary();
      if (!inner) return null;
      if (inner.nonAffine) return inner;
      return tok.value === "-" ? { a: -inner.a, b: -inner.b, nonAffine: false } : inner;
    }
    return parsePrimary();
  };

  const parsePrimary = (): LinearForm | null => {
    const tok = consume();
    if (!tok) return null;
    if (tok.kind === "num") {
      return { a: 0, b: tok.value, nonAffine: false };
    }
    if (tok.kind === "ident") {
      return { a: 1, b: 0, nonAffine: false };
    }
    if (tok.kind === "lparen") {
      const inner = parseExpr();
      const close = consume();
      if (!inner || close?.kind !== "rparen") return null;
      return inner;
    }
    return null;
  };

  const parsed = parseExpr();
  if (!parsed || cursor !== tokens.length) {
    return {
      ok: false,
      locked: true,
      kind: "non_affine",
      variables,
      reason: `Locked: expression '${trimmed}' could not be parsed as an affine expression.`,
    };
  }

  if (parsed.nonAffine) {
    return {
      ok: false,
      locked: true,
      kind: "non_affine",
      variables,
      reason: `Locked: expression '${trimmed}' is non-affine (e.g. product or division by variable) and cannot be analytically inverted.`,
    };
  }

  if (variables.length === 0) {
    return {
      ok: true,
      locked: false,
      kind: "literal",
      variables: [],
      solvedValue: targetValue,
      slope: 0,
      intercept: parsed.b,
    };
  }

  const varName = variables[0]!;
  if (Math.abs(parsed.a) <= 1e-12) {
    return {
      ok: false,
      locked: true,
      kind: "degenerate_variable",
      variables,
      variableName: varName,
      reason: `Locked: variable '${varName}' cancels out in '${trimmed}' (zero slope).`,
    };
  }

  const solved = (targetValue - parsed.b) / parsed.a;
  if (!Number.isFinite(solved)) {
    return {
      ok: false,
      locked: true,
      kind: "degenerate_variable",
      variables,
      variableName: varName,
      reason: `Locked: inverting '${trimmed}' produced non-finite value.`,
    };
  }

  return {
    ok: true,
    locked: false,
    kind: "single_var_affine",
    variables,
    variableName: varName,
    solvedValue: Number(solved.toFixed(6)),
    slope: parsed.a,
    intercept: parsed.b,
  };
}
