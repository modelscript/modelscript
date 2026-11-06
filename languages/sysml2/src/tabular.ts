// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  applyTabularMutation,
  applyWritebackEdits,
  executeTabularSheet,
  type CompiledTabularPayload,
  type TabularConfig,
  type TabularMutationRequest,
  type TabularMutationResult,
  type TabularRow,
} from "@modelscript/dsl";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDocComment(body: string): string {
  let searchPos = 0;
  while (searchPos < body.length) {
    const docIdx = body.indexOf("doc", searchPos);
    if (docIdx === -1) break;
    const prevChar = docIdx > 0 ? body[docIdx - 1] : " ";
    if (/[a-zA-Z0-9_]/.test(prevChar!)) {
      searchPos = docIdx + 3;
      continue;
    }
    let afterDoc = docIdx + 3;
    while (
      afterDoc < body.length &&
      (body[afterDoc] === " " || body[afterDoc] === "\t" || body[afterDoc] === "\n" || body[afterDoc] === "\r")
    ) {
      afterDoc++;
    }
    if (body.slice(afterDoc, afterDoc + 2) === "/*") {
      const commentStart = afterDoc + 2;
      const commentEnd = body.indexOf("*/", commentStart);
      if (commentEnd !== -1) {
        return body.slice(commentStart, commentEnd).trim();
      }
    }
    searchPos = docIdx + 3;
  }
  return "";
}

function findClosingBrace(text: string, openBraceIdx: number): number {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Extracts SysML v2 Part Definitions & Part Usages into a BOM / Element Table.
 */
export function extractSysml2PartRows(text: string): TabularRow[] {
  const rows: TabularRow[] = [];
  const blockHeaderRegex =
    /\b(part\s+def|part)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_:]+))?(?:\s*\[([^\]]+)\])?\s*([{;])/g;
  let match: RegExpExecArray | null;
  while ((match = blockHeaderRegex.exec(text)) !== null) {
    const kind = match[1]!.replace(/\s+/g, " ");
    const name = match[2]!;
    const typeName = match[3] ?? (kind === "part def" ? "PartDefinition" : "");
    const multiplicity = match[4] ? `[${match[4]}]` : "[1]";
    const delimiter = match[5]!;
    const startOffset = match.index;
    let body = ";";
    let endOffset = match.index + match[0].length;

    if (delimiter === "{") {
      const openBraceIdx = match.index + match[0].length - 1;
      const closeBraceIdx = findClosingBrace(text, openBraceIdx);
      if (closeBraceIdx !== -1) {
        body = text.slice(openBraceIdx, closeBraceIdx + 1);
        endOffset = closeBraceIdx + 1;
      }
    }

    const extractAttr = (attrName: string): string => {
      const m = body.match(
        new RegExp(`(?:attribute|:>>)\\s+${escapeRegex(attrName)}(?:\\s*:[^=;]+)?\\s*(?:=|:=)\\s*([^;\\r\\n}]+)`),
      );
      return m?.[1]?.trim() ?? "";
    };

    const docText = extractDocComment(body);

    rows.push({
      id: name,
      depth: kind === "part def" ? 0 : 1,
      span: { startOffset, endOffset },
      cells: {
        name,
        kind,
        type: typeName,
        multiplicity,
        mass: extractAttr("mass"),
        power: extractAttr("power"),
        cost: extractAttr("cost"),
        doc: docText,
      },
    });
  }
  return rows;
}

/**
 * Extracts SysML v2 Requirement Definitions & Usages into a Requirements Table.
 */
export function extractSysml2RequirementRows(text: string): TabularRow[] {
  const rows: TabularRow[] = [];
  const satisfiedByMap = new Map<string, string[]>();
  const verifiedByMap = new Map<string, string[]>();

  const satRegex = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z0-9_.'<>-]+)\s+by\s+([A-Za-z0-9_.]+)/g;
  let sm: RegExpExecArray | null;
  while ((sm = satRegex.exec(text)) !== null) {
    const reqKey = sm[1]!.replace(/^<'|'>$/g, "");
    const list = satisfiedByMap.get(reqKey) ?? [];
    list.push(sm[2]!);
    satisfiedByMap.set(reqKey, list);
  }

  const verRegex = /\bverify\s+(?:requirement\s+)?([A-Za-z0-9_.'<>-]+)\s+by\s+([A-Za-z0-9_.]+)/g;
  let vm: RegExpExecArray | null;
  while ((vm = verRegex.exec(text)) !== null) {
    const reqKey = vm[1]!.replace(/^<'|'>$/g, "");
    const list = verifiedByMap.get(reqKey) ?? [];
    list.push(vm[2]!);
    verifiedByMap.set(reqKey, list);
  }

  const reqHeaderRegex =
    /\b(requirement\s+def|requirement)\s+(?:<'([^']+)'(?:\s+([A-Za-z_][A-Za-z0-9_]*))?|([A-Za-z_][A-Za-z0-9_]*))(?:\s*:\s*([A-Za-z0-9_:]+))?\s*([{;])/g;
  let match: RegExpExecArray | null;
  while ((match = reqHeaderRegex.exec(text)) !== null) {
    const shortId = match[2] ?? "";
    const name = match[3] ?? match[4] ?? shortId ?? "UnnamedRequirement";
    if (!shortId && !match[3] && !match[4]) continue;
    const delimiter = match[6]!;
    const startOffset = match.index;
    let body = ";";
    let endOffset = match.index + match[0].length;

    if (delimiter === "{") {
      const openBraceIdx = match.index + match[0].length - 1;
      const closeBraceIdx = findClosingBrace(text, openBraceIdx);
      if (closeBraceIdx !== -1) {
        body = text.slice(openBraceIdx, closeBraceIdx + 1);
        endOffset = closeBraceIdx + 1;
      }
    }
    const docText = extractDocComment(body);

    const satisfiedBy = [...(satisfiedByMap.get(name) ?? []), ...(shortId ? (satisfiedByMap.get(shortId) ?? []) : [])];
    const verifiedBy = [...(verifiedByMap.get(name) ?? []), ...(shortId ? (verifiedByMap.get(shortId) ?? []) : [])];

    rows.push({
      id: name,
      span: { startOffset, endOffset },
      cells: {
        shortId: shortId || name,
        name,
        doc: docText,
        satisfiedBy: satisfiedBy.join(", "),
        verifiedBy: verifiedBy.join(", "),
        status:
          satisfiedBy.length > 0 && verifiedBy.length > 0
            ? "Verified"
            : satisfiedBy.length > 0
              ? "Satisfied"
              : "Unallocated",
      },
    });
  }
  return rows;
}

/**
 * Updates a SysML v2 Part or Requirement cell and returns a TabularMutationResult.
 */
export function updateSysml2TabularCell(
  text: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  newValue: string,
): TabularMutationResult {
  const escapedId = escapeRegex(rowId);
  if (sheetId === "requirements" && columnId === "doc") {
    const reqHeaderRe = new RegExp(
      `\\b(?:requirement\\s+def|requirement)\\s+(?:<'[^']+'\\s*)?${escapedId}[^;{]*([{;])`,
    );
    const m = text.match(reqHeaderRe);
    if (m && m.index !== undefined && m[1] === "{") {
      const openBraceIdx = m.index + m[0].length - 1;
      const closeBraceIdx = findClosingBrace(text, openBraceIdx);
      if (closeBraceIdx !== -1) {
        const body = text.slice(openBraceIdx, closeBraceIdx + 1);
        const docMatch = body.match(/(doc\s*\/\*\s*)([\s\S]*?)(\s*\*\/)/);
        if (docMatch && docMatch.index !== undefined) {
          const startOffset = openBraceIdx + docMatch.index + docMatch[1]!.length;
          const endOffset = startOffset + docMatch[2]!.length;
          const edit = { startOffset, endOffset, newText: newValue };
          return {
            success: true,
            newText: applyWritebackEdits(text, [edit]),
            edits: [edit],
          };
        }
      }
    }
  }

  // Part attribute update (`mass`, `power`, `cost`)
  const partHeaderRe = new RegExp(
    `\\b(?:part\\s+def|part)\\s+${escapedId}(?:\\s*:\\s*[A-Za-z0-9_:]+)?(?:\\s*\\[[^\\]]+\\])?\\s*([{;])`,
  );
  const pm = text.match(partHeaderRe);
  if (!pm || pm.index === undefined) {
    return {
      success: false,
      newText: text,
      edits: [],
      error: `Element '${rowId}' not found in SysML v2 source.`,
    };
  }

  const delimiter = pm[1]!;
  const headerEnd = pm.index + pm[0].length;
  let body = ";";
  let bodyStart = headerEnd - 1;
  let bodyEnd = headerEnd;

  if (delimiter === "{") {
    const openBraceIdx = headerEnd - 1;
    const closeBraceIdx = findClosingBrace(text, openBraceIdx);
    if (closeBraceIdx !== -1) {
      body = text.slice(openBraceIdx, closeBraceIdx + 1);
      bodyStart = openBraceIdx;
      bodyEnd = closeBraceIdx + 1;
    }
  }

  if (columnId === "mass" || columnId === "power" || columnId === "cost") {
    const attrRe = new RegExp(
      `((?:attribute|:>>)\\s+${escapeRegex(columnId)}(?:\\s*:[^=;]+)?\\s*(?:=|:=)\\s*)([^;\\r\\n}]+)`,
    );
    const am = body.match(attrRe);
    if (am && am.index !== undefined) {
      const startOffset = bodyStart + am.index + am[1]!.length;
      const endOffset = startOffset + am[2]!.trimEnd().length;
      const edit = { startOffset, endOffset, newText: newValue };
      return {
        success: true,
        newText: applyWritebackEdits(text, [edit]),
        edits: [edit],
      };
    }
    if (body.startsWith("{") && body.endsWith("}")) {
      const closeBrace = bodyEnd - 1;
      const edit = {
        startOffset: closeBrace,
        endOffset: closeBrace,
        newText: `  attribute ${columnId} = ${newValue};\n`,
      };
      return {
        success: true,
        newText: applyWritebackEdits(text, [edit]),
        edits: [edit],
      };
    }
    if (body === ";") {
      const edit = {
        startOffset: bodyStart,
        endOffset: bodyStart + 1,
        newText: ` {\n  attribute ${columnId} = ${newValue};\n}`,
      };
      return {
        success: true,
        newText: applyWritebackEdits(text, [edit]),
        edits: [edit],
      };
    }
  }

  return {
    success: false,
    newText: text,
    edits: [],
    error: `Column '${columnId}' cannot be updated on '${rowId}'.`,
  };
}

/**
 * First-class Declarative & Bidirectional Tabular Configuration for SysML v2.
 */
export const sysml2TabularConfig: TabularConfig = {
  defaultSheet: "parts",
  enableCsvExport: true,
  enableMultiColumnSort: true,
  enableQuickFilter: true,
  sheets: {
    parts: {
      id: "parts",
      title: "Parts & BOM Inventory",
      description: "Bidirectional SysML v2 Part Definition & Usage table with physical attributes",
      icon: "package",
      kind: "flat",
      sourceRule: "PartUsage",
      columns: [
        { id: "name", header: "Element Name", type: "string", width: 160, pinned: "left", mono: true },
        { id: "kind", header: "Metaclass", type: "badge", width: 100, mono: true },
        { id: "type", header: "Type", type: "reference", width: 150, editable: true, mono: true },
        { id: "multiplicity", header: "Mult.", type: "string", width: 80, editable: true, mono: true },
        { id: "mass", header: "Mass", type: "quantity", unit: "kg", width: 110, editable: true, mono: true },
        { id: "power", header: "Power", type: "quantity", unit: "W", width: 110, editable: true, mono: true },
        { id: "cost", header: "Cost", type: "quantity", unit: "USD", width: 110, editable: true, mono: true },
        { id: "doc", header: "Documentation", type: "string", width: 260, editable: true },
      ],
      extractRows: extractSysml2PartRows,
      mutations: {
        updateCell: (docText, rowId, columnId, newValue) =>
          updateSysml2TabularCell(docText, "parts", rowId, columnId, String(newValue ?? "")),
      },
    },
    requirements: {
      id: "requirements",
      title: "SysML v2 Requirements & RTM",
      description: "SysML v2 requirement definitions, satisfaction links, and verification coverage",
      icon: "checklist",
      kind: "flat",
      sourceRule: "RequirementDefinition",
      columns: [
        { id: "shortId", header: "Req ID", type: "string", width: 120, pinned: "left", mono: true },
        { id: "name", header: "Name", type: "string", width: 180, mono: true },
        { id: "doc", header: "Specification Text", type: "string", width: 320, editable: true },
        { id: "satisfiedBy", header: "Satisfied By", type: "reference", width: 160, mono: true },
        { id: "verifiedBy", header: "Verified By", type: "reference", width: 160, mono: true },
        { id: "status", header: "Coverage Status", type: "badge", width: 130 },
      ],
      extractRows: extractSysml2RequirementRows,
      mutations: {
        updateCell: (docText, rowId, columnId, newValue) =>
          updateSysml2TabularCell(docText, "requirements", rowId, columnId, String(newValue ?? "")),
      },
    },
  },
};

export function executeSysml2Tabular(text: string, sheetId?: string): CompiledTabularPayload {
  return executeTabularSheet(sysml2TabularConfig, text, sheetId);
}

export function applySysml2TabularMutation(text: string, mutation: TabularMutationRequest): TabularMutationResult {
  return applyTabularMutation(sysml2TabularConfig, text, mutation);
}
