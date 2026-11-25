// SPDX-License-Identifier: AGPL-3.0-or-later

import { appendChildSplice, parseXmlSync, type Splice, type XmlElement } from "@modelscript/dsl/xml";

export interface PscadDropTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface PscadForeignDropInfo {
  cleanName: string;
  shortName: string;
  sourceLanguage: string;
  explicitLanguage: string | null;
  params: Array<{ name: string; defaultValue: string }>;
}

export interface PscadDropBuildOptions {
  docText: string;
  info: PscadForeignDropInfo;
  x: number;
  y: number;
  instanceName?: string | undefined;
  section?: string | undefined;
  hasNativeSchema?: boolean | undefined;
  schematicEndLine: number;
  batchState?: unknown;
  sanitizeIdentifier: (raw: string, fallback?: string) => string;
  allocateUniqueIdentifier: (docText: string, baseName: string, batchState?: unknown) => string;
  allocateUniqueNumericId: (xmlRoot: XmlElement | null, seed: number, batchState?: unknown) => number;
}

function escapeXmlAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findAllXmlElements(root: XmlElement | null, predicate: (el: XmlElement) => boolean): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (el: XmlElement) => {
    if (predicate(el)) out.push(el);
    for (const c of el.children) walk(c);
  };
  if (root) walk(root);
  return out;
}

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value;
}

function xmlSpliceToTextEdit(docText: string, splice: Splice): PscadDropTextEdit {
  const toPos = (offset: number): { line: number; character: number } => {
    const clamped = Math.max(0, Math.min(offset, docText.length));
    let line = 0;
    let lastNl = -1;
    for (let i = 0; i < clamped; i++) {
      if (docText.charCodeAt(i) === 10) {
        line++;
        lastNl = i;
      }
    }
    return { line, character: clamped - (lastNl + 1) };
  };
  return {
    range: { start: toPos(splice.start), end: toPos(splice.end) },
    newText: splice.text,
  };
}

/**
 * Generates PSCAD `<User classid="UserCmp">` instance XML edits when dropping
 * a foreign cross-language symbol onto a `.pscx`/`.pslx` schematic.
 * Returns `null` when the drop targets a native PSCAD master or local user component.
 */
export function buildPscadComponentDropEdits(opts: PscadDropBuildOptions): PscadDropTextEdit[] | null {
  const {
    docText,
    info,
    x,
    y,
    instanceName,
    section,
    hasNativeSchema,
    schematicEndLine,
    batchState,
    sanitizeIdentifier,
    allocateUniqueIdentifier,
    allocateUniqueNumericId,
  } = opts;
  if (hasNativeSchema) return null;
  if (info.sourceLanguage === "pscad") return null;

  const xmlDoc = parseXmlSync(docText);
  const defElements = findAllXmlElements(xmlDoc.root, (el) => el.name.toLowerCase() === "definition");
  const existingDefs: Array<{ name: string; body: string }> = [];
  for (const defEl of defElements) {
    const defName = getXmlAttr(defEl, "name");
    if (defName) {
      existingDefs.push({ name: defName, body: docText.slice(defEl.openEnd, defEl.closeStart) });
    }
  }

  const directNativeDef = existingDefs.find((d) => d.name === info.cleanName || d.name === info.shortName);
  if (
    directNativeDef &&
    !directNativeDef.body.includes("@twin") &&
    !info.explicitLanguage &&
    info.sourceLanguage === "unknown"
  ) {
    return null;
  }

  if (info.sourceLanguage === "unknown" && !info.explicitLanguage && !info.cleanName.includes(".")) {
    return null;
  }

  const edits: PscadDropTextEdit[] = [];
  const defnRef = info.explicitLanguage ? info.cleanName.replace(/^[^:]+::/, "") : info.cleanName;

  const baseInstName = info.shortName.charAt(0).toLowerCase() + info.shortName.slice(1);
  const instName = instanceName
    ? sanitizeIdentifier(instanceName, "cmp")
    : allocateUniqueIdentifier(docText, baseInstName, batchState);
  const instId = allocateUniqueNumericId(xmlDoc.root, 100100, batchState);

  const paramEntries = info.params
    .map((p) => `<param name="${escapeXmlAttr(p.name)}" value="${escapeXmlAttr(p.defaultValue)}" />`)
    .join("");
  const userXml =
    `<User classid="UserCmp" id="${instId}" name="${escapeXmlAttr(defnRef)}" defn="${escapeXmlAttr(defnRef)}" ` +
    `x="${Math.round(x)}" y="${Math.round(y)}" w="60" h="60" z="0" orient="0" link="-1" q="4" disable="false">` +
    `<paramlist><param name="Name" value="${escapeXmlAttr(instName)}" />${paramEntries}</paramlist></User>`;

  let targetSchematic: XmlElement | null = null;
  if (section) {
    const secDef = defElements.find((d) => getXmlAttr(d, "name") === section);
    targetSchematic = secDef?.children.find((c) => c.name.toLowerCase() === "schematic") ?? null;
  }
  if (!targetSchematic) {
    const schematics = findAllXmlElements(xmlDoc.root, (el) => el.name.toLowerCase() === "schematic");
    targetSchematic = schematics[schematics.length - 1] ?? null;
  }

  if (targetSchematic) {
    edits.push(xmlSpliceToTextEdit(docText, appendChildSplice(targetSchematic, userXml, docText)));
  } else {
    const pos = { line: schematicEndLine, character: 0 };
    edits.push({ range: { start: pos, end: pos }, newText: `      ${userXml}\n` });
  }
  return edits;
}
