// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BINARY_STL_MIN_BYTES,
  BINARY_STL_RECORD_BYTES,
  buildTetrahedronStl,
  buildUnitCubeStl,
  encodeBinaryStl,
  isBinaryStl,
  parseBinaryStl,
  parseStl,
} from "../src/index.js";

describe("@modelscript/stl — Binary STL Codec", () => {
  it("encodes and decodes a unit cube binary STL with exact byte layout (84 + 50 * N)", () => {
    const cube = buildUnitCubeStl(1.0, "unit_cube");
    const bytes = encodeBinaryStl(cube, "ModelScript Unit Cube Binary");

    assert.equal(bytes.byteLength, BINARY_STL_MIN_BYTES + 12 * BINARY_STL_RECORD_BYTES);
    assert.equal(isBinaryStl(bytes), true);

    const decoded = parseStl(bytes);
    assert.equal(decoded.format, "binary");
    assert.equal(decoded.errors.length, 0);
    assert.equal(decoded.header, "ModelScript Unit Cube Binary");
    assert.equal(decoded.facets.length, 12);
    assert.equal(decoded.declaredFacetCount, 12);
  });

  it("handles binary STL whose 80-byte header begins with 'solid '", () => {
    const tet = buildTetrahedronStl(1.0, "tet");
    const bytes = encodeBinaryStl(tet);
    // Manually overwrite first 6 bytes with "solid "
    const prefix = new TextEncoder().encode("solid ");
    bytes.set(prefix, 0);

    assert.equal(isBinaryStl(bytes), true);
    const decoded = parseStl(bytes);
    assert.equal(decoded.format, "binary");
    assert.equal(decoded.facets.length, 4);
    assert.equal(decoded.errors.length, 0);
  });

  it("preserves uint16 attributeByteCount per facet", () => {
    const tet = buildTetrahedronStl(1.0, "attr_tet");
    tet.facets[0]!.attributeByteCount = 0x7c00;
    const bytes = encodeBinaryStl(tet);
    const decoded = parseBinaryStl(bytes);
    assert.equal(decoded.facets[0]?.attributeByteCount, 0x7c00);
  });

  it("detects truncated binary STL buffers with STL1001 error", () => {
    const cube = buildUnitCubeStl(1.0);
    const bytes = encodeBinaryStl(cube);
    const truncated = bytes.subarray(0, bytes.byteLength - 25);

    const decoded = parseBinaryStl(truncated);
    assert.ok(decoded.errors.length > 0);
    assert.equal(decoded.errors[0]?.code, "STL1001");
    assert.equal(decoded.facets.length, 11);
  });
});
