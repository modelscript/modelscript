// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — OpenUSD (Universal Scene Description) & USDZ Compiler.
 *
 * Compiles {@link Solid} CSG geometry trees, watertight {@link ManifoldSurfaceMesh} meshes,
 * and multi-part {@link Assembly} hierarchies directly into:
 *  1. ASCII OpenUSD scenes (.usda) compliant with the Alliance for OpenUSD (AOUSD) specification.
 *  2. Standalone, zero-dependency, 64-byte aligned uncompressed USDZ packages (.usdz)
 *     for Apple Vision Pro / iOS AR Quick Look, NVIDIA Omniverse, and WebGL/WebXR viewers.
 */

import { ManifoldWorker } from "./manifold-worker.js";
import type { Assembly, Mat4, Solid } from "./types.js";
import { SolidKind } from "./types.js";

// ── Public Types & Interfaces ────────────────────────────────────────────────

export interface UsdExportOptions {
  /** Name of the stage / default prim (default: "Root"). */
  stageName?: string | undefined;
  /** Coordinate up-axis: "Z" (engineering standard) or "Y" (graphics standard). Default: "Z". */
  upAxis?: "Y" | "Z" | undefined;
  /** Linear unit in meters. Default: 1.0 (meters). For millimeters, use 0.001. */
  metersPerUnit?: number | undefined;
  /** Authoring tool metadata string. Default: "ModelScript OpenUSD Compiler". */
  authoringTool?: string | undefined;
  /** Frames per second for time-sampled animations. Default: 60. */
  timeCodesPerSecond?: number | undefined;
  /** Start timecode for animation timeline. Default: 0. */
  startTimeCode?: number | undefined;
  /** End timecode for animation timeline. Default: 0. */
  endTimeCode?: number | undefined;
  /** Whether to serialize outward vertex normals. Default: true. */
  includeNormals?: boolean | undefined;
  /** Whether to serialize diffuse display colors. Default: true. */
  includeColors?: boolean | undefined;
}

// ── Number & Token Formatting Helpers ────────────────────────────────────────

function fmt(n: number): string {
  if (Object.is(n, -0)) return "0.0";
  if (Number.isInteger(n)) return `${n}.0`;
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s.includes(".") ? s : `${s}.0`;
}

export function sanitizeUsdIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `prim_${cleaned}`;
  }
  return cleaned;
}

// ── CRC-32 & 64-Byte Aligned USDZ ZIP Archiver ───────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

/** Computes IEEE 802.3 32-bit Cyclic Redundancy Check. */
export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates an uncompressed, 64-byte aligned ZIP archive conforming to the
 * Alliance for OpenUSD (AOUSD) USDZ package specification.
 *
 * Each file payload starts at a 64-byte boundary relative to the beginning
 * of the zip archive, enabling direct memory-mapping (`mmap`) on Apple Vision Pro,
 * iOS AR Quick Look, and NVIDIA Omniverse runtimes.
 */
export function createUsdzArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: {
    fileName: string;
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    crc32: number;
    padLength: number;
    localHeaderOffset: number;
  }[] = [];

  let currentOffset = 0;

  // First pass: compute offsets, 64-byte payload padding, and CRC32
  for (const [fileName, content] of Object.entries(files)) {
    const dataBytes = typeof content === "string" ? encoder.encode(content) : content;
    const nameBytes = encoder.encode(fileName);
    const crc = computeCrc32(dataBytes);

    // Fixed LFH header = 30 bytes.
    const unpaddedDataOffset = currentOffset + 30 + nameBytes.length;
    const remainder = unpaddedDataOffset % 64;
    const padLength = remainder === 0 ? 0 : 64 - remainder;
    const localHeaderOffset = currentOffset;

    entries.push({
      fileName,
      nameBytes,
      dataBytes,
      crc32: crc,
      padLength,
      localHeaderOffset,
    });

    currentOffset += 30 + nameBytes.length + padLength + dataBytes.length;
  }

  const cdOffset = currentOffset;
  let cdSize = 0;

  for (const entry of entries) {
    cdSize += 46 + entry.nameBytes.length;
  }

  const eocdSize = 22;
  const totalArchiveSize = cdOffset + cdSize + eocdSize;
  const buffer = new Uint8Array(totalArchiveSize);
  const view = new DataView(buffer.buffer);

  let writePos = 0;

  // 1. Write Local File Headers and 64-byte aligned payloads
  for (const entry of entries) {
    // Signature
    view.setUint32(writePos, 0x04034b50, true);
    view.setUint16(writePos + 4, 20, true); // Version needed (2.0)
    view.setUint16(writePos + 6, 0, true); // General purpose flags
    view.setUint16(writePos + 8, 0, true); // Compression = STORE (0)
    view.setUint16(writePos + 10, 0, true); // DOS time
    view.setUint16(writePos + 12, 0x5421, true); // DOS date (2022-01-01)
    view.setUint32(writePos + 14, entry.crc32, true);
    view.setUint32(writePos + 18, entry.dataBytes.length, true); // Compressed size
    view.setUint32(writePos + 22, entry.dataBytes.length, true); // Uncompressed size
    view.setUint16(writePos + 26, entry.nameBytes.length, true);
    view.setUint16(writePos + 28, entry.padLength, true); // Extra field holds alignment padding

    writePos += 30;
    buffer.set(entry.nameBytes, writePos);
    writePos += entry.nameBytes.length;

    // Fill padding with zeroes
    if (entry.padLength > 0) {
      buffer.fill(0, writePos, writePos + entry.padLength);
      writePos += entry.padLength;
    }

    // Assert 64-byte alignment
    if (writePos % 64 !== 0) {
      throw new Error(
        `Internal USDZ alignment error: data for '${entry.fileName}' starts at unaligned offset ${writePos}`,
      );
    }

    buffer.set(entry.dataBytes, writePos);
    writePos += entry.dataBytes.length;
  }

  // 2. Write Central Directory
  for (const entry of entries) {
    view.setUint32(writePos, 0x02014b50, true);
    view.setUint16(writePos + 4, 20, true); // Version made by
    view.setUint16(writePos + 6, 20, true); // Version needed
    view.setUint16(writePos + 8, 0, true); // Flags
    view.setUint16(writePos + 10, 0, true); // Compression = STORE
    view.setUint16(writePos + 12, 0, true); // DOS time
    view.setUint16(writePos + 14, 0x5421, true); // DOS date
    view.setUint32(writePos + 16, entry.crc32, true);
    view.setUint32(writePos + 20, entry.dataBytes.length, true);
    view.setUint32(writePos + 24, entry.dataBytes.length, true);
    view.setUint16(writePos + 28, entry.nameBytes.length, true);
    view.setUint16(writePos + 30, 0, true); // Extra field length
    view.setUint16(writePos + 32, 0, true); // Comment length
    view.setUint16(writePos + 34, 0, true); // Disk start
    view.setUint16(writePos + 36, 0, true); // Internal attributes
    view.setUint32(writePos + 38, 0, true); // External attributes
    view.setUint32(writePos + 42, entry.localHeaderOffset, true);

    writePos += 46;
    buffer.set(entry.nameBytes, writePos);
    writePos += entry.nameBytes.length;
  }

  // 3. Write End of Central Directory (EOCD)
  view.setUint32(writePos, 0x06054b50, true);
  view.setUint16(writePos + 4, 0, true); // Disk number
  view.setUint16(writePos + 6, 0, true); // CD start disk
  view.setUint16(writePos + 8, entries.length, true); // Total entries this disk
  view.setUint16(writePos + 10, entries.length, true); // Total entries
  view.setUint32(writePos + 12, cdSize, true); // CD size
  view.setUint32(writePos + 16, cdOffset, true); // CD offset
  view.setUint16(writePos + 20, 0, true); // Comment length

  return buffer;
}

// ── OpenUSD USDA Serializers ─────────────────────────────────────────────────

/**
 * Serializes a triangulated vertex/index buffer into an OpenUSD `UsdGeomMesh` prim block.
 */
export function formatUsdGeomMesh(
  meshName: string,
  vertices: Float32Array | number[],
  indices: Uint32Array | number[],
  normals?: Float32Array | number[] | undefined,
  color?: [number, number, number] | [number, number, number, number] | undefined,
  indent = "    ",
): string {
  const safeName = sanitizeUsdIdentifier(meshName);
  const numTriangles = Math.floor(indices.length / 3);
  const lines: string[] = [];

  lines.push(`${indent}def Mesh "${safeName}"`);
  lines.push(`${indent}{`);

  // 1. Face vertex counts (all 3 for triangulated meshes)
  const faceCounts = new Array(numTriangles).fill(3).join(", ");
  lines.push(`${indent}    int[] faceVertexCounts = [${faceCounts}]`);

  // 2. Face vertex indices
  const indexChunks: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    indexChunks.push(`${indices[i]}, ${indices[i + 1]}, ${indices[i + 2]}`);
  }
  lines.push(`${indent}    int[] faceVertexIndices = [${indexChunks.join(", ")}]`);

  // 3. Vertex positions (points)
  const pointChunks: string[] = [];
  const numVertices = Math.floor(vertices.length / 3);
  for (let i = 0; i < numVertices; i++) {
    const x = vertices[i * 3] ?? 0;
    const y = vertices[i * 3 + 1] ?? 0;
    const z = vertices[i * 3 + 2] ?? 0;
    pointChunks.push(`(${fmt(x)}, ${fmt(y)}, ${fmt(z)})`);
  }
  lines.push(`${indent}    point3f[] points = [${pointChunks.join(", ")}]`);

  // 4. Vertex outward unit normals
  if (normals && normals.length >= vertices.length) {
    const normalChunks: string[] = [];
    for (let i = 0; i < numVertices; i++) {
      const nx = normals[i * 3] ?? 0;
      const ny = normals[i * 3 + 1] ?? 0;
      const nz = normals[i * 3 + 2] ?? 0;
      normalChunks.push(`(${fmt(nx)}, ${fmt(ny)}, ${fmt(nz)})`);
    }
    lines.push(`${indent}    normal3f[] normals = [${normalChunks.join(", ")}] (`);
    lines.push(`${indent}        interpolation = "vertex"`);
    lines.push(`${indent}    )`);
  }

  // 5. Subdivision scheme = "none" (rigid polygon boundary representation)
  lines.push(`${indent}    uniform token subdivisionScheme = "none"`);

  // 6. Diffuse display color
  if (color) {
    const r = color[0] ?? 0.8;
    const g = color[1] ?? 0.8;
    const b = color[2] ?? 0.8;
    lines.push(`${indent}    color3f[] primvars:displayColor = [(${fmt(r)}, ${fmt(g)}, ${fmt(b)})]`);
  }

  lines.push(`${indent}}`);
  return lines.join("\n");
}

/**
 * Compiles a 4×4 affine transformation matrix into an OpenUSD `xformOp:transform` matrix.
 * Note: ModelScript `Mat4` is column-major; OpenUSD `matrix4d` expects row tuples `(row0, row1, row2, row3)`.
 */
export function formatUsdMatrix4d(m: Mat4, indent = "    "): string {
  // m is column-major:
  // col 0: m[0], m[1], m[2], m[3]
  // col 1: m[4], m[5], m[6], m[7]
  // col 2: m[8], m[9], m[10], m[11]
  // col 3: m[12], m[13], m[14], m[15]
  const r0 = `(${fmt(m[0])}, ${fmt(m[1])}, ${fmt(m[2])}, ${fmt(m[3])})`;
  const r1 = `(${fmt(m[4])}, ${fmt(m[5])}, ${fmt(m[6])}, ${fmt(m[7])})`;
  const r2 = `(${fmt(m[8])}, ${fmt(m[9])}, ${fmt(m[10])}, ${fmt(m[11])})`;
  const r3 = `(${fmt(m[12])}, ${fmt(m[13])}, ${fmt(m[14])}, ${fmt(m[15])})`;

  return [
    `${indent}matrix4d xformOp:transform = ( ${r0}, ${r1}, ${r2}, ${r3} )`,
    `${indent}uniform token[] xformOpOrder = ["xformOp:transform"]`,
  ].join("\n");
}

/**
 * Compiles a single {@link Solid} CSG tree into a complete OpenUSD (.usda) scene.
 */
export function compileToUsd(solid: Solid, options?: UsdExportOptions): string {
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? "Model");
  const upAxis = options?.upAxis ?? "Z";
  const metersPerUnit = options?.metersPerUnit ?? 1.0;
  const authoringTool = options?.authoringTool ?? "ModelScript OpenUSD Compiler";

  // Synthesize watertight manifold triangular mesh
  const mesh = ManifoldWorker.evaluateSolid(solid);

  const lines: string[] = [
    `#usda 1.0`,
    `(`,
    `    defaultPrim = "${stageName}"`,
    `    metersPerUnit = ${metersPerUnit}`,
    `    upAxis = "${upAxis}"`,
    `    customLayerData = {`,
    `        string creator = "${authoringTool}"`,
    `    }`,
    `)`,
    ``,
    `def Xform "${stageName}" (`,
    `    kind = "component"`,
    `)`,
    `{`,
    formatUsdGeomMesh(
      "geometry",
      mesh.vertices,
      mesh.indices,
      options?.includeNormals !== false ? mesh.normals : undefined,
      options?.includeColors !== false && mesh.sourceMetadata?.color
        ? [mesh.sourceMetadata.color[0], mesh.sourceMetadata.color[1], mesh.sourceMetadata.color[2]]
        : undefined,
      "    ",
    ),
    `}`,
    ``,
  ];

  return lines.join("\n");
}

/**
 * Compiles a multi-component {@link Assembly} into an OpenUSD (.usda) assembly scene.
 */
export function compileAssemblyToUsd(assembly: Assembly, options?: UsdExportOptions): string {
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? "Assembly");
  const upAxis = options?.upAxis ?? "Z";
  const metersPerUnit = options?.metersPerUnit ?? 1.0;
  const authoringTool = options?.authoringTool ?? "ModelScript OpenUSD Compiler";

  const lines: string[] = [
    `#usda 1.0`,
    `(`,
    `    defaultPrim = "${stageName}"`,
    `    metersPerUnit = ${metersPerUnit}`,
    `    upAxis = "${upAxis}"`,
    `    customLayerData = {`,
    `        string creator = "${authoringTool}"`,
    `    }`,
    `)`,
    ``,
    `def Xform "${stageName}" (`,
    `    kind = "assembly"`,
    `)`,
    `{`,
  ];

  for (let i = 0; i < assembly.parts.length; i++) {
    const partEntry = assembly.parts[i]!;
    let solidToMesh = partEntry.solid;
    let transformMatrix: Mat4 | undefined = undefined;

    if (partEntry.solid.kind === SolidKind.Transform) {
      transformMatrix = partEntry.solid.matrix;
      solidToMesh = partEntry.solid.child;
    }

    const rawName =
      solidToMesh.name ||
      partEntry.solid.name ||
      (partEntry.solid.sourceMetadata as { name?: string } | undefined)?.name ||
      `part_${i + 1}`;
    const partName = sanitizeUsdIdentifier(rawName);
    const mesh = ManifoldWorker.evaluateSolid(solidToMesh);

    lines.push(`    def Xform "${partName}" (`);
    lines.push(`        kind = "component"`);
    lines.push(`    )`);
    lines.push(`    {`);

    // Affine transform
    if (transformMatrix) {
      lines.push(formatUsdMatrix4d(transformMatrix, "        "));
    }

    // Geometry mesh
    const partColor = partEntry.color ?? mesh.sourceMetadata?.color;
    lines.push(
      formatUsdGeomMesh(
        "mesh",
        mesh.vertices,
        mesh.indices,
        options?.includeNormals !== false ? mesh.normals : undefined,
        options?.includeColors !== false && partColor ? [partColor[0], partColor[1], partColor[2]] : undefined,
        "        ",
      ),
    );

    lines.push(`    }`);
    lines.push(``);
  }

  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Compiles a single {@link Solid} into a 64-byte aligned OpenUSD package (.usdz).
 */
export function compileToUsdz(solid: Solid, options?: UsdExportOptions): Uint8Array {
  const usdaText = compileToUsd(solid, options);
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? "model");
  return createUsdzArchive({
    [`${stageName}.usda`]: usdaText,
  });
}

/**
 * Compiles an {@link Assembly} into a 64-byte aligned OpenUSD package (.usdz).
 */
export function compileAssemblyToUsdz(assembly: Assembly, options?: UsdExportOptions): Uint8Array {
  const usdaText = compileAssemblyToUsd(assembly, options);
  const stageName = sanitizeUsdIdentifier(options?.stageName ?? "assembly");
  return createUsdzArchive({
    [`${stageName}.usda`]: usdaText,
  });
}
