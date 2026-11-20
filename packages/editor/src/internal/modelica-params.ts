// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight helper to extract parameter values from Modelica code without loading heavy AST parsers.
 */
export function parseModelicaParameters(code: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!code) return result;
  const regex = /parameter\s+(?:Real|Integer|Boolean|String)\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const [, name, rawVal] = match;
    let val = rawVal!.trim();
    const commentMatch = val.match(/^(.*?)\s*("[^"]*")\s*$/);
    if (commentMatch) {
      const exprPart = commentMatch[1]!.trim();
      if (exprPart.length > 0) {
        val = exprPart;
      }
    }
    result[name!.trim()] = val.trim();
  }
  return result;
}

export interface ParameterRibbonItem {
  name: string;
  type: string;
  defaultValue: number;
  min?: number | undefined;
  max?: number | undefined;
  unit?: string | undefined;
}

/**
 * Extracts top-level parameters from Modelica / DSL code.
 */
export function extractParametersFromCode(code: string): ParameterRibbonItem[] {
  const items: ParameterRibbonItem[] = [];
  if (!code) return items;

  // Strip single-line and multi-line comments to avoid commented-out false positives
  const cleanCode = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const regex = /parameter\s+(?:Real|Integer|Boolean|[A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(cleanCode)) !== null) {
    const name = match[1];
    const rest = match[2]?.trim();
    if (!name || !rest) continue;

    // Parse numeric value
    const numMatch = rest.match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!numMatch) continue;

    const defaultVal = Number(numMatch[0]);
    if (isNaN(defaultVal)) continue;

    // Check for min/max annotation
    let min: number | undefined;
    let max: number | undefined;
    const minMatch = rest.match(/min\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    const maxMatch = rest.match(/max\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (minMatch && minMatch[1]) min = Number(minMatch[1]);
    if (maxMatch && maxMatch[1]) max = Number(maxMatch[1]);

    // Check for unit
    let unit: string | undefined;
    const unitMatch = rest.match(/unit\s*=\s*"([^"]+)"/);
    if (unitMatch && unitMatch[1]) unit = unitMatch[1];

    items.push({
      name,
      type: "real",
      defaultValue: defaultVal,
      min,
      max,
      unit,
    });
  }

  return items;
}
