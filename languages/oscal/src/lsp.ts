// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, live NIST SP 800-53 / 800-82 control hover
 * with parameter substitution, completions, go-to-definition, and custom actions.
 */

import { getAllBuiltInControls, getBuiltInControl } from "./catalogs/index.js";
import {
  type CpsArchitectureComponent,
  type CpsComplianceAuditReport,
  auditCpsArchitectureCompliance,
} from "./cps-bridge/index.js";
import { type OscalLintOptions, lintOscalDocument } from "./lints/rules.js";
import { parseOscal, serializeOscal } from "./parser/index.js";
import { oscalToReqif, oscalToSysML2 } from "./projections/index.js";
import { resolveOscalProfile, substituteControlProse } from "./resolver/index.js";
import type {
  OscalControl,
  OscalDiagnostic,
  OscalDocument,
  OscalGroup,
  OscalResolvedCatalog,
  OscalSourceRange,
} from "./types.js";

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
  severity: 1 | 2 | 3 | 4;
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

function toLspRange(range?: OscalSourceRange): LspRange {
  if (!range) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };
  }
  return {
    start: {
      line: Math.max(0, range.startLine - 1),
      character: Math.max(0, range.startColumn - 1),
    },
    end: {
      line: Math.max(0, range.endLine - 1),
      character: Math.max(0, range.endColumn - 1),
    },
  };
}

function collectParamOverrides(doc: OscalDocument): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const sp of doc.modify?.setParameters ?? []) {
    if (sp.values.length > 0) overrides[sp.paramId] = sp.values.join(", ");
  }
  for (const sp of doc.controlImplementation?.setParameters ?? []) {
    if (sp.values.length > 0) overrides[sp.paramId] = sp.values.join(", ");
  }
  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    for (const sp of ir.setParameters ?? []) {
      if (sp.values.length > 0) overrides[sp.paramId] = sp.values.join(", ");
    }
    for (const bc of ir.byComponents ?? []) {
      for (const sp of bc.setParameters ?? []) {
        if (sp.values.length > 0) overrides[sp.paramId] = sp.values.join(", ");
      }
    }
  }
  return overrides;
}

function extractTokenAtOffset(content: string, offset: number): string {
  const clamped = Math.max(0, Math.min(offset, content.length));
  const isTokenChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_.-]/.test(ch);

  let start = clamped;
  while (start > 0 && isTokenChar(content[start - 1])) {
    start--;
  }
  let end = clamped;
  while (end < content.length && isTokenChar(content[end])) {
    end++;
  }
  return content.slice(start, end);
}

export function validateOscal(content: string, options?: OscalLintOptions): LspDiagnostic[] {
  let doc: OscalDocument;
  try {
    doc = parseOscal(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8200",
        source: "oscal-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintOscalDocument(doc, options);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "oscal-linter",
      message: d.message,
    };
  });
}

export function getOscalDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: OscalDocument;
  try {
    doc = parseOscal(content);
  } catch {
    return [];
  }

  const rootRange = toLspRange(doc.range);
  const children: LspDocumentSymbol[] = [];

  const mapControlSymbol = (ctrl: OscalControl): LspDocumentSymbol => {
    const r = toLspRange(ctrl.range);
    const ctrlChildren: LspDocumentSymbol[] = [];
    for (const p of ctrl.params ?? []) {
      const pr = toLspRange(p.range);
      ctrlChildren.push({
        name: p.id,
        detail: p.label ?? "parameter",
        kind: LspSymbolKind.Property,
        range: pr,
        selectionRange: pr,
      });
    }
    for (const sub of ctrl.controls ?? []) {
      ctrlChildren.push(mapControlSymbol(sub));
    }
    return {
      name: ctrl.id,
      detail: ctrl.title,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children: ctrlChildren.length > 0 ? ctrlChildren : undefined,
    };
  };

  const mapGroupSymbol = (grp: OscalGroup): LspDocumentSymbol => {
    const r = toLspRange(grp.range);
    const grpChildren: LspDocumentSymbol[] = [];
    for (const c of grp.controls ?? []) {
      grpChildren.push(mapControlSymbol(c));
    }
    for (const sg of grp.groups ?? []) {
      grpChildren.push(mapGroupSymbol(sg));
    }
    return {
      name: grp.id,
      detail: grp.title,
      kind: LspSymbolKind.Package,
      range: r,
      selectionRange: r,
      children: grpChildren.length > 0 ? grpChildren : undefined,
    };
  };

  for (const grp of doc.groups ?? []) {
    children.push(mapGroupSymbol(grp));
  }
  for (const ctrl of doc.controls ?? []) {
    children.push(mapControlSymbol(ctrl));
  }

  const allComponents = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
  for (const comp of allComponents) {
    const r = toLspRange(comp.range);
    children.push({
      name: comp.title,
      detail: `${comp.type} (${comp.uuid})`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    const r = toLspRange(ir.range);
    const bcChildren: LspDocumentSymbol[] = (ir.byComponents ?? []).map((bc) => {
      const bcr = toLspRange(bc.range);
      return {
        name: bc.componentUuid,
        detail: bc.description,
        kind: LspSymbolKind.Field,
        range: bcr,
        selectionRange: bcr,
      };
    });
    children.push({
      name: ir.controlId,
      detail: ir.description ?? "implemented-requirement",
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
      children: bcChildren.length > 0 ? bcChildren : undefined,
    });
  }

  for (const f of doc.findings ?? []) {
    const r = toLspRange(f.range);
    children.push({
      name: f.title,
      detail: `${f.severity} (${f.status}) -> ${f.targetControlId}`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  for (const p of doc.poamItems ?? []) {
    const r = toLspRange(p.range);
    children.push({
      name: p.title,
      detail: `POA&M (${p.status})`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  return [
    {
      name: doc.metadata.title || doc.uuid,
      detail: `${doc.kind} (v${doc.metadata.version})`,
      kind: LspSymbolKind.Module,
      range: rootRange,
      selectionRange: rootRange,
      children,
    },
  ];
}

function formatControlHoverMarkdown(
  ctrl: OscalControl,
  paramOverrides: Record<string, string>,
  range?: OscalSourceRange,
): LspHover {
  const sub = substituteControlProse(ctrl, paramOverrides);
  const lines: string[] = [
    `### NIST Control **${ctrl.id.toUpperCase()}** — ${ctrl.title}`,
    ctrl.family ? `* **Family:** \`${ctrl.family}\`` : "",
    ctrl.isOtOverlay ? `* **Overlay:** \`NIST SP 800-82 Rev 3 (OT/ICS)\`` : "",
    "",
    sub.prose || "_No statement prose defined._",
  ].filter((l) => l !== "");

  const paramEntries = Object.entries(sub.resolvedParameters);
  if (paramEntries.length > 0) {
    lines.push("", "**Resolved Parameters:**");
    for (const [k, v] of paramEntries) {
      lines.push(`* \`${k}\`: ${v}`);
    }
  }

  return {
    contents: {
      kind: "markdown",
      value: lines.join("\n"),
    },
    range: range ? toLspRange(range) : undefined,
  };
}

export function getOscalHover(content: string, offset: number): LspHover | null {
  let doc: OscalDocument;
  try {
    doc = parseOscal(content);
  } catch {
    return null;
  }

  const paramOverrides = collectParamOverrides(doc);

  // 1. Check token under cursor against local or built-in NIST SP 800-53 controls (or parameter/statement IDs)
  const token = extractTokenAtOffset(content, offset);
  if (token) {
    const baseControlToken = token.includes("_") ? (token.split("_")[0] ?? token) : token;
    const builtIn = getBuiltInControl(token) ?? getBuiltInControl(baseControlToken);
    if (builtIn) {
      return formatControlHoverMarkdown(builtIn, paramOverrides);
    }
  }

  // 2. Check controls declared in document
  const allDocControls: OscalControl[] = [...(doc.controls ?? [])];
  for (const grp of doc.groups ?? []) {
    if (grp.controls) allDocControls.push(...grp.controls);
  }
  for (const ctrl of allDocControls) {
    if (
      (ctrl.range && offset >= ctrl.range.startOffset && offset <= ctrl.range.endOffset) ||
      ctrl.id.toLowerCase() === token.toLowerCase()
    ) {
      return formatControlHoverMarkdown(ctrl, paramOverrides, ctrl.range);
    }
  }

  // 3. Check implemented-requirements in SSP
  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    if (ir.range && offset >= ir.range.startOffset && offset <= ir.range.endOffset) {
      const ctrl = getBuiltInControl(ir.controlId);
      if (ctrl) {
        return formatControlHoverMarkdown(ctrl, paramOverrides, ir.range);
      }
      return {
        contents: {
          kind: "markdown",
          value: `### Implemented Requirement: **${ir.controlId.toUpperCase()}**\n\n${ir.description ?? ""}`,
        },
        range: toLspRange(ir.range),
      };
    }
  }

  // 4. Check components
  const allComponents = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
  for (const comp of allComponents) {
    if (
      (comp.range && offset >= comp.range.startOffset && offset <= comp.range.endOffset) ||
      comp.uuid.toLowerCase() === token.toLowerCase()
    ) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OSCAL Component: **${comp.title}**`,
            `* **UUID:** \`${comp.uuid}\``,
            `* **Type:** \`${comp.type}\``,
            comp.description ? `* **Description:** ${comp.description}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        range: comp.range ? toLspRange(comp.range) : undefined,
      };
    }
  }

  // 5. Fallback to document-level hover if inside document range
  if (offset >= doc.range.startOffset && offset <= doc.range.endOffset) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### OSCAL Document: **${doc.metadata.title}**`,
          `* **Model:** \`${doc.kind}\``,
          `* **UUID:** \`${doc.uuid}\``,
          `* **Version:** \`${doc.metadata.version}\``,
        ].join("\n"),
      },
    };
  }

  return null;
}

export function getOscalCompletions(content?: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  for (const ctrl of getAllBuiltInControls()) {
    const sub = substituteControlProse(ctrl);
    items.push({
      label: ctrl.id,
      kind: 7, // Class
      detail: `${ctrl.title}${ctrl.isOtOverlay ? " [NIST SP 800-82 OT]" : ""}`,
      documentation: sub.prose,
      insertText: ctrl.id,
    });

    for (const p of ctrl.params ?? []) {
      items.push({
        label: p.id,
        kind: 10, // Property
        detail: `Parameter for ${ctrl.id.toUpperCase()}: ${p.label ?? ""}`,
        insertText: p.id,
      });
    }
  }

  const componentTypes = [
    "plc",
    "ied",
    "ot-controller",
    "hardware",
    "software",
    "service",
    "interconnection",
    "policy",
  ];
  for (const ct of componentTypes) {
    items.push({
      label: ct,
      kind: 13, // Enum
      detail: "OSCAL Component Type",
      insertText: ct,
    });
  }

  if (content) {
    try {
      const doc = parseOscal(content);
      const comps = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
      for (const comp of comps) {
        items.push({
          label: comp.uuid,
          kind: 6, // Variable
          detail: `Component UUID: ${comp.title} (${comp.type})`,
          insertText: comp.uuid,
        });
      }
    } catch {
      // Ignore parse errors during completion
    }
  }

  return items;
}

export function getOscalDefinition(content: string, offset: number): LspRange | null {
  let doc: OscalDocument;
  try {
    doc = parseOscal(content);
  } catch {
    return null;
  }

  const token = extractTokenAtOffset(content, offset).toLowerCase();
  if (!token) return null;

  const allComponents = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
  for (const comp of allComponents) {
    if (comp.uuid.toLowerCase() === token && comp.range) {
      return toLspRange(comp.range);
    }
  }

  const allControls: OscalControl[] = [...(doc.controls ?? [])];
  for (const grp of doc.groups ?? []) {
    if (grp.controls) allControls.push(...grp.controls);
  }
  for (const ctrl of allControls) {
    if (ctrl.id.toLowerCase() === token && ctrl.range) {
      return toLspRange(ctrl.range);
    }
    for (const p of ctrl.params ?? []) {
      if (p.id.toLowerCase() === token && p.range) {
        return toLspRange(p.range);
      }
    }
  }

  for (const f of doc.findings ?? []) {
    if (f.uuid.toLowerCase() === token && f.range) {
      return toLspRange(f.range);
    }
  }

  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    if (ir.controlId.toLowerCase() === token && ir.range) {
      return toLspRange(ir.range);
    }
  }

  return null;
}

export type OscalActionParams = OscalLintOptions & {
  catalogs?: OscalDocument[] | undefined;
  archComponents?: CpsArchitectureComponent[] | undefined;
  format?: "json" | "yaml" | "xml" | undefined;
};

export async function executeOscalAction(
  actionId: "oscal_lint",
  content: string,
  params?: OscalLintOptions,
): Promise<OscalDiagnostic[]>;
export async function executeOscalAction(
  actionId: "oscal_resolve_profile",
  content: string,
  params?: { catalogs?: OscalDocument[] },
): Promise<OscalResolvedCatalog>;
export async function executeOscalAction(
  actionId: "oscal_audit_cps",
  content: string,
  params?: { archComponents?: CpsArchitectureComponent[] },
): Promise<CpsComplianceAuditReport>;
export async function executeOscalAction(
  actionId: "oscal_to_sysml2" | "oscal_to_reqif",
  content: string,
): Promise<string>;
export async function executeOscalAction(
  actionId: "oscal_convert",
  content: string,
  params?: { format?: "json" | "yaml" | "xml" },
): Promise<string>;
export async function executeOscalAction(
  actionId: string,
  content: string,
  params?: OscalActionParams,
): Promise<unknown>;
export async function executeOscalAction(
  actionId: string,
  content: string,
  params?: OscalActionParams,
): Promise<unknown> {
  const doc = parseOscal(content);

  switch (actionId) {
    case "oscal_lint":
      return lintOscalDocument(doc, params);

    case "oscal_resolve_profile":
      return resolveOscalProfile(doc, params?.catalogs);

    case "oscal_audit_cps":
      return auditCpsArchitectureCompliance(doc, params?.archComponents ?? []);

    case "oscal_to_sysml2":
      return oscalToSysML2(doc);

    case "oscal_to_reqif":
      return oscalToReqif(doc);

    case "oscal_convert": {
      const fmt = params?.format ?? "json";
      return serializeOscal(doc, fmt);
    }

    default:
      throw new Error(`Unknown OSCAL action: '${actionId}'.`);
  }
}
