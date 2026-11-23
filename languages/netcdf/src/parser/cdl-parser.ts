// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CDL (Common Data form Language) ASCII parser and serializer for NetCDF Classic v1/v2.
 */

import {
  NC_DEFAULT_FILL,
  type NetcdfAttribute,
  type NetcdfAttributeValue,
  type NetcdfDataset,
  type NetcdfDataType,
  type NetcdfDimension,
  type NetcdfParseError,
  type NetcdfVariable,
} from "../types.js";

const VALID_TYPES = new Set<NetcdfDataType>(["byte", "char", "short", "int", "long", "float", "double"]);

interface CdlToken {
  kind: "ident" | "number" | "string" | "punct" | "eof";
  text: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

function tokenizeCdl(source: string): { tokens: CdlToken[]; comments: Array<{ line: number; text: string }> } {
  const tokens: CdlToken[] = [];
  const comments: Array<{ line: number; text: string }> = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (): string => {
    const ch = source[i++] ?? "";
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < n) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment //
    if (ch === "/" && source[i + 1] === "/") {
      const commentLine = line;
      let text = "";
      while (i < n && source[i] !== "\n") {
        text += advance();
      }
      comments.push({ line: commentLine, text });
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const commentLine = line;
      let text = advance() + advance();
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        text += advance();
      }
      if (i < n) {
        text += advance() + advance();
      }
      comments.push({ line: commentLine, text });
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOffset = i;

    // String literal "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let value = quote;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          value += advance() + advance();
        } else {
          value += advance();
        }
      }
      if (i < n) {
        value += advance();
      }
      tokens.push({
        kind: "string",
        text: value,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Punctuation
    if ("{}();:,=".includes(ch)) {
      advance();
      tokens.push({
        kind: "punct",
        text: ch,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Number (including optional leading +/- or .digit, exponent, and CDL type suffix b/s/l/f/d)
    const next = source[i + 1] ?? "";
    const isNumberStart =
      (ch >= "0" && ch <= "9") ||
      ((ch === "+" || ch === "-") && ((next >= "0" && next <= "9") || next === ".")) ||
      (ch === "." && next >= "0" && next <= "9");

    if (isNumberStart) {
      let text = "";
      if (ch === "+" || ch === "-") {
        text += advance();
      }
      while (i < n && source[i]! >= "0" && source[i]! <= "9") {
        text += advance();
      }
      if (i < n && source[i] === ".") {
        text += advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") {
          text += advance();
        }
      }
      if (i < n && (source[i] === "e" || source[i] === "E")) {
        text += advance();
        if (i < n && (source[i] === "+" || source[i] === "-")) {
          text += advance();
        }
        while (i < n && source[i]! >= "0" && source[i]! <= "9") {
          text += advance();
        }
      }
      // Optional CDL numeric type suffix (b, B, s, S, l, L, f, F, d, D)
      if (i < n && /[bBsSlLfFdD]/.test(source[i]!)) {
        text += advance();
      }
      tokens.push({
        kind: "number",
        text,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Identifier (CDL allows letters, digits, _, -, ., +, @)
    if (/[A-Za-z_]/.test(ch)) {
      let text = "";
      while (i < n && /[A-Za-z0-9_.\-+]/.test(source[i]!)) {
        text += advance();
      }
      tokens.push({
        kind: "ident",
        text,
        line: startLine,
        column: startCol,
        startOffset,
        endOffset: i,
      });
      continue;
    }

    // Fallback single-char punctuation
    advance();
    tokens.push({
      kind: "punct",
      text: ch,
      line: startLine,
      column: startCol,
      startOffset,
      endOffset: i,
    });
  }

  tokens.push({
    kind: "eof",
    text: "",
    line,
    column: col,
    startOffset: n,
    endOffset: n,
  });

  return { tokens, comments };
}

function unquoteString(raw: string): string {
  if (
    raw.length >= 2 &&
    ((raw[0] === '"' && raw[raw.length - 1] === '"') || (raw[0] === "'" && raw[raw.length - 1] === "'"))
  ) {
    return raw
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }
  return raw;
}

function parseTypedLiteral(tok: CdlToken): { value: number | string; type: NetcdfDataType } {
  if (tok.kind === "string") {
    return { value: unquoteString(tok.text), type: "char" };
  }
  if (tok.kind === "ident") {
    const lower = tok.text.toLowerCase();
    if (lower === "nan" || lower === "nanf") {
      return { value: Number.NaN, type: lower === "nanf" ? "float" : "double" };
    }
    if (lower === "inf" || lower === "infinity" || lower === "+inf") {
      return { value: Number.POSITIVE_INFINITY, type: "double" };
    }
    if (lower === "-inf" || lower === "-infinity") {
      return { value: Number.NEGATIVE_INFINITY, type: "double" };
    }
    return { value: tok.text, type: "char" };
  }

  const raw = tok.text;
  const last = raw[raw.length - 1] ?? "";
  let numStr = raw;
  let inferredType: NetcdfDataType | null = null;

  if (last === "b" || last === "B") {
    numStr = raw.slice(0, -1);
    inferredType = "byte";
  } else if (last === "s" || last === "S") {
    numStr = raw.slice(0, -1);
    inferredType = "short";
  } else if (last === "l" || last === "L") {
    numStr = raw.slice(0, -1);
    inferredType = "int";
  } else if (last === "f" || last === "F") {
    numStr = raw.slice(0, -1);
    inferredType = "float";
  } else if (last === "d" || last === "D") {
    numStr = raw.slice(0, -1);
    inferredType = "double";
  }

  const num = Number(numStr);
  if (!inferredType) {
    inferredType = numStr.includes(".") || numStr.includes("e") || numStr.includes("E") ? "double" : "int";
  }
  return { value: num, type: inferredType };
}

/**
 * Parses a NetCDF CDL (Common Data form Language) ASCII document into a `NetcdfDataset`.
 */
export function parseCdl(source: string): NetcdfDataset {
  const { tokens, comments } = tokenizeCdl(source);
  const parseErrors: NetcdfParseError[] = [];
  const dimensions: NetcdfDimension[] = [];
  const variables: NetcdfVariable[] = [];
  const globalAttributes: NetcdfAttribute[] = [];
  const undeclaredDataTargets: Array<{ name: string; line: number; column: number }> = [];

  const commentByLine = new Map<number, string>();
  for (const c of comments) {
    commentByLine.set(c.line, c.text);
  }

  let pos = 0;
  const peek = (offset = 0): CdlToken => tokens[Math.min(pos + offset, tokens.length - 1)]!;
  const next = (): CdlToken => {
    const t = peek();
    if (pos < tokens.length - 1) pos++;
    return t;
  };
  const isAtEnd = (): boolean => peek().kind === "eof";

  let datasetName = "unnamed";

  // Header: netcdf <name> {
  if (peek().kind === "ident" && peek().text.toLowerCase() === "netcdf") {
    next();
    if (peek().kind === "ident" || peek().kind === "string") {
      const nameTok = next();
      datasetName = nameTok.kind === "string" ? unquoteString(nameTok.text) : nameTok.text;
    } else {
      parseErrors.push({
        code: "NC1001",
        message: `Expected dataset name after 'netcdf' keyword at line ${peek().line}`,
        line: peek().line,
        column: peek().column,
      });
    }
    if (peek().text === "{") {
      next();
    } else {
      parseErrors.push({
        code: "NC1001",
        message: `Expected '{' to begin netcdf dataset body at line ${peek().line}`,
        line: peek().line,
        column: peek().column,
      });
    }
  } else if (!isAtEnd()) {
    parseErrors.push({
      code: "NC1001",
      message: `CDL document must start with 'netcdf <name> {' (found '${peek().text}' at line ${peek().line})`,
      line: peek().line,
      column: peek().column,
    });
  }

  type Section = "none" | "dimensions" | "variables" | "data";
  let section: Section = "none";

  const findVar = (name: string): NetcdfVariable | undefined => variables.find((v) => v.name === name);

  const parseAttributeValues = (): { type: NetcdfDataType; value: NetcdfAttributeValue } => {
    const rawValues: Array<{ value: number | string; type: NetcdfDataType }> = [];
    while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") {
      const tok = next();
      if (tok.text === ",") continue;
      // Handle unary '-' followed by 'Inf' or 'NaN'
      if (tok.text === "-" && peek().kind === "ident") {
        const idTok = next();
        const combined: CdlToken = { ...idTok, text: `-${idTok.text}` };
        rawValues.push(parseTypedLiteral(combined));
      } else {
        rawValues.push(parseTypedLiteral(tok));
      }
    }
    if (peek().text === ";") next();

    if (rawValues.length === 0) {
      return { type: "char", value: "" };
    }
    if (rawValues.length === 1) {
      const first = rawValues[0]!;
      return { type: first.type, value: first.value };
    }
    if (rawValues.every((r) => typeof r.value === "string")) {
      return { type: "char", value: rawValues.map((r) => String(r.value)).join("") };
    }
    const nums = rawValues.map((r) => (typeof r.value === "number" ? r.value : Number(r.value)));
    return { type: rawValues[0]!.type, value: nums };
  };

  while (!isAtEnd()) {
    const tok = peek();
    if (tok.text === "}") {
      next();
      break;
    }

    // Section headers: dimensions:, variables:, data:
    if (tok.kind === "ident" && peek(1).text === ":") {
      const lower = tok.text.toLowerCase();
      if (lower === "dimensions" || lower === "variables" || lower === "data") {
        section = lower;
        next();
        next();
        continue;
      }
    }

    // Global attribute anywhere inside body: :attr = val ;
    if (tok.text === ":") {
      const startTok = next();
      const attrNameTok = next();
      if (peek().text === "=") next();
      const { type, value } = parseAttributeValues();
      globalAttributes.push({
        name: attrNameTok.text,
        type,
        value,
        line: startTok.line,
        column: startTok.column,
        startOffset: startTok.startOffset,
        endOffset: peek().startOffset,
      });
      continue;
    }

    if (section === "dimensions") {
      const nameTok = next();
      if (peek().text !== "=") {
        parseErrors.push({
          code: "NC1001",
          message: `Expected '=' in dimension declaration '${nameTok.text}' at line ${nameTok.line}`,
          line: nameTok.line,
          column: nameTok.column,
        });
        while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") next();
        if (peek().text === ";") next();
        continue;
      }
      next(); // '='
      const valTok = next();
      let isUnlimited = false;
      let size = 0;
      if (valTok.kind === "ident" && valTok.text.toUpperCase() === "UNLIMITED") {
        isUnlimited = true;
        // Check for standard ncdump comment: // (N currently)
        const lineComment = commentByLine.get(valTok.line) ?? "";
        const m = lineComment.match(/\(\s*(\d+)\s+currently\s*\)/i);
        size = m ? Number(m[1]) : 0;
      } else {
        const parsed = Number(valTok.text);
        size = Number.isFinite(parsed) ? parsed : -1;
      }
      const endTok = peek().text === ";" ? next() : valTok;
      dimensions.push({
        name: nameTok.text,
        size,
        isUnlimited,
        line: nameTok.line,
        column: nameTok.column,
        startOffset: nameTok.startOffset,
        endOffset: endTok.endOffset,
      });
      continue;
    }

    if (section === "variables") {
      // Variable attribute: varName:attrName = val ;
      if (tok.kind === "ident" && peek(1).text === ":") {
        const varNameTok = next();
        next(); // ':'
        const attrNameTok = next();
        if (peek().text === "=") next();
        const { type, value } = parseAttributeValues();
        const targetVar = findVar(varNameTok.text);
        const attr: NetcdfAttribute = {
          name: attrNameTok.text,
          type,
          value,
          line: varNameTok.line,
          column: varNameTok.column,
          startOffset: varNameTok.startOffset,
          endOffset: peek().startOffset,
        };
        if (targetVar) {
          targetVar.attributes.push(attr);
        } else {
          parseErrors.push({
            code: "NC1001",
            message: `Attribute '${attrNameTok.text}' attached to undeclared variable '${varNameTok.text}' at line ${varNameTok.line}`,
            line: varNameTok.line,
            column: varNameTok.column,
          });
        }
        continue;
      }

      // Variable declaration: <type> <name>[(dim1, dim2)] ;
      const typeTok = next();
      const lowerType = typeTok.text.toLowerCase() as NetcdfDataType;
      if (!VALID_TYPES.has(lowerType)) {
        parseErrors.push({
          code: "NC1001",
          message: `Unknown NetCDF data type '${typeTok.text}' at line ${typeTok.line}`,
          line: typeTok.line,
          column: typeTok.column,
        });
        while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") next();
        if (peek().text === ";") next();
        continue;
      }

      // Support comma-separated declarations of same type: float a(x), b(x);
      while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") {
        const varNameTok = next();
        const varDims: string[] = [];
        if (peek().text === "(") {
          next(); // '('
          while (!isAtEnd() && peek().text !== ")") {
            const dTok = next();
            if (dTok.text === ",") continue;
            varDims.push(dTok.text);
          }
          if (peek().text === ")") next();
        }
        variables.push({
          name: varNameTok.text,
          type: lowerType,
          dimensions: varDims,
          attributes: [],
          line: varNameTok.line,
          column: varNameTok.column,
          startOffset: typeTok.startOffset,
          endOffset: peek().startOffset,
        });
        if (peek().text === ",") {
          next();
        } else {
          break;
        }
      }
      if (peek().text === ";") next();
      continue;
    }

    if (section === "data") {
      const varNameTok = next();
      if (peek().text !== "=") {
        parseErrors.push({
          code: "NC1001",
          message: `Expected '=' in data assignment for '${varNameTok.text}' at line ${varNameTok.line}`,
          line: varNameTok.line,
          column: varNameTok.column,
        });
        while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") next();
        if (peek().text === ";") next();
        continue;
      }
      next(); // '='

      const targetVar = findVar(varNameTok.text);
      const fillAttr = targetVar?.attributes.find((a) => a.name === "_FillValue");
      const fillVal =
        fillAttr && typeof fillAttr.value === "number"
          ? fillAttr.value
          : targetVar
            ? NC_DEFAULT_FILL[targetVar.type]
            : NC_DEFAULT_FILL.float;

      const values: (number | string)[] = [];
      while (!isAtEnd() && peek().text !== ";" && peek().text !== "}") {
        const vTok = next();
        if (vTok.text === ",") continue;
        if (vTok.text === "_") {
          values.push(fillVal);
          continue;
        }
        if (vTok.text === "-" && peek().kind === "ident") {
          const idTok = next();
          const combined: CdlToken = { ...idTok, text: `-${idTok.text}` };
          values.push(parseTypedLiteral(combined).value);
          continue;
        }
        values.push(parseTypedLiteral(vTok).value);
      }
      if (peek().text === ";") next();

      if (targetVar) {
        targetVar.data = values;
      } else {
        undeclaredDataTargets.push({
          name: varNameTok.text,
          line: varNameTok.line,
          column: varNameTok.column,
        });
      }
      continue;
    }

    // Unexpected token outside known section
    parseErrors.push({
      code: "NC1001",
      message: `Unexpected token '${tok.text}' at line ${tok.line}`,
      line: tok.line,
      column: tok.column,
    });
    next();
  }

  // Infer unlimited dimension size from record variable data if size == 0
  const dimMap = new Map<string, NetcdfDimension>();
  for (const d of dimensions) {
    dimMap.set(d.name, d);
  }
  for (const v of variables) {
    const firstDimName = v.dimensions[0];
    if (firstDimName) {
      const firstDim = dimMap.get(firstDimName);
      if (firstDim?.isUnlimited) {
        v.isRecord = true;
        if (firstDim.size === 0 && v.data && v.data.length > 0) {
          let slabElems = 1;
          for (let k = 1; k < v.dimensions.length; k++) {
            const subDim = dimMap.get(v.dimensions[k]!);
            if (subDim && subDim.size > 0) slabElems *= subDim.size;
          }
          if (slabElems > 0) {
            firstDim.size = Math.ceil(v.data.length / slabElems);
          }
        }
      }
    }
  }

  return {
    name: datasetName,
    format: "classic",
    sourceFormat: "cdl",
    dimensions,
    variables,
    globalAttributes,
    undeclaredDataTargets: undeclaredDataTargets.length > 0 ? undeclaredDataTargets : undefined,
    parseErrors,
  };
}

function formatAttrValue(attr: NetcdfAttribute): string {
  if (typeof attr.value === "string") {
    const escaped = attr.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  const suffix = attr.type === "float" ? "f" : attr.type === "short" ? "s" : attr.type === "byte" ? "b" : "";
  if (Array.isArray(attr.value)) {
    return attr.value.map((n) => `${n}${suffix}`).join(", ");
  }
  return `${attr.value}${suffix}`;
}

/**
 * Serializes a `NetcdfDataset` back to canonical Unidata CDL ASCII text.
 */
export function formatCdl(dataset: NetcdfDataset): string {
  const lines: string[] = [];
  lines.push(`netcdf ${dataset.name} {`);

  if (dataset.dimensions.length > 0) {
    lines.push("dimensions:");
    for (const d of dataset.dimensions) {
      if (d.isUnlimited) {
        lines.push(`\t${d.name} = UNLIMITED ; // (${d.size} currently)`);
      } else {
        lines.push(`\t${d.name} = ${d.size} ;`);
      }
    }
  }

  if (dataset.variables.length > 0 || dataset.globalAttributes.length > 0) {
    lines.push("variables:");
    for (const v of dataset.variables) {
      const dimPart = v.dimensions.length > 0 ? `(${v.dimensions.join(", ")})` : "";
      lines.push(`\t${v.type} ${v.name}${dimPart} ;`);
      for (const a of v.attributes) {
        lines.push(`\t\t${v.name}:${a.name} = ${formatAttrValue(a)} ;`);
      }
    }
    if (dataset.globalAttributes.length > 0) {
      lines.push("");
      lines.push("// global attributes:");
      for (const ga of dataset.globalAttributes) {
        lines.push(`\t\t:${ga.name} = ${formatAttrValue(ga)} ;`);
      }
    }
  }

  const varsWithData = dataset.variables.filter((v) => v.data && v.data.length > 0);
  if (varsWithData.length > 0) {
    lines.push("data:");
    for (const v of varsWithData) {
      const formatted = (v.data ?? [])
        .map((val) => (typeof val === "string" ? `"${val.replace(/"/g, '\\"')}"` : String(val)))
        .join(", ");
      lines.push(` ${v.name} = ${formatted} ;`);
    }
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}
