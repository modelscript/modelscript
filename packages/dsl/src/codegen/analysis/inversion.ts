// SPDX-License-Identifier: AGPL-3.0-or-later

export interface InversionResult {
  isInvertible: boolean;
  invertedExpr?: string;
  sourceVar?: string;
  targetVar?: string;
  kind?: "affine" | "unit" | "prefix" | "nonlinear" | "custom";
}

/**
 * Automatically derives the inverse transformation of declarative constraint expressions.
 * Solves y = f(x) for x, enabling automatic backward TGG rule generation without manual specification.
 */
export function invertExpression(forwardExpr: string, targetVarName: string = "y"): InversionResult {
  const trimmed = forwardExpr.trim();

  // 1. Affine addition / subtraction: x + C or x - C
  const addMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*([+-])\s*([\d.]+)$/);
  if (addMatch) {
    const [, sourceVar, op, constVal] = addMatch;
    const invOp = op === "+" ? "-" : "+";
    return {
      isInvertible: true,
      kind: "affine",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName} ${invOp} ${constVal}`,
    };
  }

  // 1b. Commutative affine addition: C + x
  const commAddMatch = trimmed.match(/^([\d.]+)\s*\+\s*([a-zA-Z_]\w*)$/);
  if (commAddMatch) {
    const [, constVal, sourceVar] = commAddMatch;
    return {
      isInvertible: true,
      kind: "affine",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName} - ${constVal}`,
    };
  }

  // 2. Affine multiplication / division: x * C or x / C
  const mulMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*([*/])\s*([\d.]+)$/);
  if (mulMatch) {
    const [, sourceVar, op, constVal] = mulMatch;
    const invOp = op === "*" ? "/" : "*";
    return {
      isInvertible: true,
      kind: "affine",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName} ${invOp} ${constVal}`,
    };
  }

  // 2b. Commutative affine multiplication: C * x
  const commMulMatch = trimmed.match(/^([\d.]+)\s*\*\s*([a-zA-Z_]\w*)$/);
  if (commMulMatch) {
    const [, constVal, sourceVar] = commMulMatch;
    return {
      isInvertible: true,
      kind: "affine",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName} / ${constVal}`,
    };
  }

  // 3. String Prefix concatenation: "Prefix" + x
  const prefixMatch = trimmed.match(/^"([^"]+)"\s*\+\s*([a-zA-Z_]\w*)$/);
  if (prefixMatch) {
    const [, prefixStr, sourceVar] = prefixMatch;
    return {
      isInvertible: true,
      kind: "prefix",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName}.replace(/^${prefixStr}/, "")`,
    };
  }

  // 4. Standard Temperature Unit conversions
  if (trimmed.includes("- 273.15")) {
    const src = trimmed.replace("- 273.15", "").trim();
    return {
      isInvertible: true,
      kind: "unit",
      sourceVar: src,
      targetVar: targetVarName,
      invertedExpr: `${targetVarName} + 273.15`,
    };
  }

  // 5. Non-linear: Pure powers x ** k or x ^ k
  const powMatch = trimmed.match(/^([a-zA-Z_]\w*)\s*(?:\*\*|\^)\s*([\d.]+)$/);
  if (powMatch) {
    const [, sourceVar, expVal] = powMatch;
    const expNum = parseFloat(expVal);
    const invExp = expNum === 2 ? "Math.sqrt" : null;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: invExp ? `${invExp}(${targetVarName})` : `Math.pow(${targetVarName}, 1 / ${expVal})`,
    };
  }

  // 5b. Non-linear: Scaled quadratic C * x^2 (e.g., 0.5 * v^2 or R * i^2)
  const scaledQuadMatch1 = trimmed.match(/^([\d.]+)\s*\*\s*([a-zA-Z_]\w*)\s*(?:\*\*|\^)\s*2$/);
  if (scaledQuadMatch1) {
    const [, constVal, sourceVar] = scaledQuadMatch1;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `Math.sqrt(${targetVarName} / ${constVal})`,
    };
  }

  const scaledQuadMatch2 = trimmed.match(/^([a-zA-Z_]\w*)\s*(?:\*\*|\^)\s*2\s*\*\s*([\d.]+)$/);
  if (scaledQuadMatch2) {
    const [, sourceVar, constVal] = scaledQuadMatch2;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `Math.sqrt(${targetVarName} / ${constVal})`,
    };
  }

  // 6. Non-linear: sqrt(x)
  const sqrtMatch = trimmed.match(/^(?:Math\.)?sqrt\s*\(\s*([a-zA-Z_]\w*)\s*\)$/);
  if (sqrtMatch) {
    const [, sourceVar] = sqrtMatch;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `Math.pow(${targetVarName}, 2)`,
    };
  }

  // 7. Non-linear: exp(x) <-> ln(y)
  const expMatch = trimmed.match(/^(?:Math\.)?exp\s*\(\s*([a-zA-Z_]\w*)\s*\)$/);
  if (expMatch) {
    const [, sourceVar] = expMatch;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `Math.log(${targetVarName})`,
    };
  }

  // 8. Non-linear: log(x) <-> exp(y)
  const logMatch = trimmed.match(/^(?:Math\.)?(?:log|ln)\s*\(\s*([a-zA-Z_]\w*)\s*\)$/);
  if (logMatch) {
    const [, sourceVar] = logMatch;
    return {
      isInvertible: true,
      kind: "nonlinear",
      sourceVar,
      targetVar: targetVarName,
      invertedExpr: `Math.exp(${targetVarName})`,
    };
  }

  // 9. Relational Equality / Equation: lhs == rhs or lhs = rhs
  let eqIdx = trimmed.indexOf("==");
  let opLen = 2;
  if (eqIdx === -1) {
    eqIdx = trimmed.indexOf("=");
    opLen = 1;
  }
  if (eqIdx > 0 && eqIdx + opLen < trimmed.length) {
    const lhs = trimmed.slice(0, eqIdx).trim();
    const rhs = trimmed.slice(eqIdx + opLen).trim();
    if (lhs.length > 0 && rhs.length > 0) {
      return {
        isInvertible: true,
        kind: "custom",
        sourceVar: lhs,
        targetVar: rhs,
        invertedExpr: `${rhs} == ${lhs}`,
      };
    }
  }

  return {
    isInvertible: false,
  };
}

/**
 * Translates mathematical expressions between Modelica and SysML v2 dialects.
 */
export function translateExpression(
  expr: string,
  dialect: "modelica-sysml2" | "sysml2-modelica" = "modelica-sysml2",
): string {
  if (!expr) return "";
  let res = expr;
  if (dialect === "modelica-sysml2") {
    // der(x) -> rate(x)
    res = res.replace(/\bder\s*\(\s*([a-zA-Z_]\w*)\s*\)/g, "rate($1)");
    // <> -> !=
    res = res.replace(/<>/g, "!=");
    // ^ -> **
    res = res.replace(/\^/g, "**");
  } else if (dialect === "sysml2-modelica") {
    // rate(x) -> der(x)
    res = res.replace(/\brate\s*\(\s*([a-zA-Z_]\w*)\s*\)/g, "der($1)");
    // != -> <>
    res = res.replace(/!=/g, "<>");
    // ** -> ^
    res = res.replace(/\*\*/g, "^");
  }
  return res;
}
