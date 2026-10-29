// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Standalone FMI 2.0 / 3.0 FMU Exporter & C99 / WebAssembly Codegen for Fortran.
 *
 * Compiles Fortran subroutines, modules, and continuous/discrete numerical kernels
 * into standards-compliant Functional Mock-up Units (.fmu ZIP archives) containing:
 *   - FMI 2.0 `modelDescription.xml` & FMI 3.0 `fmi3ModelDescription.xml`
 *   - Standalone C99 model implementation (`sources/<id>_model.h`, `sources/<id>_model.c`, `sources/fmi2Functions.c`, `sources/CMakeLists.txt`)
 *   - WebAssembly-targeted C kernel (`sources/<id>_wasm.c`) with exported linear-memory step ABI
 *   - Serialized DAE & verification metadata (`resources/model.json`)
 */

import { DAEBuilder } from "@modelscript/runtime";
import {
  extractFortranSignature,
  parseFortranModule,
  parseFortranScript,
  type FortranExpr,
  type FortranRoutineSignature,
  type FortranStmt,
} from "../ast.js";
import { lowerFortranToDae } from "../dae/lowering.js";
import { preprocessFortranSegment } from "../preprocessor.js";

export interface FortranFmuOptions {
  modelIdentifier?: string | undefined;
  fmiVersion?: "2.0" | "3.0" | "both" | undefined;
  guid?: string | undefined;
  description?: string | undefined;
  author?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  stepSize?: number | undefined;
  includeSources?: boolean | undefined;
  includeWasmSource?: boolean | undefined;
}

export interface FortranFmuVariable {
  name: string;
  valueReference: number;
  causality: "input" | "output" | "parameter" | "local";
  variability: "continuous" | "discrete" | "fixed";
  start: number;
  description: string;
}

export interface FortranFmuResult {
  modelIdentifier: string;
  guid: string;
  archive: Uint8Array;
  files: string[];
  variables: FortranFmuVariable[];
  modelDescription2Xml: string;
  modelDescription3Xml: string;
  cSources: {
    modelH: string;
    modelC: string;
    fmi2FunctionsC: string;
    wasmModelC: string;
    cmakeLists: string;
  };
  daeSummary: {
    stateCount: number;
    inputCount: number;
    outputCount: number;
    parameterCount: number;
    equationCount: number;
  };
}

function sanitizeCId(name: string): string {
  const s = name
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!s) return "fortran_model";
  return /^[0-9]/.test(s) ? `f_${s}` : s.toLowerCase();
}

function generateDeterministicGuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `{${hex1}-4f90-8a2c-${hex2.slice(0, 4)}-${hex2.padEnd(12, "0").slice(0, 12)}}`;
}

// CRC-32 table for ZIP archive packaging
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pure-JS ZIP archive builder (Store method) suitable for both browser and Node.js.
 */
export function createFortranZipArchive(files: Map<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: {
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];

  let localTotal = 0;
  for (const [name, data] of files.entries()) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    entries.push({ nameBytes, data, crc, offset: localTotal });
    localTotal += 30 + nameBytes.length + data.length;
  }

  let centralTotal = 0;
  for (const e of entries) {
    centralTotal += 46 + e.nameBytes.length;
  }

  const out = new Uint8Array(localTotal + centralTotal + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Write Local File Headers + Data
  for (const e of entries) {
    view.setUint32(pos, 0x04034b50, true); // signature
    view.setUint16(pos + 4, 20, true); // version needed
    view.setUint16(pos + 6, 0, true); // flags
    view.setUint16(pos + 8, 0, true); // compression = 0 (store)
    view.setUint16(pos + 10, 0, true); // mod time
    view.setUint16(pos + 12, 0x21, true); // mod date
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.data.length, true);
    view.setUint32(pos + 22, e.data.length, true);
    view.setUint16(pos + 26, e.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
    out.set(e.data, pos);
    pos += e.data.length;
  }

  const centralDirOffset = pos;

  // Write Central Directory Headers
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true); // signature
    view.setUint16(pos + 4, 20, true); // version made by
    view.setUint16(pos + 6, 20, true); // version needed
    view.setUint16(pos + 8, 0, true); // flags
    view.setUint16(pos + 10, 0, true); // compression = 0
    view.setUint16(pos + 12, 0, true); // mod time
    view.setUint16(pos + 14, 0x21, true); // mod date
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.data.length, true);
    view.setUint32(pos + 24, e.data.length, true);
    view.setUint16(pos + 28, e.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true); // extra len
    view.setUint16(pos + 32, 0, true); // comment len
    view.setUint16(pos + 34, 0, true); // disk start
    view.setUint16(pos + 36, 0, true); // internal attr
    view.setUint32(pos + 38, 0, true); // external attr
    view.setUint32(pos + 42, e.offset, true);
    pos += 46;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
  }

  // End of Central Directory Record
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, centralTotal, true);
  view.setUint32(pos + 16, centralDirOffset, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

function collectVariables(sig: FortranRoutineSignature, stmts: FortranStmt[]): FortranFmuVariable[] {
  const vars: FortranFmuVariable[] = [];
  const seen = new Set<string>();
  let vr = 0;

  const addVar = (
    name: string,
    causality: FortranFmuVariable["causality"],
    variability: FortranFmuVariable["variability"],
    start: number,
    description: string,
  ) => {
    const key = name.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    vars.push({
      name: sanitizeCId(name),
      valueReference: vr++,
      causality,
      variability,
      start,
      description,
    });
  };

  for (const inp of sig.inputs) {
    addVar(inp, "input", "continuous", 1.0, `Fortran input argument '${inp}'`);
  }
  for (const out of sig.outputs) {
    addVar(out, "output", "continuous", 0.0, `Fortran output argument '${out}'`);
  }
  for (const [cName, cVal] of Object.entries(sig.constants)) {
    addVar(cName, "parameter", "fixed", Number(cVal), `Fortran constant parameter '${cName}'`);
  }
  for (const loc of sig.locals) {
    const spec = sig.arrays[loc] ?? sig.arrays[loc.toLowerCase()];
    if (spec && !spec.allocatable && spec.dims.length === 1 && spec.dims[0]!.upper <= 16) {
      for (let i = spec.dims[0]!.lower; i <= spec.dims[0]!.upper; i++) {
        addVar(`${loc}_${i}`, "local", "continuous", 0.0, `Element ${loc}(${i})`);
      }
    }
    addVar(loc, "local", "continuous", 0.0, `Local variable '${loc}'`);
  }

  const scanStmts = (list: FortranStmt[]) => {
    for (const s of list) {
      if (s.kind === "assign") {
        if (s.target.type === "var") {
          addVar(s.target.name, "local", "continuous", 0.0, `Assigned variable '${s.target.name}'`);
        } else if (s.target.type === "port") {
          addVar(s.target.portName, "output", "continuous", 0.0, `Assigned port '${s.target.portName}'`);
        } else if (s.target.type === "array") {
          addVar(s.target.name, "local", "continuous", 0.0, `Array variable '${s.target.name}'`);
        }
      } else if (s.kind === "do") {
        addVar(s.loopVar, "local", "discrete", 1.0, `DO loop counter '${s.loopVar}'`);
        scanStmts(s.body);
      } else if (s.kind === "if") {
        scanStmts(s.thenBody);
        if (s.elseBody) scanStmts(s.elseBody);
      }
    }
  };
  scanStmts(stmts);

  if (vars.length === 0) {
    addVar("y", "output", "continuous", 0.0, "Default output variable");
  }

  return vars;
}

function generateExprC(expr: FortranExpr, varLookup: Map<string, number>, arrayDims: Map<string, number[]>): string {
  switch (expr.kind) {
    case "number":
      return Number.isInteger(expr.value) ? `${expr.value}.0` : String(expr.value);
    case "boolean":
      return expr.value ? "1" : "0";
    case "string":
      return "0.0";
    case "special":
      if (expr.name === "TIME") return "comp->time";
      if (expr.name === "DELT") return "comp->dt";
      if (expr.name === "FIRSTSTEP") return "(comp->first_step ? 1.0 : 0.0)";
      return "0.0";
    case "port": {
      const idx = varLookup.get(expr.portName.toUpperCase());
      return idx !== undefined ? `comp->r[${idx}]` : "0.0";
    }
    case "var": {
      const idx = varLookup.get(expr.name.toUpperCase());
      return idx !== undefined ? `comp->r[${idx}]` : sanitizeCId(expr.name);
    }
    case "state": {
      const idxC = `(int)(${generateExprC(expr.indexExpr, varLookup, arrayDims)})`;
      return expr.array === "storf" ? `comp->storf[(${idxC}) & 63]` : `(double)comp->stori[(${idxC}) & 63]`;
    }
    case "arrayConstructor": {
      if (expr.elements.length === 0) return "0.0";
      return generateExprC(expr.elements[0]!, varLookup, arrayDims);
    }
    case "arrayAccess": {
      const upper = expr.name.toUpperCase();
      const cName = sanitizeCId(expr.name);
      if (arrayDims.has(upper)) {
        const dims = arrayDims.get(upper)!;
        const offsetTerms: string[] = [];
        let stride = 1;
        for (let d = 0; d < expr.subscripts.length; d++) {
          const sub = expr.subscripts[d]!;
          const subC =
            sub.kind === "index"
              ? generateExprC(sub.expr, varLookup, arrayDims)
              : sub.start
                ? generateExprC(sub.start, varLookup, arrayDims)
                : "1.0";
          offsetTerms.push(`(((int)(${subC}) - 1) * ${stride})`);
          stride *= dims[d] ?? 16;
        }
        const flatIdx = offsetTerms.length > 0 ? offsetTerms.join(" + ") : "0";
        return `comp->arr_${cName}[(${flatIdx})]`;
      }
      // User function call fallback
      const argsC = expr.subscripts
        .map((s) => (s.kind === "index" ? generateExprC(s.expr, varLookup, arrayDims) : "1.0"))
        .join(", ");
      return `msx_fn_${cName}(comp${argsC ? `, ${argsC}` : ""})`;
    }
    case "unary": {
      const inner = generateExprC(expr.expr, varLookup, arrayDims);
      if (expr.op === "-") return `(-(${inner}))`;
      if (expr.op === "!") return `(!(${inner}))`;
      return inner;
    }
    case "binary": {
      const l = generateExprC(expr.left, varLookup, arrayDims);
      const r = generateExprC(expr.right, varLookup, arrayDims);
      if (expr.op === "^") return `pow(${l}, ${r})`;
      return `((${l}) ${expr.op} (${r}))`;
    }
    case "math": {
      const argsC = expr.args.map((a) => generateExprC(a, varLookup, arrayDims));
      switch (expr.func) {
        case "sqrt":
          return `sqrt(fmax(0.0, ${argsC[0] ?? "0.0"}))`;
        case "sin":
          return `sin(${argsC[0] ?? "0.0"})`;
        case "cos":
          return `cos(${argsC[0] ?? "0.0"})`;
        case "tan":
          return `tan(${argsC[0] ?? "0.0"})`;
        case "asin":
          return `asin(fmin(1.0, fmax(-1.0, ${argsC[0] ?? "0.0"})))`;
        case "acos":
          return `acos(fmin(1.0, fmax(-1.0, ${argsC[0] ?? "0.0"})))`;
        case "atan":
          return `atan(${argsC[0] ?? "0.0"})`;
        case "atan2":
          return `atan2(${argsC[0] ?? "0.0"}, ${argsC[1] ?? "1.0"})`;
        case "exp":
          return `exp(${argsC[0] ?? "0.0"})`;
        case "log":
          return `log(fmax(1e-12, ${argsC[0] ?? "1.0"}))`;
        case "log10":
          return `log10(fmax(1e-12, ${argsC[0] ?? "1.0"}))`;
        case "abs":
          return `fabs(${argsC[0] ?? "0.0"})`;
        case "max":
          return `fmax(${argsC[0] ?? "0.0"}, ${argsC[1] ?? "0.0"})`;
        case "min":
          return `fmin(${argsC[0] ?? "0.0"}, ${argsC[1] ?? "0.0"})`;
        default:
          return argsC[0] ?? "0.0";
      }
    }
  }
}

function generateStmtsC(
  stmts: FortranStmt[],
  varLookup: Map<string, number>,
  arrayDims: Map<string, number[]>,
  indent: string = "  ",
): string {
  const lines: string[] = [];
  for (const s of stmts) {
    if (s.kind === "assign") {
      const rhs = generateExprC(s.expr, varLookup, arrayDims);
      if (s.target.type === "var") {
        const idx = varLookup.get(s.target.name.toUpperCase());
        const lhs = idx !== undefined ? `comp->r[${idx}]` : sanitizeCId(s.target.name);
        lines.push(`${indent}${lhs} = ${rhs};`);
      } else if (s.target.type === "port") {
        const idx = varLookup.get(s.target.portName.toUpperCase());
        if (idx !== undefined) lines.push(`${indent}comp->r[${idx}] = ${rhs};`);
      } else if (s.target.type === "state") {
        const idxC = `(int)(${generateExprC(s.target.indexExpr, varLookup, arrayDims)})`;
        if (s.target.array === "storf") {
          lines.push(`${indent}comp->storf[(${idxC}) & 63] = ${rhs};`);
        } else {
          lines.push(`${indent}comp->stori[(${idxC}) & 63] = (int)(${rhs});`);
        }
      } else if (s.target.type === "array") {
        const cName = sanitizeCId(s.target.name);
        const dims = arrayDims.get(s.target.name.toUpperCase()) ?? [16];
        const offsetTerms: string[] = [];
        let stride = 1;
        for (let d = 0; d < s.target.subscripts.length; d++) {
          const sub = s.target.subscripts[d]!;
          const subC =
            sub.kind === "index"
              ? generateExprC(sub.expr, varLookup, arrayDims)
              : sub.start
                ? generateExprC(sub.start, varLookup, arrayDims)
                : "1.0";
          offsetTerms.push(`(((int)(${subC}) - 1) * ${stride})`);
          stride *= dims[d] ?? 16;
        }
        const flatIdx = offsetTerms.length > 0 ? offsetTerms.join(" + ") : "0";
        lines.push(`${indent}comp->arr_${cName}[(${flatIdx})] = ${rhs};`);
      }
    } else if (s.kind === "if") {
      const cond = generateExprC(s.condition, varLookup, arrayDims);
      lines.push(`${indent}if (${cond}) {`);
      lines.push(generateStmtsC(s.thenBody, varLookup, arrayDims, indent + "  "));
      if (s.elseBody && s.elseBody.length > 0) {
        lines.push(`${indent}} else {`);
        lines.push(generateStmtsC(s.elseBody, varLookup, arrayDims, indent + "  "));
      }
      lines.push(`${indent}}`);
    } else if (s.kind === "do") {
      const vIdx = varLookup.get(s.loopVar.toUpperCase());
      const loopLhs = vIdx !== undefined ? `comp->r[${vIdx}]` : sanitizeCId(s.loopVar);
      const startC = generateExprC(s.startExpr, varLookup, arrayDims);
      const endC = generateExprC(s.endExpr, varLookup, arrayDims);
      const stepC = s.stepExpr ? generateExprC(s.stepExpr, varLookup, arrayDims) : "1.0";
      lines.push(`${indent}for (${loopLhs} = ${startC}; ${loopLhs} <= ${endC}; ${loopLhs} += ${stepC}) {`);
      lines.push(generateStmtsC(s.body, varLookup, arrayDims, indent + "  "));
      lines.push(`${indent}}`);
    } else if (s.kind === "call") {
      const subUpper = s.subroutine.toUpperCase();
      if ((subUpper === "HARDLIMIT" || subUpper === "LIMITER" || subUpper === "LIMIT") && s.args.length >= 4) {
        const [inE, minE, maxE, outE] =
          s.args.length >= 5
            ? [s.args[1]!, s.args[2]!, s.args[3]!, s.args[4]!]
            : [s.args[0]!, s.args[1]!, s.args[2]!, s.args[3]!];
        if (outE.kind === "var") {
          const outIdx = varLookup.get(outE.name.toUpperCase());
          const lhs = outIdx !== undefined ? `comp->r[${outIdx}]` : sanitizeCId(outE.name);
          const u = generateExprC(inE, varLookup, arrayDims);
          const lo = generateExprC(minE, varLookup, arrayDims);
          const hi = generateExprC(maxE, varLookup, arrayDims);
          lines.push(`${indent}${lhs} = fmin(${hi}, fmax(${lo}, ${u}));`);
        }
      } else {
        const cSub = sanitizeCId(s.subroutine);
        const argsC = s.args.map((a) => generateExprC(a, varLookup, arrayDims)).join(", ");
        lines.push(`${indent}/* CALL ${s.subroutine} */ (void)(${argsC || "0"}); (void)"${cSub}";`);
      }
    }
  }
  return lines.join("\n");
}

function generateFmi2Xml(
  modelId: string,
  guid: string,
  vars: FortranFmuVariable[],
  options: FortranFmuOptions,
): string {
  const startTime = options.startTime ?? 0.0;
  const stopTime = options.stopTime ?? 1.0;
  const stepSize = options.stepSize ?? 0.001;
  const desc = options.description ?? `Standalone Fortran FMU (${modelId})`;

  const varNodes = vars.map((v, idx) => {
    const startAttr =
      v.causality === "input" || v.causality === "parameter" || v.start !== 0 ? ` start="${v.start}"` : "";
    const initialAttr =
      v.causality === "parameter" ? ` initial="exact"` : v.causality === "output" ? ` initial="calculated"` : "";
    return `    <!-- Index ${idx + 1} -->
    <ScalarVariable name="${v.name}" valueReference="${v.valueReference}" causality="${v.causality}" variability="${v.variability}"${initialAttr} description="${v.description}">
      <Real${startAttr} />
    </ScalarVariable>`;
  });

  const outputIndices = vars.map((v, i) => (v.causality === "output" ? i + 1 : -1)).filter((idx) => idx > 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="${modelId}"
  guid="${guid}"
  description="${desc}"
  generationTool="ModelScript Fortran Compiler"
  generationDateAndTime="2026-10-28T00:00:00Z"
  variableNamingConvention="structured"
  numberOfEventIndicators="0">

  <ModelExchange modelIdentifier="${modelId}">
    <SourceFiles>
      <File name="${modelId}_model.c" />
      <File name="fmi2Functions.c" />
    </SourceFiles>
  </ModelExchange>

  <CoSimulation
    modelIdentifier="${modelId}"
    canHandleVariableCommunicationStepSize="true"
    canInterpolateInputs="true"
    maxOutputDerivativeOrder="0"
    canBeInstantiatedOnlyOncePerProcess="false"
    canNotUseMemoryManagementFunctions="true"
    canGetAndSetFMUstate="true"
    canSerializeFMUstate="true">
    <SourceFiles>
      <File name="${modelId}_model.c" />
      <File name="fmi2Functions.c" />
    </SourceFiles>
  </CoSimulation>

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varNodes.join("\n")}
  </ModelVariables>

  <ModelStructure>
    <Outputs>
${outputIndices.map((idx) => `      <Unknown index="${idx}" />`).join("\n")}
    </Outputs>
  </ModelStructure>
</fmiModelDescription>
`;
}

function generateFmi3Xml(
  modelId: string,
  guid: string,
  vars: FortranFmuVariable[],
  options: FortranFmuOptions,
): string {
  const startTime = options.startTime ?? 0.0;
  const stopTime = options.stopTime ?? 1.0;
  const stepSize = options.stepSize ?? 0.001;
  const desc = options.description ?? `Standalone Fortran FMI 3.0 FMU (${modelId})`;

  const varNodes = vars.map((v) => {
    const startAttr =
      v.causality === "input" || v.causality === "parameter" || v.start !== 0 ? ` start="${v.start}"` : "";
    return `    <Float64 name="${v.name}" valueReference="${v.valueReference}" causality="${v.causality}" variability="${v.variability}"${startAttr} description="${v.description}" />`;
  });

  const outputVrs = vars.filter((v) => v.causality === "output").map((v) => v.valueReference);

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="3.0"
  modelName="${modelId}"
  instantiationToken="${guid}"
  description="${desc}"
  generationTool="ModelScript Fortran Compiler"
  generationDateAndTime="2026-10-28T00:00:00Z"
  variableNamingConvention="structured">

  <ModelExchange modelIdentifier="${modelId}" />
  <CoSimulation modelIdentifier="${modelId}" canHandleVariableCommunicationStepSize="true" />

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varNodes.join("\n")}
  </ModelVariables>

  <ModelStructure>
${outputVrs.map((vr) => `    <Output valueReference="${vr}" />`).join("\n")}
  </ModelStructure>
</fmiModelDescription>
`;
}

/**
 * Compiles a Fortran source string into a standalone FMI 2.0 / 3.0 `.fmu` archive,
 * complete with C99 sources, WebAssembly C kernel, and DAE lowering metadata.
 */
export function exportFortranFmu(source: string, options: FortranFmuOptions = {}): FortranFmuResult {
  const prep = preprocessFortranSegment(source);
  const hasDirectives = /^\s*#/m.test(source) || /\$#DIM/i.test(source);
  const cleanSource = hasDirectives ? prep.lines.join("\n") : source;
  const moduleAst = parseFortranModule(cleanSource);
  const mainUnit = moduleAst.entryUnit;
  const sig = mainUnit ? mainUnit.signature : extractFortranSignature(source);
  const stmts = mainUnit ? mainUnit.stmts : parseFortranScript(cleanSource);

  const modelId = sanitizeCId(options.modelIdentifier ?? sig.name);
  const guid = options.guid ?? generateDeterministicGuid(`${modelId}:${source.length}`);

  const variables = collectVariables(sig, stmts);
  const varLookup = new Map<string, number>();
  for (const v of variables) {
    varLookup.set(v.name.toUpperCase(), v.valueReference);
  }

  const arrayDims = new Map<string, number[]>();
  for (const [k, spec] of Object.entries(sig.arrays)) {
    const dims = spec.dims.map((d) => Math.max(1, d.upper - d.lower + 1));
    arrayDims.set(k.toUpperCase(), dims);
  }

  // Lower to DAEBuilder for structural metadata
  const daeBuilder = new DAEBuilder();
  const loweredDae = lowerFortranToDae(daeBuilder, prep.lines, modelId);

  const arrayFieldsC = Array.from(arrayDims.entries())
    .map(([name, dims]) => {
      const total = Math.max(
        16,
        dims.reduce((a, b) => a * b, 1),
      );
      return `  double arr_${sanitizeCId(name)}[${total}];`;
    })
    .join("\n");

  const modelH = `/* Auto-generated by ModelScript Fortran FMU Compiler */
#ifndef MSX_FORTRAN_${modelId.toUpperCase()}_H
#define MSX_FORTRAN_${modelId.toUpperCase()}_H

#include <stddef.h>
#include <stdbool.h>

#define MSX_NUM_VARS ${variables.length}

typedef struct {
  double time;
  double dt;
  bool first_step;
  int nstorf;
  int nstori;
  double r[MSX_NUM_VARS];
  double storf[64];
  int stori[64];
${arrayFieldsC}
} ${modelId}_instance_t;

void ${modelId}_init(${modelId}_instance_t* comp);
void ${modelId}_step(${modelId}_instance_t* comp, double dt);

#endif
`;

  const initLines = variables
    .map((v) => `  comp->r[${v.valueReference}] = ${v.start}; /* ${v.name} (${v.causality}) */`)
    .join("\n");

  const bodyC = generateStmtsC(stmts, varLookup, arrayDims, "  ");

  const modelC = `/* Auto-generated by ModelScript Fortran FMU Compiler */
#include "${modelId}_model.h"
#include <math.h>
#include <string.h>

void ${modelId}_init(${modelId}_instance_t* comp) {
  memset(comp, 0, sizeof(${modelId}_instance_t));
  comp->dt = ${options.stepSize ?? 0.001};
  comp->first_step = true;
${initLines}
}

void ${modelId}_step(${modelId}_instance_t* comp, double dt) {
  if (dt > 0.0) comp->dt = dt;
  comp->nstorf = 0;
  comp->nstori = 0;
${bodyC}
  comp->time += comp->dt;
  comp->first_step = false;
}
`;

  const fmi2FunctionsC = `/* FMI 2.0 Co-Simulation & Model Exchange Entry Points for ${modelId} */
#include "${modelId}_model.h"
#include <stdlib.h>

typedef void* fmi2Component;
typedef unsigned int fmi2ValueReference;
typedef double fmi2Real;
typedef int fmi2Boolean;
typedef int fmi2Status;
#define fmi2OK 0
#define fmi2Error 3

fmi2Component fmi2Instantiate(const char* instanceName, int fmuType, const char* fmuGUID,
                              const char* fmuResourceLocation, const void* functions,
                              fmi2Boolean visible, fmi2Boolean loggingOn) {
  (void)instanceName; (void)fmuType; (void)fmuGUID;
  (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;
  ${modelId}_instance_t* comp = (${modelId}_instance_t*)malloc(sizeof(${modelId}_instance_t));
  if (comp) ${modelId}_init(comp);
  return (fmi2Component)comp;
}

void fmi2FreeInstance(fmi2Component c) {
  if (c) free(c);
}

fmi2Status fmi2SetupExperiment(fmi2Component c, fmi2Boolean toleranceDefined, fmi2Real tolerance,
                               fmi2Real startTime, fmi2Boolean stopTimeDefined, fmi2Real stopTime) {
  (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;
  if (!c) return fmi2Error;
  ((${modelId}_instance_t*)c)->time = startTime;
  return fmi2OK;
}

fmi2Status fmi2EnterInitializationMode(fmi2Component c) {
  return c ? fmi2OK : fmi2Error;
}

fmi2Status fmi2ExitInitializationMode(fmi2Component c) {
  if (!c) return fmi2Error;
  ${modelId}_step((${modelId}_instance_t*)c, 0.0);
  return fmi2OK;
}

fmi2Status fmi2GetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]) {
  if (!c) return fmi2Error;
  ${modelId}_instance_t* comp = (${modelId}_instance_t*)c;
  for (size_t i = 0; i < nvr; i++) {
    unsigned int idx = vr[i];
    value[i] = (idx < MSX_NUM_VARS) ? comp->r[idx] : 0.0;
  }
  return fmi2OK;
}

fmi2Status fmi2SetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]) {
  if (!c) return fmi2Error;
  ${modelId}_instance_t* comp = (${modelId}_instance_t*)c;
  for (size_t i = 0; i < nvr; i++) {
    unsigned int idx = vr[i];
    if (idx < MSX_NUM_VARS) comp->r[idx] = value[i];
  }
  return fmi2OK;
}

fmi2Status fmi2DoStep(fmi2Component c, fmi2Real currentCommunicationPoint,
                      fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint) {
  (void)noSetFMUStatePriorToCurrentPoint;
  if (!c) return fmi2Error;
  ${modelId}_instance_t* comp = (${modelId}_instance_t*)c;
  comp->time = currentCommunicationPoint;
  ${modelId}_step(comp, communicationStepSize);
  return fmi2OK;
}

fmi2Status fmi2Terminate(fmi2Component c) {
  return c ? fmi2OK : fmi2Error;
}

fmi2Status fmi2Reset(fmi2Component c) {
  if (!c) return fmi2Error;
  ${modelId}_init((${modelId}_instance_t*)c);
  return fmi2OK;
}
`;

  const wasmModelC = `/* WebAssembly Standalone Kernel for ${modelId} */
#include "${modelId}_model.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define WASM_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define WASM_EXPORT __attribute__((visibility("default")))
#endif

static ${modelId}_instance_t g_instance;

WASM_EXPORT void wasm_init(double start_time, double dt) {
  ${modelId}_init(&g_instance);
  g_instance.time = start_time;
  g_instance.dt = dt;
}

WASM_EXPORT void wasm_step(double dt) {
  ${modelId}_step(&g_instance, dt);
}

WASM_EXPORT double wasm_get_real(int vr) {
  return (vr >= 0 && vr < MSX_NUM_VARS) ? g_instance.r[vr] : 0.0;
}

WASM_EXPORT void wasm_set_real(int vr, double val) {
  if (vr >= 0 && vr < MSX_NUM_VARS) g_instance.r[vr] = val;
}
`;

  const cmakeLists = `cmake_minimum_required(VERSION 3.12)
project(${modelId} C)
add_library(${modelId} SHARED ${modelId}_model.c fmi2Functions.c)
set_target_properties(${modelId} PROPERTIES PREFIX "")
if(UNIX)
  target_link_libraries(${modelId} PRIVATE m)
endif()
`;

  const modelDescription2Xml = generateFmi2Xml(modelId, guid, variables, options);
  const modelDescription3Xml = generateFmi3Xml(modelId, guid, variables, options);

  const encoder = new TextEncoder();
  const filesMap = new Map<string, Uint8Array>();

  const fmiVer = options.fmiVersion ?? "both";
  if (fmiVer === "2.0" || fmiVer === "both") {
    filesMap.set("modelDescription.xml", encoder.encode(modelDescription2Xml));
  }
  if (fmiVer === "3.0" || fmiVer === "both") {
    filesMap.set(
      fmiVer === "3.0" ? "modelDescription.xml" : "fmi3ModelDescription.xml",
      encoder.encode(modelDescription3Xml),
    );
  }

  if (options.includeSources !== false) {
    filesMap.set(`sources/${modelId}_model.h`, encoder.encode(modelH));
    filesMap.set(`sources/${modelId}_model.c`, encoder.encode(modelC));
    filesMap.set("sources/fmi2Functions.c", encoder.encode(fmi2FunctionsC));
    filesMap.set("sources/CMakeLists.txt", encoder.encode(cmakeLists));
  }

  if (options.includeWasmSource !== false) {
    filesMap.set(`sources/${modelId}_wasm.c`, encoder.encode(wasmModelC));
  }

  const daeSummary = {
    stateCount: loweredDae.stateVarIndices.length,
    inputCount: loweredDae.inputVarIndices.length,
    outputCount: loweredDae.outputVarIndices.length,
    parameterCount: loweredDae.parameterVarIndices.length,
    equationCount: loweredDae.equationCount,
  };

  filesMap.set(
    "resources/model.json",
    encoder.encode(
      JSON.stringify(
        {
          modelIdentifier: modelId,
          guid,
          variables,
          daeSummary,
        },
        null,
        2,
      ),
    ),
  );

  const archive = createFortranZipArchive(filesMap);

  return {
    modelIdentifier: modelId,
    guid,
    archive,
    files: Array.from(filesMap.keys()),
    variables,
    modelDescription2Xml,
    modelDescription3Xml,
    cSources: {
      modelH,
      modelC,
      fmi2FunctionsC,
      wasmModelC,
      cmakeLists,
    },
    daeSummary,
  };
}
