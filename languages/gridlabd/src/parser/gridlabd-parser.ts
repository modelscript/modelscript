// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — GridLAB-D (.glm) Parser & Unit Helpers.
 *
 * Parses .glm text into a structured GlmModel with exact source spans,
 * nested object hierarchies, modules, clock, schedules, classes, and directives.
 */

import type {
  GlmClassDef,
  GlmClassField,
  GlmClock,
  GlmComplex,
  GlmDirective,
  GlmModel,
  GlmModule,
  GlmObject,
  GlmSchedule,
  GlmSourceSpan,
} from "../types.js";

function unquote(val: string): string {
  const trimmed = val.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parse a numeric value with optional unit (e.g. "2400 V" -> { value: 2400, unit: "V" }).
 */
export function parseGlmNumber(raw: string | undefined): { value: number; unit?: string | undefined } | null {
  if (!raw) return null;
  const trimmed = unquote(raw);
  const match = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:\s+([a-zA-Z%/°]+))?$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: match[2] };
}

/**
 * Parse a GridLAB-D complex value in rectangular form (e.g. "100+50j kVA" or "1200-300i").
 */
export function parseGlmComplex(raw: string | undefined): GlmComplex | null {
  if (!raw) return null;
  const trimmed = unquote(raw);
  const rectMatch =
    /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([+-]\s*\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[ij](?:\s+([a-zA-Z%/°]+))?$/.exec(
      trimmed,
    );
  if (rectMatch) {
    const re = Number(rectMatch[1]);
    const im = Number(rectMatch[2]!.replace(/\s+/g, ""));
    if (Number.isFinite(re) && Number.isFinite(im)) {
      return { re, im, unit: rectMatch[3] };
    }
  }
  const realOnly = parseGlmNumber(trimmed);
  if (realOnly) {
    return { re: realOnly.value, im: 0, unit: realOnly.unit };
  }
  return null;
}

/**
 * Convert voltage string (e.g. "7.2 kV", "2400 V", "12470") to Volts.
 */
export function parseGlmVoltageV(raw: string | undefined): number | null {
  const parsed = parseGlmComplex(raw);
  if (!parsed) return null;
  const mag = Math.hypot(parsed.re, parsed.im);
  const unit = (parsed.unit ?? "V").toLowerCase();
  if (unit === "kv") return mag * 1e3;
  if (unit === "mv") return mag * 1e6;
  return mag;
}

/**
 * Convert power string (e.g. "100+50j kVA", "50000 W", "1.5 MW") to { pWatts, qVAr }.
 */
export function parseGlmPowerW(raw: string | undefined): { pWatts: number; qVAr: number } | null {
  const parsed = parseGlmComplex(raw);
  if (!parsed) return null;
  const unit = (parsed.unit ?? "VA").toLowerCase();
  let scale = 1;
  if (unit === "kva" || unit === "kw" || unit === "kvar") scale = 1e3;
  else if (unit === "mva" || unit === "mw" || unit === "mvar") scale = 1e6;
  return { pWatts: parsed.re * scale, qVAr: parsed.im * scale };
}

/**
 * Convert length string (e.g. "2000 ft", "0.5 mile", "100 m", "1.2 km") to miles.
 */
export function parseGlmLengthMiles(raw: string | undefined): number | null {
  const parsed = parseGlmNumber(raw);
  if (!parsed) return null;
  const unit = (parsed.unit ?? "ft").toLowerCase();
  if (unit === "mile" || unit === "miles" || unit === "mi") return parsed.value;
  if (unit === "ft" || unit === "feet" || unit === "foot") return parsed.value / 5280;
  if (unit === "km") return parsed.value * 0.621371;
  if (unit === "m") return parsed.value * 0.000621371;
  return parsed.value / 5280;
}

class GlmScanner {
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  get offset(): number {
    return this.pos;
  }

  get currentLine(): number {
    return this.line;
  }

  get currentColumn(): number {
    return this.col;
  }

  eof(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }

  advance(count = 1): void {
    for (let i = 0; i < count && this.pos < this.src.length; i++) {
      const ch = this.src[this.pos]!;
      this.pos++;
      if (ch === "\n") {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
    }
  }

  skipWhitespaceAndComments(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
        continue;
      }
      if (ch === "/" && this.peek(1) === "/") {
        while (!this.eof() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }
      if (ch === "/" && this.peek(1) === "*") {
        this.advance(2);
        while (!this.eof() && !(this.peek() === "*" && this.peek(1) === "/")) {
          this.advance();
        }
        if (!this.eof()) this.advance(2);
        continue;
      }
      break;
    }
  }

  readWord(): string {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    while (!this.eof()) {
      const ch = this.peek();
      if (/[\s;{}()=]/.test(ch)) break;
      this.advance();
    }
    return this.src.slice(start, this.pos);
  }

  readUntilLineEnd(): string {
    const start = this.pos;
    while (!this.eof() && this.peek() !== "\n" && this.peek() !== "\r") {
      this.advance();
    }
    return this.src.slice(start, this.pos).trim();
  }

  readUntilSemicolon(): string {
    this.skipWhitespaceAndComments();
    const start = this.pos;
    let inSingle = false;
    let inDouble = false;
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        this.advance();
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        this.advance();
        continue;
      }
      if (!inSingle && !inDouble) {
        if (ch === ";") {
          const text = this.src.slice(start, this.pos).trim();
          this.advance(); // consume ';'
          return text;
        }
        if (ch === "}") {
          return this.src.slice(start, this.pos).trim();
        }
      }
      this.advance();
    }
    return this.src.slice(start, this.pos).trim();
  }

  readBalancedBracesBody(): string {
    this.skipWhitespaceAndComments();
    if (this.peek() !== "{") return "";
    this.advance(); // '{'
    const start = this.pos;
    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    while (!this.eof() && depth > 0) {
      const ch = this.peek();
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const body = this.src.slice(start, this.pos);
            this.advance(); // '}'
            return body;
          }
        }
      }
      this.advance();
    }
    return this.src.slice(start, this.pos);
  }

  consumeOptionalSemicolon(): void {
    this.skipWhitespaceAndComments();
    if (this.peek() === ";") {
      this.advance();
    }
  }

  makeSpan(startLine: number, startCol: number, startOffset: number): GlmSourceSpan {
    return {
      line: startLine,
      column: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }
}

function parsePropertiesBlock(scanner: GlmScanner): Record<string, string> {
  const props: Record<string, string> = {};
  scanner.skipWhitespaceAndComments();
  if (scanner.peek() !== "{") return props;
  scanner.advance(); // '{'

  while (!scanner.eof()) {
    scanner.skipWhitespaceAndComments();
    if (scanner.peek() === "}") {
      scanner.advance();
      break;
    }
    const key = scanner.readWord();
    if (!key) {
      scanner.advance();
      continue;
    }
    const value = unquote(scanner.readUntilSemicolon());
    props[key] = value;
  }

  scanner.consumeOptionalSemicolon();
  return props;
}

function parseObjectBlock(scanner: GlmScanner, parentName?: string): GlmObject {
  const startLine = scanner.currentLine;
  const startCol = scanner.currentColumn;
  const startOffset = scanner.offset;

  // "object" keyword already consumed
  const header = scanner.readWord();
  const colonIdx = header.indexOf(":");
  const className = colonIdx !== -1 ? header.slice(0, colonIdx) : header;
  const id = colonIdx !== -1 ? header.slice(colonIdx + 1) : undefined;

  const properties: Record<string, string> = {};
  const children: GlmObject[] = [];

  scanner.skipWhitespaceAndComments();
  if (scanner.peek() === "{") {
    scanner.advance(); // '{'
    while (!scanner.eof()) {
      scanner.skipWhitespaceAndComments();
      if (scanner.peek() === "}") {
        scanner.advance();
        break;
      }
      const word = scanner.readWord();
      if (!word) {
        scanner.advance();
        continue;
      }
      if (word === "object") {
        const child = parseObjectBlock(scanner, properties["name"] ?? (id ? `${className}:${id}` : undefined));
        children.push(child);
        continue;
      }
      const val = unquote(scanner.readUntilSemicolon());
      properties[word] = val;
    }
  }

  scanner.consumeOptionalSemicolon();

  const name = properties["name"];
  const parent = properties["parent"] ?? parentName;
  if (parent && !properties["parent"]) {
    properties["parent"] = parent;
  }

  return {
    className,
    name,
    id,
    parent,
    properties,
    children,
    span: scanner.makeSpan(startLine, startCol, startOffset),
  };
}

function parseClassFields(body: string): GlmClassField[] {
  const fields: GlmClassField[] = [];
  for (const rawLine of body.split(";")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\[([^\]]+)\])?$/.exec(trimmed);
    if (match) {
      fields.push({ type: match[1]!, name: match[2]!, unit: match[3] });
    }
  }
  return fields;
}

function registerObjectsRecursive(
  obj: GlmObject,
  allObjects: GlmObject[],
  objectsByName: Map<string, GlmObject>,
): void {
  allObjects.push(obj);
  if (obj.name) {
    objectsByName.set(obj.name, obj);
  }
  if (obj.id) {
    objectsByName.set(`${obj.className}:${obj.id}`, obj);
  }
  for (const child of obj.children) {
    if (!child.parent && obj.name) {
      child.parent = obj.name;
    }
    registerObjectsRecursive(child, allObjects, objectsByName);
  }
}

/**
 * Parse a GridLAB-D (.glm) source string into a structured GlmModel.
 */
export function parseGridlabd(source: string): GlmModel {
  const scanner = new GlmScanner(source);

  const directives: GlmDirective[] = [];
  let clock: GlmClock | undefined;
  const modules: GlmModule[] = [];
  const classes: GlmClassDef[] = [];
  const schedules: GlmSchedule[] = [];
  const objects: GlmObject[] = [];

  while (!scanner.eof()) {
    scanner.skipWhitespaceAndComments();
    if (scanner.eof()) break;

    const startLine = scanner.currentLine;
    const startCol = scanner.currentColumn;
    const startOffset = scanner.offset;

    const keyword = scanner.readWord();
    if (!keyword) {
      scanner.advance();
      continue;
    }

    if (keyword === "#set" || keyword === "#define" || keyword === "#include") {
      const rest = scanner.readUntilLineEnd();
      const kind = keyword.slice(1) as "set" | "define" | "include";
      if (kind === "include") {
        directives.push({
          kind,
          name: "include",
          value: unquote(rest),
          span: scanner.makeSpan(startLine, startCol, startOffset),
        });
      } else {
        const eqIdx = rest.indexOf("=");
        const spIdx = rest.search(/\s/);
        const sep = eqIdx !== -1 ? eqIdx : spIdx;
        const name = sep !== -1 ? rest.slice(0, sep).trim() : rest.trim();
        const value = sep !== -1 ? unquote(rest.slice(sep + 1)) : "";
        directives.push({
          kind,
          name,
          value,
          span: scanner.makeSpan(startLine, startCol, startOffset),
        });
      }
      continue;
    }

    if (keyword === "global") {
      const rest = scanner.readUntilSemicolon();
      const eqIdx = rest.indexOf("=");
      const spIdx = rest.search(/\s/);
      const sep = eqIdx !== -1 ? eqIdx : spIdx;
      const name = sep !== -1 ? rest.slice(0, sep).trim() : rest.trim();
      const value = sep !== -1 ? unquote(rest.slice(sep + 1)) : "";
      directives.push({
        kind: "global",
        name,
        value,
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }

    if (keyword === "clock") {
      const properties = parsePropertiesBlock(scanner);
      clock = {
        timezone: properties["timezone"],
        starttime: properties["starttime"],
        stoptime: properties["stoptime"],
        timestamp: properties["timestamp"],
        properties,
        span: scanner.makeSpan(startLine, startCol, startOffset),
      };
      continue;
    }

    if (keyword === "module") {
      const modName = scanner.readWord().replace(/;$/, "");
      scanner.skipWhitespaceAndComments();
      const properties = scanner.peek() === "{" ? parsePropertiesBlock(scanner) : {};
      scanner.consumeOptionalSemicolon();
      modules.push({
        name: modName,
        properties,
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }

    if (keyword === "class") {
      const className = scanner.readWord();
      const body = scanner.readBalancedBracesBody();
      scanner.consumeOptionalSemicolon();
      classes.push({
        name: className,
        fields: parseClassFields(body),
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }

    if (keyword === "schedule") {
      const schedName = scanner.readWord();
      const body = scanner.readBalancedBracesBody();
      scanner.consumeOptionalSemicolon();
      schedules.push({
        name: schedName,
        body: body.trim(),
        span: scanner.makeSpan(startLine, startCol, startOffset),
      });
      continue;
    }

    if (keyword === "object") {
      const obj = parseObjectBlock(scanner);
      objects.push(obj);
      continue;
    }
  }

  const allObjects: GlmObject[] = [];
  const objectsByName = new Map<string, GlmObject>();
  for (const obj of objects) {
    registerObjectsRecursive(obj, allObjects, objectsByName);
  }

  const modulesByName = new Map<string, GlmModule>();
  for (const mod of modules) {
    modulesByName.set(mod.name, mod);
  }

  return {
    directives,
    clock,
    modules,
    classes,
    schedules,
    objects,
    allObjects,
    objectsByName,
    modulesByName,
  };
}
