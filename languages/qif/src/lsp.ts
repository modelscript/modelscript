// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/qif — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, Unicode GD&T Feature Control Frame hover cards,
 * completions, go-to-definition, and custom metrology action execution.
 */

import { lintQifDocument } from "./lints/rules.js";
import { parseQif } from "./parser/index.js";
import { qifToModelica, qifToSysML2 } from "./projections/index.js";
import { evaluateQifSpc, lowerQifToDae, type QifSpcSummary } from "./spc/index.js";
import { reconcileStepWithQif, type StepReconciliationResult, synthesizeQifFromStep } from "./step-bridge/index.js";
import type {
  QifCharacteristic,
  QifDiagnostic,
  QifDocument,
  QifGdtType,
  QifMaterialCondition,
  QifSourceRange,
} from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code: string | number;
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

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const GDT_UNICODE_SYMBOLS: Record<QifGdtType, string> = {
  Flatness: "⏥",
  Straightness: "⏤",
  Circularity: "○",
  Cylindricity: "⌭",
  ProfileOfLine: "⌒",
  ProfileOfSurface: "⌓",
  Perpendicularity: "⟂",
  Parallelism: "∥",
  Angularity: "∠",
  Position: "⌖",
  CircularRunout: "↗",
  TotalRunout: "⌺",
  DimensionalSize: "⌀",
  DimensionalDistance: "↔",
};

function formatMaterialSymbol(mc?: QifMaterialCondition): string {
  if (mc === "MMC") return " Ⓜ";
  if (mc === "LMC") return " Ⓛ";
  return "";
}

/**
 * Formats an ASME Y14.5 Unicode GD&T Feature Control Frame (e.g. `| ⌖ | ⌀0.05 Ⓜ | A | B | C |`).
 */
export function formatFeatureControlFrame(char: QifCharacteristic): string {
  const sym = GDT_UNICODE_SYMBOLS[char.gdtType] ?? "⌖";
  const diamPrefix = char.isDiametrical ? "⌀" : "";
  const matSuffix = formatMaterialSymbol(char.materialCondition);
  const tolCell = `${diamPrefix}${char.toleranceZone}${matSuffix}`;

  const datumCells = char.datumReferences.map((d) => `${d.datumLabel}${formatMaterialSymbol(d.materialCondition)}`);

  const upperRow =
    datumCells.length > 0 ? `| ${sym} | ${tolCell} | ${datumCells.join(" | ")} |` : `| ${sym} | ${tolCell} |`;

  if (char.compositeLowerTier) {
    const lower = char.compositeLowerTier;
    const lowerMat = formatMaterialSymbol(lower.materialCondition ?? char.materialCondition);
    const lowerTolCell = `${diamPrefix}${lower.toleranceZone}${lowerMat}`;
    const lowerRow =
      lower.datumReferences.length > 0
        ? `| ${sym} | ${lowerTolCell} | ${lower.datumReferences.join(" | ")} |`
        : `| ${sym} | ${lowerTolCell} |`;
    return `${upperRow}\n${lowerRow}`;
  }

  return upperRow;
}

function toLspRange(r: QifSourceRange): LspRange {
  return {
    start: {
      line: Math.max(0, r.startLine - 1),
      character: Math.max(0, r.startColumn - 1),
    },
    end: {
      line: Math.max(0, r.endLine - 1),
      character: Math.max(0, r.endColumn - 1),
    },
  };
}

export function validateQif(content: string): LspDiagnostic[] {
  let doc: QifDocument;
  try {
    doc = parseQif(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8100",
        source: "qif-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintQifDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "qif-linter",
      message: d.message,
    };
  });
}

export function getQifDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: QifDocument;
  try {
    doc = parseQif(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const d of doc.datumDefinitions) {
    const r = toLspRange(d.range);
    symbols.push({
      name: `Datum ${d.label}`,
      detail: d.featureId ? `Feature: ${d.featureId}` : d.id,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const f of doc.features) {
    const r = toLspRange(f.range);
    symbols.push({
      name: f.name,
      detail: `${f.featureType}${f.nominalSize !== undefined ? ` (⌀${f.nominalSize})` : ""}`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const c of doc.characteristics) {
    const r = toLspRange(c.range);
    const matchingActuals = doc.actuals.filter(
      (a) => a.characteristicId === c.id || (c.qpId && a.characteristicId === c.qpId),
    );
    const children: LspDocumentSymbol[] = matchingActuals.map((act) => {
      const ar = toLspRange(act.range);
      return {
        name: act.id,
        detail: `${act.partSerialNumber}: ${act.measuredValue} (${act.status})`,
        kind: LspSymbolKind.Variable,
        range: ar,
        selectionRange: ar,
      };
    });

    symbols.push({
      name: c.name,
      detail: formatFeatureControlFrame(c),
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
      children,
    });
  }

  for (const dev of doc.devices) {
    const r = toLspRange(dev.range);
    symbols.push({
      name: dev.name,
      detail: `${dev.deviceType} (±${dev.calibrationUncertainty})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
    });
  }

  for (const s of doc.planSteps) {
    const r = toLspRange(s.range);
    symbols.push({
      name: s.id,
      detail: `Step #${s.stepNumber}: ${s.featureId} (${s.probingPointCount} pts)`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getQifHover(content: string, offset: number): LspHover | null {
  let doc: QifDocument;
  try {
    doc = parseQif(content);
  } catch {
    return null;
  }

  for (const c of doc.characteristics) {
    if (offset >= c.range.startOffset && offset <= c.range.endOffset) {
      const fcf = formatFeatureControlFrame(c);
      const lines = [
        `### GD&T Characteristic: **${c.name}** (\`${c.id}\`)`,
        "",
        `\`${fcf}\``,
        "",
        `* **GD&T Type:** \`${c.gdtType}\``,
        `* **Tolerance Zone:** \`${c.isDiametrical ? "⌀" : ""}${c.toleranceZone}\` (${c.materialCondition})`,
        c.nominalValue !== undefined ? `* **Nominal Value:** \`${c.nominalValue}\`` : "",
        c.featureIds.length > 0 ? `* **Features:** \`${c.featureIds.join(", ")}\`` : "",
        c.balloonNumber !== undefined ? `* **Balloon #:** \`${c.balloonNumber}\`` : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(c.range),
      };
    }
  }

  for (const f of doc.features) {
    if (offset >= f.range.startOffset && offset <= f.range.endOffset) {
      const lines = [
        `### QIF Feature: **${f.name}** (\`${f.id}\`)`,
        `* **Geometry:** \`${f.featureType}\` (${f.isFeatureOfSize ? "Feature of Size" : "Non-Feature of Size"})`,
        f.nominalSize !== undefined ? `* **Nominal Size:** \`${f.nominalSize}\`` : "",
        f.stepEntityId ? `* **STEP AP242 Entity:** \`${f.stepEntityId}\`` : "",
        f.probingPoints !== undefined ? `* **Probing Points:** \`${f.probingPoints}\`` : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(f.range),
      };
    }
  }

  for (const d of doc.datumDefinitions) {
    if (offset >= d.range.startOffset && offset <= d.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### QIF Datum: **${d.label}** (\`${d.id}\`)`,
            d.featureId ? `* **Feature Reference:** \`${d.featureId}\`` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: toLspRange(d.range),
      };
    }
  }

  for (const dev of doc.devices) {
    if (offset >= dev.range.startOffset && offset <= dev.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Measurement Device: **${dev.name}** (\`${dev.id}\`)`,
            `* **Type:** \`${dev.deviceType}\``,
            `* **Calibration Uncertainty:** \`±${dev.calibrationUncertainty}\``,
          ].join("\n"),
        },
        range: toLspRange(dev.range),
      };
    }
  }

  for (const act of doc.actuals) {
    if (offset >= act.range.startOffset && offset <= act.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Characteristic Actual: **${act.id}**`,
            `* **Characteristic:** \`${act.characteristicId}\``,
            `* **Part Serial #:** \`${act.partSerialNumber}\``,
            `* **Measured Value:** \`${act.measuredValue}\``,
            act.actualFeatureSize !== undefined ? `* **Actual Feature Size:** \`${act.actualFeatureSize}\`` : "",
            `* **Status:** \`${act.status}\``,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: toLspRange(act.range),
      };
    }
  }

  return null;
}

export function getQifCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "FEATURE",
      kind: 14,
      detail: "QIF Feature Declaration",
      insertText: 'FEATURE F1 Cylinder "Bore" size=25.0 points=6',
    },
    {
      label: "CHARACTERISTIC",
      kind: 14,
      detail: "QIF GD&T Characteristic",
      insertText: 'CHARACTERISTIC C1 Position "Bore_Pos" zone=0.05 material=MMC datums=[A,B,C] features=[F1]',
    },
    { label: "DATUM", kind: 14, detail: "QIF Datum Definition", insertText: "DATUM A id=D1 feature=F1" },
    {
      label: "DEVICE",
      kind: 14,
      detail: "QIF Measurement Device",
      insertText: 'DEVICE CMM1 CMM "Zeiss_CMM" uncertainty=0.0015',
    },
    {
      label: "STEP",
      kind: 14,
      detail: "QIF Inspection Plan Step",
      insertText: "STEP S1 step=1 feature=F1 characteristic=C1 device=CMM1 points=6",
    },
    {
      label: "ACTUAL",
      kind: 14,
      detail: "QIF Characteristic Actual Result",
      insertText: 'ACTUAL A1 characteristic=C1 serial="SN-001" value=0.02 status=PASS',
    },
    { label: "Position", kind: 13, detail: "GD&T Position (⌖)" },
    { label: "Flatness", kind: 13, detail: "GD&T Flatness (⏥)" },
    { label: "Perpendicularity", kind: 13, detail: "GD&T Perpendicularity (⟂)" },
    { label: "Cylindricity", kind: 13, detail: "GD&T Cylindricity (⌭)" },
    { label: "ProfileOfSurface", kind: 13, detail: "GD&T Profile of a Surface (⌓)" },
    { label: "MMC", kind: 12, detail: "Maximum Material Condition (Ⓜ)" },
    { label: "LMC", kind: 12, detail: "Least Material Condition (Ⓛ)" },
    { label: "RFS", kind: 12, detail: "Regardless of Feature Size" },
  ];

  try {
    const doc = parseQif(content);
    for (const f of doc.features) {
      items.push({
        label: f.id,
        kind: 6,
        detail: `Feature ${f.name} (${f.featureType})`,
      });
    }
    for (const d of doc.datumDefinitions) {
      items.push({
        label: d.label,
        kind: 21,
        detail: `Datum ${d.label} (${d.id})`,
      });
    }
    for (const c of doc.characteristics) {
      items.push({
        label: c.id,
        kind: 10,
        detail: `Characteristic ${c.name} (${c.gdtType})`,
      });
    }
    for (const dev of doc.devices) {
      items.push({
        label: dev.id,
        kind: 7,
        detail: `Device ${dev.name} (${dev.deviceType})`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export function getQifDefinition(content: string, offset: number, uri = "file:///document.qif"): LspLocation | null {
  let doc: QifDocument;
  try {
    doc = parseQif(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const feat = doc.features.find((f) => f.id === word || f.name === word || f.qpId === word);
    if (feat) {
      return { uri, range: toLspRange(feat.range) };
    }
    const datum = doc.datumDefinitions.find((d) => d.label === word || d.id === word || d.qpId === word);
    if (datum) {
      return { uri, range: toLspRange(datum.range) };
    }
    const char = doc.characteristics.find((c) => c.id === word || c.name === word || c.qpId === word);
    if (char) {
      return { uri, range: toLspRange(char.range) };
    }
    const dev = doc.devices.find((d) => d.id === word || d.name === word || d.qpId === word);
    if (dev) {
      return { uri, range: toLspRange(dev.range) };
    }
  }

  // Fallback contextual definition lookup (e.g. from Actual -> Characteristic, or PlanStep -> Feature)
  for (const act of doc.actuals) {
    if (offset >= act.range.startOffset && offset <= act.range.endOffset) {
      const char = doc.characteristics.find((c) => c.id === act.characteristicId || c.qpId === act.characteristicId);
      if (char) return { uri, range: toLspRange(char.range) };
    }
  }
  for (const step of doc.planSteps) {
    if (offset >= step.range.startOffset && offset <= step.range.endOffset) {
      const feat = doc.features.find((f) => f.id === step.featureId || f.qpId === step.featureId);
      if (feat) return { uri, range: toLspRange(feat.range) };
    }
  }

  return null;
}

function extractWordAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_-]/.test(ch));
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }
  return text.slice(start, end);
}

export async function executeQifAction(
  actionId: "qif_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<QifDiagnostic[]>;
export async function executeQifAction(
  actionId: "qif_spc",
  content: string,
  params?: Record<string, unknown>,
): Promise<QifSpcSummary>;
export async function executeQifAction(
  actionId: "qif_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeQifAction(
  actionId: "qif_to_sysml2" | "qif_to_modelica",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeQifAction(
  actionId: "qif_reconcile_step",
  content: string,
  params?: { stepText?: string },
): Promise<StepReconciliationResult>;
export async function executeQifAction(
  actionId: "qif_synthesize_from_step",
  content: string,
  params?: { stepText?: string },
): Promise<QifDocument>;
export async function executeQifAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeQifAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  if (actionId === "qif_synthesize_from_step") {
    const stepText = typeof params?.["stepText"] === "string" ? params["stepText"] : content;
    return synthesizeQifFromStep(stepText);
  }

  const doc = parseQif(content);

  switch (actionId) {
    case "qif_lint":
      return lintQifDocument(doc);

    case "qif_spc":
      return evaluateQifSpc(doc);

    case "qif_to_dae": {
      const arena = lowerQifToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "qif_to_sysml2":
      return qifToSysML2(doc);

    case "qif_to_modelica":
      return qifToModelica(doc);

    case "qif_reconcile_step": {
      const stepText = typeof params?.["stepText"] === "string" ? params["stepText"] : "";
      return reconcileStepWithQif(stepText, doc);
    }

    default:
      throw new Error(`Unknown QIF action: ${actionId}`);
  }
}
