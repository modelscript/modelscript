// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CstDocumentSession,
  CstTransaction,
  CstXmlAdapter,
  encodeXmlAttrValue,
  nodeEndOffset,
  nodeStartOffset,
  walkHealthyCst,
} from "@modelscript/dsl/unparser";
import type { XmlElement } from "@modelscript/dsl/xml";
import { createPscadCstSession } from "./edit/edit-engine.js";

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
  /** Optional live incremental CST session to avoid re-parsing `docText`. */
  session?: CstDocumentSession | undefined;
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

function collectUsedNumericIds(session: CstDocumentSession): Set<number> {
  const used = new Set<number>();
  walkHealthyCst(session.rootNode, (node) => {
    const tag = CstXmlAdapter.getTagName(node, session.text);
    if (!tag) return;
    const idVal = CstXmlAdapter.getAttribute(node, "id", session.text)?.value;
    if (idVal && /^\d+$/.test(idVal)) {
      used.add(Number.parseInt(idVal, 10));
    }
  });
  return used;
}

/**
 * Generates PSCAD `<User classid="UserCmp">` instance XML edits via {@link CstTransaction}
 * and {@link CstXmlAdapter} when dropping a foreign cross-language symbol onto a `.pscx`/`.pslx` schematic.
 * Returns `null` when the drop targets a native PSCAD master or local user component.
 */
export function buildPscadComponentDropEdits(opts: PscadDropBuildOptions): PscadDropTextEdit[] | null {
  const {
    docText,
    session: providedSession,
    info,
    x,
    y,
    instanceName,
    section,
    hasNativeSchema,
    batchState,
    sanitizeIdentifier,
    allocateUniqueIdentifier,
  } = opts;
  if (hasNativeSchema) return null;
  if (info.sourceLanguage === "pscad") return null;

  const ownsSession = !providedSession;
  const session = providedSession ?? createPscadCstSession(docText);

  try {
    const root = session.rootNode;
    const defNodes = CstXmlAdapter.findElements(root, session.text, (_n, tag) => tag.toLowerCase() === "definition");
    const existingDefs: Array<{ name: string; body: string }> = [];
    for (const defNode of defNodes) {
      const defName = CstXmlAdapter.getAttribute(defNode, "name", session.text)?.value;
      if (defName) {
        existingDefs.push({
          name: defName,
          body: session.text.slice(nodeStartOffset(defNode), nodeEndOffset(defNode)),
        });
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

    const defnRef = info.explicitLanguage ? info.cleanName.replace(/^[^:]+::/, "") : info.cleanName;
    const baseInstName = info.shortName.charAt(0).toLowerCase() + info.shortName.slice(1);
    const instName = instanceName
      ? sanitizeIdentifier(instanceName, baseInstName)
      : allocateUniqueIdentifier(docText, baseInstName, batchState);

    const usedIds = collectUsedNumericIds(session);
    const batch = batchState as { usedIds?: Set<number> } | undefined;
    if (batch?.usedIds) {
      for (const id of batch.usedIds) usedIds.add(id);
    }
    let nextId = Math.max(1000, docText.length % 90000);
    while (usedIds.has(nextId)) nextId++;
    batch?.usedIds?.add(nextId);

    const sx = Math.round(x);
    const sy = Math.round(y);
    const eol = session.eol;
    const paramLines = [
      `            <param name="Name" value="${encodeXmlAttrValue(instName)}" />`,
      ...info.params.map(
        (p) =>
          `            <param name="${encodeXmlAttrValue(p.name)}" value="${encodeXmlAttrValue(p.defaultValue)}" />`,
      ),
    ].join(eol);
    const userXml =
      `<User classid="UserCmp" defn="${encodeXmlAttrValue(defnRef)}" id="${nextId}" x="${sx}" y="${sy}" w="60" h="60" orient="0" disable="false">${eol}` +
      `          <paramlist link="-1" name="" crc="0">${eol}` +
      `${paramLines}${eol}` +
      `          </paramlist>${eol}` +
      `        </User>`;

    // Locate target <schematic> element (matching section if given) via CST
    let targetSchematic = null;
    if (section) {
      const secDef = defNodes.find((d) => CstXmlAdapter.getAttribute(d, "name", session.text)?.value === section);
      if (secDef) {
        targetSchematic =
          CstXmlAdapter.getChildElements(secDef).find(
            (c) => (CstXmlAdapter.getTagName(c, session.text) ?? "").toLowerCase() === "schematic",
          ) ?? null;
      }
    }
    if (!targetSchematic) {
      targetSchematic =
        CstXmlAdapter.findElements(root, session.text, (_n, tag) => tag.toLowerCase() === "schematic")[0] ?? null;
    }

    const tx = new CstTransaction(session);
    if (targetSchematic) {
      CstXmlAdapter.appendChild(tx, targetSchematic, userXml);
    } else {
      const rootEl = CstXmlAdapter.findElements(root, session.text, () => true)[0] ?? null;
      if (rootEl) {
        CstXmlAdapter.appendChild(tx, rootEl, userXml);
      } else {
        tx.insertAt(docText.length, `${docText.endsWith("\n") || docText.length === 0 ? "" : eol}${userXml}${eol}`);
      }
    }

    return tx.commit().edits;
  } finally {
    if (ownsSession) session.dispose();
  }
}
