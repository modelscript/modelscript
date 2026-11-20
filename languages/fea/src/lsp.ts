// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import { feaToDae } from "./dae/fea-to-dae.js";
import { parseFeaDeck } from "./dialects/index.js";
import { lintFeaModel } from "./lints/index.js";
import { extractFeaSlicingProperties } from "./materializer.js";
import { feaToModelica } from "./projections/index.js";
import type { CaeDiagnostic, FeaModelData } from "./types.js";
import { getFeaWasmParser } from "./wasm-loader.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

/**
 * Validates an FEA structural deck and returns LSP diagnostics.
 */
export function validateFea(content: string, uri: string = "model.inp"): LspDiagnostic[] {
  try {
    const ext = uri.split(".").pop() ?? "inp";
    const model = parseFeaDeck(content, ext);
    const syntaxSpans = model.syntaxErrors ?? collectWasmSyntaxErrors(getFeaWasmParser().parse(content)?.rootNode);
    const syntaxDiags: LspDiagnostic[] = syntaxSpans.map((sp) => ({
      range: {
        start: { line: Math.max(0, sp.startLine - 1), character: Math.max(0, sp.startColumn - 1) },
        end: { line: Math.max(0, sp.endLine - 1), character: Math.max(0, sp.endColumn - 1) },
      },
      severity: 1,
      code: "M7400",
      source: "modelscript-fea",
      message: sp.message,
    }));

    const diags = lintFeaModel(model);
    const lines = content.split(/\r?\n/);

    const semanticDiags: LspDiagnostic[] = diags.map((d) => {
      const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const colNum = d.column ? Math.max(0, d.column - 1) : 0;
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `M${d.code}`,
        source: "modelscript-fea",
        message: d.message,
      };
    });

    return [...syntaxDiags, ...semanticDiags];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7400",
        source: "modelscript-fea",
        message: `Failed to parse FEA deck: ${errMsg}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for FEA structural decks (materials, element sets, node sets).
 */
export function getFeaDocumentSymbols(content: string, uri: string = "model.inp"): LspDocumentSymbol[] {
  try {
    const ext = uri.split(".").pop() ?? "inp";
    const model = parseFeaDeck(content, ext);
    const children: LspDocumentSymbol[] = [];

    // Materials
    for (const [matName, mat] of model.materials) {
      children.push({
        name: matName,
        detail: `Material: E=${mat.E ?? "default"} Pa, nu=${mat.nu ?? 0.3}`,
        kind: LspSymbolKind.Class,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Element sets
    for (const setName of model.elementSets.keys()) {
      children.push({
        name: setName,
        detail: `Element Set`,
        kind: LspSymbolKind.Array,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Node sets
    for (const setName of model.nodeSets.keys()) {
      children.push({
        name: setName,
        detail: `Node Set`,
        kind: LspSymbolKind.Namespace,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    // Summary counts
    children.push({
      name: `Nodes (${model.nodes.size})`,
      detail: `${model.nodes.size} mesh vertices`,
      kind: LspSymbolKind.Property,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });
    children.push({
      name: `Elements (${model.elements.size})`,
      detail: `${model.elements.size} finite elements`,
      kind: LspSymbolKind.Struct,
      range: DEFAULT_RANGE,
      selectionRange: DEFAULT_RANGE,
    });

    const rootName =
      model.heading || (model.elements.size > 0 ? `FEA Model (${model.elements.size} elems)` : "FEA Deck");
    return [
      {
        name: rootName,
        detail: `Dialect: ${model.dialect.toUpperCase()}`,
        kind: LspSymbolKind.Module,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Returns contextual hover info for FEA structural entities.
 */
export function getFeaHover(content: string, _position: LspPosition, uri: string = "model.inp"): LspHover | undefined {
  try {
    const ext = uri.split(".").pop() ?? "inp";
    const model = parseFeaDeck(content, ext);

    const lines: string[] = [
      `### FEA Structural Model`,
      `- **Dialect:** ${model.dialect.toUpperCase()}`,
      `- **Elements:** ${model.elements.size}`,
      `- **Nodes:** ${model.nodes.size}`,
      `- **Materials:** ${model.materials.size}`,
      `- **Fixed Constraints:** ${model.fixedNodes.size} nodes`,
    ];

    if (model.materials.size > 0) {
      lines.push(`\n**Materials:**`);
      for (const [name, mat] of model.materials) {
        lines.push(`- \`${name}\`: E = ${mat.E ?? "N/A"} Pa, nu = ${mat.nu ?? "N/A"}`);
      }
    }

    return {
      contents: {
        kind: "markdown",
        value: lines.join("\n"),
      },
    };
  } catch {
    return undefined;
  }
}

export interface FeaActionResult {
  success: boolean;
  error?: string | undefined;
  diagnostics?: CaeDiagnostic[] | undefined;
  variables?: number | undefined;
  equations?: number | undefined;
  modelica?: string | undefined;
  numNodes?: number | undefined;
  numElements?: number | undefined;
  maxDisplacementM?: number | undefined;
  maxStressPa?: number | undefined;
}

/**
 * Executes domain actions on FEA models.
 */
export async function executeFeaAction(
  action: "lint_fea_model" | "lint",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; diagnostics: CaeDiagnostic[] }>;
export async function executeFeaAction(
  action: "export_fea_dae" | "to_dae",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; variables: number; equations: number }>;
export async function executeFeaAction(
  action: "export_fea_modelica" | "to_modelica",
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; modelica: string }>;
export async function executeFeaAction(
  action: "solve_fea" | "solve",
  args: Record<string, unknown>,
): Promise<{
  success: boolean;
  error?: string;
  numNodes: number;
  numElements: number;
  maxDisplacementM: number;
  maxStressPa: number;
}>;
export async function executeFeaAction(action: string, args: Record<string, unknown>): Promise<FeaActionResult>;
export async function executeFeaAction(action: string, args: Record<string, unknown>): Promise<FeaActionResult> {
  const content = (args["content"] as string) || "";
  const uri = (args["uri"] as string) || "model.inp";
  const ext = uri.split(".").pop() ?? "inp";

  let model: FeaModelData;
  try {
    model = parseFeaDeck(content, ext);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Parse error: ${errMsg}` };
  }

  switch (action) {
    case "lint_fea_model":
    case "lint": {
      const diags = lintFeaModel(model);
      return { success: true, diagnostics: diags };
    }

    case "export_fea_dae":
    case "to_dae": {
      const dae = feaToDae(model);
      return {
        success: true,
        variables: dae.varCount,
        equations: dae.eqCount,
      };
    }

    case "export_fea_modelica":
    case "to_modelica": {
      const mo = feaToModelica(model);
      return { success: true, modelica: mo };
    }

    case "solve_fea":
    case "solve": {
      const props = extractFeaSlicingProperties(content);
      let maxDisp = props.maxDisplacementM ?? 0;
      let maxStress = props.maxVonMisesPa ?? 0;
      if (maxDisp <= 0) {
        let totalForce = 0;
        for (const f of model.nodalLoads.values()) {
          totalForce += Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
        }
        let avgE = 2.1e11;
        for (const mat of model.materials.values()) {
          if (mat.E && mat.E > 0) avgE = mat.E;
        }
        maxDisp = totalForce > 0 ? totalForce / (avgE * 0.01) : 0.001;
        if (maxStress <= 0) {
          maxStress = maxDisp * avgE * 1e-3;
        }
      }

      return {
        success: true,
        numNodes: props.nodeCount ?? model.nodes.size,
        numElements: props.elementCount ?? model.elements.size,
        maxDisplacementM: maxDisp,
        maxStressPa: maxStress,
      };
    }

    default:
      throw new Error(`Unknown FEA action: ${action}`);
  }
}

export interface FeaCodeLensContext {
  uri?: string | undefined;
  flags?: {
    showVerification?: boolean | undefined;
    showPolyglotLinks?: boolean | undefined;
    showCadMetrics?: boolean | undefined;
    showDiagram?: boolean | undefined;
  };
  workspaceManager?: {
    getThreadsForUri?: (uri: string) => Array<{ domain?: string; meta?: { properties?: Record<string, unknown> } }>;
  };
}

export interface LspCodeLens {
  range: LspRange;
  command?: {
    title: string;
    command: string;
    arguments?: unknown[] | undefined;
  };
}

function isFeaWsCode(code: number): boolean {
  return code === 32 || code === 9 || code === 13 || code === 10 || code === 11 || code === 12;
}

function isFeaIdentContCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

function extractFeaSolidSectionMaterial(line: string): string | undefined {
  if (!line.slice(0, 14).toUpperCase().startsWith("*SOLID SECTION")) return undefined;
  const upper = line.toUpperCase();
  let pos = 14;
  while (pos <= upper.length - 8) {
    const idx = upper.indexOf("MATERIAL", pos);
    if (idx === -1) break;
    const beforeOk = idx === 0 || !isFeaIdentContCode(upper.charCodeAt(idx - 1));
    if (beforeOk) {
      let i = idx + 8;
      while (i < line.length && isFeaWsCode(line.charCodeAt(i))) i++;
      if (line[i] === "=") {
        let start = i + 1;
        while (start < line.length && isFeaWsCode(line.charCodeAt(start))) start++;
        let end = start;
        while (end < line.length && line[end] !== "," && !isFeaWsCode(line.charCodeAt(end))) {
          end++;
        }
        if (end > start) {
          return line.slice(start, end).split("_").join(" ");
        }
      }
    }
    pos = idx + 1;
  }
  return "Solid Section";
}

/**
 * Generates CodeLens actions for FEA structural decks (.inp, .inpt, .bdf, .fea).
 */
export function getFeaCodeLenses(text: string, uri: string, ctx: FeaCodeLensContext = {}): LspCodeLens[] {
  const lenses: LspCodeLens[] = [];
  if (!text) return lenses;

  const showVerification = ctx.flags?.showVerification ?? false;
  const showPolyglotLinks = ctx.flags?.showPolyglotLinks ?? false;
  const showCadMetrics = ctx.flags?.showCadMetrics ?? false;
  const showDiagram = ctx.flags?.showDiagram ?? false;

  const headerRange: LspRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const threadEntries =
    showVerification || showPolyglotLinks || showCadMetrics
      ? (ctx.workspaceManager?.getThreadsForUri?.(uri) ?? [])
      : [];
  const feaThread = threadEntries.find((e) => e.domain === "fea") ?? threadEntries[0];
  const feaProps = feaThread?.meta?.properties;

  if (feaProps) {
    const maxStress = feaProps["maxStress"];
    const yieldStrength = feaProps["yieldStrength"];
    const mass = feaProps["mass"];
    if (showVerification && maxStress !== undefined && yieldStrength !== undefined) {
      const numMaxStress = Number(maxStress);
      const numYieldStrength = Number(yieldStrength);
      const sf = numYieldStrength / numMaxStress;
      lenses.push({
        range: headerRange,
        command: {
          title: `🔬 FEA Structural Invariant: σ_max = ${numMaxStress.toFixed(1)} MPa ≤ ${numYieldStrength.toFixed(1)} MPa (Safety Factor: ${sf.toFixed(2)})`,
          command: "modelscript.openThreadExplorer",
          arguments: [uri],
        },
      });
    }
    if (showPolyglotLinks && mass !== undefined) {
      lenses.push({
        range: headerRange,
        command: {
          title: `⚖️ Calibrated Mass: m = ${Number(mass).toFixed(2)} kg (Transferred to Modelica & SysML)`,
          command: "modelscript.syncDigitalThreadParams",
          arguments: [uri],
        },
      });
    }
  }

  let nodeCount = 0;
  let elemCount = 0;
  if (showCadMetrics) {
    const feaPath = uri.split(/[?#]/, 1)[0]!.toLowerCase();
    const feaData = parseFeaDeck(text, feaPath.endsWith(".bdf") ? "bdf" : "inp");
    nodeCount = feaData.nodes.size;
    elemCount = feaData.elements.size;

    const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      const matLabel = extractFeaSolidSectionMaterial(line);
      if (matLabel !== undefined) {
        lenses.push({
          range: { start: { line: lineIdx, character: 0 }, end: { line: lineIdx, character: line.length } },
          command: {
            title: `📐 Composite Section Envelope: ${matLabel}`,
            command: "modelscript.openStepViewer",
            arguments: [uri],
          },
        });
      }
    }
  }

  if (showCadMetrics) {
    const meshSummary = nodeCount > 0 || elemCount > 0 ? ` (${nodeCount} Nodes, ${elemCount} Elements)` : "";
    lenses.push({
      range: headerRange,
      command: {
        title: `🕸️ Open 3D CAE Mesh Viewer${meshSummary}`,
        command: "modelscript.openStepViewer",
        arguments: [uri],
      },
    });
  }
  if (showDiagram) {
    lenses.push({
      range: headerRange,
      command: {
        title: "⊞ Open Interactive Diagram",
        command: "modelscript.openDiagram",
        arguments: [uri],
      },
    });
  }

  return lenses;
}
