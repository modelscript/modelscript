// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nifti — Multi-Format Volumetric Medical Imaging Parser.
 *
 * Supports:
 * 1. 348-byte binary NIfTI-1 headers & voxel payloads (`Uint8Array` / `ArrayBuffer`)
 * 2. NRRD (.nrrd, .nhdr) headers with space directions, origin, segment metadata & inline voxel grids
 * 3. XML (`<nifti_image>`) and JSON NIfTI header representations
 * 4. Volumetric NIfTI/NRRD DSL (`NIFTI`, `DIM`, `PIXDIM`, `QFORM`, `SFORM`, `SCALING`, `LABEL`, `ROI`, `VOXELS`)
 */

import type {
  NiftiAnatomyLabel,
  NiftiDocument,
  NiftiHeader,
  NiftiRegionOfInterest,
  NiftiSourceRange,
} from "../types.js";

const DATATYPE_NAME_TO_CODE: Record<string, { code: number; bitpix: number; canonical: string }> = {
  uint8: { code: 2, bitpix: 8, canonical: "UINT8" },
  uchar: { code: 2, bitpix: 8, canonical: "UINT8" },
  "unsigned char": { code: 2, bitpix: 8, canonical: "UINT8" },
  dt_uint8: { code: 2, bitpix: 8, canonical: "UINT8" },
  int16: { code: 4, bitpix: 16, canonical: "INT16" },
  short: { code: 4, bitpix: 16, canonical: "INT16" },
  dt_int16: { code: 4, bitpix: 16, canonical: "INT16" },
  int32: { code: 8, bitpix: 32, canonical: "INT32" },
  int: { code: 8, bitpix: 32, canonical: "INT32" },
  dt_int32: { code: 8, bitpix: 32, canonical: "INT32" },
  float32: { code: 16, bitpix: 32, canonical: "FLOAT32" },
  float: { code: 16, bitpix: 32, canonical: "FLOAT32" },
  dt_float32: { code: 16, bitpix: 32, canonical: "FLOAT32" },
  float64: { code: 64, bitpix: 64, canonical: "FLOAT64" },
  double: { code: 64, bitpix: 64, canonical: "FLOAT64" },
  dt_float64: { code: 64, bitpix: 64, canonical: "FLOAT64" },
  int8: { code: 256, bitpix: 8, canonical: "INT8" },
  char: { code: 256, bitpix: 8, canonical: "INT8" },
  uint16: { code: 512, bitpix: 16, canonical: "UINT16" },
  ushort: { code: 512, bitpix: 16, canonical: "UINT16" },
  uint32: { code: 768, bitpix: 32, canonical: "UINT32" },
  uint: { code: 768, bitpix: 32, canonical: "UINT32" },
};

const CODE_TO_DATATYPE_NAME: Record<number, { bitpix: number; canonical: string }> = {
  2: { bitpix: 8, canonical: "UINT8" },
  4: { bitpix: 16, canonical: "INT16" },
  8: { bitpix: 32, canonical: "INT32" },
  16: { bitpix: 32, canonical: "FLOAT32" },
  32: { bitpix: 64, canonical: "COMPLEX64" },
  64: { bitpix: 64, canonical: "FLOAT64" },
  128: { bitpix: 24, canonical: "RGB24" },
  256: { bitpix: 8, canonical: "INT8" },
  512: { bitpix: 16, canonical: "UINT16" },
  768: { bitpix: 32, canonical: "UINT32" },
  1024: { bitpix: 64, canonical: "INT64" },
  1280: { bitpix: 64, canonical: "UINT64" },
};

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

function offsetToLineCol(lineOffsets: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = lineOffsets.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const midVal = lineOffsets[mid] ?? 0;
    if (midVal <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = Math.max(0, low - 1);
  const lineStart = lineOffsets[lineIndex] ?? 0;
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1,
  };
}

function makeRange(lineOffsets: number[], startOffset: number, endOffset: number): NiftiSourceRange {
  const s = offsetToLineCol(lineOffsets, startOffset);
  const e = offsetToLineCol(lineOffsets, Math.max(startOffset, endOffset));
  return {
    startOffset,
    endOffset: Math.max(startOffset, endOffset),
    startLine: s.line,
    startColumn: s.column,
    endLine: e.line,
    endColumn: e.column,
  };
}

function createDefaultHeader(): NiftiHeader {
  return {
    sizeofHdr: 348,
    magic: "n+1",
    datatypeCode: 16,
    datatypeName: "FLOAT32",
    bitpix: 32,
    dim: [3, 4, 4, 4, 1, 1, 1, 1],
    pixdim: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    voxOffset: 352,
    sclSlope: 1.0,
    sclInter: 0.0,
    qformCode: 1,
    sformCode: 1,
    quaternB: 0.0,
    quaternC: 0.0,
    quaternD: 0.0,
    qoffsetX: 0.0,
    qoffsetY: 0.0,
    qoffsetZ: 0.0,
    srowX: [1.0, 0.0, 0.0, 0.0],
    srowY: [0.0, 1.0, 0.0, 0.0],
    srowZ: [0.0, 0.0, 1.0, 0.0],
    description: "ModelScript NIfTI-1 Volume",
  };
}

export function parseNifti(input: string | Uint8Array | ArrayBuffer, sourceUri?: string): NiftiDocument {
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return parseNifti1Binary(bytes, sourceUri);
  }

  const trimmed = input.trim();
  const lineOffsets = buildLineOffsets(input);

  if (/^NRRD000/i.test(trimmed)) {
    return parseNrrdText(input, lineOffsets, sourceUri);
  }
  if (trimmed.startsWith("{")) {
    return parseNiftiJson(input, lineOffsets, sourceUri);
  }
  if (/^<(?:nifti_image|NiftiVolume|\?xml)/i.test(trimmed)) {
    return parseNiftiXml(input, lineOffsets, sourceUri);
  }
  return parseNiftiDsl(input, lineOffsets, sourceUri);
}

/**
 * Parses a 348-byte binary NIfTI-1 header and optional trailing voxel payload.
 */
export function parseNifti1Binary(bytes: Uint8Array, sourceUri?: string): NiftiDocument {
  if (bytes.byteLength < 348) {
    throw new Error(`Binary NIfTI-1 buffer is too short (${bytes.byteLength} bytes, minimum 348 bytes required).`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sizeofHdrLe = view.getInt32(0, true);
  const littleEndian = sizeofHdrLe === 348 || view.getInt32(0, false) !== 348;
  const sizeofHdr = view.getInt32(0, littleEndian);

  const dim: [number, number, number, number, number, number, number, number] = [
    view.getInt16(40, littleEndian),
    view.getInt16(42, littleEndian),
    view.getInt16(44, littleEndian),
    view.getInt16(46, littleEndian),
    view.getInt16(48, littleEndian),
    view.getInt16(50, littleEndian),
    view.getInt16(52, littleEndian),
    view.getInt16(54, littleEndian),
  ];

  const intentCode = view.getInt16(68, littleEndian);
  const datatypeCode = view.getInt16(70, littleEndian);
  const bitpix = view.getInt16(72, littleEndian);
  const dtInfo = CODE_TO_DATATYPE_NAME[datatypeCode];

  const pixdim: [number, number, number, number, number, number, number, number] = [
    view.getFloat32(76, littleEndian),
    view.getFloat32(80, littleEndian),
    view.getFloat32(84, littleEndian),
    view.getFloat32(88, littleEndian),
    view.getFloat32(92, littleEndian),
    view.getFloat32(96, littleEndian),
    view.getFloat32(100, littleEndian),
    view.getFloat32(104, littleEndian),
  ];

  const voxOffset = view.getFloat32(108, littleEndian);
  const sclSlope = view.getFloat32(112, littleEndian);
  const sclInter = view.getFloat32(116, littleEndian);

  const decoder = new TextDecoder("ascii");
  const description = decoder.decode(bytes.subarray(148, 228)).replace(/\0+$/, "").trim();

  const qformCode = view.getInt16(252, littleEndian);
  const sformCode = view.getInt16(254, littleEndian);
  const quaternB = view.getFloat32(256, littleEndian);
  const quaternC = view.getFloat32(260, littleEndian);
  const quaternD = view.getFloat32(264, littleEndian);
  const qoffsetX = view.getFloat32(268, littleEndian);
  const qoffsetY = view.getFloat32(272, littleEndian);
  const qoffsetZ = view.getFloat32(276, littleEndian);

  const srowX: [number, number, number, number] = [
    view.getFloat32(280, littleEndian),
    view.getFloat32(284, littleEndian),
    view.getFloat32(288, littleEndian),
    view.getFloat32(292, littleEndian),
  ];
  const srowY: [number, number, number, number] = [
    view.getFloat32(296, littleEndian),
    view.getFloat32(300, littleEndian),
    view.getFloat32(304, littleEndian),
    view.getFloat32(308, littleEndian),
  ];
  const srowZ: [number, number, number, number] = [
    view.getFloat32(312, littleEndian),
    view.getFloat32(316, littleEndian),
    view.getFloat32(320, littleEndian),
    view.getFloat32(324, littleEndian),
  ];

  const intentName = decoder.decode(bytes.subarray(328, 344)).replace(/\0+$/, "").trim();
  const magic = decoder.decode(bytes.subarray(344, 348)).replace(/\0+$/, "").trim() || "n+1";

  const voxels: number[] = [];
  let hasExplicitVoxelPayload = false;
  const dataStart = Math.max(348, Math.floor(voxOffset || 352));
  if (bytes.byteLength > dataStart) {
    hasExplicitVoxelPayload = true;
    const payloadBytes = bytes.byteLength - dataStart;
    if (datatypeCode === 2 || datatypeCode === 256) {
      for (let i = dataStart; i < bytes.byteLength; i++) {
        voxels.push(datatypeCode === 256 ? view.getInt8(i) : view.getUint8(i));
      }
    } else if (datatypeCode === 4 || datatypeCode === 512) {
      const count = Math.floor(payloadBytes / 2);
      for (let i = 0; i < count; i++) {
        const pos = dataStart + i * 2;
        voxels.push(datatypeCode === 4 ? view.getInt16(pos, littleEndian) : view.getUint16(pos, littleEndian));
      }
    } else if (datatypeCode === 8 || datatypeCode === 768) {
      const count = Math.floor(payloadBytes / 4);
      for (let i = 0; i < count; i++) {
        const pos = dataStart + i * 4;
        voxels.push(datatypeCode === 8 ? view.getInt32(pos, littleEndian) : view.getUint32(pos, littleEndian));
      }
    } else if (datatypeCode === 64) {
      const count = Math.floor(payloadBytes / 8);
      for (let i = 0; i < count; i++) {
        voxels.push(view.getFloat64(dataStart + i * 8, littleEndian));
      }
    } else {
      const count = Math.floor(payloadBytes / 4);
      for (let i = 0; i < count; i++) {
        voxels.push(view.getFloat32(dataStart + i * 4, littleEndian));
      }
    }
  }

  const range: NiftiSourceRange = {
    startOffset: 0,
    endOffset: bytes.byteLength,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: bytes.byteLength,
  };

  const doc: NiftiDocument = {
    format: "nifti1",
    title: description || "NIfTI1BinaryVolume",
    header: {
      sizeofHdr,
      magic,
      datatypeCode,
      datatypeName: dtInfo?.canonical ?? `UNKNOWN(${datatypeCode})`,
      bitpix: bitpix || (dtInfo?.bitpix ?? 32),
      dim,
      pixdim,
      voxOffset,
      sclSlope,
      sclInter,
      qformCode,
      sformCode,
      quaternB,
      quaternC,
      quaternD,
      qoffsetX,
      qoffsetY,
      qoffsetZ,
      srowX,
      srowY,
      srowZ,
      description,
      intentCode,
      intentName,
      isSegmentation: intentCode === 1002,
    },
    voxels,
    hasExplicitVoxelPayload,
    labels: [],
    rois: [],
    range,
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

/**
 * Serializes a NiftiDocument into a standard 348-byte NIfTI-1 binary buffer
 * (or 352 + voxel payload bytes when voxels are present).
 */
export function serializeNifti1Binary(doc: NiftiDocument): Uint8Array {
  const h = doc.header;
  const voxOffset = doc.voxels.length > 0 ? Math.max(352, Math.floor(h.voxOffset || 352)) : 348;
  const bytesPerVoxel =
    h.datatypeCode === 2 || h.datatypeCode === 256
      ? 1
      : h.datatypeCode === 4 || h.datatypeCode === 512
        ? 2
        : h.datatypeCode === 64
          ? 8
          : 4;
  const totalBytes = voxOffset + doc.voxels.length * bytesPerVoxel;

  const buf = new Uint8Array(totalBytes);
  const view = new DataView(buf.buffer);

  view.setInt32(0, 348, true);
  for (let i = 0; i < 8; i++) {
    view.setInt16(40 + i * 2, h.dim[i] ?? 1, true);
  }
  view.setInt16(68, h.intentCode ?? 0, true);
  view.setInt16(70, h.datatypeCode, true);
  view.setInt16(72, h.bitpix, true);
  for (let i = 0; i < 8; i++) {
    view.setFloat32(76 + i * 4, h.pixdim[i] ?? 1.0, true);
  }
  view.setFloat32(108, voxOffset, true);
  view.setFloat32(112, h.sclSlope, true);
  view.setFloat32(116, h.sclInter, true);

  const encoder = new TextEncoder();
  const descBytes = encoder.encode((h.description || "ModelScript NIfTI-1").slice(0, 79));
  buf.set(descBytes, 148);

  view.setInt16(252, h.qformCode, true);
  view.setInt16(254, h.sformCode, true);
  view.setFloat32(256, h.quaternB, true);
  view.setFloat32(260, h.quaternC, true);
  view.setFloat32(264, h.quaternD, true);
  view.setFloat32(268, h.qoffsetX, true);
  view.setFloat32(272, h.qoffsetY, true);
  view.setFloat32(276, h.qoffsetZ, true);

  for (let i = 0; i < 4; i++) {
    view.setFloat32(280 + i * 4, h.srowX[i] ?? 0, true);
    view.setFloat32(296 + i * 4, h.srowY[i] ?? 0, true);
    view.setFloat32(312 + i * 4, h.srowZ[i] ?? 0, true);
  }

  const magicBytes = encoder.encode((h.magic || "n+1").slice(0, 3));
  buf.set(magicBytes, 344);

  for (let i = 0; i < doc.voxels.length; i++) {
    const val = doc.voxels[i] ?? 0;
    const pos = voxOffset + i * bytesPerVoxel;
    if (bytesPerVoxel === 1) {
      view.setUint8(pos, val);
    } else if (bytesPerVoxel === 2) {
      view.setInt16(pos, val, true);
    } else if (bytesPerVoxel === 8) {
      view.setFloat64(pos, val, true);
    } else if (h.datatypeCode === 8) {
      view.setInt32(pos, val, true);
    } else {
      view.setFloat32(pos, val, true);
    }
  }

  return buf;
}

function parseNrrdText(content: string, lineOffsets: number[], sourceUri?: string): NiftiDocument {
  const header = createDefaultHeader();
  header.magic = "NRRD0004";
  const labels: NiftiAnatomyLabel[] = [];
  const rois: NiftiRegionOfInterest[] = [];
  let title = "NRRDMedicalVolume";

  const splitMatch = /\r?\n\r?\n/.exec(content);
  const headerText = splitMatch ? content.slice(0, splitMatch.index) : content;
  const dataText = splitMatch ? content.slice(splitMatch.index + splitMatch[0].length).trim() : "";

  const lines = headerText.split(/\r?\n/);
  let offset = 0;
  const segmentNames = new Map<number, { name: string; labelVal: number; range: NiftiSourceRange }>();

  for (const rawLine of lines) {
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const range = makeRange(lineOffsets, lineStart, lineEnd);

    if (/^NRRD000/i.test(line)) {
      header.magic = line;
      continue;
    }

    const kvMatch = /^([^:=]+)(?::=|:)\s*(.*)$/.exec(line);
    if (!kvMatch) continue;
    const key = (kvMatch[1] ?? "").trim().toLowerCase();
    const val = (kvMatch[2] ?? "").trim();

    if (key === "type") {
      const info = DATATYPE_NAME_TO_CODE[val.toLowerCase()];
      if (info) {
        header.datatypeCode = info.code;
        header.datatypeName = info.canonical;
        header.bitpix = info.bitpix;
      } else {
        header.datatypeCode = -1;
        header.datatypeName = val;
      }
    } else if (key === "dimension") {
      header.dim[0] = Number(val);
    } else if (key === "sizes") {
      const sz = val.split(/\s+/).map(Number);
      header.dim[1] = sz[0] ?? 1;
      header.dim[2] = sz[1] ?? 1;
      header.dim[3] = sz[2] ?? 1;
      header.dim[4] = sz[3] ?? 1;
    } else if (key === "spacings") {
      const sp = val.split(/\s+/).map(Number);
      header.pixdim[1] = sp[0] ?? 1.0;
      header.pixdim[2] = sp[1] ?? 1.0;
      header.pixdim[3] = sp[2] ?? 1.0;
      header.srowX = [header.pixdim[1], 0, 0, header.srowX[3]];
      header.srowY = [0, header.pixdim[2], 0, header.srowY[3]];
      header.srowZ = [0, 0, header.pixdim[3], header.srowZ[3]];
    } else if (key === "space directions") {
      const vecMatches = Array.from(val.matchAll(/\(([^)]+)\)/g));
      if (vecMatches.length >= 3) {
        const v0 = (vecMatches[0]?.[1] ?? "1,0,0").split(/[\s,]+/).map(Number);
        const v1 = (vecMatches[1]?.[1] ?? "0,1,0").split(/[\s,]+/).map(Number);
        const v2 = (vecMatches[2]?.[1] ?? "0,0,1").split(/[\s,]+/).map(Number);
        const dx = Math.hypot(v0[0] ?? 0, v0[1] ?? 0, v0[2] ?? 0);
        const dy = Math.hypot(v1[0] ?? 0, v1[1] ?? 0, v1[2] ?? 0);
        const dz = Math.hypot(v2[0] ?? 0, v2[1] ?? 0, v2[2] ?? 0);
        header.pixdim[1] = dx;
        header.pixdim[2] = dy;
        header.pixdim[3] = dz;
        header.srowX = [v0[0] ?? 0, v1[0] ?? 0, v2[0] ?? 0, header.srowX[3]];
        header.srowY = [v0[1] ?? 0, v1[1] ?? 0, v2[1] ?? 0, header.srowY[3]];
        header.srowZ = [v0[2] ?? 0, v1[2] ?? 0, v2[2] ?? 0, header.srowZ[3]];
        header.sformCode = 1;
      }
    } else if (key === "space origin") {
      const m = /\(([^)]+)\)/.exec(val);
      if (m?.[1]) {
        const orig = m[1].split(/[\s,]+/).map(Number);
        header.qoffsetX = orig[0] ?? 0;
        header.qoffsetY = orig[1] ?? 0;
        header.qoffsetZ = orig[2] ?? 0;
        header.srowX[3] = header.qoffsetX;
        header.srowY[3] = header.qoffsetY;
        header.srowZ[3] = header.qoffsetZ;
      }
    } else if (key === "content" || key === "title" || key === "description") {
      title = val;
      header.description = val;
    } else if (key === "scl_slope") {
      header.sclSlope = Number(val);
      header.scalingExplicitlyActive = true;
    } else if (key === "scl_inter") {
      header.sclInter = Number(val);
      header.scalingExplicitlyActive = true;
    } else if (key === "segmentation") {
      header.isSegmentation = val.toLowerCase() === "true" || val === "1";
    } else {
      const segNameMatch = /^segment(\d+)_name$/i.exec(key);
      if (segNameMatch) {
        const idx = Number(segNameMatch[1]);
        const existing = segmentNames.get(idx) ?? { name: val, labelVal: idx + 1, range };
        existing.name = val;
        segmentNames.set(idx, existing);
        header.isSegmentation = true;
      }
      const segValMatch = /^segment(\d+)_labelvalue$/i.exec(key);
      if (segValMatch) {
        const idx = Number(segValMatch[1]);
        const existing = segmentNames.get(idx) ?? { name: `Segment_${idx}`, labelVal: Number(val), range };
        existing.labelVal = Number(val);
        segmentNames.set(idx, existing);
        header.isSegmentation = true;
      }
    }
  }

  for (const seg of segmentNames.values()) {
    labels.push({
      id: seg.labelVal,
      name: seg.name,
      range: seg.range,
    });
  }

  const voxels: number[] = [];
  let hasExplicitVoxelPayload = false;
  if (dataText.length > 0) {
    hasExplicitVoxelPayload = true;
    for (const tok of dataText.split(/[\s,]+/)) {
      if (!tok) continue;
      const num = Number(tok);
      if (Number.isFinite(num)) voxels.push(num);
    }
  }

  const doc: NiftiDocument = {
    format: sourceUri?.endsWith(".nhdr") ? "nhdr" : "nrrd",
    title,
    header,
    voxels,
    hasExplicitVoxelPayload,
    labels,
    rois,
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

function parseNiftiJson(content: string, lineOffsets: number[], sourceUri?: string): NiftiDocument {
  const raw = JSON.parse(content) as Record<string, unknown>;
  const header = createDefaultHeader();

  if (typeof raw["sizeof_hdr"] === "number") header.sizeofHdr = raw["sizeof_hdr"];
  if (typeof raw["magic"] === "string") header.magic = raw["magic"];
  if (typeof raw["datatype"] === "number") {
    header.datatypeCode = raw["datatype"];
    header.datatypeName = CODE_TO_DATATYPE_NAME[header.datatypeCode]?.canonical ?? `UNKNOWN(${header.datatypeCode})`;
  } else if (typeof raw["datatype"] === "string") {
    const info = DATATYPE_NAME_TO_CODE[raw["datatype"].toLowerCase()];
    if (info) {
      header.datatypeCode = info.code;
      header.datatypeName = info.canonical;
      header.bitpix = info.bitpix;
    } else {
      header.datatypeCode = -1;
      header.datatypeName = raw["datatype"];
    }
  }

  if (Array.isArray(raw["dim"])) {
    for (let i = 0; i < 8 && i < raw["dim"].length; i++) {
      header.dim[i] = Number(raw["dim"][i]);
    }
  }
  if (Array.isArray(raw["pixdim"])) {
    for (let i = 0; i < 8 && i < raw["pixdim"].length; i++) {
      header.pixdim[i] = Number(raw["pixdim"][i]);
    }
  }
  if (typeof raw["qform_code"] === "number") header.qformCode = raw["qform_code"];
  if (typeof raw["sform_code"] === "number") header.sformCode = raw["sform_code"];
  if (typeof raw["quatern_b"] === "number") header.quaternB = raw["quatern_b"];
  if (typeof raw["quatern_c"] === "number") header.quaternC = raw["quatern_c"];
  if (typeof raw["quatern_d"] === "number") header.quaternD = raw["quatern_d"];
  if (typeof raw["qoffset_x"] === "number") header.qoffsetX = raw["qoffset_x"];
  if (typeof raw["qoffset_y"] === "number") header.qoffsetY = raw["qoffset_y"];
  if (typeof raw["qoffset_z"] === "number") header.qoffsetZ = raw["qoffset_z"];

  if (Array.isArray(raw["srow_x"]) && raw["srow_x"].length >= 4) {
    header.srowX = [
      Number(raw["srow_x"][0]),
      Number(raw["srow_x"][1]),
      Number(raw["srow_x"][2]),
      Number(raw["srow_x"][3]),
    ];
  }
  if (Array.isArray(raw["srow_y"]) && raw["srow_y"].length >= 4) {
    header.srowY = [
      Number(raw["srow_y"][0]),
      Number(raw["srow_y"][1]),
      Number(raw["srow_y"][2]),
      Number(raw["srow_y"][3]),
    ];
  }
  if (Array.isArray(raw["srow_z"]) && raw["srow_z"].length >= 4) {
    header.srowZ = [
      Number(raw["srow_z"][0]),
      Number(raw["srow_z"][1]),
      Number(raw["srow_z"][2]),
      Number(raw["srow_z"][3]),
    ];
  }

  if (typeof raw["scl_slope"] === "number") {
    header.sclSlope = raw["scl_slope"];
    header.scalingExplicitlyActive = true;
  }
  if (typeof raw["scl_inter"] === "number") {
    header.sclInter = raw["scl_inter"];
    header.scalingExplicitlyActive = true;
  }
  if (typeof raw["description"] === "string") header.description = raw["description"];
  if (typeof raw["isSegmentation"] === "boolean") header.isSegmentation = raw["isSegmentation"];

  const voxels = Array.isArray(raw["voxels"]) ? raw["voxels"].map(Number) : [];
  const hasExplicitVoxelPayload = Array.isArray(raw["voxels"]);

  const docRange = makeRange(lineOffsets, 0, content.length);
  const doc: NiftiDocument = {
    format: "json",
    title: typeof raw["title"] === "string" ? raw["title"] : header.description,
    header,
    voxels,
    hasExplicitVoxelPayload,
    labels: [],
    rois: [],
    range: docRange,
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

function parseNiftiXml(content: string, lineOffsets: number[], sourceUri?: string): NiftiDocument {
  const header = createDefaultHeader();
  const attrRe = /([A-Za-z0-9_:-]+)\s*=\s*"([^"]*)"/g;
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(content)) !== null) {
    if (m[1]) attrs[m[1]] = m[2] ?? "";
  }

  if (attrs["dim"]) {
    const d = attrs["dim"]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    for (let i = 0; i < 8 && i < d.length; i++) header.dim[i] = d[i]!;
  }
  if (attrs["pixdim"]) {
    const p = attrs["pixdim"]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    for (let i = 0; i < 8 && i < p.length; i++) header.pixdim[i] = p[i]!;
  }
  if (attrs["datatype"]) {
    const info = DATATYPE_NAME_TO_CODE[attrs["datatype"].toLowerCase()];
    if (info) {
      header.datatypeCode = info.code;
      header.datatypeName = info.canonical;
      header.bitpix = info.bitpix;
    } else {
      header.datatypeCode = Number(attrs["datatype"]) || -1;
      header.datatypeName = CODE_TO_DATATYPE_NAME[header.datatypeCode]?.canonical ?? attrs["datatype"];
    }
  }
  if (attrs["qform_code"]) header.qformCode = Number(attrs["qform_code"]);
  if (attrs["sform_code"]) header.sformCode = Number(attrs["sform_code"]);
  if (attrs["sto_xyz_matrix"]) {
    const vals = attrs["sto_xyz_matrix"]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vals.length >= 12) {
      header.srowX = [vals[0]!, vals[1]!, vals[2]!, vals[3]!];
      header.srowY = [vals[4]!, vals[5]!, vals[6]!, vals[7]!];
      header.srowZ = [vals[8]!, vals[9]!, vals[10]!, vals[11]!];
    }
  }

  const doc: NiftiDocument = {
    format: "xml",
    title: attrs["description"] ?? "NIfTIXmlVolume",
    header,
    voxels: [],
    hasExplicitVoxelPayload: false,
    labels: [],
    rois: [],
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}

function parseNiftiDsl(content: string, lineOffsets: number[], sourceUri?: string): NiftiDocument {
  const header = createDefaultHeader();
  const labels: NiftiAnatomyLabel[] = [];
  const rois: NiftiRegionOfInterest[] = [];
  const voxels: number[] = [];
  let hasExplicitVoxelPayload = false;
  let title = "NIfTIMedicalVolume";

  const parseKv = (line: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const re = /([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|\[([^\]]*)\]|([^\s"]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const k = m[1];
      const v = m[2] ?? m[3] ?? m[4] ?? "";
      if (k) out[k] = v.trim();
    }
    return out;
  };

  const lines = content.split(/\r?\n/);
  let offset = 0;

  for (const rawLine of lines) {
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const range = makeRange(lineOffsets, lineStart, lineEnd);
    const kv = parseKv(line);
    const tokens = line.split(/\s+/);
    const head = (tokens[0] ?? "").toUpperCase();

    if (head === "NIFTI" || head === "VOLUME") {
      if (kv["title"]) {
        title = kv["title"];
        header.description = title;
      }
      if (kv["segmentation"] === "true") {
        header.isSegmentation = true;
      }
      if (kv["datatype"]) {
        const dtStr = kv["datatype"];
        const byName = DATATYPE_NAME_TO_CODE[dtStr.toLowerCase()];
        if (byName) {
          header.datatypeCode = byName.code;
          header.datatypeName = byName.canonical;
          header.bitpix = byName.bitpix;
        } else {
          const code = Number(dtStr);
          header.datatypeCode = Number.isFinite(code) ? code : -1;
          header.datatypeName = CODE_TO_DATATYPE_NAME[header.datatypeCode]?.canonical ?? dtStr;
        }
      }
    } else if (head === "DIM") {
      if (kv["ndim"] !== undefined) header.dim[0] = Number(kv["ndim"]);
      if (kv["nx"] !== undefined) header.dim[1] = Number(kv["nx"]);
      if (kv["ny"] !== undefined) header.dim[2] = Number(kv["ny"]);
      if (kv["nz"] !== undefined) header.dim[3] = Number(kv["nz"]);
      if (kv["nt"] !== undefined) header.dim[4] = Number(kv["nt"]);
    } else if (head === "PIXDIM" || head === "SPACING") {
      if (kv["qfac"] !== undefined) header.pixdim[0] = Number(kv["qfac"]);
      if (kv["dx"] !== undefined) header.pixdim[1] = Number(kv["dx"]);
      if (kv["dy"] !== undefined) header.pixdim[2] = Number(kv["dy"]);
      if (kv["dz"] !== undefined) header.pixdim[3] = Number(kv["dz"]);
      if (kv["dt"] !== undefined) header.pixdim[4] = Number(kv["dt"]);
      header.srowX = [header.pixdim[1], 0, 0, header.qoffsetX];
      header.srowY = [0, header.pixdim[2], 0, header.qoffsetY];
      header.srowZ = [0, 0, header.pixdim[3], header.qoffsetZ];
    } else if (head === "QFORM") {
      header.qformCode = Number(kv["code"] ?? 1);
      if (kv["qfac"] !== undefined) header.pixdim[0] = Number(kv["qfac"]);
      if (kv["b"] !== undefined) header.quaternB = Number(kv["b"]);
      if (kv["c"] !== undefined) header.quaternC = Number(kv["c"]);
      if (kv["d"] !== undefined) header.quaternD = Number(kv["d"]);
      if (kv["ox"] !== undefined) header.qoffsetX = Number(kv["ox"]);
      if (kv["oy"] !== undefined) header.qoffsetY = Number(kv["oy"]);
      if (kv["oz"] !== undefined) header.qoffsetZ = Number(kv["oz"]);
    } else if (head === "SFORM") {
      header.sformCode = Number(kv["code"] ?? 1);
      if (kv["srow_x"]) {
        const r = kv["srow_x"].split(/[\s,]+/).map(Number);
        header.srowX = [r[0] ?? 1, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0];
      }
      if (kv["srow_y"]) {
        const r = kv["srow_y"].split(/[\s,]+/).map(Number);
        header.srowY = [r[0] ?? 0, r[1] ?? 1, r[2] ?? 0, r[3] ?? 0];
      }
      if (kv["srow_z"]) {
        const r = kv["srow_z"].split(/[\s,]+/).map(Number);
        header.srowZ = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 1, r[3] ?? 0];
      }
    } else if (head === "SCALING") {
      header.scalingExplicitlyActive = true;
      if (kv["slope"] !== undefined) header.sclSlope = Number(kv["slope"]);
      if (kv["inter"] !== undefined) header.sclInter = Number(kv["inter"]);
    } else if (head === "LABEL") {
      const id = Number(kv["id"] ?? tokens[1] ?? labels.length + 1);
      const name = kv["name"] ?? tokens[2]?.replace(/^"|"$/g, "") ?? `Label_${id}`;
      const labelEntry: NiftiAnatomyLabel = { id, name, range };
      if (kv["color"]) {
        const c = kv["color"].split(/[\s,]+/).map(Number);
        labelEntry.color = [c[0] ?? 255, c[1] ?? 0, c[2] ?? 0];
      }
      labels.push(labelEntry);
      header.isSegmentation = true;
    } else if (head === "ROI") {
      const id = kv["id"] ?? tokens[1] ?? `ROI_${rois.length + 1}`;
      const name = kv["name"] ?? id;
      const labelId = Number(kv["label"] ?? 1);
      const roi: NiftiRegionOfInterest = { id, name, labelId, range };
      if (kv["D"] !== undefined) roi.diffusionCoeffD = Number(kv["D"]);
      if (kv["clearance"] !== undefined) roi.clearanceRateK = Number(kv["clearance"]);
      if (kv["conc"] !== undefined) roi.initialConcentration = Number(kv["conc"]);
      rois.push(roi);
    } else if (head === "VOXELS") {
      hasExplicitVoxelPayload = true;
      const rawData = kv["values"] ?? line.slice("VOXELS".length).trim();
      for (const tok of rawData.split(/[\s,]+/)) {
        if (!tok || tok.includes("=")) continue;
        const num = Number(tok);
        if (Number.isFinite(num)) voxels.push(num);
      }
    }
  }

  const doc: NiftiDocument = {
    format: "dsl",
    title,
    header,
    voxels,
    hasExplicitVoxelPayload,
    labels,
    rois,
    range: makeRange(lineOffsets, 0, content.length),
  };
  if (sourceUri !== undefined) doc.sourceUri = sourceUri;
  return doc;
}
