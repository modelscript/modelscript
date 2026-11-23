// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  HDF4_DATA_TYPE_NAMES,
  Hdf4DataType,
  Hdf4Tag,
  resolveHdf4DataTypeCode,
  type Hdf4Attribute,
  type Hdf4Document,
  type Hdf4Palette,
  type Hdf4ParseError,
  type Hdf4Raster8,
  type Hdf4Sds,
  type Hdf4Vdata,
  type Hdf4VdataField,
  type Hdf4Vgroup,
  type Hdf4VgroupMember,
} from "../types.js";

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && (inSingle || inDouble)) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(token: string): string {
  const t = token.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\(["'\\])/g, "$1");
  }
  return t;
}

function parseNumberList(raw: string): number[] {
  const cleaned = raw.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/[\s,]+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => {
      const upper = tok.toUpperCase();
      if (upper === "NAN") return Number.NaN;
      if (upper === "INF" || upper === "+INF" || upper === "INFINITY") return Number.POSITIVE_INFINITY;
      if (upper === "-INF" || upper === "-INFINITY") return Number.NEGATIVE_INFINITY;
      return Number(tok);
    });
}

function parseAttrValue(raw: string): string | number | number[] {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return unquote(trimmed);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return parseNumberList(trimmed);
  }
  const num = Number(trimmed);
  if (trimmed.length > 0 && !Number.isNaN(num)) {
    return num;
  }
  return trimmed;
}

function parseInlineKeyValues(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[^\s,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const key = m[1];
    const val = m[2];
    if (key !== undefined && val !== undefined) {
      out[key.toUpperCase()] = val;
    }
  }
  return out;
}

type BlockContext =
  | { kind: "ROOT" }
  | { kind: "SDS"; obj: Hdf4Sds }
  | { kind: "VGROUP"; obj: Hdf4Vgroup }
  | { kind: "VDATA"; obj: Hdf4Vdata }
  | { kind: "RASTER8"; obj: Hdf4Raster8 }
  | { kind: "PALETTE"; obj: Hdf4Palette };

/**
 * Parses a textual NCSA HDF4 DDL document into a structured `Hdf4Document`.
 */
export function parseHdf4Ddl(source: string): Hdf4Document {
  const doc: Hdf4Document = {
    name: "UntitledHdf4",
    version: "4.2",
    attributes: [],
    sdsList: [],
    vgroups: [],
    vdatas: [],
    rasters: [],
    palettes: [],
    descriptors: [],
    ddhBlocks: [],
    parseErrors: [],
  };

  let nextRef = 1;
  const allocRef = (explicit?: string): number => {
    if (explicit !== undefined) {
      const parsed = Number(explicit);
      if (Number.isInteger(parsed) && parsed > 0) {
        if (parsed >= nextRef) nextRef = parsed + 1;
        return parsed;
      }
    }
    return nextRef++;
  };

  const stack: BlockContext[] = [{ kind: "ROOT" }];
  const lines = source.split(/\r?\n/);
  let offset = 0;

  const pushError = (message: string, line: number, column = 1): void => {
    const err: Hdf4ParseError = { code: "HDF1001", message, line, column };
    doc.parseErrors.push(err);
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;
    const stripped = stripInlineComment(rawLine).trim();
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset += rawLine.length + 1;

    if (!stripped) continue;

    const current = stack[stack.length - 1] ?? { kind: "ROOT" };
    const headMatch = /^([A-Za-z_][A-Za-z0-9_]*)\b(.*)$/.exec(stripped);
    if (!headMatch) {
      pushError(`Unexpected token '${stripped}'`, lineNum);
      continue;
    }

    const keyword = (headMatch[1] ?? "").toUpperCase();
    const rest = (headMatch[2] ?? "").trim();

    if (keyword === "HDF4") {
      const nameMatch = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (nameMatch) {
        doc.name = unquote(nameMatch[1] ?? "UntitledHdf4");
        const kv = parseInlineKeyValues(nameMatch[2] ?? "");
        if (kv["VERSION"]) doc.version = unquote(kv["VERSION"]);
      } else {
        pushError("Expected dataset/file name after HDF4", lineNum);
      }
      continue;
    }

    if (keyword === "END") {
      if (stack.length > 1) {
        const popped = stack.pop();
        if (popped && popped.kind !== "ROOT" && popped.obj.location) {
          popped.obj.location.endOffset = lineEnd;
        }
      }
      continue;
    }

    if (keyword === "SDS") {
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected SDS name after 'SDS'", lineNum);
        continue;
      }
      const name = unquote(m[1] ?? "");
      const kv = parseInlineKeyValues(m[2] ?? "");
      const typeSpec = kv["TYPE"] ?? kv["DTYPE"] ?? "FLOAT32";
      const dataType = resolveHdf4DataTypeCode(unquote(typeSpec));
      const ref = allocRef(kv["REF"]);
      const sds: Hdf4Sds = {
        name,
        ref,
        dataType,
        dims: [],
        attributes: [],
        data: [],
        unit: kv["UNIT"] ? unquote(kv["UNIT"]) : undefined,
        fillValue: kv["FILL"] !== undefined ? Number(kv["FILL"]) : undefined,
        scaleFactor: kv["SCALE"] !== undefined ? Number(kv["SCALE"]) : undefined,
        addOffset: kv["OFFSET"] !== undefined ? Number(kv["OFFSET"]) : undefined,
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      doc.sdsList.push(sds);
      doc.descriptors.push({ tag: Hdf4Tag.DFTAG_NDG, ref, offset: 0, length: 0 });
      stack.push({ kind: "SDS", obj: sds });
      continue;
    }

    if (keyword === "VGROUP") {
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected Vgroup name after 'VGROUP'", lineNum);
        continue;
      }
      const name = unquote(m[1] ?? "");
      const kv = parseInlineKeyValues(m[2] ?? "");
      const ref = allocRef(kv["REF"]);
      const vg: Hdf4Vgroup = {
        name,
        vgroupClass: kv["CLASS"] ? unquote(kv["CLASS"]) : undefined,
        ref,
        members: [],
        attributes: [],
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      doc.vgroups.push(vg);
      doc.descriptors.push({ tag: Hdf4Tag.DFTAG_VG, ref, offset: 0, length: 0 });
      stack.push({ kind: "VGROUP", obj: vg });
      continue;
    }

    if (keyword === "VDATA") {
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected Vdata name after 'VDATA'", lineNum);
        continue;
      }
      const name = unquote(m[1] ?? "");
      const kv = parseInlineKeyValues(m[2] ?? "");
      const ref = allocRef(kv["REF"]);
      const vd: Hdf4Vdata = {
        name,
        vdataClass: kv["CLASS"] ? unquote(kv["CLASS"]) : undefined,
        ref,
        fields: [],
        records: [],
        attributes: [],
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      doc.vdatas.push(vd);
      doc.descriptors.push({ tag: Hdf4Tag.DFTAG_VH, ref, offset: 0, length: 0 });
      stack.push({ kind: "VDATA", obj: vd });
      continue;
    }

    if (keyword === "RASTER8") {
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected Raster8 name after 'RASTER8'", lineNum);
        continue;
      }
      const name = unquote(m[1] ?? "");
      const kv = parseInlineKeyValues(m[2] ?? "");
      const ref = allocRef(kv["REF"]);
      const raster: Hdf4Raster8 = {
        name,
        ref,
        width: kv["WIDTH"] !== undefined ? Number(kv["WIDTH"]) : 0,
        height: kv["HEIGHT"] !== undefined ? Number(kv["HEIGHT"]) : 0,
        paletteRef: kv["PALETTE_REF"] !== undefined ? Number(kv["PALETTE_REF"]) : undefined,
        pixels: [],
        attributes: [],
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      doc.rasters.push(raster);
      doc.descriptors.push({ tag: Hdf4Tag.DFTAG_RI8, ref, offset: 0, length: 0 });
      stack.push({ kind: "RASTER8", obj: raster });
      continue;
    }

    if (keyword === "PALETTE") {
      const m = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected Palette name after 'PALETTE'", lineNum);
        continue;
      }
      const name = unquote(m[1] ?? "");
      const kv = parseInlineKeyValues(m[2] ?? "");
      const ref = allocRef(kv["REF"]);
      const palette: Hdf4Palette = {
        name,
        ref,
        entries: [],
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      doc.palettes.push(palette);
      doc.descriptors.push({ tag: Hdf4Tag.DFTAG_IP8, ref, offset: 0, length: 0 });
      stack.push({ kind: "PALETTE", obj: palette });
      continue;
    }

    if (keyword === "DIM") {
      if (current.kind !== "SDS") {
        pushError("'DIM' statement is only valid inside an SDS block", lineNum);
        continue;
      }
      const m = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([+-]?\d+)(.*)$/.exec(rest);
      if (!m) {
        pushError("Expected 'DIM <name> = <size>'", lineNum);
        continue;
      }
      const dimName = m[1] ?? "";
      const dimSize = Number(m[2]);
      const kv = parseInlineKeyValues(m[3] ?? "");
      current.obj.dims.push({
        name: dimName,
        size: dimSize,
        unit: kv["UNIT"] ? unquote(kv["UNIT"]) : undefined,
        scale: kv["SCALE"] ? parseNumberList(kv["SCALE"]) : undefined,
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      });
      continue;
    }

    if (keyword === "FIELD") {
      if (current.kind !== "VDATA") {
        pushError("'FIELD' statement is only valid inside a VDATA block", lineNum);
        continue;
      }
      const m = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*([A-Za-z0-9_]+)(?:\s*\[\s*(\d+)\s*\])?/.exec(rest);
      if (!m) {
        pushError("Expected 'FIELD <name> : <type> [order]'", lineNum);
        continue;
      }
      const field: Hdf4VdataField = {
        name: m[1] ?? "",
        dataType: resolveHdf4DataTypeCode(m[2] ?? "FLOAT32"),
        order: m[3] ? Number(m[3]) : 1,
      };
      current.obj.fields.push(field);
      continue;
    }

    if (keyword === "ATTR") {
      const m = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/.exec(rest);
      if (!m) {
        pushError("Expected 'ATTR <name> = <value>'", lineNum);
        continue;
      }
      const attrName = m[1] ?? "";
      const attrVal = parseAttrValue(m[2] ?? "");
      const attr: Hdf4Attribute = {
        name: attrName,
        value: attrVal,
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      };
      if (current.kind === "ROOT") {
        doc.attributes.push(attr);
      } else if (current.kind === "SDS") {
        current.obj.attributes.push(attr);
        if (attrName.toLowerCase() === "units" && typeof attrVal === "string") {
          current.obj.unit = attrVal;
        } else if (attrName === "_FillValue" && typeof attrVal === "number") {
          current.obj.fillValue = attrVal;
        } else if (attrName === "scale_factor" && typeof attrVal === "number") {
          current.obj.scaleFactor = attrVal;
        } else if (attrName === "add_offset" && typeof attrVal === "number") {
          current.obj.addOffset = attrVal;
        }
      } else if (current.kind === "VGROUP" || current.kind === "VDATA" || current.kind === "RASTER8") {
        current.obj.attributes.push(attr);
      } else {
        doc.attributes.push(attr);
      }
      continue;
    }

    if (keyword === "MEMBER") {
      if (current.kind !== "VGROUP") {
        pushError("'MEMBER' statement is only valid inside a VGROUP block", lineNum);
        continue;
      }
      const m =
        /^(SDS|VGROUP|VDATA|RASTER8|PALETTE|TAGREF)\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][A-Za-z0-9_.-]*)(.*)$/i.exec(
          rest,
        );
      if (!m) {
        pushError("Expected 'MEMBER <SDS|VGROUP|VDATA|RASTER8|PALETTE> <name>'", lineNum);
        continue;
      }
      const kind = (m[1] ?? "SDS").toUpperCase() as Hdf4VgroupMember["kind"];
      const memberName = unquote(m[2] ?? "");
      const kv = parseInlineKeyValues(m[3] ?? "");
      current.obj.members.push({
        kind,
        name: memberName,
        tag: kv["TAG"] !== undefined ? Number(kv["TAG"]) : undefined,
        ref: kv["REF"] !== undefined ? Number(kv["REF"]) : undefined,
        location: { line: lineNum, column: 1, startOffset: lineStart, endOffset: lineEnd },
      });
      continue;
    }

    if (keyword === "DATA") {
      const payload = rest.replace(/^=/, "").trim();
      if (current.kind === "SDS") {
        current.obj.data.push(...parseNumberList(payload));
      } else if (current.kind === "RASTER8") {
        current.obj.pixels.push(...parseNumberList(payload));
      } else if (current.kind === "PALETTE") {
        current.obj.entries.push(...parseNumberList(payload));
      } else if (current.kind === "VDATA") {
        const cleaned = payload.replace(/^\[/, "").replace(/\]$/, "").trim();
        if (cleaned) {
          const cells = cleaned.split(/\s*,\s*/).map((cell) => {
            const c = cell.trim();
            if ((c.startsWith('"') && c.endsWith('"')) || (c.startsWith("'") && c.endsWith("'"))) {
              return unquote(c);
            }
            const n = Number(c);
            return !Number.isNaN(n) && c.length > 0 ? n : c;
          });
          current.obj.records.push(cells);
        }
      } else {
        pushError("'DATA' statement is only valid inside SDS, VDATA, RASTER8, or PALETTE", lineNum);
      }
      continue;
    }

    pushError(`Unknown HDF4 DDL keyword '${keyword}'`, lineNum);
  }

  return doc;
}

/**
 * Formats an `Hdf4Document` back into canonical textual HDF4 DDL.
 */
export function formatHdf4Ddl(doc: Hdf4Document): string {
  const lines: string[] = [];
  lines.push(`HDF4 ${doc.name} VERSION="${doc.version}"`);

  for (const attr of doc.attributes) {
    lines.push(`  ATTR ${attr.name} = ${formatAttrValue(attr.value)}`);
  }

  for (const sds of doc.sdsList) {
    const typeName = HDF4_DATA_TYPE_NAMES[sds.dataType] ?? String(sds.dataType);
    const parts = [`SDS ${sds.name}`, `TYPE=${typeName}`, `REF=${sds.ref}`];
    if (sds.unit) parts.push(`UNIT="${sds.unit}"`);
    lines.push("");
    lines.push(parts.join(" "));
    for (const d of sds.dims) {
      lines.push(`  DIM ${d.name} = ${d.size}`);
    }
    for (const attr of sds.attributes) {
      lines.push(`  ATTR ${attr.name} = ${formatAttrValue(attr.value)}`);
    }
    if (sds.data.length > 0) {
      lines.push(`  DATA [${sds.data.join(", ")}]`);
    }
    lines.push("END");
  }

  for (const vg of doc.vgroups) {
    const parts = [`VGROUP ${vg.name}`, `REF=${vg.ref}`];
    if (vg.vgroupClass) parts.push(`CLASS="${vg.vgroupClass}"`);
    lines.push("");
    lines.push(parts.join(" "));
    for (const attr of vg.attributes) {
      lines.push(`  ATTR ${attr.name} = ${formatAttrValue(attr.value)}`);
    }
    for (const m of vg.members) {
      lines.push(`  MEMBER ${m.kind} ${m.name}`);
    }
    lines.push("END");
  }

  for (const vd of doc.vdatas) {
    const parts = [`VDATA ${vd.name}`, `REF=${vd.ref}`];
    if (vd.vdataClass) parts.push(`CLASS="${vd.vdataClass}"`);
    lines.push("");
    lines.push(parts.join(" "));
    for (const f of vd.fields) {
      const typeName = HDF4_DATA_TYPE_NAMES[f.dataType] ?? String(f.dataType);
      lines.push(`  FIELD ${f.name} : ${typeName}${f.order > 1 ? `[${f.order}]` : ""}`);
    }
    for (const rec of vd.records) {
      lines.push(`  DATA [${rec.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`);
    }
    lines.push("END");
  }

  for (const r of doc.rasters) {
    lines.push("");
    lines.push(`RASTER8 ${r.name} WIDTH=${r.width} HEIGHT=${r.height} REF=${r.ref}`);
    if (r.pixels.length > 0) {
      lines.push(`  DATA [${r.pixels.join(", ")}]`);
    }
    lines.push("END");
  }

  for (const p of doc.palettes) {
    lines.push("");
    lines.push(`PALETTE ${p.name} REF=${p.ref}`);
    if (p.entries.length > 0) {
      lines.push(`  DATA [${p.entries.join(", ")}]`);
    }
    lines.push("END");
  }

  lines.push("END");
  return lines.join("\n") + "\n";
}

function formatAttrValue(val: string | number | number[]): string {
  if (typeof val === "string") return `"${val}"`;
  if (Array.isArray(val)) return `[${val.join(", ")}]`;
  return String(val);
}

export { Hdf4DataType };
