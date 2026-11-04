// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dicom-rt — Language Server Protocol (LSP) Service Integration.
 *
 * Provides clinical radiotherapy validation (M9201–M9210), document symbols,
 * rich markdown hover cards (with DVH metrics, BED/EQD2, and linac control point summary),
 * completions, go-to-definition, and custom action execution.
 */

import { lowerDicomRtToDae } from "./dae/index.js";
import { type DicomRtDosimetrySummary, evaluateDicomRtDosimetry } from "./dosimetry/index.js";
import { lintDicomRtDocument } from "./lints/rules.js";
import { parseDicomRt } from "./parser/index.js";
import { dicomRtToScad, dicomRtToSysML2 } from "./projections/index.js";
import type { DicomRtDiagnostic, DicomRtDocument, DicomRtSourceRange } from "./types.js";

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

const DEFAULT_RANGE: DicomRtSourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

function toLspRange(r: DicomRtSourceRange): LspRange {
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

export function validateDicomRt(content: string): LspDiagnostic[] {
  let doc: DicomRtDocument;
  try {
    doc = parseDicomRt(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9200",
        source: "dicom-rt-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintDicomRtDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "dicom-rt-linter",
      message: d.message,
    };
  });
}

export function getDicomRtDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: DicomRtDocument;
  try {
    doc = parseDicomRt(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const roi of doc.structures) {
    const r = toLspRange(roi.range);
    symbols.push({
      name: roi.name,
      detail: `ROI #${roi.roiNumber} (${roi.interpretedType}, ${roi.volumeCc} cc)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const beam of doc.beams) {
    const r = toLspRange(beam.range);
    const children: LspDocumentSymbol[] = beam.controlPoints.map((cp) => {
      const cpr = toLspRange(cp.range);
      return {
        name: `ControlPoint ${cp.index}`,
        detail: `w=${cp.cumulativeMetersetWeight.toFixed(2)}, G=${cp.gantryAngleDeg}°, C=${cp.couchAngleDeg}°`,
        kind: LspSymbolKind.Event,
        range: cpr,
        selectionRange: cpr,
      };
    });

    symbols.push({
      name: beam.name,
      detail: `Beam #${beam.beamNumber} (${beam.modality}, ${beam.energyMeV} MeV, ${beam.metersetMu} MU)`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children,
    });
  }

  for (const dvh of doc.dvhs) {
    const r = toLspRange(dvh.range ?? doc.range ?? DEFAULT_RANGE);
    symbols.push({
      name: `DVH: ${dvh.roiName}`,
      detail: `D95=${dvh.d95Gy.toFixed(1)} Gy, Mean=${dvh.meanDoseGy.toFixed(1)} Gy, Max=${dvh.maxDoseGy.toFixed(1)} Gy`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getDicomRtHover(content: string, offset: number): LspHover | null {
  let doc: DicomRtDocument;
  try {
    doc = parseDicomRt(content);
  } catch {
    return null;
  }

  const dosimetry = evaluateDicomRtDosimetry(doc);
  const reportByRoi = new Map(dosimetry.roiReports.map((r) => [r.roiNumber, r]));

  for (const roi of doc.structures) {
    if (offset >= roi.range.startOffset && offset <= roi.range.endOffset) {
      const rep = reportByRoi.get(roi.roiNumber);
      const lines = [
        `### RTSTRUCT ROI: **${roi.name}** (\`#${roi.roiNumber}\`)`,
        `* **Interpreted Type:** \`${roi.interpretedType}\``,
        `* **Volume:** \`${roi.volumeCc} cc\``,
        `* **Contour Slices:** \`${roi.contours.length}\``,
        roi.maxDoseLimitGy !== undefined ? `* **Max Dose Constraint:** \`<= ${roi.maxDoseLimitGy} Gy\`` : "",
        roi.meanDoseLimitGy !== undefined ? `* **Mean Dose Constraint:** \`<= ${roi.meanDoseLimitGy} Gy\`` : "",
        rep
          ? `* **Dosimetry:** $D_{95\\%} = ${rep.d95Gy}\\text{ Gy}$, $\\text{Mean} = ${rep.meanDoseGy}\\text{ Gy}$, $\\text{BED} = ${rep.bedGy}\\text{ Gy}$, $\\text{EQD}_2 = ${rep.eqd2Gy}\\text{ Gy}$`
          : "",
      ].filter(Boolean);

      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(roi.range),
      };
    }
  }

  for (const beam of doc.beams) {
    for (const cp of beam.controlPoints) {
      if (offset >= cp.range.startOffset && offset <= cp.range.endOffset) {
        const lines = [
          `### Control Point **#${cp.index}** (Beam **${beam.name}**)`,
          `* **Cumulative Meterset Weight:** \`${cp.cumulativeMetersetWeight}\``,
          `* **Gantry / Collimator / Couch:** \`${cp.gantryAngleDeg}°\` / \`${cp.collimatorAngleDeg}°\` / \`${cp.couchAngleDeg}°\``,
          `* **Jaw X / Y:** \`[${cp.jawX_mm[0]}, ${cp.jawX_mm[1]}] mm\` / \`[${cp.jawY_mm[0]}, ${cp.jawY_mm[1]}] mm\``,
          `* **MLC Leaf Pairs:** \`${cp.mlcLeaves.length}\``,
        ];
        return {
          contents: {
            kind: "markdown",
            value: lines.join("\n"),
          },
          range: toLspRange(cp.range),
        };
      }
    }

    if (offset >= beam.range.startOffset && offset <= beam.range.endOffset) {
      const lines = [
        `### RTPLAN Beam: **${beam.name}** (\`#${beam.beamNumber}\`)`,
        `* **Modality:** \`${beam.modality}\` (\`${beam.treatmentDeliveryType}\`)`,
        `* **Nominal Energy:** \`${beam.energyMeV} MeV\``,
        `* **Meterset:** \`${beam.metersetMu} MU\` at \`${beam.doseRateMuPerMin} MU/min\``,
        `* **Control Points:** \`${beam.controlPoints.length}\``,
      ];
      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(beam.range),
      };
    }
  }

  for (const dvh of doc.dvhs) {
    if (dvh.range && offset >= dvh.range.startOffset && offset <= dvh.range.endOffset) {
      const rep = reportByRoi.get(dvh.roiNumber);
      const lines = [
        `### Cumulative DVH: **${dvh.roiName}** (\`ROI #${dvh.roiNumber}\`)`,
        `* **$D_{98\\%}$ / $D_{95\\%}$ / $D_{50\\%}$ / $D_{2\\%}$:** \`${dvh.d98Gy} Gy\` / \`${dvh.d95Gy} Gy\` / \`${dvh.d50Gy} Gy\` / \`${dvh.d2Gy} Gy\``,
        `* **Mean / Max Dose:** \`${dvh.meanDoseGy} Gy\` / \`${dvh.maxDoseGy} Gy\``,
        `* **$V_{20\\text{Gy}}$:** \`${dvh.v20GyPercent}%\``,
        rep
          ? `* **Radiobiology:** $\\text{BED} = ${rep.bedGy}\\text{ Gy}$, $\\text{EQD}_2 = ${rep.eqd2Gy}\\text{ Gy}$, $\\text{HI} = ${rep.homogeneityIndex}$`
          : "",
      ].filter(Boolean);
      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(dvh.range),
      };
    }
  }

  return null;
}

export function getDicomRtCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "<DicomRtPlan>",
      kind: 14,
      detail: "DICOM-RT Treatment Plan Root Element",
      insertText:
        '<DicomRtPlan planId="PLAN-01" planLabel="IMRT_Prostate" patientId="PT-001" frameOfReferenceUid="1.2.840.10008.1" prescribedDoseGy="78.0" fractions="39">\n</DicomRtPlan>',
    },
    {
      label: "<ROI>",
      kind: 14,
      detail: "RTSTRUCT Anatomical Region of Interest",
      insertText: '<ROI roiNumber="1" name="PTV_78" interpretedType="PTV" volumeCc="120.0">\n</ROI>',
    },
    {
      label: "<Contour>",
      kind: 14,
      detail: "RTSTRUCT Planar Contour Slice",
      insertText: '<Contour z="0.0" geometricType="CLOSED_PLANAR" points="-20,-20,0; 20,-20,0; 20,20,0; -20,20,0" />',
    },
    {
      label: "<Beam>",
      kind: 14,
      detail: "RTPLAN Radiation Treatment Beam",
      insertText:
        '<Beam beamNumber="1" name="VMAT_Arc1" modality="PHOTON" treatmentDeliveryType="TREATMENT" energyMeV="6.0" metersetMu="250.0" doseRateMuPerMin="600.0">\n</Beam>',
    },
    {
      label: "<ControlPoint>",
      kind: 14,
      detail: "RTPLAN Beam Control Point",
      insertText:
        '<ControlPoint index="0" cumulativeMetersetWeight="0.0" gantryAngleDeg="0.0" collimatorAngleDeg="15.0" couchAngleDeg="0.0" jawX_mm="-50,50" jawY_mm="-50,50">\n</ControlPoint>',
    },
    {
      label: "<MLCLeafPair>",
      kind: 14,
      detail: "Multileaf Collimator Leaf Pair Positions (mm)",
      insertText: '<MLCLeafPair pairIndex="1" bankA_mm="-20.0" bankB_mm="20.0" />',
    },
    {
      label: "<DVH>",
      kind: 14,
      detail: "RTDOSE Cumulative Dose-Volume Histogram",
      insertText:
        '<DVH roiNumber="1" roiName="PTV_78" d98Gy="75.5" d95Gy="76.8" d50Gy="78.2" d2Gy="80.1" meanDoseGy="78.1" maxDoseGy="81.0" minDoseGy="74.0" v20GyPercent="100.0" />',
    },
    { label: "PTV", kind: 13, detail: "Planning Target Volume" },
    { label: "CTV", kind: 13, detail: "Clinical Target Volume" },
    { label: "GTV", kind: 13, detail: "Gross Tumor Volume" },
    { label: "ORGAN", kind: 13, detail: "Organ at Risk (OAR)" },
    { label: "EXTERNAL", kind: 13, detail: "External Patient Body Contour" },
    { label: "PHOTON", kind: 12, detail: "Photon Beam Modality" },
    { label: "PROTON", kind: 12, detail: "Proton Beam Modality" },
    { label: "ELECTRON", kind: 12, detail: "Electron Beam Modality" },
    { label: "CARBON_ION", kind: 12, detail: "Carbon Ion Beam Modality" },
  ];

  try {
    const doc = parseDicomRt(content);
    for (const roi of doc.structures) {
      items.push({
        label: roi.name,
        kind: 6,
        detail: `ROI #${roi.roiNumber} (${roi.interpretedType})`,
      });
    }
    for (const beam of doc.beams) {
      items.push({
        label: beam.name,
        kind: 7,
        detail: `Beam #${beam.beamNumber} (${beam.modality}, ${beam.energyMeV} MeV)`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export function getDicomRtDefinition(
  content: string,
  offset: number,
  uri = "file:///plan.dcm.xml",
): LspLocation | null {
  let doc: DicomRtDocument;
  try {
    doc = parseDicomRt(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (word) {
    const roi = doc.structures.find(
      (s) => s.name === word || `ROI_${s.roiNumber}` === word || String(s.roiNumber) === word,
    );
    if (roi) {
      return { uri, range: toLspRange(roi.range) };
    }
    const beam = doc.beams.find(
      (b) => b.name === word || `Beam_${b.beamNumber}` === word || String(b.beamNumber) === word,
    );
    if (beam) {
      return { uri, range: toLspRange(beam.range) };
    }
  }

  // Fallback contextual lookup: clicking on a <DVH> navigates to its corresponding <ROI>
  for (const dvh of doc.dvhs) {
    if (dvh.range && offset >= dvh.range.startOffset && offset <= dvh.range.endOffset) {
      const roi = doc.structures.find(
        (s) => s.roiNumber === dvh.roiNumber || s.name.toLowerCase() === dvh.roiName.toLowerCase(),
      );
      if (roi) {
        return { uri, range: toLspRange(roi.range) };
      }
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

export async function executeDicomRtAction(
  actionId: "dicom_rt_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<DicomRtDiagnostic[]>;
export async function executeDicomRtAction(
  actionId: "dicom_rt_dosimetry",
  content: string,
  params?: Record<string, unknown>,
): Promise<DicomRtDosimetrySummary>;
export async function executeDicomRtAction(
  actionId: "dicom_rt_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeDicomRtAction(
  actionId: "dicom_rt_to_scad" | "dicom_rt_to_sysml2",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeDicomRtAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeDicomRtAction(
  actionId: string,
  content: string,
  _params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseDicomRt(content);

  switch (actionId) {
    case "dicom_rt_lint":
      return lintDicomRtDocument(doc);

    case "dicom_rt_dosimetry":
      return evaluateDicomRtDosimetry(doc);

    case "dicom_rt_to_dae": {
      const arena = lowerDicomRtToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "dicom_rt_to_scad":
      return dicomRtToScad(doc);

    case "dicom_rt_to_sysml2":
      return dicomRtToSysML2(doc);

    default:
      throw new Error(`Unknown DICOM-RT action: ${actionId}`);
  }
}
