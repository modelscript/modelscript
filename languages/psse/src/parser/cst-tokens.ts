// SPDX-License-Identifier: AGPL-3.0-or-later

import { CstUnparser, createReplaceEdit, type SyntaxNode } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { resolveDyrModelSchema } from "../schema/index.js";
import type { DyrHeaderKind } from "../types.js";
import { getPsseWasmParser } from "./wasm-loader.js";

/** A logical field extracted from WASM CST tokens with exact byte and position spans. */
export interface PsseCstField {
  /** Unquoted, trimmed field value (empty string for omitted comma slots). */
  value: string;
  /** Raw source text of the field (empty string for omitted comma slots). */
  rawText: string;
  /** CST token type of the primary token (`Number`, `QuotedString`, `Identifier`, etc.), or `empty`. */
  tokenType: string;
  /** Primary CST node when a single token spans this field. */
  node?: CstNodeLike | undefined;
  /** Byte start offset in source. */
  startOffset: number;
  /** Byte end offset in source. */
  endOffset: number;
  /** 0-based start line. */
  line0: number;
  /** 0-based start column. */
  startCol0: number;
  /** 0-based end column. */
  endCol0: number;
}

/** A single source line reconstructed from WASM CST leaf tokens. */
export interface PsseCstLine {
  /** 0-based row index. */
  row: number;
  /** 1-based line number. */
  lineNum: number;
  /** Byte start offset of the line in source. */
  startOffset: number;
  /** Byte end offset of the line (excluding trailing newline). */
  endOffset: number;
  /** Full text of the line from WASM CST spans. */
  line: string;
  /** All CST leaf tokens on this line. */
  tokens: CstNodeLike[];
  /** Comment text (from `/` or `//`) on this line, if any. */
  commentText: string;
  /** True if the line contains only `@!` / `/` / `//` comments or no data tokens. */
  isCommentOrBlank: boolean;
}

export interface PsseCstDocument {
  tree: ReturnType<ReturnType<typeof getPsseWasmParser>["parse"]>;
  lines: PsseCstLine[];
  byRow: Map<number, PsseCstLine>;
}

function isCommentToken(tok: CstNodeLike): boolean {
  if (isQuotedCstToken(tok)) return false;
  const t = tok.text ?? "";
  return (
    tok.type === "SlashTerminator" ||
    tok.type === "BangComment" ||
    tok.type === "DoubleSlashComment" ||
    tok.type === "comment" ||
    tok.type === "line_comment" ||
    t.startsWith("/") ||
    t.startsWith("@!")
  );
}

/** Returns true if the CST token represents a single/double quoted string literal. */
export function isQuotedCstToken(tok: CstNodeLike): boolean {
  const raw = tok.text ?? "";
  return (
    tok.type === "QuotedString" ||
    (raw.length >= 2 &&
      ((raw[0] === "'" && raw[raw.length - 1] === "'") || (raw[0] === '"' && raw[raw.length - 1] === '"')))
  );
}

/** Returns true if the CST token represents a numeric literal (including Fortran D/d exponents). */
export function isNumericCstToken(tok: CstNodeLike): boolean {
  if (isQuotedCstToken(tok)) return false;
  if (tok.type === "Number") return true;
  const raw = (tok.text ?? "").trim();
  if (raw.length === 0) return false;
  const normalized = raw.includes("D") || raw.includes("d") ? raw.replace(/[dD]/, "e") : raw;
  return Number.isFinite(Number(normalized));
}

/**
 * Unquotes a `QuotedString` CST token without regexes.
 */
export function unquoteCstValue(tok: CstNodeLike): string {
  const raw = tok.text ?? "";
  if (isQuotedCstToken(tok)) {
    return raw.slice(1, -1).trim();
  }
  return raw.trim();
}

/**
 * Parses PSS/E text using the native WASM GLR parser and groups CST leaf tokens by line.
 */
export function parsePsseCstDocument(source: string, precomputedTree?: { rootNode?: unknown } | null): PsseCstDocument {
  const tree = precomputedTree?.rootNode ? precomputedTree : getPsseWasmParser().parse(source);
  const grouped = groupAllCstTokensByLine(tree?.rootNode as CstNodeLike | undefined);
  const lines: PsseCstLine[] = [];
  const byRow = new Map<number, PsseCstLine>();

  for (const { row, tokens } of grouped) {
    if (tokens.length === 0) continue;
    const first = tokens[0]!;
    const last = tokens[tokens.length - 1]!;
    const startOffset = Math.max(0, (first.startIndex ?? 0) - (first.startPosition?.column ?? 0));
    const fallbackText = cstLineText(source, tokens);
    const tokensEndOffset = last.endIndex ?? startOffset + fallbackText.length;

    let lineEndOffset = tokensEndOffset;
    const lastIsEolComment =
      last.type === "SlashTerminator" || last.type === "BangComment" || last.type === "DoubleSlashComment";
    if (!lastIsEolComment) {
      lineEndOffset = source.indexOf("\n", tokensEndOffset);
      if (lineEndOffset === -1) lineEndOffset = source.length;
      if (lineEndOffset > tokensEndOffset && source[lineEndOffset - 1] === "\r") {
        lineEndOffset--;
      }
    }
    const endOffset = Math.max(tokensEndOffset, lineEndOffset);
    const line = source.slice(startOffset, endOffset);

    let commentText = "";
    let hasData = false;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const txt = tok.text ?? "";
      if (isCommentToken(tok)) {
        commentText = (tok.text ?? source.slice(tok.startIndex ?? startOffset, endOffset)).trim();
        break;
      }
      if (txt.trim().length > 0) {
        hasData = true;
      }
    }
    if (!commentText && endOffset > tokensEndOffset) {
      const trailing = source.slice(tokensEndOffset, endOffset).trim();
      if (trailing.startsWith("/") || trailing.startsWith("@!")) {
        commentText = trailing;
      }
    }

    const entry: PsseCstLine = {
      row,
      lineNum: row + 1,
      startOffset,
      endOffset,
      line,
      tokens,
      commentText,
      isCommentOrBlank: !hasData,
    };
    lines.push(entry);
    byRow.set(row, entry);
  }

  return { tree: tree as PsseCstDocument["tree"], lines, byRow };
}

function buildFieldFromTokens(group: CstNodeLike[], source: string): PsseCstField {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const s = first.startIndex ?? 0;
  const e = last.endIndex ?? s + (last.text?.length ?? 0);
  const rawText = group.length === 1 ? (first.text ?? "") : source.slice(s, e);
  const value = group.length === 1 ? unquoteCstValue(first) : rawText.trim();
  const tokenType =
    group.length === 1
      ? isQuotedCstToken(first)
        ? "QuotedString"
        : isNumericCstToken(first)
          ? "Number"
          : first.type
      : "Composite";
  return {
    value,
    rawText,
    tokenType,
    node: group.length === 1 ? first : undefined,
    startOffset: s,
    endOffset: e,
    line0: first.startPosition?.row ?? 0,
    startCol0: first.startPosition?.column ?? 0,
    endCol0: (last.startPosition?.column ?? 0) + (last.text?.length ?? 0),
  };
}

/**
 * Extracts logical fields from a line's WASM CST tokens.
 * Supports comma-delimited RAW lines (preserving empty `,,` slots),
 * space-delimited DYR/CON/SEQ lines, and `/` comment truncation without regexes.
 */
export function extractFieldsFromCstTokens(
  tokens: CstNodeLike[],
  source: string,
  mode: "delimited" | "whitespace" = "delimited",
): PsseCstField[] {
  const dataTokens: CstNodeLike[] = [];
  for (const tok of tokens) {
    if (isCommentToken(tok)) break;
    dataTokens.push(tok);
  }
  if (dataTokens.length === 0) return [];

  const hasComma = mode === "delimited" && dataTokens.some((t) => t.text === ",");

  if (!hasComma) {
    // Space-delimited or single-token record: merge adjacent non-comma tokens that touch without whitespace
    // (e.g., negative sign SymbolPunct '-' followed by Number '5.0', or unquoted identifier parts),
    // while splitting tokens separated by whitespace.
    const fields: PsseCstField[] = [];
    let group: CstNodeLike[] = [];

    const flushGroup = () => {
      if (group.length === 0) return;
      fields.push(buildFieldFromTokens(group, source));
      group = [];
    };

    for (const tok of dataTokens) {
      if (tok.text === ",") {
        flushGroup();
        continue;
      }
      if (group.length > 0) {
        const prev = group[group.length - 1]!;
        const prevEnd = prev.endIndex ?? (prev.startIndex ?? 0) + (prev.text?.length ?? 0);
        const curStart = tok.startIndex ?? prevEnd;
        // Touching tokens (no whitespace gap) form one field unless one is QuotedString
        if (curStart > prevEnd || isQuotedCstToken(prev) || isQuotedCstToken(tok)) {
          flushGroup();
        }
      }
      group.push(tok);
    }
    flushGroup();
    return fields;
  }

  // Comma-delimited mode: every `,` advances to the next positional column (preserving omitted `,,` slots)
  const fields: PsseCstField[] = [];
  let bucket: CstNodeLike[] = [];
  let lastEndOffset = dataTokens[0]?.startIndex ?? 0;
  let lastLine0 = dataTokens[0]?.startPosition?.row ?? 0;
  let lastCol0 = dataTokens[0]?.startPosition?.column ?? 0;

  const pushBucket = (commaTok?: CstNodeLike) => {
    if (bucket.length === 0) {
      const col = commaTok?.startPosition?.column ?? lastCol0;
      const off = commaTok?.startIndex ?? lastEndOffset;
      fields.push({
        value: "",
        rawText: "",
        tokenType: "empty",
        startOffset: off,
        endOffset: off,
        line0: commaTok?.startPosition?.row ?? lastLine0,
        startCol0: col,
        endCol0: col,
      });
      return;
    }
    const field = buildFieldFromTokens(bucket, source);
    fields.push(field);
    lastEndOffset = field.endOffset;
    lastLine0 = field.line0;
    lastCol0 = field.endCol0;
    bucket = [];
  };

  for (const tok of dataTokens) {
    if (tok.text === ",") {
      pushBucket(tok);
      lastEndOffset = (tok.endIndex ?? tok.startIndex ?? lastEndOffset) + 0;
      lastCol0 = (tok.startPosition?.column ?? lastCol0) + 1;
    } else {
      bucket.push(tok);
    }
  }
  pushBucket();
  return fields;
}

/**
 * Resolves the 0-based field index at a given 0-based cursor column using WASM CST tokens.
 */
export function getCstFieldIndexAtColumn(tokens: CstNodeLike[], source: string, col0: number): number {
  const fields = extractFieldsFromCstTokens(tokens, source, "delimited");
  if (fields.length === 0) return 0;

  // Check if commas exist — count `,` CST tokens strictly before cursor column
  let commaCount = 0;
  let hasComma = false;
  for (const tok of tokens) {
    if (isCommentToken(tok)) break;
    if (tok.text === ",") {
      hasComma = true;
      if ((tok.startPosition?.column ?? 0) < col0) {
        commaCount++;
      }
    }
  }
  if (hasComma) return commaCount;

  // Otherwise match whitespace-separated field spans
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (col0 <= f.endCol0) return i;
  }
  return Math.max(0, fields.length - 1);
}

/**
 * Checks if a CST line represents a PSS/E section terminator (`0` or `Q`) without regexes.
 */
export function isPsseSectionTerminator(fields: PsseCstField[]): "end_section" | "end_file" | null {
  if (fields.length === 0) return null;
  const first = fields[0]!.value.trim();
  if (first === "0" && fields[0]!.tokenType !== "QuotedString" && !fields[0]!.rawText.includes(".")) {
    return "end_section";
  }
  if (first.toUpperCase() === "Q" && fields[0]!.tokenType !== "QuotedString") {
    return "end_file";
  }
  return null;
}

/**
 * Applies a surgical patch to a single CST node using `CstUnparser.patchAndUnparse` when a SyntaxNode
 * is available, or `createReplaceEdit` / byte offsets otherwise.
 */
export function buildCstFieldReplacementEdit(
  field: PsseCstField,
  newText: string,
): {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
  startOffset: number;
  endOffset: number;
} {
  const node = field.node as SyntaxNode | undefined;
  if (node && typeof node.startIndex === "number" && node.startPosition && node.endPosition) {
    // Use @modelscript/dsl CstUnparser for CST-native surgical patch generation
    const hasTree = Boolean((node as { tree?: unknown }).tree);
    if (hasTree) {
      const res = CstUnparser.patchAndUnparse({
        target: node,
        replaceText: newText,
      });
      return {
        range: res.edit.range,
        newText: res.edit.newText,
        startOffset: res.startIndex,
        endOffset: res.endIndex,
      };
    }
    const edit = createReplaceEdit(node, newText);
    return {
      range: edit.range,
      newText: edit.newText,
      startOffset: node.startIndex,
      endOffset: node.endIndex,
    };
  }

  return {
    range: {
      start: { line: field.line0, character: field.startCol0 },
      end: { line: field.line0, character: field.endCol0 },
    },
    newText,
    startOffset: field.startOffset,
    endOffset: field.endOffset,
  };
}

/** A complete multi-line PSS/E `.dyr` record with exact CST field spans for surgical writeback. */
export interface PsseDyrCstRecord {
  headerKind: DyrHeaderKind;
  modelName: string;
  ibusField?: PsseCstField | undefined;
  jbusField?: PsseCstField | undefined;
  cktField?: PsseCstField | undefined;
  deviceNameField?: PsseCstField | undefined;
  modelField?: PsseCstField | undefined;
  idField?: PsseCstField | undefined;
  iconFields: PsseCstField[];
  conFields: PsseCstField[];
  allFields: PsseCstField[];
  terminatorToken?: CstNodeLike | undefined;
}

/**
 * Extracts multi-line `.dyr` records bounded by `SlashTerminator` (`/`) from a `PsseCstDocument`,
 * decoding all 10 standard header shapes into exact `PsseCstField` spans for single-token CST edits.
 */
export function extractDyrCstRecords(doc: PsseCstDocument): PsseDyrCstRecord[] {
  const records: PsseDyrCstRecord[] = [];
  let fieldsAccum: PsseCstField[] = [];
  let termTok: CstNodeLike | undefined;

  const flushRecord = () => {
    if (fieldsAccum.length < 2) {
      fieldsAccum = [];
      termTok = undefined;
      return;
    }

    const f0 = fieldsAccum[0]!;
    const f1 = fieldsAccum[1]!;
    const f2 = fieldsAccum[2];
    const f3 = fieldsAccum[3];

    let headerKind: DyrHeaderKind = "machine";
    let modelIdx = 1;
    let payloadStart = 2;
    let ibusField: PsseCstField | undefined = f0;
    let jbusField: PsseCstField | undefined;
    let cktField: PsseCstField | undefined;
    let deviceNameField: PsseCstField | undefined;
    let modelField: PsseCstField | undefined = f1;
    let idField: PsseCstField | undefined;

    const u1 = f1.value.toUpperCase();
    if (u1 === "USRMDL") {
      // IBUS 'USRMDL' ID 'MODEL' IC IT NI NC NS NV [ICONs...] [CONs...]
      headerKind = "usrmdl";
      idField = f2;
      modelIdx = fieldsAccum.length > 3 ? 3 : 1;
      modelField = fieldsAccum[modelIdx];
      const ni = fieldsAccum.length > 6 ? Number(fieldsAccum[6]?.value ?? 0) : 0;
      const nc = fieldsAccum.length > 7 ? Number(fieldsAccum[7]?.value ?? 0) : 0;
      const metaStart = 10;
      const iconCount = Number.isFinite(ni) && ni > 0 ? Math.trunc(ni) : 0;
      const iconFields = fieldsAccum.slice(metaStart, metaStart + iconCount);
      const conEnd = Number.isFinite(nc) && nc > 0 ? metaStart + iconCount + Math.trunc(nc) : fieldsAccum.length;
      const conFields = fieldsAccum.slice(metaStart + iconCount, conEnd);
      records.push({
        headerKind,
        modelName: (modelField?.value ?? "USRMDL").toUpperCase(),
        ibusField,
        modelField,
        idField,
        iconFields,
        conFields,
        allFields: fieldsAccum,
        terminatorToken: termTok,
      });
      fieldsAccum = [];
      termTok = undefined;
      return;
    }

    if (
      fieldsAccum.length >= 4 &&
      f3 &&
      f3.tokenType === "QuotedString" &&
      /^-?\d+$/.test(f0.value.trim()) &&
      /^-?\d+$/.test(f1.value.trim())
    ) {
      // IBUS JBUS CKT 'MODEL'
      headerKind = "branch";
      ibusField = f0;
      jbusField = f1;
      cktField = f2;
      modelIdx = 3;
      modelField = f3;
      payloadStart = 4;
    } else if (f0.tokenType === "QuotedString") {
      // 'DCNAME' 'MODEL' or 'FACTSNAME' 'MODEL'
      deviceNameField = f0;
      ibusField = undefined;
      modelIdx = 1;
      modelField = f1;
      payloadStart = 2;
      const sch = resolveDyrModelSchema(modelField.value);
      headerKind = sch?.headerKind ?? "dc2t";
    } else {
      const sch = resolveDyrModelSchema(f1.value);
      headerKind = sch?.headerKind ?? "machine";
      modelIdx = 1;
      modelField = f1;
      if (headerKind === "bus" || headerKind === "dc2t" || headerKind === "vscdc" || headerKind === "facts") {
        // IBUS 'MODEL' (optional numeric/flag directly follows unless non-numeric quoted ID provided)
        if (f2 && f2.tokenType === "QuotedString") {
          idField = f2;
          payloadStart = 3;
        } else {
          payloadStart = 2;
        }
      } else {
        // machine, load, subsystem: IBUS 'MODEL' ID
        if (f2) {
          idField = f2;
          payloadStart = 3;
        } else {
          payloadStart = 2;
        }
      }
    }

    const schema = resolveDyrModelSchema(modelField?.value ?? "");
    const nIconsSchema = schema?.icons?.length ?? 0;
    const nConsSchema = schema?.params.length ?? 0;
    const payload = fieldsAccum.slice(payloadStart);
    // Support both full (ICON + CON) and legacy CON-only records cleanly
    const useIcons = nIconsSchema > 0 && payload.length >= nIconsSchema + Math.min(1, nConsSchema);
    const nIcons = useIcons ? nIconsSchema : 0;

    records.push({
      headerKind: schema?.headerKind ?? headerKind,
      modelName: schema?.model ?? (modelField?.value ?? "").toUpperCase(),
      ibusField,
      jbusField,
      cktField,
      deviceNameField,
      modelField,
      idField,
      iconFields: payload.slice(0, nIcons),
      conFields: payload.slice(nIcons),
      allFields: fieldsAccum,
      terminatorToken: termTok,
    });
    fieldsAccum = [];
    termTok = undefined;
  };

  for (const line of doc.lines) {
    let sawSlash = false;
    const beforeCommentTokens: CstNodeLike[] = [];
    for (const tok of line.tokens) {
      if (tok.type === "BangComment" || tok.type === "DoubleSlashComment" || tok.text?.startsWith("@!")) {
        break;
      }
      if (tok.type === "SlashTerminator" || (!isQuotedCstToken(tok) && tok.text?.startsWith("/"))) {
        sawSlash = true;
        termTok = tok;
        break;
      }
      beforeCommentTokens.push(tok);
    }

    // Reconstruct field spans for this physical line slice
    const rawFields = extractFieldsFromCstTokens(beforeCommentTokens, "", "whitespace");
    // Repair field.endOffset/rawText if tokens had startIndex directly
    for (const f of rawFields) {
      fieldsAccum.push(f);
    }
    if (sawSlash) {
      flushRecord();
    }
  }
  if (fieldsAccum.length > 0) {
    flushRecord();
  }

  return records;
}
