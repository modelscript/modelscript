// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { hdf4Language } from "../src/language.js";

const pkgRoot = new URL("..", import.meta.url).pathname;
const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");

describe("HDF4 WASM GLR grammar & language metadata", () => {
  it("exports hdf4Language with Beta tier, extensions, and Hdf4Panel UI descriptor", () => {
    assert.equal(hdf4Language.name, "hdf4");
    assert.equal(hdf4Language.maturity, "beta");
    assert.ok(hdf4Language.fileExtensions?.includes(".hdf"));
    assert.ok(hdf4Language.fileExtensions?.includes(".hdf4"));
    assert.ok(hdf4Language.ui?.panels && hdf4Language.ui.panels.length >= 1);
    assert.equal(hdf4Language.ui.panels[0]?.entry, "./src/ui/Hdf4Panel.tsx");
  });

  it("compiles and parses HDF4 DDL via native dist/parser.wasm", async () => {
    assert.ok(fs.existsSync(wasmPath), `Expected WASM parser at ${wasmPath}`);
    const { parser } = await createWasmParser(wasmPath);

    const ddl = `# Test HDF4 DDL
HDF4 EosDemo VERSION="4.2"
  SDS Temp TYPE=FLOAT32
    DIM lat = 2
    DIM lon = 2
    ATTR units = "K"
    DATA [280.1, 281.2, 282.3, 283.4]
  END
  VGROUP Root CLASS="GRID"
    MEMBER SDS Temp
  END
END
`;
    const tree = parser.parse(ddl);
    assert.ok(tree, "WASM parser should return a CST");
    assert.ok(tree.rootNode, "CST should have a rootNode");
    assert.equal(
      tree.rootNode.hasError,
      false,
      `Valid HDF4 DDL should parse without syntax errors: ${tree.rootNode.toString()}`,
    );
  });
});
