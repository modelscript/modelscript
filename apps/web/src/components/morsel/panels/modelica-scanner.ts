// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Linear-time lexical sanitizer and section-aware statement scanner for Modelica,
 * ModelScript, and flattened DAE source code.
 *
 * Eliminates false-positive variable/equation extraction from:
 * - Multi-line HTML documentation strings (`Documentation(info="<html>...")`)
 * - Single-line (`//`) and multi-line (`/* ... *\/`) comments
 * - Multi-line `annotation(...)` clauses (`Placement`, `Icon`, `Diagram`)
 * - Component declaration modifiers (`Sine sin1(f=5)`) and `final parameter` bindings
 * - Helper `function`, `connector`, `record`, and `package` definitions
 */

export type ModelicaSectionKind =
  | "public"
  | "protected"
  | "equation"
  | "initial_equation"
  | "algorithm"
  | "initial_algorithm";

export interface ScannedDeclaration {
  name: string;
  typeName: string;
  variability: "parameter" | "constant" | "discrete" | "continuous" | "component" | "input" | "output";
  isScalarType: boolean;
  isFlow: boolean;
  isStream: boolean;
  isProtected: boolean;
  arrayDims: number[];
  modifiersText: string;
  bindingExpr?: string | undefined;
  unit?: string | undefined;
  startValue?: string | undefined;
  fixed?: boolean | undefined;
  line: number;
}

export interface ScannedEquation {
  text: string;
  lhs: string;
  rhs: string;
  kind: "ODE" | "Relation" | "connect" | "Simple";
  isInitial: boolean;
  isAlgorithm: boolean;
  loopIterators: string[];
  line: number;
}

export interface ScannedModelStructure {
  className: string;
  declarations: ScannedDeclaration[];
  equations: ScannedEquation[];
  initialEquations: ScannedEquation[];
  localLineBySymbol: Map<string, number>;
}

const CLASS_KEYWORDS = new Set([
  "model",
  "block",
  "class",
  "connector",
  "record",
  "package",
  "function",
  "type",
  "operator",
]);

const END_BLOCK_KEYWORDS = new Set(["if", "for", "when", "while"]);

const DECLARATION_QUALIFIERS = new Set([
  "final",
  "inner",
  "outer",
  "replaceable",
  "redeclare",
  "each",
  "flow",
  "stream",
  "discrete",
  "parameter",
  "constant",
  "input",
  "output",
  "encapsulated",
  "partial",
  "expandable",
]);

const RESERVED_NON_TYPES = new Set([
  "model",
  "class",
  "package",
  "block",
  "connector",
  "record",
  "function",
  "type",
  "operator",
  "end",
  "equation",
  "initial",
  "algorithm",
  "public",
  "protected",
  "extends",
  "import",
  "within",
  "external",
  "connect",
  "der",
  "if",
  "then",
  "elseif",
  "else",
  "for",
  "in",
  "loop",
  "when",
  "elsewhen",
  "while",
  "return",
  "break",
  "assert",
  "terminate",
  "reinit",
  "annotation",
  "constrainedby",
]);

const SCALAR_PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String", "StateSelect", "AssertionLevel"]);

const SCALAR_QUANTITY_TYPE_SUFFIXES = new Set([
  "Voltage",
  "ElectricPotential",
  "Potential",
  "Current",
  "Charge",
  "ElectricCharge",
  "Resistance",
  "ElectricalResistance",
  "Conductance",
  "ElectricalConductance",
  "Capacitance",
  "Inductance",
  "MagneticFlux",
  "MagneticFluxDensity",
  "Impedance",
  "Admittance",
  "ApparentPower",
  "ActivePower",
  "ReactivePower",
  "Power",
  "Energy",
  "Work",
  "Enthalpy",
  "SpecificEnthalpy",
  "InternalEnergy",
  "SpecificInternalEnergy",
  "Entropy",
  "SpecificEntropy",
  "SpecificHeatCapacity",
  "HeatCapacity",
  "HeatFlowRate",
  "HeatFlux",
  "ThermalConductance",
  "ThermalResistance",
  "ThermalConductivity",
  "Temperature",
  "ThermodynamicTemperature",
  "Temp_K",
  "Temp_C",
  "TemperatureDifference",
  "Pressure",
  "AbsolutePressure",
  "GaugePressure",
  "PressureDifference",
  "MassFlowRate",
  "VolumeFlowRate",
  "MomentumFlux",
  "Position",
  "Distance",
  "Length",
  "Breadth",
  "Height",
  "Thickness",
  "Radius",
  "Diameter",
  "Area",
  "Volume",
  "Angle",
  "SolidAngle",
  "Velocity",
  "Speed",
  "LinearVelocity",
  "AngularVelocity",
  "Acceleration",
  "LinearAcceleration",
  "AngularAcceleration",
  "Force",
  "Torque",
  "MomentOfForce",
  "Momentum",
  "Impulse",
  "AngularMomentum",
  "Mass",
  "Inertia",
  "MomentOfInertia",
  "Density",
  "SpecificVolume",
  "DynamicViscosity",
  "KinematicViscosity",
  "TranslationalSpringConstant",
  "TranslationalDampingConstant",
  "RotationalSpringConstant",
  "RotationalDampingConstant",
  "Frequency",
  "AngularFrequency",
  "Period",
  "Time",
  "Duration",
  "DimensionlessRatio",
  "Efficiency",
  "Ratio",
  "Fraction",
  "MassFraction",
  "VolumeFraction",
  "MoleFraction",
  "Concentration",
  "MolarMass",
  "AmountOfSubstance",
  "RealInput",
  "RealOutput",
  "BooleanInput",
  "BooleanOutput",
  "IntegerInput",
  "IntegerOutput",
  "Signal",
]);

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95;
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

/**
 * Strips comments (`//`, `/* ... *\/`), double-quoted string literals (`"..."`),
 * and `annotation(...)` clauses in O(N) time while preserving exact newline positions
 * and Modelica single-quoted identifiers (`'...'`).
 *
 * Also returns a map of extracted `unit="..."` values keyed by 1-based line number
 * before strings are blanked out, so unit homogeneity checks retain string units.
 */
export function sanitizeModelicaSource(code: string): {
  sanitized: string;
  unitsByLine: Map<number, Map<string, string>>;
  experimentLines: Set<number>;
} {
  const n = code.length;
  const out = new Array<string>(n);
  const unitsByLine = new Map<number, Map<string, string>>();
  const experimentLines = new Set<number>();

  // Pre-extract `unit = "..."` and `experiment(...)` before stripping strings/annotations
  const unitRegex = /\b([A-Za-z_'][A-Za-z0-9_.']*)\s*(?:\[[^\]]*\])?\s*\([^;]*?\bunit\s*=\s*"([^"]+)"/g;
  let um: RegExpExecArray | null;
  while ((um = unitRegex.exec(code)) !== null) {
    const line = countLinesUpTo(code, um.index);
    let lineMap = unitsByLine.get(line);
    if (!lineMap) {
      lineMap = new Map();
      unitsByLine.set(line, lineMap);
    }
    lineMap.set(um[1]!, um[2]!);
  }

  const expRegex = /\bexperiment\s*\(/gi;
  while ((um = expRegex.exec(code)) !== null) {
    experimentLines.add(countLinesUpTo(code, um.index));
  }

  let i = 0;
  while (i < n) {
    const ch = code.charCodeAt(i);

    // 1. Line comment //
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && code.charCodeAt(i) !== 10) {
        out[i] = code.charCodeAt(i) === 13 ? "\r" : " ";
        i++;
      }
      continue;
    }

    // 2. Block comment /* ... */
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 42) {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n) {
        if (code.charCodeAt(i) === 42 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          break;
        }
        const c = code.charCodeAt(i);
        out[i] = c === 10 ? "\n" : c === 13 ? "\r" : " ";
        i++;
      }
      continue;
    }

    // 3. Double-quoted string "..." (descriptions, HTML Documentation, etc.)
    if (ch === 34) {
      out[i] = " ";
      i++;
      while (i < n) {
        const c = code.charCodeAt(i);
        if (c === 92 && i + 1 < n) {
          // Escape sequence
          out[i] = " ";
          const nextC = code.charCodeAt(i + 1);
          out[i + 1] = nextC === 10 ? "\n" : nextC === 13 ? "\r" : " ";
          i += 2;
          continue;
        }
        if (c === 34) {
          out[i] = " ";
          i++;
          break;
        }
        out[i] = c === 10 ? "\n" : c === 13 ? "\r" : " ";
        i++;
      }
      continue;
    }

    // 4. Single-quoted identifier '...' (keep intact!)
    if (ch === 39) {
      out[i] = "'";
      i++;
      while (i < n) {
        const c = code.charCodeAt(i);
        out[i] = code[i]!;
        i++;
        if (c === 92 && i < n) {
          out[i] = code[i]!;
          i++;
          continue;
        }
        if (c === 39 || c === 10) break;
      }
      continue;
    }

    // 5. Identifier or `annotation(...)` clause
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < n && isIdentPart(code.charCodeAt(i))) i++;
      const word = code.slice(start, i);

      if (word === "annotation") {
        // Check if followed (after whitespace/comments) by '('
        let k = i;
        while (
          k < n &&
          (code.charCodeAt(k) === 32 ||
            code.charCodeAt(k) === 9 ||
            code.charCodeAt(k) === 10 ||
            code.charCodeAt(k) === 13)
        ) {
          k++;
        }
        if (k < n && code.charCodeAt(k) === 40) {
          // Blank `annotation` and balanced `(...)` while preserving newlines
          for (let p = start; p <= k; p++) {
            const c = code.charCodeAt(p);
            out[p] = c === 10 ? "\n" : c === 13 ? "\r" : " ";
          }
          i = k + 1;
          let depth = 1;
          while (i < n && depth > 0) {
            const c = code.charCodeAt(i);
            if (c === 34) {
              // String inside annotation
              out[i] = " ";
              i++;
              while (i < n) {
                const sc = code.charCodeAt(i);
                if (sc === 92 && i + 1 < n) {
                  out[i] = " ";
                  const nc = code.charCodeAt(i + 1);
                  out[i + 1] = nc === 10 ? "\n" : nc === 13 ? "\r" : " ";
                  i += 2;
                  continue;
                }
                out[i] = sc === 10 ? "\n" : sc === 13 ? "\r" : " ";
                i++;
                if (sc === 34) break;
              }
              continue;
            }
            if (c === 47 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
              while (i < n && code.charCodeAt(i) !== 10) {
                out[i] = code.charCodeAt(i) === 13 ? "\r" : " ";
                i++;
              }
              continue;
            }
            if (c === 47 && i + 1 < n && code.charCodeAt(i + 1) === 42) {
              out[i] = " ";
              out[i + 1] = " ";
              i += 2;
              while (i < n) {
                if (code.charCodeAt(i) === 42 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
                  out[i] = " ";
                  out[i + 1] = " ";
                  i += 2;
                  break;
                }
                const bc = code.charCodeAt(i);
                out[i] = bc === 10 ? "\n" : bc === 13 ? "\r" : " ";
                i++;
              }
              continue;
            }
            if (c === 40) depth++;
            else if (c === 41) depth--;
            out[i] = c === 10 ? "\n" : c === 13 ? "\r" : " ";
            i++;
          }
          continue;
        }
      }

      for (let p = start; p < i; p++) {
        out[p] = code[p]!;
      }
      continue;
    }

    out[i] = code[i]!;
    i++;
  }

  return { sanitized: out.join(""), unitsByLine, experimentLines };
}

function countLinesUpTo(text: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(lineOffsets: number[], offset: number): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lineOffsets[mid]! <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hi + 1;
}

interface ClassBlockSpan {
  kind: string;
  name: string;
  qualifiedName: string;
  isShortDef: boolean;
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
  startLine: number;
  endLine: number;
  hasExperiment: boolean;
}

/**
 * Extracts symbol -> line mappings from raw source code so flattened variables like
 * `sin1.y` can jump to `sin1`'s declaration line in the editor.
 */
export function indexLocalSymbolLines(code: string): Map<string, number> {
  const { sanitized } = sanitizeModelicaSource(code);
  const lineOffsets = buildLineOffsets(sanitized);
  const map = new Map<string, number>();
  const lines = sanitized.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    // Match declaration-like lines
    const tokens = trimmed.split(/\s+/);
    let idx = 0;
    while (idx < tokens.length && DECLARATION_QUALIFIERS.has(tokens[idx]!)) idx++;
    if (idx + 1 < tokens.length && !RESERVED_NON_TYPES.has(tokens[idx]!)) {
      const rest = tokens.slice(idx + 1).join(" ");
      const firstIdent = /^([A-Za-z_'][A-Za-z0-9_']*)/.exec(rest);
      if (firstIdent && !RESERVED_NON_TYPES.has(firstIdent[1]!)) {
        if (!map.has(firstIdent[1]!)) {
          map.set(firstIdent[1]!, i + 1);
        }
      }
    }
  }

  void lineOffsets;
  return map;
}

function isKnownScalarType(typeName: string, userScalarTypeAliases: Set<string>): boolean {
  const clean = typeName.trim();
  if (SCALAR_PRIMITIVE_TYPES.has(clean) || userScalarTypeAliases.has(clean)) return true;
  if (clean.startsWith("enumeration(") || clean.startsWith("enumeration ")) return true;
  if (
    clean.startsWith("Modelica.Units.SI.") ||
    clean.startsWith("Modelica.SIunits.") ||
    clean.startsWith("SI.") ||
    clean.startsWith("SIunits.") ||
    clean.startsWith("Modelica.Units.NonSI.") ||
    clean.startsWith("NonSI.")
  ) {
    return true;
  }
  const suffix = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1) : clean;
  if (
    SCALAR_PRIMITIVE_TYPES.has(suffix) ||
    SCALAR_QUANTITY_TYPE_SUFFIXES.has(suffix) ||
    userScalarTypeAliases.has(suffix)
  ) {
    return true;
  }
  return false;
}

/**
 * Splits a string by `delimiter` only at parenthesis/bracket/brace depth 0,
 * respecting single-quoted Modelica identifiers `'...'`.
 */
export function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < text.length && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40 || ch === 91 || ch === 123) depth++;
    else if (ch === 41 || ch === 93 || ch === 125) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(delimiter, i)) {
      parts.push(text.slice(last, i));
      last = i + delimiter.length;
      i += delimiter.length - 1;
    }
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * Finds the index of the top-level `=` equation operator (excluding `==`, `<=`, `>=`, `<>`, `:=`).
 * Returns -1 if not found at depth 0.
 */
export function findTopLevelEquationEquals(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < text.length && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40 || ch === 91 || ch === 123) depth++;
    else if (ch === 41 || ch === 93 || ch === 125) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === 61) {
      const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      // Exclude ==, <=, >=, :=
      if (next === 61 || prev === 61 || prev === 60 || prev === 62 || prev === 58) {
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * Scans Modelica / ModelScript / flattened DAE source code and returns structured
 * declarations and equations for the target simulatable class.
 */
export function scanModelicaStructure(code: string, targetClassName?: string): ScannedModelStructure {
  const { sanitized, unitsByLine, experimentLines } = sanitizeModelicaSource(code);
  const lineOffsets = buildLineOffsets(sanitized);
  const localLineBySymbol = indexLocalSymbolLines(code);

  // Collect `type Alias = Real...` scalar aliases across file
  const userScalarTypeAliases = new Set<string>();
  const typeAliasRegex = /\btype\s+([A-Za-z_'][A-Za-z0-9_']*)\s*=\s*([A-Za-z0-9_.]+)/g;
  let tm: RegExpExecArray | null;
  while ((tm = typeAliasRegex.exec(sanitized)) !== null) {
    if (isKnownScalarType(tm[2]!, userScalarTypeAliases)) {
      userScalarTypeAliases.add(tm[1]!);
    }
  }

  // Locate class spans in sanitized code
  const classSpans = findClassSpans(sanitized, lineOffsets, experimentLines);

  let chosenClass: ClassBlockSpan | undefined;
  const simulatableKinds = new Set(["model", "block", "class"]);

  if (targetClassName) {
    const cleanTarget = targetClassName.trim();
    const shortTarget = cleanTarget.includes(".") ? cleanTarget.slice(cleanTarget.lastIndexOf(".") + 1) : cleanTarget;
    chosenClass =
      classSpans.find((c) => !c.isShortDef && (c.qualifiedName === cleanTarget || c.name === cleanTarget)) ??
      classSpans.find((c) => !c.isShortDef && simulatableKinds.has(c.kind) && c.name === shortTarget) ??
      classSpans.find((c) => !c.isShortDef && c.name === shortTarget);
  }

  if (!chosenClass) {
    const simulatable = classSpans.filter((c) => !c.isShortDef && simulatableKinds.has(c.kind));
    chosenClass =
      simulatable.find((c) => c.hasExperiment) ??
      (simulatable.length > 0 ? simulatable[simulatable.length - 1] : classSpans.find((c) => !c.isShortDef));
  }

  const bodyText = chosenClass ? sanitized.slice(chosenClass.bodyStart, chosenClass.bodyEnd) : sanitized;
  const bodyBaseOffset = chosenClass ? chosenClass.bodyStart : 0;
  const resolvedClassName = chosenClass?.name ?? targetClassName ?? "Model";

  // Blank out any nested class definitions (`function ... end ...;`, `model ... end ...;`, `record ... end ...;`)
  // inside `bodyText` so inner helper functions/records do not pollute the outer model's variables/equations.
  const maskedBody = maskNestedClassBlocks(bodyText);

  const declarations: ScannedDeclaration[] = [];
  const equations: ScannedEquation[] = [];
  const initialEquations: ScannedEquation[] = [];

  parseClassBodyStatements(
    maskedBody,
    bodyBaseOffset,
    lineOffsets,
    unitsByLine,
    userScalarTypeAliases,
    declarations,
    equations,
    initialEquations,
  );

  return {
    className: resolvedClassName,
    declarations,
    equations,
    initialEquations,
    localLineBySymbol,
  };
}

function findClassSpans(sanitized: string, lineOffsets: number[], experimentLines: Set<number>): ClassBlockSpan[] {
  const spans: ClassBlockSpan[] = [];
  const stack: Array<{
    kind: string;
    name: string;
    qualifiedName: string;
    headerStart: number;
    bodyStart: number;
    startLine: number;
  }> = [];

  // Tokenize at paren/bracket/brace depth 0 to match class headers and `end <Name>;`
  const n = sanitized.length;
  let i = 0;
  let depth = 0;

  while (i < n) {
    const ch = sanitized.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < n && sanitized.charCodeAt(i) !== 39) {
        if (sanitized.charCodeAt(i) === 92) i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === 40 || ch === 91 || ch === 123) {
      depth++;
      i++;
      continue;
    }
    if (ch === 41 || ch === 93 || ch === 125) {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth > 0 || !isIdentStart(ch)) {
      i++;
      continue;
    }

    const wordStart = i;
    i++;
    while (i < n && isIdentPart(sanitized.charCodeAt(i))) i++;
    const word = sanitized.slice(wordStart, i);

    if (word === "end") {
      // Read next identifier/q-ident
      let k = i;
      while (k < n && /\s/.test(sanitized[k]!)) k++;
      const nameTok = readModelicaIdent(sanitized, k);
      if (nameTok && !END_BLOCK_KEYWORDS.has(nameTok.ident)) {
        // Advance to `;`
        let semi = nameTok.nextIdx;
        while (semi < n && /\s/.test(sanitized[semi]!)) semi++;
        // Pop matching class from stack
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s]!.name === nameTok.ident) {
            const popped = stack.splice(s, 1)[0]!;
            const endLine = offsetToLine(lineOffsets, wordStart);
            let hasExp = false;
            for (const el of experimentLines) {
              if (el >= popped.startLine && el <= endLine) {
                hasExp = true;
                break;
              }
            }
            spans.push({
              kind: popped.kind,
              name: popped.name,
              qualifiedName: popped.qualifiedName,
              isShortDef: false,
              headerStart: popped.headerStart,
              bodyStart: popped.bodyStart,
              bodyEnd: wordStart,
              startLine: popped.startLine,
              endLine,
              hasExperiment: hasExp,
            });
            break;
          }
        }
        i = semi < n && sanitized.charCodeAt(semi) === 59 ? semi + 1 : nameTok.nextIdx;
        continue;
      }
      continue;
    }

    if (CLASS_KEYWORDS.has(word)) {
      // Check previous non-whitespace char to ensure this isn't `redeclare model ...` modifier inside `(...)` (depth is 0 here)
      let k = i;
      while (k < n && /\s/.test(sanitized[k]!)) k++;
      // Handle `operator record` or `operator function`
      let effectiveKind = word;
      if (word === "operator") {
        const nextW = readModelicaIdent(sanitized, k);
        if (nextW && (nextW.ident === "record" || nextW.ident === "function")) {
          effectiveKind = nextW.ident;
          k = nextW.nextIdx;
          while (k < n && /\s/.test(sanitized[k]!)) k++;
        }
      }
      const nameTok = readModelicaIdent(sanitized, k);
      if (!nameTok || RESERVED_NON_TYPES.has(nameTok.ident)) continue;

      // Check if short class definition: `model A = B(...);` or `type V = Real(...);`
      let afterName = nameTok.nextIdx;
      while (afterName < n && /\s/.test(sanitized[afterName]!)) afterName++;
      if (afterName < n && sanitized.charCodeAt(afterName) === 61) {
        // Advance to `;` at depth 0
        let d2 = 0;
        let p = afterName + 1;
        while (p < n) {
          const c2 = sanitized.charCodeAt(p);
          if (c2 === 40 || c2 === 91 || c2 === 123) d2++;
          else if (c2 === 41 || c2 === 93 || c2 === 125) d2 = Math.max(0, d2 - 1);
          else if (d2 === 0 && c2 === 59) break;
          p++;
        }
        const parentQ = stack.length > 0 ? `${stack[stack.length - 1]!.qualifiedName}.${nameTok.ident}` : nameTok.ident;
        spans.push({
          kind: effectiveKind,
          name: nameTok.ident,
          qualifiedName: parentQ,
          isShortDef: true,
          headerStart: wordStart,
          bodyStart: afterName + 1,
          bodyEnd: p,
          startLine: offsetToLine(lineOffsets, wordStart),
          endLine: offsetToLine(lineOffsets, p),
          hasExperiment: false,
        });
        i = p + 1;
        continue;
      }

      const parentQ = stack.length > 0 ? `${stack[stack.length - 1]!.qualifiedName}.${nameTok.ident}` : nameTok.ident;
      stack.push({
        kind: effectiveKind,
        name: nameTok.ident,
        qualifiedName: parentQ,
        headerStart: wordStart,
        bodyStart: nameTok.nextIdx,
        startLine: offsetToLine(lineOffsets, wordStart),
      });
      i = nameTok.nextIdx;
    }
  }

  return spans;
}

function maskNestedClassBlocks(body: string): string {
  const dummyOffsets = [0];
  const innerSpans = findClassSpans(body, dummyOffsets, new Set());
  if (innerSpans.length === 0) return body;

  const chars = body.split("");
  for (const sp of innerSpans) {
    // Also blank the `end <Name>;` trailing after `bodyEnd` if not shortDef
    let endPos = sp.bodyEnd;
    if (!sp.isShortDef) {
      const tail = body.slice(sp.bodyEnd);
      const endMatch = /^end\s+(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)\s*;?/.exec(tail);
      if (endMatch) endPos += endMatch[0].length;
    }
    // Also blank any leading qualifiers (`replaceable`, `final`, `partial`, `encapsulated`) before `headerStart` on the same statement
    for (let k = sp.headerStart; k < endPos && k < chars.length; k++) {
      if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
    }
  }
  return chars.join("");
}

function readModelicaIdent(text: string, pos: number): { ident: string; nextIdx: number } | null {
  if (pos >= text.length) return null;
  const ch = text.charCodeAt(pos);
  if (ch === 39) {
    let i = pos + 1;
    while (i < text.length && text.charCodeAt(i) !== 39) {
      if (text.charCodeAt(i) === 92) i++;
      i++;
    }
    if (i < text.length) i++;
    return { ident: text.slice(pos, i), nextIdx: i };
  }
  if (isIdentStart(ch)) {
    let i = pos + 1;
    while (i < text.length && isIdentPart(text.charCodeAt(i))) i++;
    return { ident: text.slice(pos, i), nextIdx: i };
  }
  return null;
}

function parseClassBodyStatements(
  body: string,
  baseOffset: number,
  lineOffsets: number[],
  unitsByLine: Map<number, Map<string, string>>,
  userScalarTypeAliases: Set<string>,
  declarations: ScannedDeclaration[],
  equations: ScannedEquation[],
  initialEquations: ScannedEquation[],
): void {
  let section: ModelicaSectionKind = "public";
  const loopIteratorStack: string[] = [];

  const n = body.length;
  let pos = 0;

  while (pos < n) {
    while (pos < n && /\s/.test(body[pos]!)) pos++;
    if (pos >= n) break;

    // Check section keywords or control-flow headers before `;`
    const sectionShift = matchSectionKeyword(body, pos);
    if (sectionShift) {
      section = sectionShift.section;
      pos = sectionShift.nextPos;
      continue;
    }

    // Control-flow headers inside equation/algorithm sections:
    // `for <var> in <expr> loop`, `if <cond> then`, `elseif <cond> then`, `else`, `when <cond> then`, `elsewhen <cond> then`, `end for;`, `end if;`, `end when;`
    if (section !== "public" && section !== "protected") {
      const cfShift = matchControlFlowHeader(body, pos, loopIteratorStack);
      if (cfShift !== null) {
        pos = cfShift;
        continue;
      }
    }

    // Read a single statement up to `;` at depth 0, while stopping early if a top-level section keyword starts on a new line
    const stmtEnd = findStatementEnd(body, pos);
    const rawStmt = body.slice(pos, stmtEnd.endPos);
    const trimmedStmt = rawStmt.trim();
    const stmtLine = offsetToLine(lineOffsets, baseOffset + pos);

    pos = stmtEnd.nextPos;

    if (!trimmedStmt) continue;

    if (section === "public" || section === "protected") {
      parseDeclarationStatement(
        trimmedStmt,
        section === "protected",
        stmtLine,
        unitsByLine,
        userScalarTypeAliases,
        declarations,
        equations,
      );
    } else if (section === "equation" || section === "initial_equation") {
      parseEquationStatement(
        trimmedStmt,
        section === "initial_equation",
        loopIteratorStack,
        stmtLine,
        section === "initial_equation" ? initialEquations : equations,
      );
    } else if (section === "algorithm" || section === "initial_algorithm") {
      parseAlgorithmStatement(
        trimmedStmt,
        section === "initial_algorithm",
        loopIteratorStack,
        stmtLine,
        section === "initial_algorithm" ? initialEquations : equations,
      );
    }
  }
}

function matchSectionKeyword(body: string, pos: number): { section: ModelicaSectionKind; nextPos: number } | null {
  const slice = body.slice(pos, pos + 32);
  const initEq = /^initial\s+equation\b/.exec(slice);
  if (initEq) return { section: "initial_equation", nextPos: pos + initEq[0].length };

  const initAlg = /^initial\s+algorithm\b/.exec(slice);
  if (initAlg) return { section: "initial_algorithm", nextPos: pos + initAlg[0].length };

  const eq = /^equation\b/.exec(slice);
  if (eq) return { section: "equation", nextPos: pos + eq[0].length };

  const alg = /^algorithm\b/.exec(slice);
  if (alg) return { section: "algorithm", nextPos: pos + alg[0].length };

  const pub = /^public\b/.exec(slice);
  if (pub) return { section: "public", nextPos: pos + pub[0].length };

  const prot = /^protected\b/.exec(slice);
  if (prot) return { section: "protected", nextPos: pos + prot[0].length };

  return null;
}

function matchControlFlowHeader(body: string, pos: number, loopIteratorStack: string[]): number | null {
  const head = body.slice(pos, pos + 40);

  // `end for;`, `end if;`, `end when;`, `end while;`
  const endCf = /^end\s+(for|if|when|while)\s*;?/.exec(head);
  if (endCf) {
    if (endCf[1] === "for" && loopIteratorStack.length > 0) {
      loopIteratorStack.pop();
    }
    return pos + endCf[0].length;
  }

  // `for <ident> in ... loop`
  if (/^for\b/.test(head)) {
    const rest = body.slice(pos);
    const loopMatch = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b[\s\S]*?\bloop\b/.exec(rest);
    if (loopMatch) {
      loopIteratorStack.push(loopMatch[1]!);
      return pos + loopMatch[0].length;
    }
  }

  // Statement-level `if <cond> then` (note: expression-level `y = if c then a else b;` starts with `y`, NOT `if`!)
  if (/^(?:if|elseif|when|elsewhen)\b/.test(head)) {
    const rest = body.slice(pos);
    const thenMatch = /^(?:if|elseif|when|elsewhen)\b[\s\S]*?\bthen\b/.exec(rest);
    if (thenMatch) {
      return pos + thenMatch[0].length;
    }
  }

  if (/^else\b/.test(head)) {
    return pos + 4;
  }

  return null;
}

function findStatementEnd(body: string, start: number): { endPos: number; nextPos: number } {
  let depth = 0;
  const n = body.length;
  for (let i = start; i < n; i++) {
    const ch = body.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < n && body.charCodeAt(i) !== 39) {
        if (body.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40 || ch === 91 || ch === 123) depth++;
    else if (ch === 41 || ch === 93 || ch === 125) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === 59) {
      return { endPos: i, nextPos: i + 1 };
    } else if (depth === 0 && ch === 10) {
      // Check if next non-whitespace token at start of line is a section header (`equation`, `protected`, etc.)
      let k = i + 1;
      while (k < n && (body.charCodeAt(k) === 32 || body.charCodeAt(k) === 9 || body.charCodeAt(k) === 13)) k++;
      if (matchSectionKeyword(body, k)) {
        return { endPos: i, nextPos: k };
      }
    }
  }
  return { endPos: n, nextPos: n };
}

function parseDeclarationStatement(
  stmt: string,
  isProtected: boolean,
  line: number,
  unitsByLine: Map<number, Map<string, string>>,
  userScalarTypeAliases: Set<string>,
  declarations: ScannedDeclaration[],
  equations: ScannedEquation[],
): void {
  const normalized = stmt.replace(/\s+/g, " ").trim();
  if (!normalized) return;

  // Ignore imports, extends, within, external
  if (/^(?:import|extends|within|external)\b/.test(normalized)) return;

  // Strip trailing `constrainedby ...` at depth 0 if present
  const constrainedIdx = findTopLevelKeyword(normalized, "constrainedby");
  const core = constrainedIdx >= 0 ? normalized.slice(0, constrainedIdx).trim() : normalized;

  // Parse leading qualifiers
  let cursor = 0;
  let variability: ScannedDeclaration["variability"] | null = null;
  let causality: "input" | "output" | null = null;
  let isFlow = false;
  let isStream = false;

  while (cursor < core.length) {
    while (cursor < core.length && /\s/.test(core[cursor]!)) cursor++;
    const wMatch = /^([A-Za-z_][A-Za-z0-9_]*)\b/.exec(core.slice(cursor));
    if (!wMatch || !DECLARATION_QUALIFIERS.has(wMatch[1]!)) break;
    const kw = wMatch[1]!;
    if (kw === "parameter") variability = "parameter";
    else if (kw === "constant") variability = "constant";
    else if (kw === "discrete") variability = "discrete";
    else if (kw === "input") causality = "input";
    else if (kw === "output") causality = "output";
    else if (kw === "flow") isFlow = true;
    else if (kw === "stream") isStream = true;
    cursor += kw.length;
  }

  while (cursor < core.length && /\s/.test(core[cursor]!)) cursor++;
  const afterQualifiers = core.slice(cursor);
  if (!afterQualifiers) return;

  // Read TypeSpec: e.g. `Real`, `Modelica.Blocks.Sources.Sine`, `Real[3]`, or `enumeration(...)`
  let typeEnd = 0;
  if (afterQualifiers.startsWith("enumeration")) {
    const m = /^enumeration\s*\([^)]*\)/.exec(afterQualifiers);
    if (!m) return;
    typeEnd = m[0].length;
  } else {
    const m = /^\.?[A-Za-z_'][A-Za-z0-9_.']*(?:\s*\[[^\]]*\])?/.exec(afterQualifiers);
    if (!m) return;
    typeEnd = m[0].length;
  }

  const rawTypeSpec = afterQualifiers.slice(0, typeEnd).trim();
  const baseTypeMatch = /^([^[]+)/.exec(rawTypeSpec);
  const typeName = baseTypeMatch ? baseTypeMatch[1]!.trim() : rawTypeSpec;

  if (RESERVED_NON_TYPES.has(typeName)) return;

  const typeDims = extractNumericDimensions(rawTypeSpec);
  const declListStr = afterQualifiers.slice(typeEnd).trim();
  if (!declListStr) return;

  const isScalar = isKnownScalarType(typeName, userScalarTypeAliases);
  const declarators = splitTopLevel(declListStr, ",");

  for (const rawDecl of declarators) {
    let d = rawDecl.trim();
    if (!d) continue;

    // Strip conditional component suffix `if <expr>` at depth 0
    const ifIdx = findTopLevelKeyword(d, "if");
    if (ifIdx > 0) {
      d = d.slice(0, ifIdx).trim();
    }

    // Extract component name (supports flattened dotted/quoted/indexed names like `sin1.y`, `comp[1].y`, `'R1.v'`)
    const segPattern = "(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)";
    const nameRe = new RegExp(
      `^(${segPattern}(?:(?:\\s*\\[[^\\]]*\\])+\\s*\\.${segPattern}|\\.${segPattern})*)(\\s*(?:\\[[^\\]]*\\]\\s*)*)`,
    );
    const nameMatch = nameRe.exec(d);
    if (!nameMatch) continue;

    const baseName = nameMatch[1]!.replace(/\s+/g, "");
    if (RESERVED_NON_TYPES.has(baseName)) continue;

    const bracketPart = nameMatch[2]!.trim();
    let rest = d.slice(nameMatch[0].length).trim();

    // Extract optional `(modifications)`
    let modifiersText = "";
    if (rest.startsWith("(")) {
      const closeIdx = findMatchingCloseParen(rest, 0);
      if (closeIdx > 0) {
        modifiersText = rest.slice(1, closeIdx).trim();
        rest = rest.slice(closeIdx + 1).trim();
      }
    }

    // Optional array dims after modifications (`Real x(unit="m")[3]`)
    let extraBracketPart = "";
    if (rest.startsWith("[")) {
      const bm = /^(?:\[[^\]]*\]\s*)+/.exec(rest);
      if (bm) {
        extraBracketPart = bm[0].trim();
        rest = rest.slice(bm[0].length).trim();
      }
    }

    // Optional `= bindingExpr`
    let bindingExpr: string | undefined;
    if (rest.startsWith("=") && !rest.startsWith("==")) {
      bindingExpr = rest.slice(1).trim();
    }

    const trailingBrackets = `${bracketPart}${extraBracketPart}`.replace(/\s+/g, "");
    const declDims = [
      ...typeDims,
      ...extractNumericDimensions(bracketPart),
      ...extractNumericDimensions(extraBracketPart),
    ];

    // If an earlier declaration already registered `baseName` with trailing brackets (expanded flattened array elements `Real x[1]; Real x[2];`),
    // upgrade the earlier entry and keep full indexed names `x[1]`, `x[2]`.
    let finalName = baseName;
    if (trailingBrackets) {
      const prevSameBase = declarations.find((prev) => prev.name === baseName || prev.name.startsWith(`${baseName}[`));
      if (prevSameBase) {
        if (prevSameBase.name === baseName && prevSameBase.arrayDims.length > 0) {
          const prevSub = prevSameBase.arrayDims.map((dim) => `[${dim}]`).join("");
          const prevEq = equations.find((eq) => eq.lhs === baseName && eq.line === prevSameBase.line);
          prevSameBase.name = `${baseName}${prevSub}`;
          prevSameBase.arrayDims = [];
          if (prevEq) {
            prevEq.lhs = prevSameBase.name;
            prevEq.text = `${prevSameBase.name} = ${prevEq.rhs}`;
          }
        }
        finalName = `${baseName}${trailingBrackets}`;
      }
    }

    const effectiveVariability: ScannedDeclaration["variability"] =
      variability ?? causality ?? (isScalar ? "continuous" : "component");

    const unitFromLine = unitsByLine.get(line)?.get(baseName);
    const startMatch = /\bstart\s*=\s*([^,)]+)/i.exec(modifiersText);
    const fixedMatch = /\bfixed\s*=\s*(true|false)/i.exec(modifiersText);

    declarations.push({
      name: finalName,
      typeName,
      variability: effectiveVariability,
      isScalarType: isScalar,
      isFlow,
      isStream,
      isProtected,
      arrayDims: finalName !== baseName ? [] : declDims,
      modifiersText,
      bindingExpr,
      unit: unitFromLine,
      startValue: startMatch?.[1]?.trim(),
      fixed: fixedMatch ? fixedMatch[1]!.toLowerCase() === "true" : undefined,
      line,
    });

    // In Modelica, a binding expression on a non-parameter, non-constant, non-input scalar variable
    // (`Real y = 2 * x;` or `output Real THD = ...;`) is an algebraic binding equation!
    if (
      bindingExpr &&
      isScalar &&
      effectiveVariability !== "parameter" &&
      effectiveVariability !== "constant" &&
      effectiveVariability !== "input"
    ) {
      equations.push({
        text: `${finalName} = ${bindingExpr}`,
        lhs: finalName,
        rhs: bindingExpr,
        kind: "Relation",
        isInitial: false,
        isAlgorithm: false,
        loopIterators: [],
        line,
      });
    }
  }
}

function parseEquationStatement(
  stmt: string,
  isInitial: boolean,
  loopIterators: string[],
  line: number,
  target: ScannedEquation[],
): void {
  const clean = stmt.replace(/\s+/g, " ").trim();
  if (!clean) return;

  // Ignore pure procedural assertions/terminations/reinits in structural incidence
  if (/^(?:assert|terminate|reinit)\s*\(/.test(clean)) return;

  if (/^connect\s*\(/.test(clean)) {
    target.push({
      text: clean,
      lhs: clean,
      rhs: "",
      kind: "connect",
      isInitial,
      isAlgorithm: false,
      loopIterators: [...loopIterators],
      line,
    });
    return;
  }

  const eqPos = findTopLevelEquationEquals(clean);
  if (eqPos > 0) {
    const lhs = clean.slice(0, eqPos).trim();
    const rhs = clean.slice(eqPos + 1).trim();
    const hasDer = /\bder\s*\(/.test(lhs) || /\bder\s*\(/.test(rhs);
    target.push({
      text: clean,
      lhs,
      rhs,
      kind: hasDer ? "ODE" : "Relation",
      isInitial,
      isAlgorithm: false,
      loopIterators: [...loopIterators],
      line,
    });
  }
}

function parseAlgorithmStatement(
  stmt: string,
  isInitial: boolean,
  loopIterators: string[],
  line: number,
  target: ScannedEquation[],
): void {
  const clean = stmt.replace(/\s+/g, " ").trim();
  if (!clean || /^(?:assert|terminate|return|break)\b/.test(clean)) return;

  const assignParts = splitTopLevel(clean, ":=");
  if (assignParts.length >= 2) {
    const lhs = assignParts[0]!.trim();
    const rhs = assignParts.slice(1).join(":=").trim();
    if (lhs && rhs && !loopIterators.includes(lhs)) {
      target.push({
        text: `${lhs} := ${rhs}`,
        lhs,
        rhs,
        kind: "Simple",
        isInitial,
        isAlgorithm: true,
        loopIterators: [...loopIterators],
        line,
      });
    }
  }
}

function findMatchingCloseParen(text: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < text.length && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40) depth++;
    else if (ch === 41) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findTopLevelKeyword(text: string, keyword: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < text.length && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40 || ch === 91 || ch === 123) depth++;
    else if (ch === 41 || ch === 93 || ch === 125) depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(keyword, i)) {
      const prevOk = i === 0 || !isIdentPart(text.charCodeAt(i - 1));
      const afterIdx = i + keyword.length;
      const nextOk = afterIdx >= text.length || !isIdentPart(text.charCodeAt(afterIdx));
      if (prevOk && nextOk) return i;
    }
  }
  return -1;
}

function extractNumericDimensions(bracketStr: string): number[] {
  const dims: number[] = [];
  const re = /\[\s*(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bracketStr)) !== null) {
    const v = parseInt(m[1]!, 10);
    if (v > 0) dims.push(v);
  }
  return dims;
}
