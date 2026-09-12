// SPDX-License-Identifier: AGPL-3.0-or-later

export interface InversionResult {
  isInvertible: boolean;
  invertedExpr?: string;
  sourceVar?: string;
  targetVar?: string;
  kind?: "affine" | "unit" | "prefix" | "custom";
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

  return {
    isInvertible: false,
  };
}
