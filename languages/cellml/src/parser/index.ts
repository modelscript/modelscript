// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — CellML 1.0 / 1.1 / 2.0 XML & Content MathML Parser.
 *
 * Parses <model>, <units>/<unit> (with SI prefix and exponent calculation into CellmlDimensionVector),
 * <component>, <variable>, Content MathML <math> (<apply><eq/>, <diff/>, <bvar>, <piecewise>, etc.)
 * or infix formula attributes, <connection>/<map_components>/<map_variables>, and
 * <group>/<encapsulation>/<component_ref>.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  CellmlComponent,
  CellmlConnection,
  CellmlDimensionVector,
  CellmlDocument,
  CellmlEncapsulationNode,
  CellmlEquation,
  CellmlInterfaceType,
  CellmlSourceRange,
  CellmlUnits,
  CellmlVariable,
  CellmlVariableMapping,
} from "../types.js";

const SI_PREFIX_EXPONENTS: Record<string, number> = {
  yotta: 24,
  zetta: 21,
  exa: 18,
  peta: 15,
  tera: 12,
  giga: 9,
  mega: 6,
  kilo: 3,
  hecto: 2,
  deka: 1,
  deca: 1,
  deci: -1,
  centi: -2,
  milli: -3,
  micro: -6,
  nano: -9,
  pico: -12,
  femto: -15,
  atto: -18,
  zepto: -21,
  yocto: -24,
};

function makeDim(overrides: Partial<CellmlDimensionVector> = {}): CellmlDimensionVector {
  return {
    ampere: overrides.ampere ?? 0,
    kelvin: overrides.kelvin ?? 0,
    kilogram: overrides.kilogram ?? 0,
    metre: overrides.metre ?? 0,
    mole: overrides.mole ?? 0,
    second: overrides.second ?? 0,
    candela: overrides.candela ?? 0,
    multiplierScale: overrides.multiplierScale ?? 0,
  };
}

/**
 * Built-in SI and standard CellML electrophysiology / biophysical units.
 */
export const BUILTIN_CELLML_UNITS: ReadonlyMap<string, CellmlDimensionVector> = new Map<string, CellmlDimensionVector>([
  // 7 SI base units + dimensionless
  ["dimensionless", makeDim()],
  ["ampere", makeDim({ ampere: 1 })],
  ["kelvin", makeDim({ kelvin: 1 })],
  ["kilogram", makeDim({ kilogram: 1 })],
  ["gram", makeDim({ kilogram: 1, multiplierScale: -3 })],
  ["metre", makeDim({ metre: 1 })],
  ["meter", makeDim({ metre: 1 })],
  ["mole", makeDim({ mole: 1 })],
  ["second", makeDim({ second: 1 })],
  ["candela", makeDim({ candela: 1 })],

  // Standard CellML derived SI units
  ["radian", makeDim()],
  ["steradian", makeDim()],
  ["hertz", makeDim({ second: -1 })],
  ["newton", makeDim({ kilogram: 1, metre: 1, second: -2 })],
  ["pascal", makeDim({ kilogram: 1, metre: -1, second: -2 })],
  ["joule", makeDim({ kilogram: 1, metre: 2, second: -2 })],
  ["watt", makeDim({ kilogram: 1, metre: 2, second: -3 })],
  ["coulomb", makeDim({ ampere: 1, second: 1 })],
  ["volt", makeDim({ kilogram: 1, metre: 2, second: -3, ampere: -1 })],
  ["farad", makeDim({ kilogram: -1, metre: -2, second: 4, ampere: 2 })],
  ["ohm", makeDim({ kilogram: 1, metre: 2, second: -3, ampere: -2 })],
  ["siemens", makeDim({ kilogram: -1, metre: -2, second: 3, ampere: 2 })],
  ["weber", makeDim({ kilogram: 1, metre: 2, second: -2, ampere: -1 })],
  ["tesla", makeDim({ kilogram: 1, second: -2, ampere: -1 })],
  ["henry", makeDim({ kilogram: 1, metre: 2, second: -2, ampere: -2 })],
  ["celsius", makeDim({ kelvin: 1 })],
  ["lumen", makeDim({ candela: 1 })],
  ["lux", makeDim({ candela: 1, metre: -2 })],
  ["becquerel", makeDim({ second: -1 })],
  ["gray", makeDim({ metre: 2, second: -2 })],
  ["sievert", makeDim({ metre: 2, second: -2 })],
  ["katal", makeDim({ mole: 1, second: -1 })],
  ["litre", makeDim({ metre: 3, multiplierScale: -3 })],
  ["liter", makeDim({ metre: 3, multiplierScale: -3 })],

  // Common physiological / cardiac electrophysiology CellML units
  ["millisecond", makeDim({ second: 1, multiplierScale: -3 })],
  ["ms", makeDim({ second: 1, multiplierScale: -3 })],
  ["per_second", makeDim({ second: -1 })],
  ["per_millisecond", makeDim({ second: -1, multiplierScale: 3 })],
  ["per_ms", makeDim({ second: -1, multiplierScale: 3 })],
  ["millivolt", makeDim({ kilogram: 1, metre: 2, second: -3, ampere: -1, multiplierScale: -3 })],
  ["mV", makeDim({ kilogram: 1, metre: 2, second: -3, ampere: -1, multiplierScale: -3 })],
  ["per_millivolt", makeDim({ kilogram: -1, metre: -2, second: 3, ampere: 1, multiplierScale: 3 })],
  ["per_millivolt_millisecond", makeDim({ kilogram: -1, metre: -2, second: 2, ampere: 1, multiplierScale: 6 })],
  ["milliampere", makeDim({ ampere: 1, multiplierScale: -3 })],
  ["microampere", makeDim({ ampere: 1, multiplierScale: -6 })],
  ["nanoampere", makeDim({ ampere: 1, multiplierScale: -9 })],
  ["picoampere", makeDim({ ampere: 1, multiplierScale: -12 })],
  ["microampere_per_cmsq", makeDim({ ampere: 1, metre: -2, multiplierScale: -2 })],
  ["uA_per_cmsq", makeDim({ ampere: 1, metre: -2, multiplierScale: -2 })],
  ["uA_per_cm2", makeDim({ ampere: 1, metre: -2, multiplierScale: -2 })],
  ["millisiemens", makeDim({ kilogram: -1, metre: -2, second: 3, ampere: 2, multiplierScale: -3 })],
  ["microsiemens", makeDim({ kilogram: -1, metre: -2, second: 3, ampere: 2, multiplierScale: -6 })],
  ["nanosiemens", makeDim({ kilogram: -1, metre: -2, second: 3, ampere: 2, multiplierScale: -9 })],
  ["millisiemens_per_cmsq", makeDim({ kilogram: -1, metre: -4, second: 3, ampere: 2, multiplierScale: 1 })],
  ["mS_per_cmsq", makeDim({ kilogram: -1, metre: -4, second: 3, ampere: 2, multiplierScale: 1 })],
  ["mS_per_cm2", makeDim({ kilogram: -1, metre: -4, second: 3, ampere: 2, multiplierScale: 1 })],
  ["microfarad", makeDim({ kilogram: -1, metre: -2, second: 4, ampere: 2, multiplierScale: -6 })],
  ["nanofarad", makeDim({ kilogram: -1, metre: -2, second: 4, ampere: 2, multiplierScale: -9 })],
  ["picofarad", makeDim({ kilogram: -1, metre: -2, second: 4, ampere: 2, multiplierScale: -12 })],
  ["microfarad_per_cmsq", makeDim({ kilogram: -1, metre: -4, second: 4, ampere: 2, multiplierScale: -2 })],
  ["uF_per_cmsq", makeDim({ kilogram: -1, metre: -4, second: 4, ampere: 2, multiplierScale: -2 })],
  ["uF_per_cm2", makeDim({ kilogram: -1, metre: -4, second: 4, ampere: 2, multiplierScale: -2 })],
  ["molar", makeDim({ mole: 1, metre: -3, multiplierScale: 3 })],
  ["millimolar", makeDim({ mole: 1, metre: -3, multiplierScale: 0 })],
  ["mM", makeDim({ mole: 1, metre: -3, multiplierScale: 0 })],
  ["micromolar", makeDim({ mole: 1, metre: -3, multiplierScale: -3 })],
  ["uM", makeDim({ mole: 1, metre: -3, multiplierScale: -3 })],
  ["nanomolar", makeDim({ mole: 1, metre: -3, multiplierScale: -6 })],
  ["millimolar_per_millisecond", makeDim({ mole: 1, metre: -3, second: -1, multiplierScale: 3 })],
]);

export function resolveUnitDimensions(
  unitName: string,
  docUnits: Map<string, CellmlUnits>,
): CellmlDimensionVector | undefined {
  const custom = docUnits.get(unitName);
  if (custom) return custom.dimensions;
  return BUILTIN_CELLML_UNITS.get(unitName);
}

export function areDimensionsCompatible(d1: CellmlDimensionVector, d2: CellmlDimensionVector): boolean {
  const eps = 1e-6;
  return (
    Math.abs(d1.ampere - d2.ampere) < eps &&
    Math.abs(d1.kelvin - d2.kelvin) < eps &&
    Math.abs(d1.kilogram - d2.kilogram) < eps &&
    Math.abs(d1.metre - d2.metre) < eps &&
    Math.abs(d1.mole - d2.mole) < eps &&
    Math.abs(d1.second - d2.second) < eps &&
    Math.abs(d1.candela - d2.candela) < eps
  );
}

function localTagName(rawName: string): string {
  const idx = rawName.indexOf(":");
  return (idx >= 0 ? rawName.slice(idx + 1) : rawName).toLowerCase();
}

function getAttr(elem: XmlElement, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attr of elem.attributes) {
    if (attr.name.toLowerCase() === target || localTagName(attr.name) === target) {
      return attr.value;
    }
  }
  return undefined;
}

function getNumAttr(elem: XmlElement, name: string, defaultValue?: number): number | undefined {
  const val = getAttr(elem, name);
  if (val === undefined || val.trim() === "") return defaultValue;
  const num = Number(val);
  return Number.isNaN(num) ? defaultValue : num;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  const target = name.toLowerCase();
  return elem.children.find((c) => localTagName(c.name) === target);
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  const target = name.toLowerCase();
  return elem.children.filter((c) => localTagName(c.name) === target);
}

function computeRange(source: string, elem: XmlElement): CellmlSourceRange {
  let line = 1;
  let col = 1;
  let startLine = 1;
  let startCol = 1;
  let endLine = 1;
  let endCol = 1;

  const start = Math.max(0, elem.start);
  const end = Math.min(source.length, Math.max(start, elem.end));

  for (let i = 0; i <= source.length; i++) {
    if (i === start) {
      startLine = line;
      startCol = col;
    }
    if (i === end) {
      endLine = line;
      endCol = col;
      break;
    }
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }

  return {
    startOffset: start,
    endOffset: end,
    startLine,
    startColumn: startCol,
    endLine: endLine >= startLine ? endLine : startLine,
    endColumn: endCol,
  };
}

function parsePrefixScale(prefixAttr: string | undefined): number {
  if (!prefixAttr || prefixAttr.trim() === "") return 0;
  const clean = prefixAttr.trim().toLowerCase();
  const mapped = SI_PREFIX_EXPONENTS[clean];
  if (mapped !== undefined) return mapped;
  const numeric = Number(clean);
  return Number.isNaN(numeric) ? 0 : numeric;
}

function parseInterfaceType(raw: string | undefined): CellmlInterfaceType {
  if (!raw) return "none";
  const clean = raw.trim().toLowerCase();
  if (clean === "in" || clean === "out") return clean;
  return "none";
}

function extractCnText(elem: XmlElement, source: string): string {
  if (elem.children.some((c) => localTagName(c.name) === "sep")) {
    const rawSlice = source.slice(elem.start, elem.end);
    const openEnd = rawSlice.indexOf(">");
    const closeStart = rawSlice.lastIndexOf("</");
    const inner = openEnd >= 0 && closeStart > openEnd ? rawSlice.slice(openEnd + 1, closeStart) : rawSlice;
    const lowerInner = inner.toLowerCase();
    const sepIdx = lowerInner.indexOf("<sep");
    if (sepIdx >= 0) {
      const sepEnd = inner.indexOf(">", sepIdx);
      if (sepEnd >= 0) {
        const left = inner.slice(0, sepIdx).trim() || "0";
        const right = inner.slice(sepEnd + 1).trim() || "0";
        return `${left}e${right}`;
      }
    }
  }
  return elem.text?.trim() || "0";
}

function collectMathCiIdentifiers(elem: XmlElement, out: Set<string>): void {
  const tag = localTagName(elem.name);
  if (tag === "ci") {
    const id = elem.text?.trim();
    if (id) out.add(id);
    return;
  }
  if (tag === "bvar") {
    return;
  }
  for (let i = 0; i < elem.children.length; i++) {
    const child = elem.children[i];
    if (!child) continue;
    if (tag === "apply" && i === 0 && localTagName(child.name) === "ci" && elem.children.length > 1) {
      continue;
    }
    collectMathCiIdentifiers(child, out);
  }
}

/**
 * Converts a Content MathML XML element into an infix mathematical expression string.
 */
export function mathMlToInfix(elem: XmlElement, source = ""): string {
  const tag = localTagName(elem.name);

  if (tag === "math") {
    if (elem.children.length === 0) return elem.text?.trim() ?? "";
    return elem.children.map((c) => mathMlToInfix(c, source)).join(" ");
  }

  if (tag === "ci" || tag === "csymbol") {
    return elem.text?.trim() ?? "";
  }

  if (tag === "cn") {
    return extractCnText(elem, source);
  }

  if (tag === "true") return "1";
  if (tag === "false") return "0";
  if (tag === "pi") return "pi";
  if (tag === "exponentiale") return "e";

  if (tag === "piecewise") {
    const pairs: string[] = [];
    let otherwiseExpr = "0";
    for (const child of elem.children) {
      const cTag = localTagName(child.name);
      if (cTag === "piece" && child.children.length >= 2) {
        const valExpr = mathMlToInfix(child.children[0]!, source);
        const condExpr = mathMlToInfix(child.children[1]!, source);
        pairs.push(`${condExpr}, ${valExpr}`);
      } else if (cTag === "otherwise" && child.children.length >= 1) {
        otherwiseExpr = mathMlToInfix(child.children[0]!, source);
      }
    }
    if (pairs.length === 0) return otherwiseExpr;
    return `piecewise(${pairs.join(", ")}, ${otherwiseExpr})`;
  }

  if (tag === "apply") {
    const opElem = elem.children[0];
    if (!opElem) return "";
    const op = localTagName(opElem.name);
    const operandElems = elem.children.slice(1).filter((c) => {
      const ct = localTagName(c.name);
      return ct !== "bvar" && ct !== "degree" && ct !== "logbase";
    });
    const args = operandElems.map((c) => mathMlToInfix(c, source));

    switch (op) {
      case "plus":
        return args.length > 0 ? `(${args.join(" + ")})` : "0";
      case "times":
        return args.length > 0 ? `(${args.join(" * ")})` : "1";
      case "minus":
        if (args.length === 1) return `(-${args[0]})`;
        return args.length === 2 ? `(${args[0]} - ${args[1]})` : `(${args.join(" - ")})`;
      case "divide":
        return args.length === 2 ? `(${args[0]} / ${args[1]})` : args.join(" / ");
      case "power":
        return args.length === 2 ? `(${args[0]} ^ ${args[1]})` : `pow(${args.join(", ")})`;
      case "root": {
        const degreeElem = findChild(elem, "degree");
        if (degreeElem) {
          const degText = mathMlToInfix(degreeElem, source);
          if (degText && degText !== "2") {
            return `((${args[0] ?? "0"}) ^ (1 / (${degText})))`;
          }
        }
        return `sqrt(${args[0] ?? "0"})`;
      }
      case "exp":
        return `exp(${args[0] ?? "0"})`;
      case "ln":
        return `ln(${args[0] ?? "1"})`;
      case "log":
        return `log10(${args[0] ?? "1"})`;
      case "abs":
        return `abs(${args[0] ?? "0"})`;
      case "floor":
        return `floor(${args[0] ?? "0"})`;
      case "ceiling":
        return `ceil(${args[0] ?? "0"})`;
      case "sin":
        return `sin(${args[0] ?? "0"})`;
      case "cos":
        return `cos(${args[0] ?? "0"})`;
      case "tan":
        return `tan(${args[0] ?? "0"})`;
      case "sec":
        return `(1 / cos(${args[0] ?? "0"}))`;
      case "csc":
        return `(1 / sin(${args[0] ?? "0"}))`;
      case "cot":
        return `(1 / tan(${args[0] ?? "0"}))`;
      case "sinh":
        return `sinh(${args[0] ?? "0"})`;
      case "cosh":
        return `cosh(${args[0] ?? "0"})`;
      case "tanh":
        return `tanh(${args[0] ?? "0"})`;
      case "arcsin":
        return `asin(${args[0] ?? "0"})`;
      case "arccos":
        return `acos(${args[0] ?? "0"})`;
      case "arctan":
        return `atan(${args[0] ?? "0"})`;
      case "gt":
        return `(${args[0] ?? "0"} > ${args[1] ?? "0"})`;
      case "lt":
        return `(${args[0] ?? "0"} < ${args[1] ?? "0"})`;
      case "geq":
        return `(${args[0] ?? "0"} >= ${args[1] ?? "0"})`;
      case "leq":
        return `(${args[0] ?? "0"} <= ${args[1] ?? "0"})`;
      case "eq":
        return `(${args[0] ?? "0"} == ${args[1] ?? "0"})`;
      case "neq":
        return `(${args[0] ?? "0"} != ${args[1] ?? "0"})`;
      case "and":
        return args.length > 0 ? `(${args.join(" && ")})` : "1";
      case "or":
        return args.length > 0 ? `(${args.join(" || ")})` : "0";
      case "xor":
        return args.length === 2 ? `((${args[0]}) != (${args[1]}))` : "0";
      case "not":
        return `(!(${args[0] ?? "0"}))`;
      case "rem":
        return `(${args[0] ?? "0"} % ${args[1] ?? "1"})`;
      case "min":
        return `min(${args.join(", ")})`;
      case "max":
        return `max(${args.join(", ")})`;
      case "diff": {
        const bvarElem = findChild(elem, "bvar");
        const bvarCi = bvarElem ? (findChild(bvarElem, "ci") ?? bvarElem) : undefined;
        const indep = bvarCi?.text?.trim() ?? "t";
        return `der(${args[0] ?? "0"}, ${indep})`;
      }
      case "ci":
      case "csymbol": {
        const fnName = opElem.text?.trim() || op;
        return `${fnName}(${args.join(", ")})`;
      }
      default:
        return `${op}(${args.join(", ")})`;
    }
  }

  if (elem.children.length > 0) {
    return elem.children.map((c) => mathMlToInfix(c, source)).join(" ");
  }

  return elem.text?.trim() ?? "";
}

const RESERVED_MATH_FUNCTIONS = new Set([
  "exp",
  "ln",
  "log",
  "log10",
  "sqrt",
  "pow",
  "abs",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "floor",
  "ceil",
  "min",
  "max",
  "piecewise",
  "der",
  "true",
  "false",
  "pi",
  "e",
]);

function isAlphaOrUnderscore(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function isAlphaNumOrUnderscore(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || isAlphaOrUnderscore(ch);
}

function isDigitOrDot(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || c === 46;
}

function isWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function extractIdentifiersFromInfix(expr: string): string[] {
  const out = new Set<string>();
  const n = expr.length;
  let i = 0;
  while (i < n) {
    const ch = expr[i] ?? "";
    if (isAlphaOrUnderscore(ch)) {
      let id = "";
      while (i < n && isAlphaNumOrUnderscore(expr[i] ?? "")) {
        id += expr[i] ?? "";
        i++;
      }
      while (i < n && isWhitespaceChar(expr[i] ?? "")) i++;
      const isCall = expr[i] === "(";
      if (!isCall && !RESERVED_MATH_FUNCTIONS.has(id)) {
        out.add(id);
      }
    } else if (isDigitOrDot(ch)) {
      while (i < n) {
        const cur = expr[i] ?? "";
        if (isDigitOrDot(cur) || cur === "e" || cur === "E") {
          i++;
        } else if ((cur === "+" || cur === "-") && (expr[i - 1] === "e" || expr[i - 1] === "E")) {
          i++;
        } else {
          break;
        }
      }
    } else {
      i++;
    }
  }
  return Array.from(out);
}

function parseApplyEquation(applyElem: XmlElement, source: string): CellmlEquation | null {
  const firstChild = applyElem.children[0];
  if (!firstChild || localTagName(firstChild.name) !== "eq") {
    return null;
  }

  const lhsElem = applyElem.children[1];
  const rhsElem = applyElem.children[2];
  if (!lhsElem || !rhsElem) return null;

  let targetVariable = "";
  let isOde = false;
  let independentVariable: string | undefined;
  const referencedSet = new Set<string>();

  const lhsTag = localTagName(lhsElem.name);
  if (lhsTag === "apply") {
    const lhsOp = lhsElem.children[0];
    if (lhsOp && localTagName(lhsOp.name) === "diff") {
      isOde = true;
      const bvarElem = findChild(lhsElem, "bvar");
      if (bvarElem) {
        const bvarCi = findChild(bvarElem, "ci") ?? bvarElem;
        const bvarName = bvarCi.text?.trim();
        if (bvarName) {
          independentVariable = bvarName;
        }
      }
      const depElem = lhsElem.children.slice(1).find((c) => {
        const ct = localTagName(c.name);
        return ct !== "bvar" && ct !== "degree";
      });
      if (depElem) {
        const depCi = localTagName(depElem.name) === "ci" ? depElem : findChild(depElem, "ci");
        targetVariable = (depCi ?? depElem).text?.trim() ?? "";
      }
    }
  } else if (lhsTag === "ci") {
    targetVariable = lhsElem.text?.trim() ?? "";
    isOde = false;
  }

  const rhsExpression = mathMlToInfix(rhsElem, source);
  collectMathCiIdentifiers(rhsElem, referencedSet);

  return {
    targetVariable,
    isOde,
    independentVariable,
    rhsExpression,
    referencedIdentifiers: Array.from(referencedSet),
    range: computeRange(source, applyElem),
  };
}

function parseInfixEquation(formulaText: string, range: CellmlSourceRange): CellmlEquation[] {
  const equations: CellmlEquation[] = [];
  const statements = formulaText
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    const eqIdx = stmt.indexOf("=");
    if (eqIdx < 0) continue;
    const lhs = stmt.slice(0, eqIdx).trim();
    const rhs = stmt.slice(eqIdx + 1).trim();

    let isOde = false;
    let targetVariable = lhs;
    let independentVariable: string | undefined;

    if (lhs.startsWith("d(") && lhs.includes(")/d(") && lhs.endsWith(")")) {
      const mid = lhs.indexOf(")/d(");
      targetVariable = lhs.slice(2, mid).trim();
      independentVariable = lhs.slice(mid + 4, -1).trim();
      isOde = true;
    } else if (lhs.startsWith("der(") && lhs.endsWith(")")) {
      const inner = lhs
        .slice(4, -1)
        .split(",")
        .map((p) => p.trim());
      targetVariable = inner[0] ?? "";
      independentVariable = inner[1] ?? "time";
      isOde = true;
    }

    const refs = extractIdentifiersFromInfix(rhs);
    equations.push({
      targetVariable,
      isOde,
      independentVariable,
      rhsExpression: rhs,
      referencedIdentifiers: refs,
      range,
    });
  }

  return equations;
}

function parseUnitsElement(
  uElem: XmlElement,
  source: string,
  unitsMap: Map<string, CellmlUnits>,
  unresolvedUnitRefs: Array<{ unitsName: string; refUnitName: string; range: CellmlSourceRange }>,
): void {
  const name = getAttr(uElem, "name")?.trim() ?? "";
  if (!name) return;

  const baseUnitsAttr = getAttr(uElem, "base_units")?.trim().toLowerCase();
  const isBaseUnits = baseUnitsAttr === "yes" || baseUnitsAttr === "true";
  const range = computeRange(source, uElem);

  if (isBaseUnits) {
    unitsMap.set(name, {
      name,
      isBaseUnits: true,
      dimensions: makeDim(),
      range,
    });
    return;
  }

  const unitChildren = findChildren(uElem, "unit");
  if (unitChildren.length === 0) {
    const builtin = BUILTIN_CELLML_UNITS.get(name);
    unitsMap.set(name, {
      name,
      isBaseUnits: false,
      dimensions: builtin ? { ...builtin } : makeDim(),
      range,
    });
    return;
  }

  const totalDim = makeDim();

  for (const child of unitChildren) {
    const refName = getAttr(child, "units")?.trim() ?? "";
    const prefix = getAttr(child, "prefix");
    const exponent = getNumAttr(child, "exponent", 1.0) ?? 1.0;
    const multiplier = getNumAttr(child, "multiplier", 1.0) ?? 1.0;

    const refDim = resolveUnitDimensions(refName, unitsMap);
    if (!refDim) {
      unresolvedUnitRefs.push({
        unitsName: name,
        refUnitName: refName,
        range: computeRange(source, child),
      });
      continue;
    }

    const prefixScale = parsePrefixScale(prefix);
    const multScale = multiplier !== 0 ? Math.log10(Math.abs(multiplier)) : 0;

    totalDim.ampere += refDim.ampere * exponent;
    totalDim.kelvin += refDim.kelvin * exponent;
    totalDim.kilogram += refDim.kilogram * exponent;
    totalDim.metre += refDim.metre * exponent;
    totalDim.mole += refDim.mole * exponent;
    totalDim.second += refDim.second * exponent;
    totalDim.candela += refDim.candela * exponent;
    totalDim.multiplierScale += (refDim.multiplierScale + prefixScale + multScale) * exponent;
  }

  unitsMap.set(name, {
    name,
    isBaseUnits: false,
    dimensions: totalDim,
    range,
  });
}

function parseEncapsulationRef(elem: XmlElement, source: string): CellmlEncapsulationNode {
  const componentRef = getAttr(elem, "component")?.trim() ?? "";
  const children = findChildren(elem, "component_ref").map((c) => parseEncapsulationRef(c, source));
  return {
    componentRef,
    children,
    range: computeRange(source, elem),
  };
}

/**
 * Parses a CellML 1.0, 1.1, or 2.0 XML document into a structured CellmlDocument AST.
 */
export function parseCellml(text: string, uri?: string): CellmlDocument {
  const xmlDoc = parseXml(text);
  const root = xmlDoc.root;

  if (!root || localTagName(root.name) !== "model") {
    throw new Error("Invalid CellML document: root element must be <model>.");
  }

  const modelName = getAttr(root, "name")?.trim() ?? "";
  const xmlns = getAttr(root, "xmlns") ?? getAttr(root, "xmlns:cellml") ?? "";
  const versionAttr = getAttr(root, "version")?.trim();

  let version: "1.0" | "1.1" | "2.0" = "1.0";
  if (versionAttr === "2.0" || xmlns.includes("cellml/2.0")) {
    version = "2.0";
  } else if (versionAttr === "1.1" || xmlns.includes("cellml/1.1")) {
    version = "1.1";
  }

  const units = new Map<string, CellmlUnits>();
  const components = new Map<string, CellmlComponent>();
  const connections: CellmlConnection[] = [];
  const encapsulation: CellmlEncapsulationNode[] = [];
  const duplicateComponents: Array<{ name: string; range: CellmlSourceRange }> = [];
  const unresolvedUnitRefs: Array<{ unitsName: string; refUnitName: string; range: CellmlSourceRange }> = [];

  // 1. Parse model-level <units>
  for (const uElem of findChildren(root, "units")) {
    parseUnitsElement(uElem, text, units, unresolvedUnitRefs);
  }

  // 2. Parse <component> elements
  for (const cElem of findChildren(root, "component")) {
    const compName = getAttr(cElem, "name")?.trim() ?? "";
    const compRange = computeRange(text, cElem);

    if (compName && components.has(compName)) {
      duplicateComponents.push({ name: compName, range: compRange });
    }

    for (const uElem of findChildren(cElem, "units")) {
      parseUnitsElement(uElem, text, units, unresolvedUnitRefs);
    }

    const variables = new Map<string, CellmlVariable>();
    const duplicateVariables: Array<{ name: string; range: CellmlSourceRange }> = [];
    for (const vElem of findChildren(cElem, "variable")) {
      const varName = getAttr(vElem, "name")?.trim() ?? "";
      const varUnits = getAttr(vElem, "units")?.trim() ?? "";
      const initialValue = getNumAttr(vElem, "initial_value") ?? getNumAttr(vElem, "initialValue");
      const publicInterface = parseInterfaceType(
        getAttr(vElem, "public_interface") ?? getAttr(vElem, "publicInterface"),
      );
      const privateInterface = parseInterfaceType(
        getAttr(vElem, "private_interface") ?? getAttr(vElem, "privateInterface"),
      );
      const varRange = computeRange(text, vElem);

      if (varName && variables.has(varName)) {
        duplicateVariables.push({ name: varName, range: varRange });
      } else if (varName) {
        variables.set(varName, {
          name: varName,
          units: varUnits,
          initialValue,
          publicInterface,
          privateInterface,
          range: varRange,
        });
      }
    }

    const equations: CellmlEquation[] = [];

    for (const mathElem of findChildren(cElem, "math")) {
      const formulaAttr = getAttr(mathElem, "formula");
      if (formulaAttr) {
        equations.push(...parseInfixEquation(formulaAttr, computeRange(text, mathElem)));
      }
      for (const applyElem of findChildren(mathElem, "apply")) {
        const eq = parseApplyEquation(applyElem, text);
        if (eq) equations.push(eq);
      }
      if (mathElem.children.length === 0 && mathElem.text?.includes("=")) {
        equations.push(...parseInfixEquation(mathElem.text, computeRange(text, mathElem)));
      }
    }

    for (const eqElem of findChildren(cElem, "equation")) {
      const fAttr = getAttr(eqElem, "formula") ?? eqElem.text?.trim();
      if (fAttr) {
        equations.push(...parseInfixEquation(fAttr, computeRange(text, eqElem)));
      }
      for (const applyElem of findChildren(eqElem, "apply")) {
        const eq = parseApplyEquation(applyElem, text);
        if (eq) equations.push(eq);
      }
    }

    const compFormulaAttr = getAttr(cElem, "formula");
    if (compFormulaAttr) {
      equations.push(...parseInfixEquation(compFormulaAttr, compRange));
    }

    if (!components.has(compName)) {
      components.set(compName, {
        name: compName,
        variables,
        equations,
        range: compRange,
        duplicateVariables: duplicateVariables.length > 0 ? duplicateVariables : undefined,
      });
    }
  }

  // 3. Parse <connection> elements
  for (const connElem of findChildren(root, "connection")) {
    const mapCompElem = findChild(connElem, "map_components");
    const component1 =
      (
        (mapCompElem ? (getAttr(mapCompElem, "component_1") ?? getAttr(mapCompElem, "component1")) : undefined) ??
        getAttr(connElem, "component_1") ??
        getAttr(connElem, "component1")
      )?.trim() ?? "";
    const component2 =
      (
        (mapCompElem ? (getAttr(mapCompElem, "component_2") ?? getAttr(mapCompElem, "component2")) : undefined) ??
        getAttr(connElem, "component_2") ??
        getAttr(connElem, "component2")
      )?.trim() ?? "";

    const mappings: CellmlVariableMapping[] = [];
    for (const mvElem of findChildren(connElem, "map_variables")) {
      const variable1 = (getAttr(mvElem, "variable_1") ?? getAttr(mvElem, "variable1"))?.trim() ?? "";
      const variable2 = (getAttr(mvElem, "variable_2") ?? getAttr(mvElem, "variable2"))?.trim() ?? "";
      mappings.push({
        variable1,
        variable2,
        range: computeRange(text, mvElem),
      });
    }

    connections.push({
      component1,
      component2,
      mappings,
      range: computeRange(text, connElem),
    });
  }

  // 4. Parse <group> (CellML 1.0/1.1) and <encapsulation> (CellML 2.0)
  for (const groupElem of findChildren(root, "group")) {
    const relRefs = findChildren(groupElem, "relationship_ref");
    const isEncap =
      relRefs.length === 0 ||
      relRefs.some((r) => (getAttr(r, "relationship")?.trim().toLowerCase() ?? "encapsulation") === "encapsulation");
    if (isEncap) {
      for (const refElem of findChildren(groupElem, "component_ref")) {
        encapsulation.push(parseEncapsulationRef(refElem, text));
      }
    }
  }

  for (const encapElem of findChildren(root, "encapsulation")) {
    for (const refElem of findChildren(encapElem, "component_ref")) {
      encapsulation.push(parseEncapsulationRef(refElem, text));
    }
  }

  return {
    name: modelName,
    version,
    units,
    components,
    connections,
    encapsulation,
    uri,
    range: computeRange(text, root),
    duplicateComponents: duplicateComponents.length > 0 ? duplicateComponents : undefined,
    unresolvedUnitRefs: unresolvedUnitRefs.length > 0 ? unresolvedUnitRefs : undefined,
  };
}
