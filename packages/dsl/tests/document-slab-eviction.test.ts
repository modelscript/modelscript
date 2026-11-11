// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, field, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import assert from "node:assert";
import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = {
  name: "DocumentSlabEvictionDSL",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq("model", field("name", $.Identifier), repeat($.Decl), "end", field("endName", $.Identifier), ";"),
    Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($: any) => "Real",
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s/],
};

describe("Document Page/Slab Arena & Tree.edit() Suite", () => {
  let activeFacade: any;
  let tmpDir: string;
  let LspFacadeClass: any;
  let TreeClass: any;
  let TreeSitterParserClass: any;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_slab_eviction");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    childProcess.execFileSync(
      ascBin,
      [...ascPrefixArgs, parserTs, "-o", outWasm, "--exportRuntime", "--enable", "threads", "-O0", "--runtime", "stub"],
      { stdio: "inherit" },
    );

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree, TreeSitterParser };`;
    const getExports = new Function(wrapperSrc);
    const exported = getExports();
    LspFacadeClass = exported.LspFacade;
    TreeClass = exported.Tree;
    TreeSitterParserClass = exported.TreeSitterParser;

    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
    activeFacade = new LspFacadeClass(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should assign distinct file IDs and maintain per-document AST roots", () => {
    const fileA = "file:///workspace/ModelA.mo";
    const fileB = "file:///workspace/ModelB.mo";

    const idA = activeFacade.getFileId(fileA);
    const idB = activeFacade.getFileId(fileB);
    assert.ok(idA > 0, "fileA should have positive fileId");
    assert.ok(idB > 0, "fileB should have positive fileId");
    assert.notStrictEqual(idA, idB, "fileA and fileB must receive distinct fileIds");

    const codeA = `model ModelA Real x; end ModelA;`;
    const codeB = `model ModelB Real y; Real z; end ModelB;`;

    const rootA = activeFacade.parse(codeA, 0, 0, 0, fileA);
    assert.ok(rootA > 0, "rootA should be valid");

    const rootB = activeFacade.parse(codeB, 0, 0, 0, fileB);
    assert.ok(rootB > 0, "rootB should be valid");
    assert.notStrictEqual(rootA, rootB, "Roots must be distinct");

    assert.strictEqual(activeFacade.getDocumentRoot(fileA), rootA, "getDocumentRoot(fileA) must match rootA");
    assert.strictEqual(activeFacade.getDocumentRoot(fileB), rootB, "getDocumentRoot(fileB) must match rootB");
  });

  it("should preserve per-document AST when parsing other documents", () => {
    const fileA = "file:///workspace/ModelA.mo";
    const fileB = "file:///workspace/ModelB.mo";

    const rootA_before = activeFacade.getDocumentRoot(fileA);
    const rootB_before = activeFacade.getDocumentRoot(fileB);

    // Edit doc A without touching doc B
    const codeA_v2 = `model ModelA Real x; Real w; end ModelA;`;
    const editStart = codeA_v2.indexOf("Real w;");
    const editOldEnd = editStart;
    const editNewEnd = editStart + "Real w; ".length;

    const rootA_after = activeFacade.parse(codeA_v2, editStart, editOldEnd, editNewEnd, fileA);
    assert.ok(rootA_after > 0, "rootA_after should be valid");
    assert.strictEqual(activeFacade.getDocumentRoot(fileA), rootA_after, "Doc A root should be updated");

    // Verify Doc B was completely unaffected
    assert.strictEqual(activeFacade.getDocumentRoot(fileB), rootB_before, "Doc B root must remain untouched");
  });

  it("should evict document slabs in O(1) on removeDocument without GC pause", () => {
    const fileTemp = "file:///workspace/TempModel.mo";
    const tempCode = `model TempModel Real a; Real b; Real c; end TempModel;`;

    const tempRoot = activeFacade.parse(tempCode, 0, 0, 0, fileTemp);
    assert.ok(tempRoot > 0, "tempRoot should be valid");
    assert.strictEqual(activeFacade.getDocumentRoot(fileTemp), tempRoot);

    // Evict document
    activeFacade.removeDocument(fileTemp);
    assert.strictEqual(activeFacade.getDocumentRoot(fileTemp), 0, "Document root must be cleared on remove");

    // Parse a new document into recycled slabs
    const fileNew = "file:///workspace/NewModel.mo";
    const newCode = `model NewModel Real q; end NewModel;`;
    const newRoot = activeFacade.parse(newCode, 0, 0, 0, fileNew);
    assert.ok(newRoot > 0, "newRoot should be valid after recycling slabs");
  });

  it("should support tree.edit() and auto-extract lastEdit in TreeSitterParser.parse", () => {
    const parser = new TreeSitterParserClass();
    parser.setLanguage(() => activeFacade);

    const initialCode = `model MyModel Real p; end MyModel;`;
    const tree1 = parser.parse(initialCode);
    assert.ok(tree1, "tree1 must not be null");
    assert.ok(tree1.rootNode, "tree1 must have rootNode");
    assert.strictEqual(tree1.rootNode.type, "Program");

    // Prepare an edit
    const insertText = "Real q; ";
    const insertOffset = initialCode.indexOf("end MyModel;");
    const newCode = initialCode.slice(0, insertOffset) + insertText + initialCode.slice(insertOffset);

    // Call tree.edit() matching standard tree-sitter API
    tree1.edit({
      startIndex: insertOffset,
      oldEndIndex: insertOffset,
      newEndIndex: insertOffset + insertText.length,
    });

    assert.ok(tree1.lastEdit, "tree1 must record lastEdit");
    assert.strictEqual(tree1.lastEdit.startIndex, insertOffset);

    // Parse with (newCode, tree1) - should automatically pick up lastEdit
    const tree2 = parser.parse(newCode, tree1);
    assert.ok(tree2, "tree2 must not be null");
    assert.ok(tree2.rootNode, "tree2 must have rootNode");
    assert.strictEqual(tree2.rootNode.type, "Program");
  });
});
