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
import {
  collectCstLeaves,
  extractDocCommentSpan,
  findMatchingBraceLeaf,
  findMatchingDelimiterLeaf,
  isSysmlIdentLeaf,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  sliceLeavesInRange,
  stripSurroundingQuotes,
  type CstLeaf,
} from "./cst-utils.js";

function findAttributeValueSpanInBody(
  text: string,
  leaves: readonly CstLeaf[],
  bodyStartIdx: number,
  bodyEndIdx: number,
  attrName: string,
): { startOffset: number; endOffset: number; valueText: string } | null {
  for (let i = bodyStartIdx; i < bodyEndIdx; i++) {
    const kw = leaves[i]!.text;
    if (kw !== "attribute" && kw !== ":>>") continue;
    const nameLeaf = leaves[i + 1];
    if (!nameLeaf || nameLeaf.text !== attrName) continue;

    let j = i + 2;
    if (leaves[j]?.text === ":") {
      j++;
      while (j < bodyEndIdx && leaves[j]!.text !== "=" && leaves[j]!.text !== ":=" && leaves[j]!.text !== ";") {
        j++;
      }
    }
    if (j >= bodyEndIdx || (leaves[j]!.text !== "=" && leaves[j]!.text !== ":=")) continue;
    const valStartIdx = j + 1;
    if (valStartIdx >= bodyEndIdx) continue;
    let endIdx = valStartIdx;
    while (
      endIdx < bodyEndIdx &&
      leaves[endIdx]!.text !== ";" &&
      leaves[endIdx]!.text !== "}" &&
      !text.slice(leaves[endIdx - 1]!.end, leaves[endIdx]!.start).includes("\n")
    ) {
      endIdx++;
    }
    if (endIdx <= valStartIdx) continue;
    const startOffset = leaves[valStartIdx]!.start;
    const endOffset = leaves[endIdx - 1]!.end;
    return {
      startOffset,
      endOffset,
      valueText: text.slice(startOffset, endOffset).trim(),
    };
  }
  return null;
}

interface ParsedBlockDecl {
  kind: string;
  name: string;
  shortId: string;
  typeName: string;
  multiplicity: string;
  startOffset: number;
  endOffset: number;
  delimiter: "{" | ";";
  openBraceOffset: number;
  closeBraceOffset: number;
  bodyStartIdx: number;
  bodyEndIdx: number;
  docSpan: { commentBodyStart: number; commentBodyEnd: number; text: string } | null;
}

function scanPartDeclarations(text: string, leaves: readonly CstLeaf[]): ParsedBlockDecl[] {
  const decls: ParsedBlockDecl[] = [];
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i]!.text !== "part") continue;
    const isDef = leaves[i + 1]!.text === "def";
    const nameIdx = isDef ? i + 2 : i + 1;
    const nameLeaf = leaves[nameIdx];
    if (!nameLeaf || !isSysmlIdentLeaf(nameLeaf.text)) continue;

    let j = nameIdx + 1;
    let typeName = isDef ? "PartDefinition" : "";
    if (leaves[j]?.text === ":") {
      j++;
      const typeParts: string[] = [];
      while (j < leaves.length && (isSysmlIdentLeaf(leaves[j]!.text) || leaves[j]!.text === "::")) {
        typeParts.push(leaves[j]!.text);
        j++;
      }
      if (typeParts.length > 0) typeName = typeParts.join("");
    }

    let multiplicity = "[1]";
    if (leaves[j]?.text === "[") {
      const closeBracket = findMatchingDelimiterLeaf(leaves, j, "[", "]");
      if (closeBracket < 0) continue;
      const multInner = sliceBetweenLeaves(text, leaves[j]!, leaves[closeBracket]!);
      multiplicity = `[${multInner}]`;
      j = closeBracket + 1;
    }

    const delimLeaf = leaves[j];
    if (!delimLeaf || (delimLeaf.text !== "{" && delimLeaf.text !== ";")) continue;

    const startOffset = leaves[i]!.start;
    let endOffset = delimLeaf.end;
    let bodyStartIdx = j + 1;
    let bodyEndIdx = j + 1;
    let openBraceOffset = delimLeaf.start;
    let closeBraceOffset = delimLeaf.end;

    if (delimLeaf.text === "{") {
      const closeBraceIdx = findMatchingBraceLeaf(leaves, j);
      if (closeBraceIdx !== -1) {
        bodyEndIdx = closeBraceIdx;
        openBraceOffset = delimLeaf.start;
        closeBraceOffset = leaves[closeBraceIdx]!.end;
        endOffset = closeBraceOffset;
      }
    }

    const bodyLeaves = sliceLeavesInRange(leaves, openBraceOffset, closeBraceOffset);
    const docSpan = delimLeaf.text === "{" ? extractDocCommentSpan(text, bodyLeaves) : null;

    decls.push({
      kind: isDef ? "part def" : "part",
      name: nameLeaf.text,
      shortId: "",
      typeName,
      multiplicity,
      startOffset,
      endOffset,
      delimiter: delimLeaf.text,
      openBraceOffset,
      closeBraceOffset,
      bodyStartIdx,
      bodyEndIdx,
      docSpan,
    });
  }
  return decls;
}

function scanRequirementDeclarations(text: string, leaves: readonly CstLeaf[]): ParsedBlockDecl[] {
  const decls: ParsedBlockDecl[] = [];
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i]!.text !== "requirement") continue;
    const prevTok = i > 0 ? leaves[i - 1]!.text : "";
    if (prevTok === "satisfy" || prevTok === "verify") continue;

    const isDef = leaves[i + 1]!.text === "def";
    let j = isDef ? i + 2 : i + 1;
    let shortId = "";
    let explicitName = "";

    if (
      j + 2 < leaves.length &&
      leaves[j]!.text === "<" &&
      leaves[j + 2]!.text === ">" &&
      (leaves[j + 1]!.text.startsWith("'") || isSysmlIdentLeaf(leaves[j + 1]!.text))
    ) {
      shortId = stripSurroundingQuotes(leaves[j + 1]!.text);
      j += 3;
      if (j < leaves.length && isSysmlIdentLeaf(leaves[j]!.text)) {
        explicitName = leaves[j]!.text;
        j++;
      }
    } else if (j < leaves.length && isSysmlIdentLeaf(leaves[j]!.text)) {
      explicitName = leaves[j]!.text;
      j++;
    } else {
      continue;
    }

    const name = explicitName || shortId;
    if (!name) continue;

    let typeName = "";
    if (leaves[j]?.text === ":") {
      j++;
      const typeParts: string[] = [];
      while (j < leaves.length && (isSysmlIdentLeaf(leaves[j]!.text) || leaves[j]!.text === "::")) {
        typeParts.push(leaves[j]!.text);
        j++;
      }
      typeName = typeParts.join("");
    }

    const delimLeaf = leaves[j];
    if (!delimLeaf || (delimLeaf.text !== "{" && delimLeaf.text !== ";")) continue;

    const startOffset = leaves[i]!.start;
    let endOffset = delimLeaf.end;
    let bodyStartIdx = j + 1;
    let bodyEndIdx = j + 1;
    let openBraceOffset = delimLeaf.start;
    let closeBraceOffset = delimLeaf.end;

    if (delimLeaf.text === "{") {
      const closeBraceIdx = findMatchingBraceLeaf(leaves, j);
      if (closeBraceIdx !== -1) {
        bodyEndIdx = closeBraceIdx;
        openBraceOffset = delimLeaf.start;
        closeBraceOffset = leaves[closeBraceIdx]!.end;
        endOffset = closeBraceOffset;
      }
    }

    const bodyLeaves = sliceLeavesInRange(leaves, openBraceOffset, closeBraceOffset);
    const docSpan = delimLeaf.text === "{" ? extractDocCommentSpan(text, bodyLeaves) : null;

    decls.push({
      kind: isDef ? "requirement def" : "requirement",
      name,
      shortId,
      typeName,
      multiplicity: "[1]",
      startOffset,
      endOffset,
      delimiter: delimLeaf.text,
      openBraceOffset,
      closeBraceOffset,
      bodyStartIdx,
      bodyEndIdx,
      docSpan,
    });
  }
  return decls;
}

/**
 * Extracts SysML v2 Part Definitions & Part Usages into a BOM / Element Table.
 */
export function extractSysml2PartRows(text: string): TabularRow[] {
  const leaves = collectCstLeaves(parseSysmlSource(text));
  const decls = scanPartDeclarations(text, leaves);
  const rows: TabularRow[] = [];

  for (const decl of decls) {
    const extractAttr = (attrName: string): string =>
      decl.delimiter === "{"
        ? (findAttributeValueSpanInBody(text, leaves, decl.bodyStartIdx, decl.bodyEndIdx, attrName)?.valueText ?? "")
        : "";

    rows.push({
      id: decl.name,
      depth: decl.kind === "part def" ? 0 : 1,
      span: { startOffset: decl.startOffset, endOffset: decl.endOffset },
      cells: {
        name: decl.name,
        kind: decl.kind,
        type: decl.typeName,
        multiplicity: decl.multiplicity,
        mass: extractAttr("mass"),
        power: extractAttr("power"),
        cost: extractAttr("cost"),
        doc: decl.docSpan?.text ?? "",
      },
    });
  }
  return rows;
}

function readSatisfyOrVerifyRef(leaves: readonly CstLeaf[], startIdx: number): { key: string; nextIdx: number } | null {
  if (startIdx + 2 < leaves.length && leaves[startIdx]!.text === "<" && leaves[startIdx + 2]!.text === ">") {
    return {
      key: stripSurroundingQuotes(leaves[startIdx + 1]!.text),
      nextIdx: startIdx + 3,
    };
  }
  const chain = readDottedChainFromLeaves(leaves, startIdx);
  if (chain) {
    return { key: chain.text, nextIdx: chain.nextIdx };
  }
  return null;
}

/**
 * Extracts SysML v2 Requirement Definitions & Usages into a Requirements Table.
 */
export function extractSysml2RequirementRows(text: string): TabularRow[] {
  const leaves = collectCstLeaves(parseSysmlSource(text));
  const satisfiedByMap = new Map<string, string[]>();
  const verifiedByMap = new Map<string, string[]>();

  for (let i = 0; i + 2 < leaves.length; i++) {
    const kw = leaves[i]!.text;
    if (kw !== "satisfy" && kw !== "verify") continue;
    let j = i + 1;
    if (leaves[j]?.text === "requirement") j++;
    const reqRef = readSatisfyOrVerifyRef(leaves, j);
    if (!reqRef || leaves[reqRef.nextIdx]?.text !== "by") continue;
    const targetChain = readDottedChainFromLeaves(leaves, reqRef.nextIdx + 1);
    if (!targetChain) continue;
    const map = kw === "satisfy" ? satisfiedByMap : verifiedByMap;
    const list = map.get(reqRef.key) ?? [];
    list.push(targetChain.text);
    map.set(reqRef.key, list);
  }

  const reqDecls = scanRequirementDeclarations(text, leaves);
  const rows: TabularRow[] = [];
  for (const decl of reqDecls) {
    const satisfiedBy = [
      ...(satisfiedByMap.get(decl.name) ?? []),
      ...(decl.shortId ? (satisfiedByMap.get(decl.shortId) ?? []) : []),
    ];
    const verifiedBy = [
      ...(verifiedByMap.get(decl.name) ?? []),
      ...(decl.shortId ? (verifiedByMap.get(decl.shortId) ?? []) : []),
    ];

    rows.push({
      id: decl.name,
      span: { startOffset: decl.startOffset, endOffset: decl.endOffset },
      cells: {
        shortId: decl.shortId || decl.name,
        name: decl.name,
        doc: decl.docSpan?.text ?? "",
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
  const leaves = collectCstLeaves(parseSysmlSource(text));

  if (sheetId === "requirements" && columnId === "doc") {
    const reqDecl = scanRequirementDeclarations(text, leaves).find((d) => d.name === rowId);
    if (reqDecl && reqDecl.delimiter === "{" && reqDecl.docSpan) {
      let startOffset = reqDecl.docSpan.commentBodyStart;
      let endOffset = reqDecl.docSpan.commentBodyEnd;
      while (
        startOffset < endOffset &&
        (text[startOffset] === " " ||
          text[startOffset] === "\t" ||
          text[startOffset] === "\n" ||
          text[startOffset] === "\r")
      ) {
        startOffset++;
      }
      while (
        endOffset > startOffset &&
        (text[endOffset - 1] === " " ||
          text[endOffset - 1] === "\t" ||
          text[endOffset - 1] === "\n" ||
          text[endOffset - 1] === "\r")
      ) {
        endOffset--;
      }
      const edit = { startOffset, endOffset, newText: newValue };
      return {
        success: true,
        newText: applyWritebackEdits(text, [edit]),
        edits: [edit],
      };
    }
  }

  // Part attribute update (`mass`, `power`, `cost`)
  const partDecl = scanPartDeclarations(text, leaves).find((d) => d.name === rowId);
  if (!partDecl) {
    return {
      success: false,
      newText: text,
      edits: [],
      error: `Element '${rowId}' not found in SysML v2 source.`,
    };
  }

  if (columnId === "mass" || columnId === "power" || columnId === "cost") {
    if (partDecl.delimiter === "{") {
      const attrSpan = findAttributeValueSpanInBody(text, leaves, partDecl.bodyStartIdx, partDecl.bodyEndIdx, columnId);
      if (attrSpan) {
        const edit = { startOffset: attrSpan.startOffset, endOffset: attrSpan.endOffset, newText: newValue };
        return {
          success: true,
          newText: applyWritebackEdits(text, [edit]),
          edits: [edit],
        };
      }
      const closeBrace = partDecl.closeBraceOffset - 1;
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

    if (partDecl.delimiter === ";") {
      const edit = {
        startOffset: partDecl.openBraceOffset,
        endOffset: partDecl.openBraceOffset + 1,
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
