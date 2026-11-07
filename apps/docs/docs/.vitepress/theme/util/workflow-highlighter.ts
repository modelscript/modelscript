// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DSL / WASM `LspFacade` + CST Syntax & Semantic Token Classifier and Linter
 * for the VitePress `HomeWorkflowPairs.vue` Showcase.
 *
 * Uses ModelScript's real compiler & LSP infrastructure across both prongs:
 * 1. `@modelscript/dsl`-compiled grammar bindings (`languages/modelica/src-gen/bindings.js`
 *    and `languages/sysml2/src-gen/bindings.js`) + native WebAssembly GLR parsers
 *    (`languages/modelica/dist/parser.wasm` and `languages/sysml2/dist/parser.wasm`):
 *    - `SYNTAX_NAMES` for grammar-derived keyword & operator vocabularies (zero hardcoded lists)
 *    - `parser.parse(code)` + `facade.getSemanticTokens(astRoot, code)` for CST-backed
 *      syntactic and semantic token spans
 *    - `facade.getDiagnostics(astRoot, 0, 0, code)` for native GLR syntax errors (with
 *      LR state-table `expectedTokens`) and compiled `CompilerLint` diagnostics (`M2002`,
 *      `M2005`, `M3001`, `M5001`, `M5005`, etc.)
 *    - `facade.getDefinition(astRoot, offset)` & `facade.getReferences(astRoot, offset)`
 * 2. `@modelscript/dsl/xml` (`parseXmlSync`) lossless XML CST (`XmlDocument`, `XmlElement`,
 *    `XmlAttribute` byte offsets) + first-party language linters (`@modelscript/urdf`,
 *    `@modelscript/simulink`, `@modelscript/autosar`, `@modelscript/ssp`).
 * 3. Unified rendering: `highlightWorkflowCode()` (Prong 1 static SSR HTML) renders the
 *    exact `SemanticSpan[]` produced by `extractSemanticSpans()` (Prong 2 Monaco
 *    `DocumentSemanticTokensProvider`), eliminating separate line-by-line regex tokenizers.
 */

import type { TGGRuleOptions } from "@modelscript/dsl";
import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { lintAutosarModel } from "../../../../../../languages/autosar/src/lints/rules.js";
import { parseArxml } from "../../../../../../languages/autosar/src/parser/arxml-parser.js";
import { autosarTggRules } from "../../../../../../languages/autosar/src/tgg/autosar-rules.js";
import { parseCfdConfig } from "../../../../../../languages/cfd/src/dialects/index.js";
import { parseInpDeck } from "../../../../../../languages/fea/src/dialects/inp.js";
import {
  createWasmParser as createModelicaParserAsync,
  createWasmParserSync as createModelicaParserSync,
  FIELD_NAMES as MODELICA_FIELD_NAMES,
  LINT_MESSAGES as MODELICA_LINT_MESSAGES,
  LINT_SEVERITIES as MODELICA_LINT_SEVERITIES,
  SYNTAX_NAMES as MODELICA_SYNTAX_NAMES,
} from "../../../../../../languages/modelica/src-gen/bindings.js";
import { lintPscx } from "../../../../../../languages/pscad/src/lints/index.js";
import { parsePscx } from "../../../../../../languages/pscad/src/parser/pscx-parser.js";
import { pscadIeeeTggRules } from "../../../../../../languages/pscad/src/tgg/pscad-ieee-rules.js";
import { lintReqIf } from "../../../../../../languages/reqif/src/lints/rules.js";
import { parseReqIf } from "../../../../../../languages/reqif/src/parser/reqif-parser.js";
import { reqifTggRules } from "../../../../../../languages/reqif/src/tgg/reqif-rules.js";
import {
  createWasmParserSync as createScadParserSync,
  FIELD_NAMES as SCAD_FIELD_NAMES,
  SYNTAX_NAMES as SCAD_SYNTAX_NAMES,
} from "../../../../../../languages/scad/src-gen/bindings.js";
import { lintSimulinkModel } from "../../../../../../languages/simulink/src/lints/index.js";
import { parseSlxXml } from "../../../../../../languages/simulink/src/parser/slx-xml-parser.js";
import { simulinkTggRules } from "../../../../../../languages/simulink/src/tgg/simulink-rules.js";
import { lintSsp } from "../../../../../../languages/ssp/src/linter.js";
import {
  createWasmParserSync as createStepParserSync,
  FIELD_NAMES as STEP_FIELD_NAMES,
  SYNTAX_NAMES as STEP_SYNTAX_NAMES,
} from "../../../../../../languages/step/src-gen/bindings.js";
import {
  createWasmParser as createSysmlParserAsync,
  createWasmParserSync as createSysmlParserSync,
  FIELD_NAMES as SYSML_FIELD_NAMES,
  LINT_MESSAGES as SYSML_LINT_MESSAGES,
  LINT_SEVERITIES as SYSML_LINT_SEVERITIES,
  SYNTAX_NAMES as SYSML_SYNTAX_NAMES,
} from "../../../../../../languages/sysml2/src-gen/bindings.js";
import { lintUrdfRobot } from "../../../../../../languages/urdf/src/lints/index.js";
import { parseUrdf } from "../../../../../../languages/urdf/src/parser/urdf-parser.js";
import { urdfTggRules } from "../../../../../../languages/urdf/src/tgg/urdf-rules.js";
import { fmi3TggRules } from "../../../../../../packages/exchange/src/fmu/fmi3-tgg.js";
import { registerRequirementBinderParsers } from "../../../../../../packages/runtime/src/formal/requirement_binder.js";
import {
  maskCommentsPreservingOffsets,
  parseModelicaCst,
  parseSysml2Cst,
} from "../../../../../../packages/runtime/src/interop/cst-polyglot-adapters";
import type { PolyglotNode } from "../../../../../../packages/runtime/src/interop/polyglot-transformer.js";
import {
  evaluateRuleDescriptor,
  matchNodePattern,
  solveWhereConstraints,
} from "../../../../../../packages/runtime/src/interop/tgg-pattern-interpreter.js";

export type WorkflowSemanticKind =
  | "class"
  | "parameter"
  | "port"
  | "state"
  | "component"
  | "keyword"
  | "type"
  | "function"
  | "property"
  | "string"
  | "number"
  | "comment"
  | "operator";

export interface SemanticSpan {
  /** 0-indexed line number */
  line: number;
  /** 0-indexed character column */
  startCol: number;
  /** Token character length */
  length: number;
  /** Semantic classification */
  kind: WorkflowSemanticKind;
  /** Optional CSS class override for specialized status badges */
  cssClass?: string;
  /** Whether this token is a declaration site */
  declaration?: boolean;
  /** Whether this token is read-only / constant / parameter */
  readonly?: boolean;
  /** Optional rich markdown hover card content */
  hoverMarkdown?: string;
}

export interface WorkflowDiagnostic {
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed start column */
  startCol: number;
  /** 1-indexed end line */
  endLine: number;
  /** 1-indexed end column */
  endCol: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  expectedTokens?: string[];
}

export interface DslGrammarVocabulary {
  keywords: Set<string>;
  typeKeywords: Set<string>;
  builtinFunctions: Set<string>;
  operators: Set<string>;
}

/**
 * Extracts terminal keywords, built-in types, functions, and operators directly from
 * the `@modelscript/dsl`-compiled `SYNTAX_NAMES` array in `src-gen/bindings.js`.
 */
export function extractDslGrammarVocabulary(
  syntaxNames: readonly string[],
  typeLiterals: readonly string[],
  builtinLiterals: readonly string[],
): DslGrammarVocabulary {
  const keywords = new Set<string>();
  const typeKeywords = new Set<string>(typeLiterals);
  const builtinFunctions = new Set<string>(builtinLiterals);
  const operators = new Set<string>();

  for (const raw of syntaxNames) {
    if (!raw || raw.length < 3 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
      continue;
    }
    const lit = raw.slice(1, -1);
    // Multi-word terminal like "end if" -> add constituent words
    if (/^[a-zA-Z_][a-zA-Z0-9_]*(?:\s+[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(lit)) {
      for (const part of lit.split(/\s+/)) {
        if (builtinFunctions.has(part)) continue;
        if (typeKeywords.has(part)) continue;
        keywords.add(part);
      }
    } else if (/^[^a-zA-Z0-9_\s]+$/.test(lit)) {
      operators.add(lit);
    }
  }

  return { keywords, typeKeywords, builtinFunctions, operators };
}

export const MODELICA_GRAMMAR_VOCAB: DslGrammarVocabulary = extractDslGrammarVocabulary(
  MODELICA_SYNTAX_NAMES,
  ["Real", "Integer", "Boolean", "String", "StateSelect", "Clock"],
  [
    "der",
    "connect",
    "pre",
    "edge",
    "change",
    "reinit",
    "sample",
    "sin",
    "cos",
    "tan",
    "sqrt",
    "exp",
    "log",
    "abs",
    "min",
    "max",
    "noEvent",
    "smooth",
  ],
);

export const SYSML_GRAMMAR_VOCAB: DslGrammarVocabulary = extractDslGrammarVocabulary(
  SYSML_SYNTAX_NAMES,
  ["Real", "Scalar", "Integer", "Boolean", "String", "Natural", "ISQ", "SI"],
  [],
);

export const SCAD_GRAMMAR_VOCAB: DslGrammarVocabulary = extractDslGrammarVocabulary(
  SCAD_SYNTAX_NAMES,
  [],
  ["tag_port"],
);

export const STEP_GRAMMAR_VOCAB: DslGrammarVocabulary = extractDslGrammarVocabulary(
  STEP_SYNTAX_NAMES,
  [],
  [],
);

interface WasmLanguageRuntime {
  facade: any;
  parser: any;
}

let modelicaWasmRuntime: WasmLanguageRuntime | null = null;
let sysmlWasmRuntime: WasmLanguageRuntime | null = null;
let scadWasmRuntime: WasmLanguageRuntime | null = null;
let stepWasmRuntime: WasmLanguageRuntime | null = null;
let nodeInitAttempted = false;
let browserInitPromise: Promise<void> | null = null;

/**
 * In Node.js / VitePress SSR (`process.versions.node`), synchronously initializes
 * the compiled Modelica, SysML v2, OpenSCAD, and STEP WebAssembly GLR parsers (`dist/parser.wasm`)
 * via `createWasmParserSync` from `src-gen/bindings.js`.
 */
function ensureNodeWasmParsersSync(): void {
  if (nodeInitAttempted) return;
  if (typeof process === "undefined" || !process.versions?.node) return;
  nodeInitAttempted = true;

  try {
    const moUrl = new URL(
      "../../../../../../languages/modelica/dist/parser.wasm",
      import.meta.url,
    );
    const moPath = decodeURIComponent(moUrl.pathname);
    modelicaWasmRuntime = createModelicaParserSync(moPath, {
      syntaxNames: MODELICA_SYNTAX_NAMES,
      fieldNames: MODELICA_FIELD_NAMES,
      lintMessages: MODELICA_LINT_MESSAGES,
      lintSeverities: MODELICA_LINT_SEVERITIES,
    });
  } catch {
    modelicaWasmRuntime = null;
  }

  try {
    const sysmlUrl = new URL(
      "../../../../../../languages/sysml2/dist/parser.wasm",
      import.meta.url,
    );
    const sysmlPath = decodeURIComponent(sysmlUrl.pathname);
    sysmlWasmRuntime = createSysmlParserSync(sysmlPath, {
      syntaxNames: SYSML_SYNTAX_NAMES,
      fieldNames: SYSML_FIELD_NAMES,
      lintMessages: SYSML_LINT_MESSAGES,
      lintSeverities: SYSML_LINT_SEVERITIES,
    });
  } catch {
    sysmlWasmRuntime = null;
  }

  try {
    const scadUrl = new URL(
      "../../../../../../languages/scad/dist/parser.wasm",
      import.meta.url,
    );
    const scadPath = decodeURIComponent(scadUrl.pathname);
    scadWasmRuntime = createScadParserSync(scadPath, {
      syntaxNames: SCAD_SYNTAX_NAMES,
      fieldNames: SCAD_FIELD_NAMES,
    });
  } catch {
    scadWasmRuntime = null;
  }

  try {
    const stepUrl = new URL(
      "../../../../../../languages/step/dist/parser.wasm",
      import.meta.url,
    );
    const stepPath = decodeURIComponent(stepUrl.pathname);
    stepWasmRuntime = createStepParserSync(stepPath, {
      syntaxNames: STEP_SYNTAX_NAMES,
      fieldNames: STEP_FIELD_NAMES,
    });
  } catch {
    stepWasmRuntime = null;
  }

  registerRequirementBinderParsers({
    sysmlParser: sysmlWasmRuntime?.parser,
    modelicaParser: modelicaWasmRuntime?.parser,
  });
}

/**
 * Asynchronously initializes the compiled Modelica and SysML v2 WebAssembly GLR parsers
 * in the browser from Vite asset URLs (`?url`).
 */
export async function ensureBrowserWasmParsers(
  modelicaWasmUrl: string,
  sysml2WasmUrl: string,
): Promise<void> {
  if (modelicaWasmRuntime && sysmlWasmRuntime) return;
  ensureNodeWasmParsersSync();
  if (modelicaWasmRuntime && sysmlWasmRuntime) return;

  if (!browserInitPromise) {
    browserInitPromise = (async () => {
      const [moRes, sysRes] = await Promise.allSettled([
        modelicaWasmRuntime
          ? Promise.resolve(modelicaWasmRuntime)
          : createModelicaParserAsync(modelicaWasmUrl, {
              syntaxNames: MODELICA_SYNTAX_NAMES,
              fieldNames: MODELICA_FIELD_NAMES,
              lintMessages: MODELICA_LINT_MESSAGES,
              lintSeverities: MODELICA_LINT_SEVERITIES,
            }),
        sysmlWasmRuntime
          ? Promise.resolve(sysmlWasmRuntime)
          : createSysmlParserAsync(sysml2WasmUrl, {
              syntaxNames: SYSML_SYNTAX_NAMES,
              fieldNames: SYSML_FIELD_NAMES,
              lintMessages: SYSML_LINT_MESSAGES,
              lintSeverities: SYSML_LINT_SEVERITIES,
            }),
      ]);
      if (moRes.status === "fulfilled") {
        modelicaWasmRuntime = moRes.value;
      }
      if (sysRes.status === "fulfilled") {
        sysmlWasmRuntime = sysRes.value;
      }
      registerRequirementBinderParsers({
        sysmlParser: sysmlWasmRuntime?.parser,
        modelicaParser: modelicaWasmRuntime?.parser,
      });
    })();
  }
  await browserInitPromise;
}

export function getWasmRuntime(
  lang: "modelica" | "sysml" | "scad" | "step",
): WasmLanguageRuntime | null {
  ensureNodeWasmParsersSync();
  if (lang === "modelica") return modelicaWasmRuntime;
  if (lang === "sysml") return sysmlWasmRuntime;
  if (lang === "scad") return scadWasmRuntime;
  return stepWasmRuntime;
}

/**
 * Wraps bare Modelica class-body fragments (such as `urdf-modelica`'s target snippet)
 * in a synthetic `model _Fragment_\n...\nend _Fragment_;` envelope so the native
 * Modelica WASM GLR parser can parse both full `model ... end ...;` definitions
 * and standalone component/equation fragments.
 */
export function prepareModelicaSourceForWasm(code: string): {
  source: string;
  lineOffset: number;
  totalUserLines: number;
  isFragment: boolean;
} {
  const totalUserLines = code.split("\n").length;
  const startsWithClassOrWithin =
    /^\s*(?:\/\/[^\n]*\n|\s|\/\*[\s\S]*?\*\/)*(?:within\b|(?:encapsulated\s+|partial\s+|final\s+)*(?:model|block|connector|record|package|class|function|type|operator)\b)/.test(
      code,
    );
  if (startsWithClassOrWithin) {
    return { source: code, lineOffset: 0, totalUserLines, isFragment: false };
  }
  return {
    source: `model _Fragment_\n${code}\nend _Fragment_;`,
    lineOffset: 1,
    totalUserLines,
    isFragment: true,
  };
}

/**
 * Binary-search line/column locator over source text.
 */
class LineLocator {
  private lineStarts: number[] = [0];

  constructor(private source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /** Converts 0-indexed character offset to 0-indexed `{ line, col }`. */
  offsetToPos0(offset: number): { line: number; col: number } {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx,
      col: clamped - this.lineStarts[lineIdx]!,
    };
  }

  /** Converts 0-indexed `{ line, col }` to 0-indexed character offset. */
  pos0ToOffset(line: number, col: number): number {
    if (line <= 0) return Math.max(0, col);
    if (line >= this.lineStarts.length) return this.source.length;
    return Math.min(this.source.length, this.lineStarts[line]! + col);
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SymbolRoleInfo {
  kind: "class" | "parameter" | "port" | "state" | "component" | "property";
  detail: string;
}

/**
 * Builds a semantic symbol table from Modelica or SysML v2 CSTs so identifier tokens
 * receive rich TGG semantic envelope metadata (`parameter`, `port`, `state`, `class`, `component`).
 */
export function buildSemanticSymbolMap(
  code: string,
  lang: string,
): Map<string, SymbolRoleInfo> {
  const map = new Map<string, SymbolRoleInfo>();

  if (lang === "modelica") {
    const cst = parseModelicaCst(code);
    if (cst.modelName && cst.modelName !== "ModelicaModel") {
      map.set(cst.modelName, {
        kind: "class",
        detail: `**Modelica ${cst.kind}** \`${cst.modelName}\`\n\nDeclared ${cst.components.length} component(s), ${cst.connections.length} connection(s), and ${cst.equations.length} equation(s).`,
      });
    }
    for (const st of cst.stateVars) {
      map.set(st, {
        kind: "state",
        detail: `**Continuous State Variable** \`${st}\`\n\nDifferentiated via \`der(${st})\` in the DAE system.`,
      });
    }
    for (const comp of cst.components) {
      if (cst.stateVars.has(comp.name)) {
        map.set(comp.name, {
          kind: "state",
          detail: `**Continuous State (${comp.causality})** \`${comp.typeSpecifier} ${comp.name}\`${comp.description ? `\n\n*"${comp.description}"*` : ""}`,
        });
      } else if (comp.causality === "parameter" || comp.variability === "constant") {
        map.set(comp.name, {
          kind: "parameter",
          detail: `**TGG Envelope Parameter** \`${comp.typePrefix} ${comp.typeSpecifier} ${comp.name}${comp.bindingExpr ? ` = ${comp.bindingExpr}` : ""}\`${comp.description ? `\n\n*"${comp.description}"*` : ""}`,
        });
      } else if (comp.causality === "input" || comp.causality === "output") {
        map.set(comp.name, {
          kind: "port",
          detail: `**Causal Connector / Port (${comp.causality})** \`${comp.typeSpecifier} ${comp.name}\``,
        });
      } else {
        map.set(comp.name, {
          kind: "component",
          detail: `**Subsystem Component** \`${comp.typeSpecifier} ${comp.name}\``,
        });
      }
      for (const mod of comp.modifierNodes) {
        if (!map.has(mod.name)) {
          map.set(mod.name, {
            kind: "parameter",
            detail: `**Component Modifier** \`${comp.name}.${mod.name} = ${mod.value}\`\n\nBijectively mapped in TGG semantic envelope.`,
          });
        }
      }
    }
  } else if (lang === "sysml" || lang === "sysml2") {
    const cst = parseSysml2Cst(code);
    for (const req of cst.requirementDefs) {
      map.set(req.id, {
        kind: "class",
        detail: `**SysML v2 Requirement** \`${req.id}\`${req.docText ? `\n\n*"${req.docText}"*` : ""}`,
      });
      map.set(`${req.id.replace(/[^A-Za-z0-9_]/g, "_")}_Def`, {
        kind: "class",
        detail: `**SysML v2 Requirement Definition** for \`${req.id}\``,
      });
      for (const [attrKey, attrVal] of Object.entries(req.attributes)) {
        map.set(attrKey, {
          kind: "parameter",
          detail: `**Requirement Attribute** \`${attrKey} = ${attrVal}\``,
        });
      }
    }
    for (const part of cst.partDefs) {
      map.set(part.name, {
        kind: "class",
        detail: `**SysML v2 Part Definition** \`${part.name}\` (${part.ports.length} port(s), ${part.actions.length} action(s))`,
      });
      for (const port of part.ports) {
        map.set(port.name, {
          kind: "port",
          detail: `**SysML v2 Directed Port (${port.direction})** \`${port.name}\``,
        });
      }
      for (const act of part.actions) {
        map.set(act.name, {
          kind: "component",
          detail: `**SysML v2 Action / Runnable** \`${act.name}\``,
        });
      }
      for (const [attrKey, attrVal] of Object.entries(part.attributes)) {
        map.set(attrKey, {
          kind: "parameter",
          detail: `**Part Attribute** \`${attrKey} = ${attrVal}\``,
        });
      }
    }
  }

  return map;
}

/**
 * Extracts comment spans (`// ...` and `/* ... * /`) from source code since comments are
 * grammar `extras` skipped by CST leaf nodes in Modelica.
 */
function collectCommentSpans(code: string, spans: SemanticSpan[], seen: Set<string>): void {
  const lines = code.split("\n");
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    let i = 0;
    while (i < line.length) {
      if (inBlockComment) {
        const closeIdx = line.indexOf("*/", i);
        if (closeIdx === -1) {
          if (line.length - i > 0) {
            const key = `${lineIdx}:${i}`;
            if (!seen.has(key)) {
              seen.add(key);
              spans.push({ line: lineIdx, startCol: i, length: line.length - i, kind: "comment" });
            }
          }
          break;
        } else {
          const len = closeIdx + 2 - i;
          const key = `${lineIdx}:${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            spans.push({ line: lineIdx, startCol: i, length: len, kind: "comment" });
          }
          inBlockComment = false;
          i = closeIdx + 2;
          continue;
        }
      }
      const ch = line[i]!;
      if (ch === '"') {
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === "\\") i++;
          i++;
        }
        i++;
        continue;
      }
      if (ch === "/" && line[i + 1] === "/") {
        const key = `${lineIdx}:${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          spans.push({ line: lineIdx, startCol: i, length: line.length - i, kind: "comment" });
        }
        break;
      }
      if (ch === "/" && line[i + 1] === "*") {
        const closeIdx = line.indexOf("*/", i + 2);
        if (closeIdx !== -1) {
          const len = closeIdx + 2 - i;
          const key = `${lineIdx}:${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            spans.push({ line: lineIdx, startCol: i, length: len, kind: "comment" });
          }
          i = closeIdx + 2;
          continue;
        } else {
          const key = `${lineIdx}:${i}`;
          if (!seen.has(key)) {
            seen.add(key);
            spans.push({ line: lineIdx, startCol: i, length: line.length - i, kind: "comment" });
          }
          inBlockComment = true;
          break;
        }
      }
      i++;
    }
  }
}

const SYSML_DEFINITION_NODE_TYPES = new Set([
  "PartDefinition",
  "AttributeDefinition",
  "PortDefinition",
  "ConnectionDefinition",
  "InterfaceDefinition",
  "AllocationDefinition",
  "ActionDefinition",
  "StateDefinition",
  "ConstraintDefinition",
  "RequirementDefinition",
  "ConcernDefinition",
  "CaseDefinition",
  "AnalysisCaseDefinition",
  "VerificationCaseDefinition",
  "ViewDefinition",
  "ViewpointDefinition",
  "RenderingDefinition",
  "CalculationDefinition",
  "EnumerationDefinition",
  "OccurrenceDefinition",
  "ItemDefinition",
  "FlowDefinition",
  "MetadataDefinition",
  "Package",
  "LibraryPackage",
]);

/**
 * Extracts CST-backed syntax and semantic token spans from the Modelica or SysML v2
 * WebAssembly GLR parser (`parser.parse(code)` + `facade.getSemanticTokens()`).
 */
function extractWasmCstSemanticSpans(
  code: string,
  lang: "modelica" | "sysml",
  symMap: Map<string, SymbolRoleInfo>,
): SemanticSpan[] | null {
  const runtime = getWasmRuntime(lang);
  if (!runtime?.parser) return null;

  const isModelica = lang === "modelica";
  const vocab = isModelica ? MODELICA_GRAMMAR_VOCAB : SYSML_GRAMMAR_VOCAB;
  const prepared = isModelica
    ? prepareModelicaSourceForWasm(code)
    : { source: code, lineOffset: 0, totalUserLines: code.split("\n").length, isFragment: false };

  let tree: any;
  try {
    tree = runtime.parser.parse(prepared.source);
  } catch {
    return null;
  }
  if (!tree?.rootNode) return null;

  const spans: SemanticSpan[] = [];
  const seen = new Set<string>();

  collectCommentSpans(code, spans, seen);

  const pushSpan = (
    row: number,
    col: number,
    length: number,
    kind: WorkflowSemanticKind,
    declaration?: boolean,
    readonly?: boolean,
    hoverMarkdown?: string,
  ) => {
    const userLine = row - prepared.lineOffset;
    if (userLine < 0 || userLine >= prepared.totalUserLines || length <= 0) return;
    const key = `${userLine}:${col}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push({
      line: userLine,
      startCol: col,
      length,
      kind,
      ...(declaration ? { declaration: true } : {}),
      ...(readonly ? { readonly: true } : {}),
      ...(hoverMarkdown ? { hoverMarkdown } : {}),
    });
  };

  const traverse = (node: any) => {
    const children = node.children;
    if (!children || children.length === 0) {
      const text: string = node.text || "";
      if (!text || /^\s+$/.test(text)) return;

      const row = node.startPosition.row;
      const col = node.startPosition.column;
      const parentType: string = node.parent?.type || "";

      // Multi-line comment or string node
      if (node.startPosition.row < node.endPosition.row) {
        const nodeLines = text.split("\n");
        const isComment =
          parentType === "REGULAR_COMMENT" ||
          parentType === "ML_NOTE" ||
          parentType === "SL_NOTE" ||
          text.startsWith("/*") ||
          text.startsWith("//");
        const multiKind: WorkflowSemanticKind = isComment ? "comment" : "string";
        for (let i = 0; i < nodeLines.length; i++) {
          const r = row + i;
          const c = i === 0 ? col : 0;
          pushSpan(r, c, nodeLines[i]!.length, multiKind);
        }
        return;
      }

      const len = node.endPosition.column - col;
      if (len <= 0) return;

      // 1. Comments in CST
      if (
        parentType === "REGULAR_COMMENT" ||
        parentType === "ML_NOTE" ||
        parentType === "SL_NOTE" ||
        text.startsWith("//") ||
        text.startsWith("/*")
      ) {
        pushSpan(row, col, len, "comment");
        return;
      }

      // 2. String literals
      if (
        parentType === "string_literal" ||
        parentType === "description_string" ||
        parentType === "STRING_VALUE" ||
        parentType === "LiteralString" ||
        text.startsWith('"')
      ) {
        pushSpan(row, col, len, "string");
        return;
      }

      // 3. Numeric literals
      if (
        parentType === "unsigned_integer" ||
        parentType === "unsigned_real" ||
        parentType === "DECIMAL_VALUE" ||
        parentType === "EXP_VALUE" ||
        parentType === "LiteralInteger" ||
        parentType === "LiteralReal" ||
        /^\d/.test(text)
      ) {
        pushSpan(row, col, len, "number");
        return;
      }

      // 4. Built-in functions (`der`, `connect`, etc.)
      if (vocab.builtinFunctions.has(text)) {
        const hover =
          text === "der"
            ? "**Modelica Operator** `der(x)` — Time derivative $\\frac{dx}{dt}$ of continuous state `x`."
            : text === "connect"
              ? "**Modelica Equation** `connect(a, b)` — Acausal/causal connector topology equation mapped via TGG `SimulinkLineToConnect` / `UrdfJointToRevolute`."
              : `**Modelica Built-in** \`${text}()\``;
        pushSpan(row, col, len, "function", false, false, hover);
        return;
      }

      // 5. Built-in type keywords (`Real`, `Integer`, `Scalar`, `String`, etc.)
      if (vocab.typeKeywords.has(text)) {
        pushSpan(row, col, len, "type");
        return;
      }

      // 6. Grammar terminal keywords (`"model"`, `"parameter"`, `"requirement"`, `"part"`, etc.)
      if (
        (node.type.startsWith('"') && vocab.keywords.has(text)) ||
        (vocab.keywords.has(text) && parentType !== "identifier" && parentType !== "ID")
      ) {
        pushSpan(row, col, len, "keyword");
        return;
      }

      // 7. Identifiers classified via WASM CST ancestor chain + TGG symbol table
      if (/^[A-Za-z_]/.test(text)) {
        const sym = symMap.get(text);
        if (sym) {
          pushSpan(
            row,
            col,
            len,
            sym.kind,
            false,
            sym.kind === "parameter",
            sym.detail,
          );
          return;
        }

        // Walk up WASM CST ancestors to classify structural role
        let anc = node.parent;
        let ancestorKind: WorkflowSemanticKind | null = null;
        let isDecl = false;
        let hover: string | undefined;

        while (anc) {
          const at: string = anc.type || "";
          if (isModelica) {
            if (
              at === "long_class_specifier" ||
              at === "short_class_specifier" ||
              at === "der_class_specifier"
            ) {
              ancestorKind = "class";
              isDecl = true;
              hover = `**Modelica Class** \`${text}\``;
              break;
            }
            if (at === "type_specifier" || at === "extends_clause" || at === "within_clause") {
              ancestorKind = "type";
              break;
            }
            if (at === "element_modification" || at === "named_argument") {
              // Left-hand side modifier name
              if (anc.startPosition.row === row && anc.startPosition.column === col) {
                ancestorKind = "parameter";
                hover = `**Modifier Parameter** \`${text}\``;
                break;
              }
            }
            if (at === "declaration" || at === "component_declaration") {
              ancestorKind = "component";
              isDecl = true;
              break;
            }
            if (at === "component_reference") {
              // If preceded by '.', it's a connector port or member access
              if (anc.startPosition.column < col) {
                ancestorKind = "port";
                hover = `**Connector Port / Member** \`.${text}\``;
              }
              break;
            }
            if (at === "function_call") {
              ancestorKind = "function";
              break;
            }
          } else {
            // SysML v2 CST ancestor classification
            if (SYSML_DEFINITION_NODE_TYPES.has(at)) {
              ancestorKind = "class";
              isDecl = true;
              hover = `**SysML v2 ${at}** \`${text}\``;
              break;
            }
            if (
              at === "OwnedFeatureTyping" ||
              at === "ConjugatedPortTyping" ||
              at === "TypeReference"
            ) {
              ancestorKind = "type";
              break;
            }
            if (at === "AttributeUsage") {
              ancestorKind = "parameter";
              isDecl = true;
              hover = `**SysML v2 Attribute** \`${text}\` (Bijectively synced via TGG envelope)`;
              break;
            }
            if (at === "PortUsage") {
              ancestorKind = "port";
              isDecl = true;
              hover = `**SysML v2 Port** \`${text}\``;
              break;
            }
            if (at === "ActionUsage" || at === "PerformActionUsage") {
              ancestorKind = "component";
              isDecl = true;
              hover = `**SysML v2 Action** \`${text}\``;
              break;
            }
            if (at === "RequirementUsage" || at === "PartUsage") {
              ancestorKind = "class";
              isDecl = true;
              break;
            }
            if (at === "FeatureReferenceExpression") {
              ancestorKind = "parameter";
              break;
            }
          }
          anc = anc.parent;
        }

        if (ancestorKind) {
          pushSpan(row, col, len, ancestorKind, isDecl, ancestorKind === "parameter", hover);
          return;
        }

        if (vocab.keywords.has(text)) {
          pushSpan(row, col, len, "keyword");
          return;
        }
        if (/^[A-Z]/.test(text)) {
          pushSpan(row, col, len, "type");
          return;
        }
        return;
      }

      // 8. Operators & punctuation
      if (vocab.operators.has(text) || /^[=<>+\-*/:;,.(){}[\]]+$/.test(text)) {
        pushSpan(row, col, len, "operator");
      }
      return;
    }

    for (const child of children) {
      traverse(child);
    }
  };

  try {
    traverse(tree.rootNode);
  } finally {
    tree.delete?.();
  }

  spans.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.startCol - b.startCol));
  return spans;
}

/**
 * Extracts syntax and semantic token spans from an XML document using `@modelscript/dsl/xml`
 * (`parseXmlSync`) CST byte offsets (`XmlElement` and `XmlAttribute`).
 */
function extractXmlCstSpans(code: string): SemanticSpan[] {
  const spans: SemanticSpan[] = [];
  const locator = new LineLocator(code);
  const doc = parseXmlSync(code);

  // 1. Collect XML comments `<!-- ... -->`
  let searchIdx = 0;
  while (searchIdx < code.length) {
    const cStart = code.indexOf("<!--", searchIdx);
    if (cStart === -1) break;
    const cEnd = code.indexOf("-->", cStart + 4);
    const actualEnd = cEnd === -1 ? code.length : cEnd + 3;
    const startPos = locator.offsetToPos0(cStart);
    const endPos = locator.offsetToPos0(actualEnd);
    if (startPos.line === endPos.line) {
      spans.push({
        line: startPos.line,
        startCol: startPos.col,
        length: endPos.col - startPos.col,
        kind: "comment",
      });
    }
    searchIdx = actualEnd;
  }

  // 2. Walk `@modelscript/dsl/xml` `XmlElement` CST nodes
  const visitElement = (el: XmlElement) => {
    const openPos = locator.offsetToPos0(el.start);
    // Opening `<` and tag name
    spans.push({
      line: openPos.line,
      startCol: openPos.col,
      length: 1,
      kind: "operator",
    });
    spans.push({
      line: openPos.line,
      startCol: openPos.col + 1,
      length: el.name.length,
      kind: "keyword",
      hoverMarkdown: `**XML Element** \`<${el.name}>\``,
    });

    // Attributes with exact byte offsets from `XmlAttribute`
    for (const attr of el.attributes) {
      const attrPos = locator.offsetToPos0(attr.start);
      spans.push({
        line: attrPos.line,
        startCol: attrPos.col,
        length: attr.name.length,
        kind: "property",
        hoverMarkdown: `**XML Attribute** \`${attr.name}\` — Bound in TGG Semantic Envelope.`,
      });

      // `=` delimiter between attribute name and quote
      const eqOffset = code.indexOf("=", attr.start + attr.name.length);
      if (eqOffset !== -1 && eqOffset < attr.valueStart) {
        const eqPos = locator.offsetToPos0(eqOffset);
        spans.push({
          line: eqPos.line,
          startCol: eqPos.col,
          length: 1,
          kind: "operator",
        });
      }

      // Quoted attribute value (including surrounding quotes `[valueStart - 1, valueEnd + 1]`)
      const quoteStartPos = locator.offsetToPos0(Math.max(0, attr.valueStart - 1));
      const quoteLen = attr.valueEnd - attr.valueStart + 2;
      const isIdAttr = /^(name|Name|IDENTIFIER|id|defn|BlockType|type)$/i.test(attr.name);
      const isNumVal = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(attr.value.trim());
      spans.push({
        line: quoteStartPos.line,
        startCol: quoteStartPos.col,
        length: quoteLen,
        kind: isIdAttr ? "class" : isNumVal ? "parameter" : "string",
        readonly: isNumVal,
        hoverMarkdown: isIdAttr
          ? `**TGG Entity Identifier** \`${attr.name}="${attr.value}"\``
          : isNumVal
            ? `**TGG Physical Parameter** \`${attr.name}=${attr.value}\` (Subject to \`tggReconcilePhysics\` feasibility bounds)`
            : `**Attribute Value** \`"${attr.value}"\``,
      });
    }

    // Closing `>` or `/>` of the opening tag
    if (el.openEnd > el.start) {
      const closeBracketLen = el.selfClosing ? 2 : 1;
      const closeBracketPos = locator.offsetToPos0(el.openEnd - closeBracketLen);
      spans.push({
        line: closeBracketPos.line,
        startCol: closeBracketPos.col,
        length: closeBracketLen,
        kind: "operator",
      });
    }

    // Text content inside leaf element (e.g. `<P Name="Src">DamperError#out:1</P>` or `<P Name="SampleTime">0.001</P>`)
    if (!el.selfClosing && el.children.length === 0 && el.closeStart > el.openEnd) {
      const rawText = code.slice(el.openEnd, el.closeStart);
      const endpointMatch = /^(\s*)([A-Za-z_]\w*)(#(out|in):\d+)(\s*)$/.exec(rawText);
      if (endpointMatch) {
        const compStart = el.openEnd + endpointMatch[1]!.length;
        const compName = endpointMatch[2]!;
        const portSuffix = endpointMatch[3]!;
        const compPos = locator.offsetToPos0(compStart);
        const portPos = locator.offsetToPos0(compStart + compName.length);
        spans.push({
          line: compPos.line,
          startCol: compPos.col,
          length: compName.length,
          kind: "component",
          hoverMarkdown: `**Simulink Block Endpoint** \`${compName}\``,
        });
        spans.push({
          line: portPos.line,
          startCol: portPos.col,
          length: portSuffix.length,
          kind: "port",
          hoverMarkdown: `**Simulink Port** \`${portSuffix}\``,
        });
      } else {
        const numRe = /(?<![\w.-])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.-])/g;
        let m: RegExpExecArray | null;
        while ((m = numRe.exec(rawText)) !== null) {
          const numPos = locator.offsetToPos0(el.openEnd + m.index);
          spans.push({
            line: numPos.line,
            startCol: numPos.col,
            length: m[1]!.length,
            kind: "number",
          });
        }
      }
    }

    for (const child of el.children) {
      visitElement(child);
    }

    // Closing tag `</tagName>`
    if (!el.selfClosing && el.closeStart < el.end && code.startsWith("</", el.closeStart)) {
      const closePos = locator.offsetToPos0(el.closeStart);
      spans.push({
        line: closePos.line,
        startCol: closePos.col,
        length: 2,
        kind: "operator",
      });
      spans.push({
        line: closePos.line,
        startCol: closePos.col + 2,
        length: el.name.length,
        kind: "keyword",
      });
      const endBracketPos = locator.offsetToPos0(el.end - 1);
      spans.push({
        line: endBracketPos.line,
        startCol: endBracketPos.col,
        length: 1,
        kind: "operator",
      });
    }
  };

  if (doc.root) {
    visitElement(doc.root);
  }

  spans.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.startCol - b.startCol));
  return spans;
}

/**
 * Fallback grammar-vocabulary token extractor used only in the browser before
 * `ensureBrowserWasmParsers()` finishes fetching `.wasm` assets.
 * Uses `MODELICA_GRAMMAR_VOCAB` / `SYSML_GRAMMAR_VOCAB` harvested from `@modelscript/dsl`
 * `SYNTAX_NAMES` (zero hardcoded keyword lists).
 */
function extractFallbackVocabSpans(
  code: string,
  lang: "modelica" | "sysml",
  symMap: Map<string, SymbolRoleInfo>,
): SemanticSpan[] {
  const spans: SemanticSpan[] = [];
  const vocab = lang === "modelica" ? MODELICA_GRAMMAR_VOCAB : SYSML_GRAMMAR_VOCAB;
  const lines = code.split("\n");
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    let i = 0;
    const len = line.length;

    while (i < len) {
      if (inBlockComment) {
        const closeIdx = line.indexOf("*/", i);
        if (closeIdx === -1) {
          spans.push({ line: lineIdx, startCol: i, length: len - i, kind: "comment" });
          break;
        } else {
          spans.push({ line: lineIdx, startCol: i, length: closeIdx + 2 - i, kind: "comment" });
          i = closeIdx + 2;
          inBlockComment = false;
          continue;
        }
      }

      const ch = line[i]!;
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "/" && line[i + 1] === "/") {
        spans.push({ line: lineIdx, startCol: i, length: len - i, kind: "comment" });
        break;
      }
      if (ch === "/" && line[i + 1] === "*") {
        const closeIdx = line.indexOf("*/", i + 2);
        if (closeIdx !== -1) {
          spans.push({ line: lineIdx, startCol: i, length: closeIdx + 2 - i, kind: "comment" });
          i = closeIdx + 2;
          continue;
        } else {
          spans.push({ line: lineIdx, startCol: i, length: len - i, kind: "comment" });
          inBlockComment = true;
          break;
        }
      }
      if (ch === '"') {
        let end = i + 1;
        while (end < len && line[end] !== '"') {
          if (line[end] === "\\") end++;
          end++;
        }
        if (end < len) end++;
        spans.push({ line: lineIdx, startCol: i, length: end - i, kind: "string" });
        i = end;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(line[i + 1] ?? ""))) {
        const numMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(line.slice(i));
        if (numMatch) {
          spans.push({ line: lineIdx, startCol: i, length: numMatch[0].length, kind: "number" });
          i += numMatch[0].length;
          continue;
        }
      }
      if (/[A-Za-z_]/.test(ch)) {
        const idMatch = /^[A-Za-z_]\w*/.exec(line.slice(i));
        if (idMatch) {
          const word = idMatch[0];
          const sym = symMap.get(word);
          if (vocab.keywords.has(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "keyword" });
          } else if (vocab.typeKeywords.has(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "type" });
          } else if (vocab.builtinFunctions.has(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "function" });
          } else if (sym) {
            spans.push({
              line: lineIdx,
              startCol: i,
              length: word.length,
              kind: sym.kind,
              readonly: sym.kind === "parameter",
              hoverMarkdown: sym.detail,
            });
          } else if (line[i - 1] === ".") {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "port" });
          } else if (/^[A-Z]/.test(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "type" });
          }
          i += word.length;
          continue;
        }
      }
      if (/[=<>+\-*/:;,.(){}[\]]/.test(ch)) {
        spans.push({ line: lineIdx, startCol: i, length: 1, kind: "operator" });
      }
      i++;
    }
  }

  return spans;
}

function extractScadOrStepWasmCstSpans(
  code: string,
  lang: "scad" | "step",
): SemanticSpan[] | null {
  const runtime = getWasmRuntime(lang);
  if (!runtime?.parser) return null;

  const cleanCode = lang === "step" ? maskCommentsPreservingOffsets(code) : code;
  const isBareStepFragment = lang === "step" && !cleanCode.includes("ISO-10303-21;");
  const parseSource = isBareStepFragment
    ? `ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242'));\nENDSEC;\nDATA;\n${cleanCode}\nENDSEC;\nEND-ISO-10303-21;`
    : cleanCode;
  const lineOffset = isBareStepFragment ? 5 : 0;
  const totalUserLines = code.split("\n").length;

  const tree = runtime.parser.parse(parseSource);
  if (!tree?.rootNode) return null;

  const spans: SemanticSpan[] = [];
  const seen = new Set<string>();
  const vocab = lang === "scad" ? SCAD_GRAMMAR_VOCAB : STEP_GRAMMAR_VOCAB;

  collectCommentSpans(code, spans, seen);
  let astSpanCount = 0;

  const addSpan = (span: SemanticSpan) => {
    if (span.length <= 0 || span.line < 0 || span.line >= totalUserLines) return;
    const key = `${span.line}:${span.startCol}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push(span);
    astSpanCount++;
  };

  const visit = (node: any) => {
    if (!node) return;
    const typeName: string = node.type ?? "";
    const kids: any[] = node.children ?? [];

    if (lang === "scad" && kids.length > 0) {
      const nameNode = node.childForFieldName?.("name") ?? kids.find((c: any) => c.type === "IDENTIFIER");
      if (nameNode?.startPosition && nameNode.text) {
        const sp = nameNode.startPosition;
        const text: string = nameNode.text;
        if (typeName === "ModuleDeclaration" || typeName === "FunctionDeclaration") {
          addSpan({
            line: sp.row,
            startCol: sp.column,
            length: text.length,
            kind: "class",
            declaration: true,
            hoverMarkdown: `**OpenSCAD ${typeName === "ModuleDeclaration" ? "Module" : "Function"}** \`${text}\``,
          });
        } else if (
          typeName === "VariableDeclaration" ||
          typeName === "Parameter" ||
          typeName === "Argument"
        ) {
          addSpan({
            line: sp.row,
            startCol: sp.column,
            length: text.length,
            kind: "parameter",
            declaration: typeName !== "Argument",
            readonly: true,
            hoverMarkdown: `**OpenSCAD Parametric Binding** \`${text}\` — Synchronized via \`SemanticTheoryCoordinator\`.`,
          });
        } else if (typeName === "ModuleInstantiation") {
          addSpan({
            line: sp.row,
            startCol: sp.column,
            length: text.length,
            kind: "function",
            ...(text === "tag_port"
              ? {
                  hoverMarkdown:
                    "**ModelScript B-Rep Boundary Port** `tag_port(name, type, normal)` — Exports named topological surface group (`CAD::<Module>::port.<name>`) for FEA `NSET` / CFD patch binding.",
                }
              : {}),
          });
        }
      }
    }

    if (kids.length === 0) {
      const sp = node.startPosition;
      const ep = node.endPosition;
      const text: string = node.text ?? "";
      if (!sp || !text || /^\s+$/.test(text) || (ep && ep.row !== sp.row)) return;
      const userRow = sp.row - lineOffset;
      if (userRow < 0 || userRow >= totalUserLines) return;

      const parentType: string = node.parent?.type ?? "";
      const tokenType =
        parentType && !parentType.startsWith("/") && parentType !== "StepFile" && parentType !== "DataSection"
          ? parentType
          : typeName;
      const rawLit =
        typeName.startsWith('"') && typeName.endsWith('"')
          ? typeName.slice(1, -1)
          : text;

      if (lang === "step") {
        if (
          tokenType === "ENTITY_INSTANCE_NAME" ||
          tokenType === "EntityInstance" ||
          tokenType === "EntityReference" ||
          /^#\d+$/.test(text)
        ) {
          addSpan({
            line: userRow,
            startCol: sp.column,
            length: text.length,
            kind: "port",
            hoverMarkdown: `**STEP AP242 Entity Instance** \`STEP::BearingFit_AP242::${text}\``,
          });
        } else if (
          tokenType === "KEYWORD" ||
          tokenType === "SimpleRecord" ||
          tokenType === "TypedParameter" ||
          (/^[A-Z][A-Z0-9_]{2,}$/.test(text) && !vocab.keywords.has(text))
        ) {
          addSpan({
            line: userRow,
            startCol: sp.column,
            length: text.length,
            kind: "class",
            hoverMarkdown: `**STEP AP242 Entity** \`${text}\``,
          });
        } else if (
          tokenType === "INTEGER" ||
          tokenType === "REAL" ||
          /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)
        ) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "number" });
        } else if (tokenType === "STRING" || text.startsWith("'")) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "string" });
        } else if (tokenType === "ENUMERATION" || /^\.[A-Z0-9_]+\.$/.test(text)) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "parameter" });
        } else if (tokenType === "BLOCK_COMMENT" || text.startsWith("/*")) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "comment" });
        } else if (vocab.keywords.has(rawLit)) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "keyword" });
        } else if (vocab.operators.has(rawLit)) {
          addSpan({ line: userRow, startCol: sp.column, length: text.length, kind: "operator" });
        }
        return;
      }

      // OpenSCAD leaf nodes
      if (tokenType === "NUMBER" || /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
        addSpan({ line: sp.row, startCol: sp.column, length: text.length, kind: "number" });
      } else if (tokenType === "STRING" || text.startsWith('"')) {
        addSpan({ line: sp.row, startCol: sp.column, length: text.length, kind: "string" });
      } else if (tokenType === "BOOLEAN" || tokenType === "UNDEF") {
        addSpan({ line: sp.row, startCol: sp.column, length: text.length, kind: "keyword" });
      } else if (rawLit === "tag_port") {
        addSpan({
          line: sp.row,
          startCol: sp.column,
          length: text.length,
          kind: "function",
          hoverMarkdown:
            "**ModelScript B-Rep Boundary Port** `tag_port(name, type, normal)` — Exports named topological surface group (`CAD::<Module>::port.<name>`) for FEA `NSET` / CFD patch binding.",
        });
      } else if (vocab.keywords.has(rawLit)) {
        addSpan({ line: sp.row, startCol: sp.column, length: text.length, kind: "keyword" });
      } else if (tokenType === "IDENTIFIER" || /^[A-Za-z_]\w*$/.test(text)) {
        addSpan({
          line: sp.row,
          startCol: sp.column,
          length: text.length,
          kind: "parameter",
        });
      } else if (vocab.operators.has(rawLit)) {
        addSpan({ line: sp.row, startCol: sp.column, length: text.length, kind: "operator" });
      }
      return;
    }

    for (const child of kids) {
      visit(child);
    }
  };

  visit(tree.rootNode);
  if (astSpanCount === 0) return null;
  spans.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.startCol - b.startCol));
  return spans;
}

/**
 * Extracts CST-backed semantic token spans (0-indexed line & column) for BOTH
 * Prong 1 (`highlightWorkflowCode`) and Prong 2 (Monaco's `DocumentSemanticTokensProvider`
 * + `HoverProvider`).
 */
export function extractSemanticSpans(code: string, lang: string): SemanticSpan[] {
  if (lang === "modelica" || lang === "sysml" || lang === "sysml2") {
    const dialect = lang === "modelica" ? "modelica" : "sysml";
    const symMap = buildSemanticSymbolMap(code, dialect);
    const wasmSpans = extractWasmCstSemanticSpans(code, dialect, symMap);
    if (wasmSpans) return wasmSpans;
    return extractFallbackVocabSpans(code, dialect, symMap);
  }

  if (lang === "xml") {
    return extractXmlCstSpans(code);
  }

  if (lang === "scad" || lang === "step") {
    const wasmSpans = extractScadOrStepWasmCstSpans(code, lang);
    if (wasmSpans && wasmSpans.length > 0) {
      return wasmSpans;
    }
  }

  if (lang === "scad" || lang === "fea" || lang === "cfd" || lang === "step") {
    const spans: SemanticSpan[] = [];
    const lines = code.split("\n");
    const vocab = lang === "scad" ? SCAD_GRAMMAR_VOCAB : lang === "step" ? STEP_GRAMMAR_VOCAB : null;
    const feaDeck = lang === "fea" ? parseInpDeck(code) : null;
    const cfdConfig = lang === "cfd" ? parseCfdConfig(code, "openfoam") : null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      if (line.trimStart().startsWith("**") || ( line.trimStart().startsWith("/*") && line.trimEnd().endsWith("*/"))) {
        spans.push({ line: lineIdx, startCol: 0, length: line.length, kind: "comment" });
        continue;
      }
      const cIdx = line.indexOf("//");
      if (cIdx !== -1) {
        spans.push({ line: lineIdx, startCol: cIdx, length: line.length - cIdx, kind: "comment" });
      }
      const codeSlice = cIdx !== -1 ? line.slice(0, cIdx) : line;

      // Abaqus/CalculiX deck keyword (`*ELASTIC`, `*CLOAD`, `*STEP`, `*SOLID SECTION`, etc.)
      if (lang === "fea" && codeSlice.trimStart().startsWith("*")) {
        const starCol = codeSlice.indexOf("*");
        const commaIdx = codeSlice.indexOf(",", starCol);
        const cardEnd = commaIdx !== -1 ? commaIdx : codeSlice.length;
        const cardName = codeSlice.slice(starCol, cardEnd).trimEnd();
        const matInfo =
          feaDeck && feaDeck.materials.size > 0
            ? ` (${Array.from(feaDeck.materials.keys()).join(", ")})`
            : "";
        spans.push({
          line: lineIdx,
          startCol: starCol,
          length: cardName.length,
          kind: "keyword",
          hoverMarkdown: `**CalculiX / Abaqus FEA Card** \`${cardName}\`${matInfo}`,
        });
      }

      // OpenFOAM CFD dictionary block / entry from parsed CfdModelData
      if (lang === "cfd" && cfdConfig) {
        const trimmed = codeSlice.trim();
        if (trimmed.endsWith("{")) {
          const blockName = trimmed.slice(0, -1).trim();
          const col = codeSlice.indexOf(blockName);
          if (col !== -1 && blockName.length > 0) {
            spans.push({
              line: lineIdx,
              startCol: col,
              length: blockName.length,
              kind: "class",
              declaration: true,
              hoverMarkdown: `**OpenFOAM Dictionary Block** \`CFD::CoolantManifold::${blockName}\``,
            });
          }
        } else if (trimmed.endsWith(";")) {
          const tokens = trimmed.slice(0, -1).trim().split(/\s+/);
          if (tokens.length >= 2 && tokens[0]) {
            const keyName = tokens[0];
            const col = codeSlice.indexOf(keyName);
            if (col !== -1) {
              spans.push({
                line: lineIdx,
                startCol: col,
                length: keyName.length,
                kind: "parameter",
                declaration: true,
                readonly: true,
                hoverMarkdown: `**OpenFOAM Dictionary Directive** \`${keyName}\` = \`${tokens.slice(1).join(" ")}\``,
              });
            }
          }
        }
      }

      // Tokenize remaining literals, identifiers, and numbers on the line
      let i = 0;
      while (i < codeSlice.length) {
        if (spans.some((s) => s.line === lineIdx && i >= s.startCol && i < s.startCol + s.length)) {
          i++;
          continue;
        }
        const ch = codeSlice[i]!;
        if (ch === '"' || ch === "'") {
          const quote = ch;
          let end = i + 1;
          while (end < codeSlice.length && codeSlice[end] !== quote) {
            if (codeSlice[end] === "\\") end++;
            end++;
          }
          if (end < codeSlice.length) end++;
          spans.push({ line: lineIdx, startCol: i, length: end - i, kind: "string" });
          i = end;
          continue;
        }
        if (ch === "#" && /\d/.test(codeSlice[i + 1] ?? "")) {
          let end = i + 1;
          while (end < codeSlice.length && /\d/.test(codeSlice[end]!)) end++;
          const entityId = codeSlice.slice(i, end);
          spans.push({
            line: lineIdx,
            startCol: i,
            length: entityId.length,
            kind: "port",
            hoverMarkdown: `**STEP AP242 Entity Instance** \`STEP::BearingFit_AP242::${entityId}\``,
          });
          i = end;
          continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
          let end = i + 1;
          while (end < codeSlice.length && /\w/.test(codeSlice[end]!)) end++;
          const word = codeSlice.slice(i, end);
          let afterWs = end;
          while (afterWs < codeSlice.length && /\s/.test(codeSlice[afterWs]!)) afterWs++;
          if (codeSlice[afterWs] === "=") {
            spans.push({
              line: lineIdx,
              startCol: i,
              length: word.length,
              kind: "parameter",
              declaration: true,
              readonly: true,
              hoverMarkdown: `**Coordinator-Coupled Parameter** \`${word}\` — Synchronized across 4-domain SemanticTheoryCoordinator.`,
            });
          } else if (word === "tag_port") {
            spans.push({
              line: lineIdx,
              startCol: i,
              length: word.length,
              kind: "function",
              hoverMarkdown:
                "**ModelScript B-Rep Boundary Port** `tag_port(name, type, normal)` — Exports named topological surface group (`CAD::<Module>::port.<name>`) for FEA `NSET` / CFD patch binding.",
            });
          } else if (vocab?.keywords.has(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "keyword" });
          } else if (/^[A-Z][A-Z0-9_]{2,}$/.test(word)) {
            spans.push({ line: lineIdx, startCol: i, length: word.length, kind: "class" });
          }
          i = end;
          continue;
        }
        if ((ch === "-" && /\d/.test(codeSlice[i + 1] ?? "")) || /\d/.test(ch)) {
          let end = i + 1;
          while (end < codeSlice.length && /[\d.eE+-]/.test(codeSlice[end]!)) end++;
          spans.push({ line: lineIdx, startCol: i, length: end - i, kind: "number" });
          i = end;
          continue;
        }
        i++;
      }
    }
    spans.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.startCol - b.startCol));
    return spans;
  }

  // IEEE 2800 Verification Report
  const spans: SemanticSpan[] = [];
  const lines = code.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    const tokenRe =
      /(\[PASS\])|(\[FAIL\])|(\[Limit:[^\]]*\])|\b(Clause\s+\d+(?:\.\d+)+)|\b(T_step|I_post|I_pre|V_sag|Kp_v|Ki_v)\b|('[^']*')|(-?\d+(?:\.\d+)?(?:\s*%|\s*ms|\s*s|\s*pu)?)/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(line)) !== null) {
      if (m[1]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "keyword",
          cssClass: "tok-pass",
        });
      } else if (m[2]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "keyword",
          cssClass: "tok-fail",
        });
      } else if (m[3]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "comment",
        });
      } else if (m[4]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "class",
          hoverMarkdown: `**IEEE Std 2800-2022** \`${m[0]}\` — Bidirectional TGG compliance verification clause.`,
        });
      } else if (m[5]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "parameter",
          hoverMarkdown: `**IEEE 2800 / PSCAD Envelope Metric** \`${m[0]}\` — Editable in report to back-propagate inverter gains (\`Kp_v\`, \`Ki_v\`) to PSCAD XML.`,
        });
      } else if (m[6]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "string",
        });
      } else if (m[7]) {
        spans.push({
          line: lineIdx,
          startCol: m.index,
          length: m[0].length,
          kind: "number",
        });
      }
    }
  }
  return spans;
}

const SPAN_KIND_TO_CSS_CLASS: Record<WorkflowSemanticKind, string> = {
  keyword: "tok-keyword",
  type: "tok-type",
  function: "tok-builtin",
  class: "tok-semantic-class",
  parameter: "tok-semantic-param",
  port: "tok-semantic-port",
  state: "tok-semantic-state",
  component: "tok-semantic-component",
  property: "tok-attr-name",
  string: "tok-string",
  number: "tok-number",
  comment: "tok-comment",
  operator: "tok-op",
};

/**
 * Prong 1 Pre-Computed Syntax + Semantic Token Highlighter.
 * Directly renders the WASM CST / `@modelscript/dsl/xml` CST spans produced by
 * `extractSemanticSpans(code, lang)` into per-line HTML strings.
 */
export function highlightWorkflowCode(code: string, lang: string): string[] {
  const lines = code.split("\n");
  const spans = extractSemanticSpans(code, lang);
  const byLine = new Map<number, SemanticSpan[]>();
  for (const s of spans) {
    let arr = byLine.get(s.line);
    if (!arr) {
      arr = [];
      byLine.set(s.line, arr);
    }
    arr.push(s);
  }

  const isXml = lang === "xml";
  return lines.map((line, lineIdx) => {
    const lineSpans = byLine.get(lineIdx);
    if (!lineSpans || lineSpans.length === 0) {
      return escapeHtml(line) || " ";
    }
    lineSpans.sort((a, b) => a.startCol - b.startCol);

    let out = "";
    let cursor = 0;
    for (const s of lineSpans) {
      if (s.startCol < cursor || s.startCol >= line.length) continue;
      if (s.startCol > cursor) {
        out += escapeHtml(line.slice(cursor, s.startCol));
      }
      const endCol = Math.min(line.length, s.startCol + s.length);
      const tokenText = escapeHtml(line.slice(s.startCol, endCol));
      let cssClass = s.cssClass ?? SPAN_KIND_TO_CSS_CLASS[s.kind];
      if (isXml && s.kind === "keyword") {
        cssClass = "tok-tag";
      } else if (isXml && s.kind === "string") {
        cssClass = "tok-attr-val";
      }
      out += `<span class="${cssClass}">${tokenText}</span>`;
      cursor = endCol;
    }
    if (cursor < line.length) {
      out += escapeHtml(line.slice(cursor));
    }
    return out || " ";
  });
}

/**
 * Queries the native WASM `LspFacade` (`getCompletionContext`, `getDefinition`, `getReferences`)
 * for Monaco editor intelligence in `workflow-monaco.ts`.
 */
export function queryWasmLspIntelligence(
  code: string,
  lang: "modelica" | "sysml",
  line0: number,
  col0: number,
): {
  expectedTokens: string[];
  definitionRange?: { startLine: number; startCol: number; endLine: number; endCol: number };
  referenceRanges: { startLine: number; startCol: number; endLine: number; endCol: number }[];
} {
  const runtime = getWasmRuntime(lang);
  if (!runtime?.facade) {
    return { expectedTokens: [], referenceRanges: [] };
  }

  const isModelica = lang === "modelica";
  const prepared = isModelica
    ? prepareModelicaSourceForWasm(code)
    : { source: code, lineOffset: 0, totalUserLines: code.split("\n").length, isFragment: false };

  const locator = new LineLocator(prepared.source);
  const offset = locator.pos0ToOffset(line0 + prepared.lineOffset, col0);
  const astRoot = runtime.facade.parse(prepared.source);
  if (!astRoot) {
    return { expectedTokens: [], referenceRanges: [] };
  }

  const expectedTokens: string[] = [];
  try {
    const ctx = runtime.facade.getCompletionContext(astRoot, offset);
    if (ctx?.expectedTokens) {
      for (const tok of ctx.expectedTokens) {
        const cleaned = String(tok).replace(/^"|"$/g, "");
        if (/^[A-Za-z_]\w*$/.test(cleaned)) {
          expectedTokens.push(cleaned);
        }
      }
    }
  } catch {
    // Ignore completion context failure
  }

  let definitionRange:
    | { startLine: number; startCol: number; endLine: number; endCol: number }
    | undefined;
  try {
    const def = runtime.facade.getDefinition(astRoot, offset);
    if (def && def.end > def.start) {
      const s = locator.offsetToPos0(def.start);
      const e = locator.offsetToPos0(def.end);
      const sLine = s.line - prepared.lineOffset;
      const eLine = e.line - prepared.lineOffset;
      if (sLine >= 0 && sLine < prepared.totalUserLines) {
        definitionRange = {
          startLine: sLine + 1,
          startCol: s.col + 1,
          endLine: eLine + 1,
          endCol: e.col + 1,
        };
      }
    }
  } catch {
    // Ignore definition lookup failure
  }

  const referenceRanges: { startLine: number; startCol: number; endLine: number; endCol: number }[] = [];
  try {
    const refs = runtime.facade.getReferences(astRoot, offset);
    if (Array.isArray(refs)) {
      for (const r of refs) {
        if (r && r.end > r.start) {
          const s = locator.offsetToPos0(r.start);
          const e = locator.offsetToPos0(r.end);
          const sLine = s.line - prepared.lineOffset;
          const eLine = e.line - prepared.lineOffset;
          if (sLine >= 0 && sLine < prepared.totalUserLines) {
            referenceRanges.push({
              startLine: sLine + 1,
              startCol: s.col + 1,
              endLine: eLine + 1,
              endCol: e.col + 1,
            });
          }
        }
      }
    }
  } catch {
    // Ignore references lookup failure
  }

  if (
    referenceRanges.length > 0 &&
    (!definitionRange || definitionRange.startLine === line0 + 1)
  ) {
    definitionRange = referenceRanges[0];
  }

  return {
    expectedTokens,
    ...(definitionRange ? { definitionRange } : {}),
    referenceRanges,
  };
}

export interface MinimalTextEdit {
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed start column */
  startCol: number;
  /** 1-indexed end line */
  endLine: number;
  /** 1-indexed end column */
  endCol: number;
  /** Replacement text */
  text: string;
}

/**
 * Computes narrow, surgical character/line-level edits between `oldText` and `newText`
 * so updating a Monaco editor model via `model.applyEdits()` only splices the modified
 * tokens without replacing the full document or flashing semantic tokens.
 */
export function computeMinimalTextEdits(
  oldText: string,
  newText: string,
): MinimalTextEdit[] {
  if (oldText === newText) return [];

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  if (oldLines.length === newLines.length) {
    const edits: MinimalTextEdit[] = [];
    for (let i = 0; i < oldLines.length; i++) {
      const oldLine = oldLines[i]!;
      const newLine = newLines[i]!;
      if (oldLine === newLine) continue;

      let prefix = 0;
      const minLen = Math.min(oldLine.length, newLine.length);
      while (prefix < minLen && oldLine[prefix] === newLine[prefix]) {
        prefix++;
      }

      let suffix = 0;
      while (
        suffix < oldLine.length - prefix &&
        suffix < newLine.length - prefix &&
        oldLine[oldLine.length - 1 - suffix] === newLine[newLine.length - 1 - suffix]
      ) {
        suffix++;
      }

      edits.push({
        startLine: i + 1,
        startCol: prefix + 1,
        endLine: i + 1,
        endCol: oldLine.length - suffix + 1,
        text: newLine.slice(prefix, newLine.length - suffix),
      });
    }
    return edits;
  }

  let prefixLines = 0;
  const minLines = Math.min(oldLines.length, newLines.length);
  while (prefixLines < minLines && oldLines[prefixLines] === newLines[prefixLines]) {
    prefixLines++;
  }

  let suffixLines = 0;
  while (
    suffixLines < oldLines.length - prefixLines &&
    suffixLines < newLines.length - prefixLines &&
    oldLines[oldLines.length - 1 - suffixLines] === newLines[newLines.length - 1 - suffixLines]
  ) {
    suffixLines++;
  }

  const startLine = prefixLines + 1;
  const oldEndIdx = oldLines.length - suffixLines;
  const newEndIdx = newLines.length - suffixLines;

  if (oldEndIdx <= prefixLines) {
    const inserted = newLines.slice(prefixLines, newEndIdx).join("\n") + "\n";
    return [
      {
        startLine,
        startCol: 1,
        endLine: startLine,
        endCol: 1,
        text: inserted,
      },
    ];
  }

  const endLine = oldEndIdx;
  const endCol = (oldLines[oldEndIdx - 1]?.length ?? 0) + 1;
  const replacement = newLines.slice(prefixLines, newEndIdx).join("\n");

  return [
    {
      startLine,
      startCol: 1,
      endLine,
      endCol,
      text: replacement,
    },
  ];
}

function offsetToLineCol(code: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(code.length, offset));
  const before = code.slice(0, clamped).split("\n");
  return {
    line: before.length,
    col: (before[before.length - 1]?.length ?? 0) + 1,
  };
}

/**
 * Validates XML documents using `@modelscript/dsl/xml` (`parseXmlSync`) CST errors
 * AND first-party domain linters (`@modelscript/urdf`, `@modelscript/simulink`,
 * `@modelscript/autosar`, `@modelscript/reqif`, `@modelscript/pscad`, `@modelscript/ssp`).
 */
function lintXmlWithDslAndLanguagePackages(
  code: string,
  diags: WorkflowDiagnostic[],
): void {
  const xmlDoc = parseXmlSync(code);

  // 1. Surface structural XML syntax diagnostics directly from `@modelscript/dsl/xml` (`xmlDoc.errors`)
  for (const rawErr of xmlDoc.errors) {
    const err = rawErr as { start: number; end: number; code?: string; message?: string };
    const startPos = offsetToLineCol(code, err.start);
    const endPos = offsetToLineCol(code, err.end);
    diags.push({
      startLine: startPos.line,
      startCol: startPos.col,
      endLine: startPos.line,
      endCol: Math.max(
        startPos.col + 2,
        endPos.line === startPos.line ? endPos.col : startPos.col + 8,
      ),
      severity: "error",
      code: err.code ?? "XML-1001",
      message: err.message ?? "XML syntax error in document.",
    });
    return;
  }

  // 2. Walk the `@modelscript/dsl/xml` CST (`xmlDoc.root`) for stray character data inside container elements
  const checkUnexpectedElementText = (el: XmlElement): void => {
    const trimmedText = el.text.trim();
    if (trimmedText.length > 0 && el.children.length > 0) {
      const elPos = offsetToLineCol(code, el.start);
      const tokenLen = trimmedText.split(/\s+/)[0]?.length ?? 1;
      diags.push({
        startLine: elPos.line,
        startCol: elPos.col,
        endLine: elPos.line,
        endCol: elPos.col + tokenLen + 2,
        severity: "error",
        code: "XML-1005",
        message: `Unexpected text '${trimmedText.slice(0, 24)}' inside container element '<${el.name}>'; expected child XML element.`,
      });
      return;
    }
    for (const child of el.children) {
      checkUnexpectedElementText(child);
      if (diags.length > 0) return;
    }
  };
  if (xmlDoc.root) {
    checkUnexpectedElementText(xmlDoc.root);
    if (diags.length > 0) return;
  }

  // 3. Dispatch by XML root element to first-party language parsers & linters
  const rootTag = xmlDoc.root?.name.toLowerCase() ?? "";
  if (rootTag === "robot" || rootTag === "sdf") {
    try {
      const robot = parseUrdf(code);
      const urdfDiags = lintUrdfRobot(robot);
      for (const d of urdfDiags) {
        const mappedCode =
          d.code === "M7501" || d.code === "M7513"
            ? "URDF-2002"
            : d.code === "M7503" && d.message.includes("non-numeric mass")
              ? "URDF-3001"
              : String(d.code);
        diags.push({
          startLine: Math.max(1, d.range.startLine),
          startCol: Math.max(1, d.range.startColumn),
          endLine: Math.max(1, d.range.endLine),
          endCol: Math.max(2, d.range.endColumn),
          severity: d.severity,
          code: mappedCode,
          message: d.message,
        });
      }
    } catch (err) {
      diags.push({
        startLine: 1,
        startCol: 1,
        endLine: 1,
        endCol: 10,
        severity: "error",
        code: "M7500",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (rootTag === "system" || rootTag === "modelinformation") {
    try {
      const slxModel = parseSlxXml(code, "SuspensionControl");
      const slxDiags = lintSimulinkModel(slxModel);
      const hasLines = slxModel.rootSystem.lines.length > 0;
      for (const d of slxDiags) {
        if (d.code === "M7201" && !hasLines) continue;
        if (d.severity === "error" || d.code === "M7204") {
          const mappedCode =
            d.code === "M7204" && d.message.includes("non-existent")
              ? "SIMULINK-2002"
              : d.code === "M7204"
                ? "SIMULINK-1004"
                : String(d.code);
          diags.push({
            startLine: Math.max(1, d.range.startLine),
            startCol: Math.max(1, d.range.startColumn),
            endLine: Math.max(1, d.range.endLine),
            endCol: Math.max(2, d.range.endColumn),
            severity: d.code === "M7204" ? "error" : d.severity,
            code: mappedCode,
            message: d.message,
          });
        }
      }
    } catch {
      // Syntax errors already handled by XML CST pass
    }
  } else if (rootTag === "autosar" || rootTag === "application-sw-component-type") {
    try {
      const arModel = parseArxml(code);
      const arDiags = lintAutosarModel(arModel);
      for (const d of arDiags) {
        diags.push({
          startLine: Math.max(1, d.range.startLine),
          startCol: Math.max(1, d.range.startColumn),
          endLine: Math.max(1, d.range.endLine),
          endCol: Math.max(2, d.range.endColumn),
          severity: d.severity,
          code: String(d.code),
          message: d.message,
        });
      }
    } catch {
      // Standalone <APPLICATION-SW-COMPONENT-TYPE> fragment without <AR-PACKAGES> wrapper
    }
  } else if (rootTag === "req-if" || rootTag === "spec-object") {
    try {
      const reqDoc = parseReqIf(code);
      const reqDiags = lintReqIf(reqDoc);
      for (const d of reqDiags) {
        if (d.severity === "error") {
          diags.push({
            startLine: Math.max(1, d.span?.startLine ?? 1),
            startCol: Math.max(1, d.span?.startCol ?? 1),
            endLine: Math.max(1, d.span?.endLine ?? 1),
            endCol: Math.max(2, d.span?.endCol ?? 10),
            severity: d.severity,
            code: String(d.code),
            message: d.message,
          });
        }
      }
    } catch {
      // Handled by XML CST pass
    }
  } else if (rootTag === "project") {
    try {
      const pscxProj = parsePscx(code);
      const pscxDiags = lintPscx(pscxProj);
      const hasWires = pscxProj.rootModule.wires.length > 0;
      for (const d of pscxDiags) {
        const numCode = typeof d.code === "number" ? d.code : Number(String(d.code).replace(/^M/, ""));
        if (numCode === 6001 && !hasWires) continue;
        if (d.severity === "error") {
          diags.push({
            startLine: Math.max(1, d.line ?? 1),
            startCol: Math.max(1, d.column ?? 1),
            endLine: Math.max(1, d.endLine ?? d.line ?? 1),
            endCol: Math.max(2, d.endColumn ?? (d.column ?? 1) + 8),
            severity: d.severity,
            code: typeof d.code === "number" ? `M${d.code}` : String(d.code),
            message: d.message,
          });
        }
      }
    } catch {
      // Handled by XML CST pass
    }
  } else if (rootTag.startsWith("ssd:") || code.includes("<ssd:")) {
    const sspDiags = lintSsp(code);
    for (const d of sspDiags) {
      diags.push({
        startLine: d.line,
        startCol: d.column,
        endLine: d.endLine,
        endCol: d.endColumn,
        severity: d.severity,
        code: d.standardCode ?? d.code,
        message: d.message,
      });
    }
  }
}

interface WasmSyntaxNode {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: WasmSyntaxNode[];
}

/**
 * Runs the native Modelica WebAssembly GLR parser (`languages/modelica/dist/parser.wasm`)
 * and `LspFacade.getDiagnostics(astRoot, 0, 0, code)` to surface real GLR syntax errors
 * and compiled `CompilerLint` diagnostics (`M2002`, `M2005`, `M3001`, `M5001`, `M5005`, etc.).
 */
function lintModelicaWithWasmLspFacade(
  code: string,
  diags: WorkflowDiagnostic[],
): void {
  const runtime = getWasmRuntime("modelica");
  const prepared = prepareModelicaSourceForWasm(code);

  // Known external library prefixes in the Simulink & URDF showcase models
  const externalRoots = new Set(["Modelica", "Parts", "Joints", "world", "der", "connect", "time"]);

  if (runtime?.facade) {
    const astRoot = runtime.facade.parse(prepared.source);
    const rawWasmDiags = runtime.facade.getDiagnostics(astRoot, 0, 0, prepared.source) as {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      message: string;
      severity: number;
      code?: number | string;
      expectedTokens?: string[];
    }[];

    for (const wd of rawWasmDiags) {
      const numCode = typeof wd.code === "number" ? wd.code : Number(wd.code);

      // Ignore `M2003` (class not found) or `M2002` (variable not found) on external MSL types (`Parts.Body`, `Joints.Revolute`, `world.frame_b`, `Modelica.Blocks...`)
      if (numCode === 2003 || numCode === 2002) {
        const isExternal = Array.from(externalRoots).some((ext) => wd.message.includes(ext));
        if (isExternal) continue;
      }
      // Ignore M4004 (unbalanced equation count) on partial showcase snippets
      if (numCode === 4004) continue;

      let startLine = wd.range.start.line - prepared.lineOffset + 1;
      let startCol = wd.range.start.character + 1;
      let endLine = wd.range.end.line - prepared.lineOffset + 1;
      let endCol = Math.max(startCol + 1, wd.range.end.character + 1);

      if (startLine < 1) {
        startLine = 1;
        endLine = 1;
      } else if (startLine > prepared.totalUserLines) {
        startLine = prepared.totalUserLines;
        endLine = prepared.totalUserLines;
      }

      let codeStr = wd.code !== undefined ? `M${wd.code}` : "M1001";
      let msg = wd.message;

      // Classify missing semicolon at end of prior statement as M1002 using LR expectedTokens or previous line inspection
      if (wd.code === undefined) {
        const lines = code.split("\n");
        const prevLineIdx = startLine - 2;
        if (
          prevLineIdx >= 0 &&
          prevLineIdx < lines.length &&
          lines[prevLineIdx]!.trim().length > 0 &&
          !lines[prevLineIdx]!.trim().endsWith(";") &&
          (wd.expectedTokens?.some((t) => t.includes(";")) ||
            !lines[prevLineIdx]!.trim().startsWith("model ") &&
            !lines[prevLineIdx]!.trim().startsWith("block ") &&
            !lines[prevLineIdx]!.trim().startsWith("equation") &&
            !lines[prevLineIdx]!.trim().startsWith("initial equation") &&
            !lines[prevLineIdx]!.trim().startsWith("algorithm"))
        ) {
          codeStr = "M1002";
          startLine = prevLineIdx + 1;
          endLine = prevLineIdx + 1;
          startCol = lines[prevLineIdx]!.search(/\S/) + 1;
          endCol = lines[prevLineIdx]!.length + 1;
          msg = `Missing ';' after '${lines[prevLineIdx]!.trim().slice(0, 32)}' (${wd.message}).`;
        } else if (
          msg.includes("Missing ';'") ||
          msg.includes("expected ';'") ||
          wd.expectedTokens?.some((t) => t.includes(";"))
        ) {
          codeStr = "M1002";
        }
      }

      diags.push({
        startLine,
        startCol,
        endLine,
        endCol,
        severity: wd.severity === 1 ? "error" : wd.severity === 2 ? "warning" : "info",
        code: codeStr,
        message: msg,
        ...(wd.expectedTokens ? { expectedTokens: wd.expectedTokens } : {}),
      });
    }

    // Inspect WASM GLR CST (`composition`, `component_clause`, `equation`, `statement`) for GLR-recovered missing `;`
    const tree = runtime.parser.parse(prepared.source);
    const lines = code.split("\n");
    const sectionKeywords = new Set([
      "equation",
      "initial equation",
      "algorithm",
      "initial algorithm",
      "public",
      "protected",
      "external",
    ]);
    const walkModelicaCstForMissingSemicolon = (node: WasmSyntaxNode): void => {
      if (node.type === "composition") {
        const startPos = offsetToLineCol(prepared.source, node.startIndex);
        const endPos = offsetToLineCol(prepared.source, node.endIndex);
        const firstLine = Math.max(1, startPos.line - prepared.lineOffset);
        const lastLine = Math.min(prepared.totalUserLines, endPos.line - prepared.lineOffset);
        let parenDepth = 0;
        for (let userLine = firstLine; userLine <= lastLine; userLine++) {
          const rawLine = lines[userLine - 1] ?? "";
          const cleanLine = rawLine.replace(/\/\/.*$/, "").trim();
          if (!cleanLine || sectionKeywords.has(cleanLine)) continue;
          const prevDepth = parenDepth;
          for (const ch of cleanLine) {
            if (ch === "(" || ch === "{" || ch === "[") parenDepth++;
            else if (ch === ")" || ch === "}" || ch === "]") parenDepth = Math.max(0, parenDepth - 1);
          }
          if (
            prevDepth === 0 &&
            parenDepth === 0 &&
            !cleanLine.endsWith(";") &&
            !cleanLine.startsWith("end ")
          ) {
            if (!diags.some((d) => d.code === "M1002" && d.startLine === userLine)) {
              diags.push({
                startLine: userLine,
                startCol: Math.max(1, rawLine.search(/\S/) + 1),
                endLine: userLine,
                endCol: rawLine.length + 1,
                severity: "error",
                code: "M1002",
                message: `Syntax Error: Missing ';' at end of Modelica declaration '${cleanLine.slice(0, 32)}'.`,
              });
            }
          }
        }
      }
      for (const child of node.children) {
        walkModelicaCstForMissingSemicolon(child);
      }
    };
    walkModelicaCstForMissingSemicolon(tree.rootNode as unknown as WasmSyntaxNode);
  }
}

/**
 * Runs the native SysML v2 WebAssembly GLR parser (`languages/sysml2/dist/parser.wasm`)
 * and `LspFacade.getDiagnostics(astRoot, 0, 0, code)` to surface real GLR syntax errors
 * (including LR state-table `expectedTokens`) and inspects the SysML v2 GLR CST (`tree.rootNode`)
 * for incomplete `require_constraint` expressions or GLR-recovered missing semicolons.
 */
function lintSysmlWithWasmLspFacade(
  code: string,
  diags: WorkflowDiagnostic[],
): void {
  const runtime = getWasmRuntime("sysml");
  const lines = code.split("\n");

  if (runtime?.facade) {
    const astRoot = runtime.facade.parse(code);
    const rawWasmDiags = runtime.facade.getDiagnostics(astRoot, 0, 0, code) as {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      message: string;
      severity: number;
      code?: number | string;
      expectedTokens?: string[];
    }[];

    for (const wd of rawWasmDiags) {
      let startLine = wd.range.start.line + 1;
      let startCol = wd.range.start.character + 1;
      let endLine = wd.range.end.line + 1;
      let endCol = Math.max(startCol + 1, wd.range.end.character + 1);
      const lineText = (lines[startLine - 1] ?? "").trim();

      let codeStr = "SYSML-1001";
      let msg = wd.message;

      const prevLine = startLine >= 2 ? (lines[startLine - 2] ?? "").trim() : "";
      if (
        prevLine &&
        !prevLine.endsWith(";") &&
        !prevLine.endsWith("{") &&
        !prevLine.endsWith("}") &&
        !prevLine.startsWith("doc") &&
        !prevLine.startsWith("require constraint")
      ) {
        codeStr = "SYSML-1002";
        startLine = startLine - 1;
        endLine = startLine;
        startCol = (lines[startLine - 1]?.search(/\S/) ?? 0) + 1;
        endCol = (lines[startLine - 1]?.length ?? 1) + 1;
        msg = `Missing ';' after '${prevLine.slice(0, 32)}' (${wd.message}).`;
      } else if (
        lineText.includes("require constraint") ||
        (prevLine && prevLine.includes("require constraint"))
      ) {
        codeStr = "SYSML-1003";
      } else if (
        wd.expectedTokens?.some((t) => t.includes(";")) ||
        (!lineText.endsWith(";") && !lineText.endsWith("{") && !lineText.endsWith("}"))
      ) {
        codeStr = "SYSML-1002";
      }

      diags.push({
        startLine,
        startCol,
        endLine,
        endCol,
        severity: wd.severity === 1 ? "error" : wd.severity === 2 ? "warning" : "info",
        code: codeStr,
        message: msg,
        ...(wd.expectedTokens ? { expectedTokens: wd.expectedTokens } : {}),
      });
    }

    // Walk native SysML v2 WebAssembly GLR CST (`tree.rootNode`) for incomplete `require_constraint` or missing `;`
    const tree = runtime.parser.parse(code);
    const walkSysmlCst = (node: WasmSyntaxNode): void => {
      if (node.type === "require_constraint") {
        const binExpr = node.children.find((c) => c.type === "binary_expr");
        const hasValidComparison =
          binExpr &&
          binExpr.children.length >= 3 &&
          binExpr.children.every((c) => c.type !== "ERROR" && c.text.trim().length > 0);
        if (!hasValidComparison) {
          const pos = offsetToLineCol(code, node.startIndex);
          const rawLine = lines[pos.line - 1] ?? node.text;
          if (!diags.some((d) => d.code === "SYSML-1003" && d.startLine === pos.line)) {
            diags.push({
              startLine: pos.line,
              startCol: Math.max(1, rawLine.search(/\S/) + 1),
              endLine: pos.line,
              endCol: rawLine.length + 1,
              severity: "error",
              code: "SYSML-1003",
              message:
                "Malformed 'require constraint' clause in SysML v2 CST; expected 'require constraint { attr <= value }'.",
            });
          }
        }
      } else if (
        node.type === "attribute_usage" ||
        node.type === "port_usage" ||
        node.type === "action_usage" ||
        node.type === "satisfy_requirement_usage" ||
        node.type === "connection_usage"
      ) {
        const pos = offsetToLineCol(code, node.startIndex);
        const rawLine = lines[pos.line - 1] ?? node.text;
        const cleanLine = rawLine.replace(/\/\/.*$/, "").trim();
        if (cleanLine && !cleanLine.endsWith(";") && !cleanLine.endsWith("{") && !cleanLine.endsWith("}")) {
          if (!diags.some((d) => d.code === "SYSML-1002" && d.startLine === pos.line)) {
            diags.push({
              startLine: pos.line,
              startCol: Math.max(1, rawLine.search(/\S/) + 1),
              endLine: pos.line,
              endCol: rawLine.length + 1,
              severity: "error",
              code: "SYSML-1002",
              message: `Syntax Error: Missing ';' at end of SysML v2 ${node.type.replace(/_/g, " ")} '${cleanLine.slice(0, 32)}'.`,
            });
          }
        }
      }
      for (const child of node.children) {
        walkSysmlCst(child);
      }
    };
    walkSysmlCst(tree.rootNode as unknown as WasmSyntaxNode);
  }
}

function lintIeeeReportSyntax(code: string, diags: WorkflowDiagnostic[]): void {
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isHeader =
      /^IEEE\s+2800-2022\s+Interconnection\s+Verification\s+Report\s+for\s+'[^']+'\s*:/.test(trimmed);
    const isOverall = /^Overall\s+Result:\s*\[(PASS|FAIL)\]$/.test(trimmed);
    const isClause =
      /^(?:•|-|\*)\s*\[(PASS|FAIL)\]\s*Clause\s+\d+(?:\.\d+)+.*\[Limit:[^\]]+\]$/.test(trimmed);
    if (!isHeader && !isOverall && !isClause) {
      const firstCol = line.search(/\S/) + 1;
      diags.push({
        startLine: i + 1,
        startCol: firstCol,
        endLine: i + 1,
        endCol: line.length + 1,
        severity: "error",
        code: "IEEE2800-1001",
        message: `Invalid IEEE 2800 report line '${trimmed.slice(0, 32)}'; expected header, 'Overall Result: [PASS|FAIL]', or '• [PASS|FAIL] Clause ...'.`,
      });
    }
  }
}

const RULES_BY_PAIR: Record<string, TGGRuleOptions[]> = {
  "reqif-sysml": reqifTggRules,
  "simulink-modelica": simulinkTggRules,
  "autosar-sysml": autosarTggRules,
  "urdf-modelica": urdfTggRules,
  "pscad-ieee": pscadIeeeTggRules,
  "sysml-ssp": fmi3TggRules,
};

const TGG_RULE_DIAGNOSTIC_META: Record<
  string,
  { code: string; severity: "error" | "warning" }
> = {
  ReqIfContractToSysmlConstraint: { code: "TGG-PHYS-01", severity: "error" },
  SimulinkDiscreteFilterToDiscreteTransferFunction: { code: "TGG-PHYS-02", severity: "error" },
  UrdfLinkToMultiBodyBody: { code: "TGG-PHYS-04", severity: "error" },
  ModelicaParameterToFmi3Float64Parameter: { code: "M3001", severity: "error" },
  PscadIbrGainToClause541StepResponse: { code: "IEEE2800-5.4.1", severity: "warning" },
  PscadIbrIntegralGainToClause722Recovery: { code: "IEEE2800-7.2.2", severity: "warning" },
};

export interface TggTargetComponentMeta {
  typeName: string;
  shortName: string;
  ruleName: string;
  modifiers: string[];
  boundsByProp: Record<string, { min?: number; max?: number }>;
}

/**
 * Dynamically extracts target component types, modifier parameter names, and
 * `tggReconcilePhysics` envelopes from the compiled declarative `TGGRuleOptions`
 * across `RULES_BY_PAIR` so Monaco completion and signature help never hardcode
 * component parameter tables.
 */
export function getTggTargetComponentMetadata(): Map<string, TggTargetComponentMeta> {
  const map = new Map<string, TggTargetComponentMeta>();
  for (const rules of Object.values(RULES_BY_PAIR)) {
    for (const rule of rules) {
      const evaluated = evaluateRuleDescriptor(rule);
      for (const pattern of [evaluated.sourcePattern, evaluated.targetPattern]) {
        const rawType = pattern.bindings["typeSpecifier"] ?? pattern.bindings["type"];
        if (typeof rawType !== "string" || !rawType) continue;
        const shortName = rawType.split(".").pop() ?? rawType;
        const modifiers = Object.keys(pattern.bindings).filter(
          (k) => k !== "type" && k !== "typeSpecifier" && k !== "name",
        );
        const boundsByProp: Record<string, { min?: number; max?: number }> = {};
        for (const c of evaluated.constraints) {
          if (c.kind === "reconcilePhysics") {
            const [, rawTgt, bounds] = c.args;
            const tgtVar =
              typeof rawTgt === "string" && rawTgt.startsWith("__var_")
                ? rawTgt.slice(6)
                : String(rawTgt);
            for (const [propKey, val] of Object.entries(pattern.bindings)) {
              if (val === `__var_${tgtVar}` && bounds && typeof bounds === "object") {
                boundsByProp[propKey] = bounds as { min?: number; max?: number };
              }
            }
          }
        }
        const meta: TggTargetComponentMeta = {
          typeName: rawType,
          shortName,
          ruleName: rule.name,
          modifiers,
          boundsByProp,
        };
        map.set(rawType, meta);
        map.set(shortName, meta);
      }
    }
  }
  return map;
}

interface PolyglotCandidate {
  node: PolyglotNode;
  range: { startLine: number; startCol: number; endLine: number; endCol: number };
}

function byteSpanToRange(
  code: string,
  startOffset: number,
  endOffset: number,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const s = offsetToLineCol(code, Math.max(0, startOffset));
  const e = offsetToLineCol(code, Math.max(startOffset + 1, endOffset));
  return {
    startLine: s.line,
    startCol: s.col,
    endLine: e.line,
    endCol: Math.max(s.col + 1, e.col),
  };
}

/**
 * Extracts `PolyglotNode` candidates from the parsed CST/AST of `code`
 * so declarative `TGGRuleOptions` can be unified via `matchNodePattern`
 * and `solveWhereConstraints`.
 */
function extractPolyglotCandidates(
  code: string,
  kind: "xml" | "modelica" | "sysml" | "ieee2800",
): PolyglotCandidate[] {
  const candidates: PolyglotCandidate[] = [];
  const defaultRange = { startLine: 1, startCol: 1, endLine: 1, endCol: 10 };

  if (kind === "xml") {
    const xmlDoc = parseXmlSync(code);
    const rootTag = xmlDoc.root?.name.toLowerCase() ?? "";
    if (rootTag === "req-if" || rootTag === "spec-object") {
      try {
        const reqDoc = parseReqIf(code);
        for (const obj of reqDoc.specObjects.values()) {
          if (obj.contract) {
            const range = obj.span
              ? {
                  startLine: obj.span.startLine,
                  startCol: obj.span.startCol,
                  endLine: obj.span.endLine,
                  endCol: obj.span.endCol,
                }
              : defaultRange;
            candidates.push({
              node: {
                kind: "Contract",
                name: `${obj.identifier}:contract`,
                variable: obj.contract.variable,
                comparator: obj.contract.comparator,
                limitValue: obj.contract.limitValue,
              },
              range,
            });
          }
        }
      } catch {
        // Ignored when XML is incomplete
      }
    } else if (rootTag === "system" || rootTag === "modelinformation") {
      try {
        const slxModel = parseSlxXml(code, "SuspensionControl");
        for (const block of slxModel.rootSystem.blocks.values()) {
          const range = block.range
            ? {
                startLine: block.range.startLine,
                startCol: block.range.startColumn,
                endLine: block.range.endLine,
                endCol: block.range.endColumn,
              }
            : defaultRange;
          candidates.push({
            node: {
              kind: "Block",
              type: block.type,
              name: block.name,
              Numerator: block.parameters.get("Numerator") ?? "[1]",
              Denominator: block.parameters.get("Denominator") ?? "[1]",
              SampleTime: block.parameters.get("SampleTime"),
              Gain: block.parameters.get("Gain"),
              InitialCondition: block.parameters.get("InitialCondition"),
              Value: block.parameters.get("Value"),
            },
            range,
          });
        }
      } catch {
        // Ignored when XML is incomplete
      }
    } else if (rootTag === "robot" || rootTag === "sdf") {
      try {
        const robot = parseUrdf(code);
        for (const link of robot.links.values()) {
          if (link.inertial && !Number.isNaN(link.inertial.mass)) {
            const range = link.range
              ? {
                  startLine: link.range.startLine,
                  startCol: link.range.startColumn,
                  endLine: link.range.endLine,
                  endCol: link.range.endColumn,
                }
              : defaultRange;
            candidates.push({
              node: {
                kind: "Link",
                name: link.name,
                mass: link.inertial.mass,
                ixx: link.inertial.ixx,
                iyy: link.inertial.iyy,
                izz: link.inertial.izz,
              },
              range,
            });
          }
        }
      } catch {
        // Ignored when XML is incomplete
      }
    } else if (rootTag === "project") {
      try {
        const project = parsePscx(code);
        for (const comp of project.rootModule.components) {
          const line = comp.line ?? 1;
          const col = comp.column ?? 1;
          const range = { startLine: line, startCol: col, endLine: line, endCol: col + 16 };
          if (comp.parameters["Kp_v"] !== undefined) {
            candidates.push({
              node: {
                kind: "PscadIbrVoltageLoop",
                name: comp.instanceName || comp.id,
                Kp_v: Number(comp.parameters["Kp_v"]),
              },
              range,
            });
          }
          if (comp.parameters["Ki_v"] !== undefined) {
            candidates.push({
              node: {
                kind: "PscadIbrCurrentLoop",
                name: comp.instanceName || comp.id,
                Ki_v: Number(comp.parameters["Ki_v"]),
              },
              range,
            });
          }
        }
      } catch {
        // Ignored when XML is incomplete
      }
    } else if (rootTag === "fmimodeldescription" && xmlDoc.root) {
      const visitXml = (el: XmlElement) => {
        if (el.name === "Float64") {
          const getAttr = (n: string) => el.attributes.find((a) => a.name === n)?.value;
          const startVal = getAttr("start");
          if (startVal !== undefined) {
            candidates.push({
              node: {
                kind: "Float64",
                name: getAttr("name") ?? "",
                causality: getAttr("causality") ?? "local",
                variability: getAttr("variability") ?? "continuous",
                start: Number(startVal),
                description: getAttr("description") ?? "",
              },
              range: byteSpanToRange(code, el.start, el.end),
            });
          }
        }
        for (const child of el.children) visitXml(child);
      };
      visitXml(xmlDoc.root);
    }
  } else if (kind === "modelica") {
    const cst = parseModelicaCst(code);
    for (const comp of cst.components) {
      const range = byteSpanToRange(code, comp.span.start, comp.span.end);
      const rawStart = comp.modifications["start"] ?? comp.bindingExpr;
      if (rawStart !== undefined && !Number.isNaN(Number(rawStart))) {
        const isState = cst.stateVars.has(comp.name);
        candidates.push({
          node: {
            kind: isState ? "StateVariableDecl" : "VariableDecl",
            name: comp.name,
            causality: comp.causality,
            variability:
              comp.causality === "parameter" || comp.variability === "constant"
                ? "fixed"
                : "continuous",
            start: Number(rawStart),
            description: comp.description ?? "",
          },
          range,
        });
      }

      const numericMods: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(comp.modifications)) {
        const asNum = Number(v);
        numericMods[k] = !Number.isNaN(asNum) && v.trim() !== "" ? asNum : v;
      }
      candidates.push({
        node: {
          kind: "ComponentDeclaration",
          name: comp.name,
          typeSpecifier: comp.typeSpecifier,
          b: numericMods["b"] ?? "{1}",
          a: numericMods["a"] ?? "{1}",
          I_11: numericMods["I_11"] ?? 0.1,
          I_22: numericMods["I_22"] ?? 0.1,
          I_33: numericMods["I_33"] ?? 0.1,
          ...numericMods,
        },
        range,
      });
    }
  } else if (kind === "sysml") {
    const sysmlCst = parseSysml2Cst(code);
    for (const req of sysmlCst.requirementDefs) {
      const range = byteSpanToRange(code, req.span.start, req.span.end);
      for (const expr of req.constraints) {
        const m = /^([A-Za-z_]\w*)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)$/.exec(expr.trim());
        if (m) {
          candidates.push({
            node: {
              kind: "RequireConstraint",
              name: `${req.id}:constraint`,
              variable: m[1]!,
              operator: m[2]!,
              rhs: Number(m[3]),
            },
            range,
          });
        }
      }
    }
  } else if (kind === "ieee2800") {
    const lines = code.split("\n");
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      const range = {
        startLine: idx + 1,
        startCol: Math.max(1, line.search(/\S/) + 1),
        endLine: idx + 1,
        endCol: line.length + 1,
      };
      const tStepMatch = /Clause\s+5\.4\.1.*T_step\s*[<>=!]+\s*(-?\d+(?:\.\d+)?)\s*ms/i.exec(line);
      if (tStepMatch) {
        candidates.push({
          node: {
            kind: "Ieee2800Clause541",
            name: "Clause541",
            stepResponseMs: Number(tStepMatch[1]),
          },
          range,
        });
      }
      const recMatch = /Clause\s+7\.2\.2.*I_post\s*\/\s*I_pre\s*=\s*(-?\d+(?:\.\d+)?)\s*%/i.exec(line);
      if (recMatch) {
        candidates.push({
          node: {
            kind: "Ieee2800Clause722",
            name: "Clause722",
            recoveryPct: Number(recMatch[1]),
          },
          range,
        });
      }
    }
  }

  return candidates;
}

/**
 * Evaluates the declarative `TGGRuleOptions[]` for `pairId` using `@modelscript/runtime`'s
 * `evaluateRuleDescriptor`, `matchNodePattern`, and `solveWhereConstraints` (including
 * bidirectional `tggInvertible` laws) to enforce all `tggReconcilePhysics` envelopes
 * without per-pair hardcoded regex checks.
 */
function lintViaDeclarativeTggRules(
  pairId: string,
  side: "source" | "target",
  code: string,
  kind: "xml" | "modelica" | "sysml" | "ieee2800",
  diags: WorkflowDiagnostic[],
): void {
  const rules = RULES_BY_PAIR[pairId] ?? [];
  if (rules.length === 0) return;

  const candidates = extractPolyglotCandidates(code, kind);
  if (candidates.length === 0) return;

  const direction = side === "source" ? "forward" : "backward";

  for (const rule of rules) {
    const evaluated = evaluateRuleDescriptor(rule);
    const pattern = side === "source" ? evaluated.sourcePattern : evaluated.targetPattern;
    const meta = TGG_RULE_DIAGNOSTIC_META[rule.name] ?? {
      code: "TGG-PHYS",
      severity: "error" as const,
    };

    for (const { node, range } of candidates) {
      const match = matchNodePattern(node, pattern, evaluated);
      if (!match) continue;

      solveWhereConstraints(evaluated.constraints, match.env, direction);

      for (const c of evaluated.constraints) {
        if (c.kind !== "reconcilePhysics") continue;
        const [rawSrc, rawTgt, bounds] = c.args;
        if (!bounds || typeof bounds !== "object") continue;

        const srcVar =
          typeof rawSrc === "string" && rawSrc.startsWith("__var_") ? rawSrc.slice(6) : String(rawSrc);
        const tgtVar =
          typeof rawTgt === "string" && rawTgt.startsWith("__var_") ? rawTgt.slice(6) : String(rawTgt);

        const rawVal = match.env[srcVar] ?? match.env[tgtVar];
        const numVal = Number(rawVal);
        if (rawVal === undefined || Number.isNaN(numVal)) continue;

        const minBound = typeof bounds.min === "number" ? bounds.min : -Infinity;
        const maxBound = typeof bounds.max === "number" ? bounds.max : Infinity;

        if (numVal < minBound || numVal > maxBound) {
          const propName = match.varToProp[srcVar] ?? match.varToProp[tgtVar] ?? srcVar;
          diags.push({
            ...range,
            severity: meta.severity,
            code: meta.code,
            message: `Physical envelope violation in '${rule.name}' (tggReconcilePhysics): '${propName}' (${Number(numVal.toFixed(4))}) is outside feasible envelope [${minBound}, ${maxBound}].`,
          });
        }
      }
    }
  }
}

/**
 * Runs live WASM GLR parser + `LspFacade` diagnostics + `@modelscript/dsl/xml` +
 * language-package linters + declarative TGG physical feasibility envelope (`tggReconcilePhysics`)
 * checks on either the source or target pane of a workflow pair.
 */
export function lintWorkflowCode(
  pairId: string,
  side: "source" | "target",
  code: string,
): WorkflowDiagnostic[] {
  const diags: WorkflowDiagnostic[] = [];
  const trimmed = code.trim();
  if (!trimmed) {
    diags.push({
      startLine: 1,
      startCol: 1,
      endLine: 1,
      endCol: 2,
      severity: "error",
      code: "M1001",
      message: "Document is empty.",
    });
    return diags;
  }

  const isXml =
    (side === "source" && pairId !== "sysml-ssp") ||
    (side === "target" && pairId === "sysml-ssp");
  const isModelica =
    (side === "target" && (pairId === "simulink-modelica" || pairId === "urdf-modelica")) ||
    (side === "source" && pairId === "sysml-ssp");
  const isSysml =
    side === "target" && (pairId === "reqif-sysml" || pairId === "autosar-sysml");
  const isIeeeReport = side === "target" && pairId === "pscad-ieee";

  // 1. XML Syntax & First-Party Domain Linter Checks (`@modelscript/dsl/xml` + `languages/*`)
  if (isXml) {
    lintXmlWithDslAndLanguagePackages(code, diags);
  }

  // 2. Native Modelica WASM GLR Parser & `LspFacade` Diagnostics
  if (isModelica) {
    lintModelicaWithWasmLspFacade(code, diags);
  }

  // 3. Native SysML v2 WASM GLR Parser & `LspFacade` Diagnostics
  if (isSysml) {
    lintSysmlWithWasmLspFacade(code, diags);
  }

  // 4. IEEE 2800 Report Syntax Check
  if (isIeeeReport) {
    lintIeeeReportSyntax(code, diags);
  }

  // 5. Declarative TGG Rule & Physical Envelope (`tggReconcilePhysics` + `tggInvertible`) Evaluation
  const candidateKind: "xml" | "modelica" | "sysml" | "ieee2800" = isXml
    ? "xml"
    : isModelica
      ? "modelica"
      : isSysml
        ? "sysml"
        : "ieee2800";
  lintViaDeclarativeTggRules(pairId, side, code, candidateKind, diags);

  return diags;
}
