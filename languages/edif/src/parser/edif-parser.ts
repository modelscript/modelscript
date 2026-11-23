// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * EDIF 2.0.0 S-expression tokenizer and recursive-descent parser.
 */

import type {
  EdifCell,
  EdifDesign,
  EdifDocument,
  EdifInstance,
  EdifLibrary,
  EdifNameRef,
  EdifNet,
  EdifPort,
  EdifPortRef,
  EdifProperty,
  EdifPropertyValue,
  EdifSpan,
  EdifStatus,
  EdifSyntaxError,
  EdifView,
  EdifViewRef,
} from "../types.js";

export type EdifTokenKind = "lparen" | "rparen" | "string" | "number" | "ident";

export interface EdifToken {
  kind: EdifTokenKind;
  value: string;
  span: EdifSpan;
}

export type EdifSExpr =
  | { kind: "list"; items: EdifSExpr[]; span: EdifSpan }
  | { kind: "string"; value: string; span: EdifSpan }
  | { kind: "number"; value: number; raw: string; span: EdifSpan }
  | { kind: "ident"; value: string; span: EdifSpan };

/**
 * Tokenizes an EDIF 2.0.0 source string into tokens with line/column/offset spans.
 */
export function tokenizeEdif(source: string): { tokens: EdifToken[]; errors: EdifSyntaxError[] } {
  const tokens: EdifToken[] = [];
  const errors: EdifSyntaxError[] = [];
  const len = source.length;
  let i = 0;
  let line = 1;
  let col = 1;

  while (i < len) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (ch === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
      continue;
    }

    // Semicolon line comments (common in EDIF tooling extensions)
    if (ch === ";") {
      while (i < len && source[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }

    const startOffset = i;
    const startLine = line;
    const startCol = col;

    if (ch === "(") {
      i++;
      col++;
      tokens.push({
        kind: "lparen",
        value: "(",
        span: { startOffset, endOffset: i, line: startLine, column: startCol, endLine: line, endColumn: col },
      });
      continue;
    }

    if (ch === ")") {
      i++;
      col++;
      tokens.push({
        kind: "rparen",
        value: ")",
        span: { startOffset, endOffset: i, line: startLine, column: startCol, endLine: line, endColumn: col },
      });
      continue;
    }

    // Double-quoted string literal
    if (ch === '"') {
      i++;
      col++;
      let val = "";
      let closed = false;
      while (i < len) {
        const c = source[i]!;
        if (c === "\\") {
          if (i + 1 < len) {
            val += source[i + 1]!;
            i += 2;
            col += 2;
            continue;
          }
        }
        if (c === '"') {
          i++;
          col++;
          closed = true;
          break;
        }
        if (c === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        val += c;
        i++;
      }
      const span: EdifSpan = {
        startOffset,
        endOffset: i,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
      };
      if (!closed) {
        errors.push({ message: "Unterminated string literal", span });
      }
      tokens.push({ kind: "string", value: val, span });
      continue;
    }

    // Number or Identifier
    let raw = "";
    while (i < len) {
      const c = source[i]!;
      if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "(" || c === ")" || c === '"' || c === ";") {
        break;
      }
      raw += c;
      i++;
      col++;
    }

    const span: EdifSpan = {
      startOffset,
      endOffset: i,
      line: startLine,
      column: startCol,
      endLine: line,
      endColumn: col,
    };

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
      tokens.push({ kind: "number", value: raw, span });
    } else {
      tokens.push({ kind: "ident", value: raw, span });
    }
  }

  return { tokens, errors };
}

/**
 * Parses tokens into S-expressions.
 */
export function parseSExpressions(source: string): { forms: EdifSExpr[]; errors: EdifSyntaxError[] } {
  const { tokens, errors } = tokenizeEdif(source);
  const forms: EdifSExpr[] = [];
  let pos = 0;

  function parseOne(): EdifSExpr | undefined {
    const tok = tokens[pos];
    if (!tok) return undefined;

    if (tok.kind === "lparen") {
      pos++;
      const items: EdifSExpr[] = [];
      while (pos < tokens.length && tokens[pos]!.kind !== "rparen") {
        const child = parseOne();
        if (child) items.push(child);
      }
      if (pos >= tokens.length) {
        const lastSpan = items.length > 0 ? items[items.length - 1]!.span : tok.span;
        errors.push({
          message: "Unclosed '(' — expected matching ')'",
          span: {
            startOffset: tok.span.startOffset,
            endOffset: lastSpan.endOffset,
            line: tok.span.line,
            column: tok.span.column,
            endLine: lastSpan.endLine,
            endColumn: lastSpan.endColumn,
          },
        });
        return {
          kind: "list",
          items,
          span: {
            startOffset: tok.span.startOffset,
            endOffset: lastSpan.endOffset,
            line: tok.span.line,
            column: tok.span.column,
            endLine: lastSpan.endLine,
            endColumn: lastSpan.endColumn,
          },
        };
      }
      const closeTok = tokens[pos]!;
      pos++;
      return {
        kind: "list",
        items,
        span: {
          startOffset: tok.span.startOffset,
          endOffset: closeTok.span.endOffset,
          line: tok.span.line,
          column: tok.span.column,
          endLine: closeTok.span.endLine,
          endColumn: closeTok.span.endColumn,
        },
      };
    }

    if (tok.kind === "rparen") {
      errors.push({ message: "Unexpected ')' without matching '('", span: tok.span });
      pos++;
      return undefined;
    }

    pos++;
    if (tok.kind === "string") {
      return { kind: "string", value: tok.value, span: tok.span };
    }
    if (tok.kind === "number") {
      return { kind: "number", value: Number(tok.value), raw: tok.value, span: tok.span };
    }
    return { kind: "ident", value: tok.value, span: tok.span };
  }

  while (pos < tokens.length) {
    const form = parseOne();
    if (form) forms.push(form);
  }

  return { forms, errors };
}

function listHead(expr: EdifSExpr): string | undefined {
  if (expr.kind !== "list" || expr.items.length === 0) return undefined;
  const first = expr.items[0]!;
  return first.kind === "ident" ? first.value.toLowerCase() : undefined;
}

function parseNameDef(expr: EdifSExpr | undefined): EdifNameRef {
  if (!expr) return { name: "" };
  if (expr.kind === "ident") {
    return { name: expr.value, span: expr.span };
  }
  if (expr.kind === "string") {
    return { name: expr.value, span: expr.span };
  }
  if (expr.kind === "number") {
    return { name: expr.raw, span: expr.span };
  }
  if (expr.kind === "list" && listHead(expr) === "rename") {
    const idItem = expr.items[1];
    const origItem = expr.items[2];
    const name =
      idItem?.kind === "ident"
        ? idItem.value
        : idItem?.kind === "string"
          ? idItem.value
          : idItem?.kind === "number"
            ? idItem.raw
            : "";
    const originalName =
      origItem?.kind === "string" ? origItem.value : origItem?.kind === "ident" ? origItem.value : undefined;
    return { name, originalName, span: expr.span };
  }
  return { name: "", span: expr.span };
}

function parsePropertyValue(expr: EdifSExpr | undefined): EdifPropertyValue {
  if (!expr) return { kind: "string", value: "" };
  if (expr.kind === "string") return { kind: "string", value: expr.value };
  if (expr.kind === "number") return { kind: "number", value: expr.value };
  if (expr.kind === "ident") return { kind: "identifier", value: expr.value };

  const head = listHead(expr);
  if (head === "string") {
    const v = expr.items[1];
    return { kind: "string", value: v?.kind === "string" ? v.value : v?.kind === "ident" ? v.value : "" };
  }
  if (head === "integer") {
    const v = expr.items[1];
    return { kind: "integer", value: v?.kind === "number" ? Math.trunc(v.value) : 0 };
  }
  if (head === "number") {
    const v = expr.items[1];
    if (v?.kind === "number") {
      return { kind: "number", value: v.value };
    }
    if (v?.kind === "list" && listHead(v) === "e") {
      const m = v.items[1]?.kind === "number" ? v.items[1].value : 0;
      const exp = v.items[2]?.kind === "number" ? v.items[2].value : 0;
      return { kind: "number", value: m * Math.pow(10, exp), mantissa: m, exponent: exp };
    }
    return { kind: "number", value: 0 };
  }
  if (head === "boolean") {
    const v = expr.items[1];
    if (v?.kind === "list") {
      const bHead = listHead(v);
      return { kind: "boolean", value: bHead === "true" };
    }
    if (v?.kind === "ident") {
      return { kind: "boolean", value: v.value.toLowerCase() === "true" };
    }
    return { kind: "boolean", value: false };
  }
  return { kind: "string", value: "" };
}

function parseProperty(expr: EdifSExpr): EdifProperty {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  const value = parsePropertyValue(items[2]);
  let owner: string | undefined;
  let unit: string | undefined;

  for (let i = 3; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "owner" && sub.kind === "list") {
      const o = sub.items[1];
      if (o?.kind === "string" || o?.kind === "ident") owner = o.value;
    } else if (h === "unit" && sub.kind === "list") {
      const u = sub.items[1];
      if (u?.kind === "ident" || u?.kind === "string") unit = u.value;
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    value,
    owner,
    unit,
    span: expr.span,
  };
}

function parsePort(expr: EdifSExpr): EdifPort {
  const items = expr.kind === "list" ? expr.items : [];
  const target = items[1];
  let nameRef: EdifNameRef;
  let width: number | undefined;

  if (target?.kind === "list" && listHead(target) === "array") {
    nameRef = parseNameDef(target.items[1]);
    const w = target.items[2];
    if (w?.kind === "number") width = w.value;
  } else {
    nameRef = parseNameDef(target);
  }

  let direction: string | undefined;
  const properties: EdifProperty[] = [];

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "direction" && sub.kind === "list") {
      const d = sub.items[1];
      if (d?.kind === "ident" || d?.kind === "string") {
        direction = d.value.toUpperCase();
      }
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    direction,
    width,
    properties,
    span: expr.span,
  };
}

function parseViewRef(expr: EdifSExpr): EdifViewRef {
  const items = expr.kind === "list" ? expr.items : [];
  const viewName = parseNameDef(items[1]).name;
  let cellName: string | undefined;
  let libraryName: string | undefined;

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    if (sub.kind === "list" && listHead(sub) === "cellref") {
      cellName = parseNameDef(sub.items[1]).name;
      for (let j = 2; j < sub.items.length; j++) {
        const nested = sub.items[j]!;
        if (nested.kind === "list" && listHead(nested) === "libraryref") {
          libraryName = parseNameDef(nested.items[1]).name;
        }
      }
    } else if (sub.kind === "list" && listHead(sub) === "libraryref") {
      libraryName = parseNameDef(sub.items[1]).name;
    }
  }

  return { viewName, cellName, libraryName, span: expr.span };
}

function parseInstance(expr: EdifSExpr): EdifInstance {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  let viewRef: EdifViewRef = { viewName: "" };
  const properties: EdifProperty[] = [];
  let designator: string | undefined;

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "viewref") {
      viewRef = parseViewRef(sub);
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    } else if (h === "designator" && sub.kind === "list") {
      const d = sub.items[1];
      if (d?.kind === "string" || d?.kind === "ident") designator = d.value;
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    viewRef,
    properties,
    designator,
    span: expr.span,
  };
}

function parsePortRef(expr: EdifSExpr): EdifPortRef {
  const items = expr.kind === "list" ? expr.items : [];
  const target = items[1];
  let portName = "";
  let memberIndex: number | undefined;
  let instanceName: string | undefined;

  if (target?.kind === "list" && listHead(target) === "member") {
    portName = parseNameDef(target.items[1]).name;
    const idx = target.items[2];
    if (idx?.kind === "number") memberIndex = idx.value;
  } else {
    portName = parseNameDef(target).name;
  }

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    if (sub.kind === "list" && listHead(sub) === "instanceref") {
      instanceName = parseNameDef(sub.items[1]).name;
    }
  }

  return { portName, memberIndex, instanceName, span: expr.span };
}

function parseNet(expr: EdifSExpr): EdifNet {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  const joined: EdifPortRef[] = [];
  const properties: EdifProperty[] = [];

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "joined" && sub.kind === "list") {
      for (let j = 1; j < sub.items.length; j++) {
        const pref = sub.items[j]!;
        if (listHead(pref) === "portref") {
          joined.push(parsePortRef(pref));
        }
      }
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    joined,
    properties,
    span: expr.span,
  };
}

function parseView(expr: EdifSExpr): EdifView {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  let viewType = "NETLIST";
  const ports: EdifPort[] = [];
  const instances: EdifInstance[] = [];
  const nets: EdifNet[] = [];
  const properties: EdifProperty[] = [];
  let hasContents = false;

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "viewtype" && sub.kind === "list") {
      const vt = sub.items[1];
      if (vt?.kind === "ident" || vt?.kind === "string") viewType = vt.value.toUpperCase();
    } else if (h === "interface" && sub.kind === "list") {
      for (let j = 1; j < sub.items.length; j++) {
        const child = sub.items[j]!;
        const ch = listHead(child);
        if (ch === "port") {
          ports.push(parsePort(child));
        } else if (ch === "property") {
          properties.push(parseProperty(child));
        }
      }
    } else if (h === "contents" && sub.kind === "list") {
      hasContents = true;
      for (let j = 1; j < sub.items.length; j++) {
        const child = sub.items[j]!;
        const ch = listHead(child);
        if (ch === "instance") {
          instances.push(parseInstance(child));
        } else if (ch === "net") {
          nets.push(parseNet(child));
        } else if (ch === "property") {
          properties.push(parseProperty(child));
        }
      }
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    viewType,
    ports,
    instances,
    nets,
    properties,
    hasContents,
    span: expr.span,
  };
}

function parseCell(expr: EdifSExpr): EdifCell {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  let cellType = "GENERIC";
  const views: EdifView[] = [];
  const properties: EdifProperty[] = [];

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "celltype" && sub.kind === "list") {
      const ct = sub.items[1];
      if (ct?.kind === "ident" || ct?.kind === "string") cellType = ct.value.toUpperCase();
    } else if (h === "view") {
      views.push(parseView(sub));
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    cellType,
    views,
    properties,
    span: expr.span,
  };
}

function parseLibrary(expr: EdifSExpr, isExternal: boolean): EdifLibrary {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  let edifLevel: number | undefined;
  let technology: Record<string, unknown> | undefined;
  const cells: EdifCell[] = [];
  const properties: EdifProperty[] = [];

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "ediflevel" && sub.kind === "list") {
      const lv = sub.items[1];
      if (lv?.kind === "number") edifLevel = lv.value;
    } else if (h === "technology" && sub.kind === "list") {
      technology = { entries: sub.items.length - 1 };
    } else if (h === "cell") {
      cells.push(parseCell(sub));
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    isExternal,
    edifLevel,
    technology,
    cells,
    properties,
    span: expr.span,
  };
}

function parseDesign(expr: EdifSExpr): EdifDesign {
  const items = expr.kind === "list" ? expr.items : [];
  const nameRef = parseNameDef(items[1]);
  let cellName = "";
  let libraryName: string | undefined;
  let viewName: string | undefined;
  const properties: EdifProperty[] = [];

  for (let i = 2; i < items.length; i++) {
    const sub = items[i]!;
    const h = listHead(sub);
    if (h === "cellref" && sub.kind === "list") {
      cellName = parseNameDef(sub.items[1]).name;
      for (let j = 2; j < sub.items.length; j++) {
        const nested = sub.items[j]!;
        if (nested.kind === "list" && listHead(nested) === "libraryref") {
          libraryName = parseNameDef(nested.items[1]).name;
        }
      }
    } else if (h === "viewref" && sub.kind === "list") {
      const vr = parseViewRef(sub);
      viewName = vr.viewName;
      if (vr.cellName) cellName = vr.cellName;
      if (vr.libraryName) libraryName = vr.libraryName;
    } else if (h === "property") {
      properties.push(parseProperty(sub));
    }
  }

  return {
    name: nameRef.name,
    originalName: nameRef.originalName,
    cellName,
    libraryName,
    viewName,
    properties,
    span: expr.span,
  };
}

function parseStatus(expr: EdifSExpr): EdifStatus {
  const items = expr.kind === "list" ? expr.items : [];
  const status: EdifStatus = { span: expr.span };
  for (let i = 1; i < items.length; i++) {
    const sub = items[i]!;
    if (sub.kind === "list" && listHead(sub) === "written") {
      const written: NonNullable<EdifStatus["written"]> = {};
      for (let j = 1; j < sub.items.length; j++) {
        const w = sub.items[j]!;
        const wh = listHead(w);
        if (wh === "timestamp" && w.kind === "list") {
          written.timeStamp = w.items
            .slice(1)
            .filter((x): x is Extract<EdifSExpr, { kind: "number" }> => x.kind === "number")
            .map((x) => x.value);
        } else if (wh === "author" && w.kind === "list") {
          const a = w.items[1];
          if (a?.kind === "string" || a?.kind === "ident") written.author = a.value;
        } else if (wh === "program" && w.kind === "list") {
          const p = w.items[1];
          if (p?.kind === "string" || p?.kind === "ident") written.program = p.value;
          const v = w.items[2];
          if (v?.kind === "list" && listHead(v) === "version") {
            const vv = v.items[1];
            if (vv?.kind === "string" || vv?.kind === "ident") written.programVersion = vv.value;
          }
        } else if (wh === "comment" && w.kind === "list") {
          const c = w.items[1];
          if (c?.kind === "string") written.comment = c.value;
        }
      }
      status.written = written;
    }
  }
  return status;
}

/**
 * Parses an engineering value string or `EdifPropertyValue` into a numeric value (SI units).
 * Supports SPICE/EDIF suffixes: `f`, `p`, `n`, `u`, `m`, `k`, `meg`/`M`, `g`, `t`.
 */
export function parseEdifNumericValue(prop: EdifPropertyValue): number | undefined {
  if (prop.kind === "number" || prop.kind === "integer") {
    return Number.isFinite(prop.value) ? prop.value : undefined;
  }
  if (prop.kind === "boolean") {
    return prop.value ? 1 : 0;
  }
  const raw = prop.value.trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z]+)?$/.exec(raw);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = match[2] ?? "";
  if (!suffix) return base;

  const lower = suffix.toLowerCase();
  if (lower.startsWith("meg")) return base * 1e6;
  if (suffix.startsWith("M") && !lower.startsWith("mh") && !lower.startsWith("mf")) return base * 1e6;
  const first = lower[0];
  switch (first) {
    case "f":
      return base * 1e-15;
    case "p":
      return base * 1e-12;
    case "n":
      return base * 1e-9;
    case "u":
      return base * 1e-6;
    case "m":
      return base * 1e-3;
    case "k":
      return base * 1e3;
    case "g":
      return base * 1e9;
    case "t":
      return base * 1e12;
    default:
      // Unit suffix without metric prefix (e.g., "V", "Ohm", "F", "H")
      return base;
  }
}

/**
 * Parses an EDIF 2.0.0 source document into a structured `EdifDocument`.
 */
export function parseEdif(source: string): EdifDocument {
  const { forms, errors } = parseSExpressions(source);
  const syntaxErrors: EdifSyntaxError[] = [...errors];

  const doc: EdifDocument = {
    name: "UnnamedEdif",
    externals: [],
    libraries: [],
    properties: [],
    syntaxErrors,
  };

  if (forms.length === 0) {
    syntaxErrors.push({
      message: "Empty EDIF document — expected top-level '(edif ...)' form",
      span: { startOffset: 0, endOffset: 0, line: 1, column: 1, endLine: 1, endColumn: 1 },
    });
    return doc;
  }

  const root = forms[0]!;
  if (root.kind !== "list" || listHead(root) !== "edif") {
    syntaxErrors.push({
      message: "Top-level form must be '(edif <name> ...)'",
      span: root.span,
    });
    return doc;
  }

  doc.span = root.span;
  const nameRef = parseNameDef(root.items[1]);
  doc.name = nameRef.name || "UnnamedEdif";
  doc.originalName = nameRef.originalName;

  for (let i = 2; i < root.items.length; i++) {
    const sub = root.items[i]!;
    const h = listHead(sub);
    if (!h || sub.kind !== "list") continue;

    switch (h) {
      case "edifversion": {
        const nums = sub.items
          .slice(1)
          .filter((x): x is Extract<EdifSExpr, { kind: "number" }> => x.kind === "number")
          .map((x) => x.value);
        doc.edifVersion = nums;
        doc.edifVersionSpan = sub.span;
        break;
      }
      case "ediflevel": {
        const lv = sub.items[1];
        if (lv?.kind === "number") {
          doc.edifLevel = lv.value;
          doc.edifLevelSpan = sub.span;
        }
        break;
      }
      case "keywordmap": {
        for (let j = 1; j < sub.items.length; j++) {
          const kw = sub.items[j]!;
          if (kw.kind === "list" && listHead(kw) === "keywordlevel") {
            const lv = kw.items[1];
            if (lv?.kind === "number") doc.keywordLevel = lv.value;
          }
        }
        break;
      }
      case "status": {
        doc.status = parseStatus(sub);
        break;
      }
      case "external": {
        doc.externals.push(parseLibrary(sub, true));
        break;
      }
      case "library": {
        doc.libraries.push(parseLibrary(sub, false));
        break;
      }
      case "design": {
        doc.design = parseDesign(sub);
        break;
      }
      case "property": {
        doc.properties.push(parseProperty(sub));
        break;
      }
      default:
        break;
    }
  }

  return doc;
}
