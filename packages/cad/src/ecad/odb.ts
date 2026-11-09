// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ODB++ Manufacturing Export Compiler.
 *
 * Emits an open, structured ODB++ v8.1 archive hierarchy:
 *   - matrix/matrix (layer sequence, polarity, and context)
 *   - steps/pcb/layers/<layer>/features (vector traces and pad flashes)
 *   - steps/pcb/eda/data (components, packages, and pins)
 *   - steps/pcb/netlists/cad/netlist (topological nets)
 *   - misc/info & misc/attrlist
 *
 * Includes an integrated, zero-dependency POSIX USTAR archive packager.
 *
 * Reference: ODB++ Format Specification v8.1 (Valor Computerized Systems).
 */

import type { PCBLayout, PadDefinition, TraceSegment } from "./gerber.js";
import type { NetlistGraph } from "./netlist.js";

// ── Public Types ──

export interface ODBCompileOptions {
  jobName?: string;
  stepName?: string;
  units?: "MM" | "INCH";
  precision?: number;
}

export interface ODBJobArchive {
  /** Relative file paths inside the archive and their ASCII contents. */
  files: Map<string, string>;
  /** Generates an uncompressed POSIX USTAR tar archive buffer. */
  toTar(): Uint8Array;
}

// ── Coordinate & Symbol Formatters ──

const MM_TO_MICRON = 1000;

function toMicron(mm: number): number {
  return Math.round(mm * MM_TO_MICRON);
}

function padSymbolName(pad: PadDefinition): string {
  const w = toMicron(pad.width);
  const h = toMicron(pad.height);
  if (pad.shape === "circle") {
    return `round${w}`;
  }
  if (pad.shape === "rect") {
    return `r${w}x${h}`;
  }
  if (pad.shape === "roundrect") {
    return `oval${w}x${h}`;
  }
  return `rect${w}x${h}`;
}

// ── ODB++ Layer & Step Generators ──

function buildMatrixFile(): string {
  const lines: string[] = [];
  lines.push("STEP {");
  lines.push("  COL=1");
  lines.push("  NAME=pcb");
  lines.push("}");
  lines.push("");

  const layers = [
    { name: "top_silkscreen", type: "SILK_SCREEN", context: "BOARD", polarity: "POSITIVE" },
    { name: "top_soldermask", type: "SOLDER_MASK", context: "BOARD", polarity: "POSITIVE" },
    { name: "top_copper", type: "SIGNAL", context: "BOARD", polarity: "POSITIVE" },
    { name: "bottom_copper", type: "SIGNAL", context: "BOARD", polarity: "POSITIVE" },
    { name: "bottom_soldermask", type: "SOLDER_MASK", context: "BOARD", polarity: "POSITIVE" },
    { name: "bottom_silkscreen", type: "SILK_SCREEN", context: "BOARD", polarity: "POSITIVE" },
    { name: "drill", type: "DRILL", context: "BOARD", polarity: "POSITIVE" },
    { name: "outline", type: "DOCUMENT", context: "BOARD", polarity: "POSITIVE" },
  ];

  let row = 1;
  for (const l of layers) {
    lines.push("LAYER {");
    lines.push(`  ROW=${row++}`);
    lines.push(`  NAME=${l.name}`);
    lines.push(`  TYPE=${l.type}`);
    lines.push(`  CONTEXT=${l.context}`);
    lines.push(`  POLARITY=${l.polarity}`);
    lines.push("  START_NAME=");
    lines.push("  END_NAME=");
    lines.push("}");
  }

  return lines.join("\n");
}

function buildFeaturesFile(traces: TraceSegment[], pads: PadDefinition[], vias: PCBLayout["vias"]): string {
  const lines: string[] = [];
  lines.push("# ODB++ Layer Features");
  lines.push("UNITS=MM");

  // Collect and assign symbol IDs ($1, $2, ...)
  const symbolMap = new Map<string, number>();
  let nextSymId = 1;

  for (const t of traces) {
    const sym = `round${toMicron(t.width)}`;
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, nextSymId++);
      lines.push(`$${symbolMap.get(sym)} ${sym}`);
    }
  }

  for (const p of pads) {
    const sym = padSymbolName(p);
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, nextSymId++);
      lines.push(`$${symbolMap.get(sym)} ${sym}`);
    }
  }

  for (const v of vias) {
    const sym = `round${toMicron(v.drill + 2 * v.annularRing)}`;
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, nextSymId++);
      lines.push(`$${symbolMap.get(sym)} ${sym}`);
    }
  }

  // Draw traces: L <xs> <ys> <xe> <ye> <sym_id> P <net_id>
  for (const t of traces) {
    const sym = `round${toMicron(t.width)}`;
    const symId = symbolMap.get(sym);
    lines.push(
      `L ${t.start[0].toFixed(4)} ${t.start[1].toFixed(4)} ${t.end[0].toFixed(4)} ${t.end[1].toFixed(4)} $${symId} P 0`,
    );
  }

  // Flash pads: P <x> <y> <sym_id> P <rot> <mirror> <net_id>
  for (const p of pads) {
    const sym = padSymbolName(p);
    const symId = symbolMap.get(sym);
    lines.push(`P ${p.center[0].toFixed(4)} ${p.center[1].toFixed(4)} $${symId} P 0 N 0`);
  }

  // Flash vias
  for (const v of vias) {
    const sym = `round${toMicron(v.drill + 2 * v.annularRing)}`;
    const symId = symbolMap.get(sym);
    lines.push(`P ${v.center[0].toFixed(4)} ${v.center[1].toFixed(4)} $${symId} P 0 N 0`);
  }

  return lines.join("\n");
}

function buildEdaDataFile(netlist: NetlistGraph): string {
  const lines: string[] = [];
  lines.push("# ODB++ EDA Data");
  lines.push("UNITS=MM");

  // Packages section
  const packages = new Set<string>();
  for (const c of netlist.components) {
    const pkg = c.placement?.footprint ?? "SMD";
    packages.add(pkg);
  }

  for (const pkg of packages) {
    lines.push(`PKG ${pkg} 0.000 0.000 2.000 1.200`);
    lines.push(`  PIN 1 0.000 0.000 round400`);
  }

  // Components section
  for (const c of netlist.components) {
    const pkg = c.placement?.footprint ?? "SMD";
    const x = c.placement?.x ?? 0;
    const y = c.placement?.y ?? 0;
    const rot = c.placement?.angle ?? 0;
    const side = (c.placement?.layer ?? "top").toLowerCase().includes("bottom") ? "BOT" : "TOP";
    lines.push(`CMP ${c.name} ${pkg} ${x.toFixed(4)} ${y.toFixed(4)} ${rot.toFixed(1)} ${side}`);
    for (const pin of c.pins) {
      lines.push(`  TOP_PIN ${pin} ${pin}`);
    }
  }

  return lines.join("\n");
}

function buildNetlistFile(netlist: NetlistGraph): string {
  const lines: string[] = [];
  lines.push("# ODB++ CAD Netlist");
  lines.push("UNITS=MM");

  for (const net of netlist.nets) {
    lines.push(`$NET ${net.id}`);
    for (const pin of net.pins) {
      lines.push(`  ${pin.component} ${pin.localName}`);
    }
  }

  return lines.join("\n");
}

// ── Compiler Implementation ──

/**
 * Compiles a PCBLayout and Netlist into a standard ODB++ v8.1 file archive.
 */
export function compileToODB(layout: PCBLayout, options?: ODBCompileOptions): ODBJobArchive {
  const files = new Map<string, string>();
  const job = options?.jobName ?? "job";

  // 1. matrix/matrix
  files.set("matrix/matrix", buildMatrixFile());

  // 2. misc/info & misc/attrlist
  files.set(
    "misc/info",
    `JOB=${job}\nSTEP=pcb\nVERSION=8.1\nCREATOR=ModelScript ECAD\nDATE=${new Date().toISOString()}\nUNITS=MM\n`,
  );
  files.set("misc/attrlist", `UNITS=MM\n.comment=Generated by ModelScript ECAD engine\n`);

  // 3. steps/pcb/layers/<layer>/features
  const topTraces = layout.traces.filter((t) => t.layer === "TopCopper" || t.layer === "top" || t.layer === "F.Cu");
  const topPads = layout.pads.filter((p) => p.layer === "TopCopper" || p.layer === "top" || p.layer === "F.Cu");
  files.set("steps/pcb/layers/top_copper/features", buildFeaturesFile(topTraces, topPads, layout.vias));

  const botTraces = layout.traces.filter(
    (t) => t.layer === "BottomCopper" || t.layer === "bottom" || t.layer === "B.Cu",
  );
  const botPads = layout.pads.filter((p) => p.layer === "BottomCopper" || p.layer === "bottom" || p.layer === "B.Cu");
  files.set("steps/pcb/layers/bottom_copper/features", buildFeaturesFile(botTraces, botPads, []));

  // Outline
  if (layout.outline && layout.outline.vertices.length >= 2) {
    const outlineLines: string[] = ["UNITS=MM", "$1 round100"];
    const v = layout.outline.vertices;
    for (let i = 0; i < v.length; i++) {
      const next = v[(i + 1) % v.length]!;
      const curr = v[i]!;
      outlineLines.push(
        `L ${curr[0].toFixed(4)} ${curr[1].toFixed(4)} ${next[0].toFixed(4)} ${next[1].toFixed(4)} $1 P 0`,
      );
    }
    files.set("steps/pcb/layers/outline/features", outlineLines.join("\n"));
  }

  // 4. steps/pcb/eda/data
  files.set("steps/pcb/eda/data", buildEdaDataFile(layout.netlist));

  // 5. steps/pcb/netlists/cad/netlist
  files.set("steps/pcb/netlists/cad/netlist", buildNetlistFile(layout.netlist));

  return {
    files,
    toTar(): Uint8Array {
      return packUstarArchive(files);
    },
  };
}

// ── POSIX USTAR Archive Packager ──

/**
 * Creates an uncompressed POSIX USTAR tar archive from in-memory files.
 */
export function packUstarArchive(files: Map<string, string>): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const [path, content] of files) {
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(content);
    const header = createUstarHeader(path, dataBytes.length);
    blocks.push(header);
    blocks.push(dataBytes);

    // Pad file data to 512-byte boundary
    const remainder = dataBytes.length % 512;
    if (remainder > 0) {
      blocks.push(new Uint8Array(512 - remainder));
    }
  }

  // End of archive is marked by two 512-byte blocks of zeroes
  blocks.push(new Uint8Array(1024));

  // Concatenate all blocks
  const totalLength = blocks.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

function createUstarHeader(filename: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);

  // Filename (0..99)
  writeString(buf, 0, 100, filename);
  // File mode: 0000644\0 (100..107)
  writeString(buf, 100, 8, "0000644\0");
  // Owner UID: 0000000\0 (108..115)
  writeString(buf, 108, 8, "0000000\0");
  // Owner GID: 0000000\0 (116..123)
  writeString(buf, 116, 8, "0000000\0");
  // File size in octal: 11 digits + null (124..135)
  const sizeOctal = size.toString(8).padStart(11, "0") + "\0";
  writeString(buf, 124, 12, sizeOctal);
  // Modification time in octal (136..147)
  const mtimeOctal =
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, "0") + "\0";
  writeString(buf, 136, 12, mtimeOctal);
  // Typeflag '0' for regular file (156)
  buf[156] = "0".charCodeAt(0);
  // Magic "ustar\0" (257..262)
  writeString(buf, 257, 6, "ustar\0");
  // Version "00" (263..264)
  writeString(buf, 263, 2, "00");

  // Fill Checksum field (148..155) with spaces before computing
  for (let i = 148; i < 156; i++) buf[i] = 32;

  // Compute checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i]!;
  const checksumOctal = checksum.toString(8).padStart(6, "0") + "\0 ";
  writeString(buf, 148, 8, checksumOctal);

  return buf;
}

function writeString(buf: Uint8Array, offset: number, maxLength: number, str: string): void {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const len = Math.min(bytes.length, maxLength);
  buf.set(bytes.subarray(0, len), offset);
}
