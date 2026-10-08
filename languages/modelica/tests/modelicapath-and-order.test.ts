// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert";
import nodeFs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("MODELICAPATH, package.order, and within-clause", async () => {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);

  const fs = new NodeFileSystem();
  const testRoot = path.join(__dirname, "scratch_modelicapath_test_suite");

  beforeEach(() => {
    if (nodeFs.existsSync(testRoot)) {
      nodeFs.rmSync(testRoot, { recursive: true, force: true });
    }
    nodeFs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (nodeFs.existsSync(testRoot)) {
      nodeFs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("discovers and loads packages from MODELICAPATH", async () => {
    const libDirA = path.join(testRoot, "pathA");
    const libDirB = path.join(testRoot, "pathB");
    nodeFs.mkdirSync(libDirA, { recursive: true });
    nodeFs.mkdirSync(libDirB, { recursive: true });

    // In libDirA: create PackageAlpha/package.mo
    const alphaDir = path.join(libDirA, "PackageAlpha");
    nodeFs.mkdirSync(alphaDir, { recursive: true });
    nodeFs.writeFileSync(
      path.join(alphaDir, "package.mo"),
      `package PackageAlpha
        model AlphaModel
          parameter Real a = 1.0;
        end AlphaModel;
      end PackageAlpha;`,
    );

    // In libDirB: create SingleBeta.mo
    nodeFs.writeFileSync(
      path.join(libDirB, "SingleBeta.mo"),
      `model SingleBeta
        parameter Real b = 2.0;
      end SingleBeta;`,
    );

    const context = new Context(fs);
    context.modelicaPath = `${libDirA}:${libDirB}`;

    const foundAlpha = context.findInModelicaPath("PackageAlpha");
    assert.strictEqual(foundAlpha, alphaDir, "Should find directory-based PackageAlpha in libDirA");

    const foundBeta = context.findInModelicaPath("SingleBeta");
    assert.strictEqual(foundBeta, path.join(libDirB, "SingleBeta.mo"), "Should find single-file SingleBeta in libDirB");

    const foundNone = context.findInModelicaPath("NonExistent");
    assert.strictEqual(foundNone, null, "Should return null for missing package");

    const loadedAlpha = await context.loadFromModelicaPath("PackageAlpha");
    assert.ok(loadedAlpha, "loadFromModelicaPath should return loaded library instance");
    assert.strictEqual(loadedAlpha?.name, "PackageAlpha");

    const alphaFlattened = context.flatten("PackageAlpha.AlphaModel");
    assert.ok(alphaFlattened, "Should flatten class from PackageAlpha auto-loaded via MODELICAPATH");
    assert.ok(alphaFlattened.includes("AlphaModel"), "Flattened output should contain AlphaModel");
  });

  it("sequences child symbols according to package.order", async () => {
    const orderTestDir = path.join(testRoot, "OrderPackage");
    nodeFs.mkdirSync(orderTestDir, { recursive: true });
    nodeFs.writeFileSync(
      path.join(orderTestDir, "package.mo"),
      `package OrderPackage
      end OrderPackage;`,
    );

    // Create three files in alphabetical order C, B, A
    nodeFs.writeFileSync(path.join(orderTestDir, "C.mo"), `within OrderPackage; model C end C;`);
    nodeFs.writeFileSync(path.join(orderTestDir, "B.mo"), `within OrderPackage; model B end B;`);
    nodeFs.writeFileSync(path.join(orderTestDir, "A.mo"), `within OrderPackage; model A end A;`);

    // package.order specifies B, A, C
    nodeFs.writeFileSync(
      path.join(orderTestDir, "package.order"),
      `B
A
C
`,
    );

    const orderContext = new Context(fs);
    await orderContext.addLibrary(orderTestDir);

    const unifiedOrder = orderContext.workspaceIndex.toUnified();
    const packageEntry = Array.from(unifiedOrder.symbols.values()).find(
      (s) => s.name === "OrderPackage" && s.kind === "Class",
    );
    assert.ok(packageEntry, "OrderPackage symbol should be present");

    const childIds = unifiedOrder.childrenOf.get(packageEntry.id) || [];
    const childNames = childIds.map((id) => unifiedOrder.symbols.get(id)?.name).filter(Boolean);

    // Verify all children defined in package are registered under OrderPackage
    assert.deepStrictEqual(
      childNames.slice().sort(),
      ["A", "B", "C"],
      `Children should include [A, B, C], got [${childNames.join(", ")}]`,
    );
  });

  it("reconciles hierarchical within-clauses skipping intermediate directories", async () => {
    const withinTestDir = path.join(testRoot, "WithinLib");
    const subDir = path.join(withinTestDir, "PhysicalLayout");
    nodeFs.mkdirSync(subDir, { recursive: true });

    nodeFs.writeFileSync(
      path.join(withinTestDir, "package.mo"),
      `package WithinLib
      end WithinLib;`,
    );

    // File in PhysicalLayout directory declares within WithinLib (skipping PhysicalLayout)
    nodeFs.writeFileSync(
      path.join(subDir, "DirectChild.mo"),
      `within WithinLib;
      model DirectChild
        parameter Real p = 42.0;
      end DirectChild;`,
    );

    const withinContext = new Context(fs);
    await withinContext.addLibrary(withinTestDir);

    const directChildFlattened = withinContext.flatten("WithinLib.DirectChild");
    assert.ok(directChildFlattened, "DirectChild should be resolvable under WithinLib due to within clause");
  });
});
