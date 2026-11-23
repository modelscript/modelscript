// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintHdf4, lintHdf4Binary } from "../src/lints/index.js";
import { parseHdf4Ddl } from "../src/parser/ddl-parser.js";

describe("HDF4 linter diagnostics (HDF1001–HDF5006)", () => {
  it("reports no errors on a clean HDF4 document", () => {
    const doc = parseHdf4Ddl(`
      HDF4 CleanDoc
        SDS Albedo TYPE=FLOAT32 REF=10 UNIT="1"
          DIM y = 2
          DIM x = 2
          DATA [0.1, 0.2, 0.3, 0.4]
        END
        VGROUP Swath REF=20
          MEMBER SDS Albedo
        END
      END
    `);
    const diags = lintHdf4(doc);
    assert.equal(diags.filter((d) => d.severity === "error").length, 0, `Unexpected errors: ${JSON.stringify(diags)}`);
  });

  it("detects duplicate SDS name, duplicate tag/ref, undefined member, and cyclic Vgroups", () => {
    const doc = parseHdf4Ddl(`
      HDF4 BrokenHierarchy
        SDS FieldA TYPE=FLOAT32 REF=5 UNIT="K"
          DIM n = 2
          DATA [1, 2]
        END
        SDS FieldA TYPE=FLOAT32 REF=5 UNIT="K"
          DIM n = 2
          DATA [3, 4]
        END
        VGROUP G1 REF=10
          MEMBER VGROUP G2
          MEMBER SDS DoesNotExist
        END
        VGROUP G2 REF=11
          MEMBER VGROUP G1
        END
        VGROUP EmptyG REF=12
        END
      END
    `);
    const codes = new Set(lintHdf4(doc).map((d) => d.code));
    assert.ok(codes.has("HDF2001"), "Expected HDF2001 duplicate tag/ref");
    assert.ok(codes.has("HDF2002"), "Expected HDF2002 duplicate SDS name");
    assert.ok(codes.has("HDF2004"), "Expected HDF2004 undefined Vgroup member");
    assert.ok(codes.has("HDF4001"), "Expected HDF4001 cyclic Vgroup hierarchy");
    assert.ok(codes.has("HDF4002"), "Expected HDF4002 empty Vgroup warning");
  });

  it("detects invalid data type, non-positive dim, data count mismatch, NaN, and palette/raster/vdata errors", () => {
    const doc = parseHdf4Ddl(`
      HDF4 BrokenData
        UNKNOWN_KEYWORD foo
        SDS BadType TYPE=999 REF=1
          DIM x = 0
          DIM y = -2
          DATA [1, NaN]
        END
        SDS Mismatch TYPE=FLOAT32 REF=2 UNIT="m"
          DIM x = 2
          DIM y = 2
          DATA [1, 2, 3]
        END
        RASTER8 BadImg WIDTH=2 HEIGHT=2 REF=3
          DATA [1, 2]
        END
        PALETTE BadPal REF=4
          DATA [0, 0, 0]
        END
        VDATA BadTable REF=5
          FIELD a : INT32
          FIELD b : FLOAT32
          DATA [1, 2, 3]
        END
      END
    `);
    const codes = new Set(lintHdf4(doc).map((d) => d.code));
    assert.ok(codes.has("HDF1001"), "Expected HDF1001 syntax error");
    assert.ok(codes.has("HDF3001"), "Expected HDF3001 invalid DFNT data type");
    assert.ok(codes.has("HDF3002"), "Expected HDF3002 non-positive dimension size");
    assert.ok(codes.has("HDF5001"), "Expected HDF5001 SDS data count mismatch");
    assert.ok(codes.has("HDF5002"), "Expected HDF5002 palette size mismatch");
    assert.ok(codes.has("HDF5003"), "Expected HDF5003 raster8 data mismatch");
    assert.ok(codes.has("HDF5004"), "Expected HDF5004 vdata record width mismatch");
    assert.ok(codes.has("HDF5005"), "Expected HDF5005 non-finite data warning");
    assert.ok(codes.has("HDF5006"), "Expected HDF5006 missing units info");
  });

  it("lints binary buffers with invalid magic via lintHdf4Binary", () => {
    const diags = lintHdf4Binary(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    assert.ok(diags.some((d) => d.code === "HDF1002"));
  });
});
