// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InSituTelemetrySlice } from "./hpc-types.js";

export const IN_SITU_MAGIC = 0x534c4943; // 'SLIC'
export const IN_SITU_VERSION = 1;
export const FIELD_NAME_BYTES = 32;

/**
 * Binary In-Situ Planar Slice Codec.
 * Serializes 2D cut-planes extracted from 3D CFD meshes into compact binary chunks
 * for real-time telemetry streaming over WebSockets, Arrow Flight, or IPC.
 */
export class InSituSliceCodec {
  public static serialize(slice: InSituTelemetrySlice): ArrayBuffer {
    const fieldNames = Object.keys(slice.fields);
    const numFields = fieldNames.length;
    const numVerts = slice.numVertices;
    const numTris = slice.numTriangles;

    // Header size: 64 bytes
    // [0..3]:   Magic 0x534C4943
    // [4..7]:   Version 1
    // [8..11]:  Step (u32)
    // [12..19]: Time (f64)
    // [20..31]: Origin [x, y, z] (3 * f32)
    // [32..43]: Normal [nx, ny, nz] (3 * f32)
    // [44..47]: NumVertices (u32)
    // [48..51]: NumTriangles (u32)
    // [52..55]: NumFields (u32)
    // [56..63]: Reserved (u64)
    const headerBytes = 64;

    const posBytes = numVerts * 3 * 4;
    const idxBytes = numTris * 3 * 4;
    const fieldsDescriptorBytes = numFields * (FIELD_NAME_BYTES + numVerts * 4);

    const totalBytes = headerBytes + posBytes + idxBytes + fieldsDescriptorBytes;
    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);

    view.setUint32(0, IN_SITU_MAGIC, true);
    view.setUint32(4, IN_SITU_VERSION, true);
    view.setUint32(8, slice.step, true);
    view.setFloat64(12, slice.time, true);

    view.setFloat32(20, slice.origin[0], true);
    view.setFloat32(24, slice.origin[1], true);
    view.setFloat32(28, slice.origin[2], true);

    view.setFloat32(32, slice.normal[0], true);
    view.setFloat32(36, slice.normal[1], true);
    view.setFloat32(40, slice.normal[2], true);

    view.setUint32(44, numVerts, true);
    view.setUint32(48, numTris, true);
    view.setUint32(52, numFields, true);

    let offset = headerBytes;

    // 1. Positions
    new Uint8Array(buffer, offset, posBytes).set(
      new Uint8Array(slice.positions.buffer, slice.positions.byteOffset, posBytes),
    );
    offset += posBytes;

    // 2. Indices
    new Uint8Array(buffer, offset, idxBytes).set(
      new Uint8Array(slice.indices.buffer, slice.indices.byteOffset, idxBytes),
    );
    offset += idxBytes;

    // 3. Fields
    const encoder = new TextEncoder();
    for (const fName of fieldNames) {
      // Write field name (padded to 32 bytes)
      const nameBytes = encoder.encode(fName.slice(0, 31));
      const targetNameBuf = new Uint8Array(buffer, offset, FIELD_NAME_BYTES);
      targetNameBuf.fill(0);
      targetNameBuf.set(nameBytes);
      offset += FIELD_NAME_BYTES;

      // Write field data
      const fieldData = slice.fields[fName]!;
      const dataBytes = numVerts * 4;
      new Uint8Array(buffer, offset, dataBytes).set(new Uint8Array(fieldData.buffer, fieldData.byteOffset, dataBytes));
      offset += dataBytes;
    }

    return buffer;
  }

  public static deserialize(buffer: ArrayBuffer): InSituTelemetrySlice {
    const view = new DataView(buffer);
    const magic = view.getUint32(0, true);
    if (magic !== IN_SITU_MAGIC) {
      throw new Error(`Invalid In-Situ telemetry magic: 0x${magic.toString(16)} (expected 0x534c4943)`);
    }

    const step = view.getUint32(8, true);
    const time = view.getFloat64(12, true);

    const origin: [number, number, number] = [
      view.getFloat32(20, true),
      view.getFloat32(24, true),
      view.getFloat32(28, true),
    ];

    const normal: [number, number, number] = [
      view.getFloat32(32, true),
      view.getFloat32(36, true),
      view.getFloat32(40, true),
    ];

    const numVerts = view.getUint32(44, true);
    const numTris = view.getUint32(48, true);
    const numFields = view.getUint32(52, true);

    const headerBytes = 64;
    let offset = headerBytes;

    const posBytes = numVerts * 3 * 4;
    const positions = new Float32Array(buffer.slice(offset, offset + posBytes));
    offset += posBytes;

    const idxBytes = numTris * 3 * 4;
    const indices = new Uint32Array(buffer.slice(offset, offset + idxBytes));
    offset += idxBytes;

    const decoder = new TextDecoder();
    const fields: Record<string, Float32Array> = {};

    for (let f = 0; f < numFields; f++) {
      const nameRaw = new Uint8Array(buffer, offset, FIELD_NAME_BYTES);
      const nullIdx = nameRaw.indexOf(0);
      const nameEnd = nullIdx === -1 ? FIELD_NAME_BYTES : nullIdx;
      const fName = decoder.decode(nameRaw.subarray(0, nameEnd));
      offset += FIELD_NAME_BYTES;

      const dataBytes = numVerts * 4;
      fields[fName] = new Float32Array(buffer.slice(offset, offset + dataBytes));
      offset += dataBytes;
    }

    return {
      planeId: `plane_${origin.join("_")}`,
      step,
      time,
      origin,
      normal,
      numVertices: numVerts,
      numTriangles: numTris,
      positions,
      indices,
      fields,
    };
  }

  /**
   * Synthesizes a planar cut-mesh for testing and real-time visualization.
   */
  public static synthesizeSlice(
    origin: [number, number, number],
    normal: [number, number, number],
    size: [number, number],
    resolution: [number, number],
    time: number,
    step: number,
  ): InSituTelemetrySlice {
    const [nx, ny] = resolution;
    const [w, h] = size;
    const numVerts = nx * ny;
    const numTris = (nx - 1) * (ny - 1) * 2;

    const positions = new Float32Array(numVerts * 3);
    const indices = new Uint32Array(numTris * 3);
    const velocityMag = new Float32Array(numVerts);
    const pressure = new Float32Array(numVerts);

    let vi = 0;
    for (let iy = 0; iy < ny; iy++) {
      const yFrac = iy / (ny - 1) - 0.5;
      const yPos = origin[1] + yFrac * h;
      for (let ix = 0; ix < nx; ix++) {
        const xFrac = ix / (nx - 1) - 0.5;
        const xPos = origin[0] + xFrac * w;
        const zPos = origin[2];

        positions[vi * 3 + 0] = xPos;
        positions[vi * 3 + 1] = yPos;
        positions[vi * 3 + 2] = zPos;

        // Synthetic flow profile (Poiseuille + wave)
        const rNorm = Math.hypot(xFrac, yFrac) * 2.0;
        const uProfile = Math.max(0, 1.0 - rNorm * rNorm) * 15.0;
        const pWave = 101325.0 + Math.sin(xPos * 10 + time * 5) * 250.0;

        velocityMag[vi] = uProfile;
        pressure[vi] = pWave;
        vi++;
      }
    }

    let ti = 0;
    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const v0 = iy * nx + ix;
        const v1 = v0 + 1;
        const v2 = (iy + 1) * nx + ix;
        const v3 = v2 + 1;

        indices[ti++] = v0;
        indices[ti++] = v1;
        indices[ti++] = v2;

        indices[ti++] = v1;
        indices[ti++] = v3;
        indices[ti++] = v2;
      }
    }

    return {
      planeId: `slice_${origin.join("_")}`,
      step,
      time,
      origin,
      normal,
      numVertices: numVerts,
      numTriangles: numTris,
      positions,
      indices,
      fields: {
        velocityMagnitude: velocityMag,
        pressure,
      },
    };
  }
}
