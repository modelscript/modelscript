// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Polyglot Projections (ASCII STL, Binary STL, STEP AP203/AP242, OpenUSD USDA).
 */

import { compileAssemblyToStep, compileAssemblyToUsd, compileToStep, compileToUsd } from "@modelscript/cad";
import { lowerObjToCad, type ObjCadLoweringOptions } from "../cad/index.js";
import { triangulateObjMesh } from "../solver/index.js";
import type { ObjDocument } from "../types.js";

export interface ObjStlOptions {
  /** Solid name embedded in ASCII STL or binary header. */
  name?: string | undefined;
  /** Optional uniform coordinate scale factor. Default: 1.0. */
  scale?: number | undefined;
}

export interface ObjStepOptions extends ObjCadLoweringOptions {
  /** Author metadata string. */
  author?: string | undefined;
}

export interface ObjUsdOptions extends ObjCadLoweringOptions {
  /** Meters per unit metadata in USDA. Default: 1.0. */
  metersPerUnit?: number | undefined;
}

/**
 * Project a Wavefront `ObjDocument` to ASCII STL text.
 */
export function objToAsciiStl(doc: ObjDocument, options?: ObjStlOptions): string {
  const name = (options?.name ?? doc.objects[0]?.name ?? "obj_mesh").replace(/\s+/g, "_");
  const scale = options?.scale ?? 1.0;
  const tris = triangulateObjMesh(doc);

  const lines: string[] = [`solid ${name}`];
  for (const tri of tris) {
    const [nx, ny, nz] = tri.faceNormal;
    const [i0, i1, i2] = tri.indices;
    const p0 = doc.vertices[i0]!;
    const p1 = doc.vertices[i1]!;
    const p2 = doc.vertices[i2]!;

    lines.push(`  facet normal ${nx.toExponential(6)} ${ny.toExponential(6)} ${nz.toExponential(6)}`);
    lines.push(`    outer loop`);
    lines.push(
      `      vertex ${(p0.x * scale).toExponential(6)} ${(p0.y * scale).toExponential(6)} ${(p0.z * scale).toExponential(6)}`,
    );
    lines.push(
      `      vertex ${(p1.x * scale).toExponential(6)} ${(p1.y * scale).toExponential(6)} ${(p1.z * scale).toExponential(6)}`,
    );
    lines.push(
      `      vertex ${(p2.x * scale).toExponential(6)} ${(p2.y * scale).toExponential(6)} ${(p2.z * scale).toExponential(6)}`,
    );
    lines.push(`    endloop`);
    lines.push(`  endfacet`);
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n") + "\n";
}

/**
 * Project a Wavefront `ObjDocument` to IEEE 754 little-endian Binary STL (`Uint8Array`).
 *
 * Format:
 *   - 80-byte ASCII header
 *   - 4-byte uint32 triangle count
 *   - 50 bytes per triangle: 3x float32 normal, 9x float32 vertices, 2-byte uint16 attribute byte count
 */
export function objToBinaryStl(doc: ObjDocument, options?: ObjStlOptions): Uint8Array {
  const name = options?.name ?? doc.objects[0]?.name ?? "ModelScript OBJ Binary STL";
  const scale = options?.scale ?? 1.0;
  const tris = triangulateObjMesh(doc);

  const totalBytes = 84 + tris.length * 50;
  const buffer = new ArrayBuffer(totalBytes);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Write 80-byte header
  const headerText = `ModelScript @modelscript/obj: ${name}`.slice(0, 79);
  for (let i = 0; i < headerText.length; i++) {
    bytes[i] = headerText.charCodeAt(i) & 0x7f;
  }

  // Write triangle count
  view.setUint32(80, tris.length, true);

  let offset = 84;
  for (const tri of tris) {
    const [nx, ny, nz] = tri.faceNormal;
    const [i0, i1, i2] = tri.indices;
    const p0 = doc.vertices[i0]!;
    const p1 = doc.vertices[i1]!;
    const p2 = doc.vertices[i2]!;

    view.setFloat32(offset, nx, true);
    view.setFloat32(offset + 4, ny, true);
    view.setFloat32(offset + 8, nz, true);

    view.setFloat32(offset + 12, p0.x * scale, true);
    view.setFloat32(offset + 16, p0.y * scale, true);
    view.setFloat32(offset + 20, p0.z * scale, true);

    view.setFloat32(offset + 24, p1.x * scale, true);
    view.setFloat32(offset + 28, p1.y * scale, true);
    view.setFloat32(offset + 32, p1.z * scale, true);

    view.setFloat32(offset + 36, p2.x * scale, true);
    view.setFloat32(offset + 40, p2.y * scale, true);
    view.setFloat32(offset + 44, p2.z * scale, true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return bytes;
}

/**
 * Project a Wavefront `ObjDocument` to ISO 10303-21 STEP via `@modelscript/cad`.
 */
export function objToStep(doc: ObjDocument, options?: ObjStepOptions): string {
  const lowered = lowerObjToCad(doc, options);
  if (lowered.solids.length > 1) {
    return compileAssemblyToStep(lowered.assembly);
  }
  return compileToStep(lowered.solid, lowered.solid.name);
}

/**
 * Project a Wavefront `ObjDocument` to OpenUSD ASCII (`.usda`) via `@modelscript/cad`.
 */
export function objToUsd(doc: ObjDocument, options?: ObjUsdOptions): string {
  const lowered = lowerObjToCad(doc, options);
  if (lowered.solids.length > 1) {
    return compileAssemblyToUsd(lowered.assembly, {
      metersPerUnit: options?.metersPerUnit ?? 1.0,
    });
  }
  return compileToUsd(lowered.solid, {
    metersPerUnit: options?.metersPerUnit ?? 1.0,
  });
}
