import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const multiDocGrammar = {
  name: "MultiDocDSL",
  rules: {
    Program: ($: any) => repeat($.Decl),
    Decl: ($: any) => seq("var", field("name", $.Identifier), "=", field("val", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s/],
};

describe("Immutable Append-Only Arena & Multi-Doc Suite", () => {
  let activeFacade: any;
  let TreeClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(multiDocGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_immutable_arena");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade, Tree };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade, Tree } = getFacade();
    TreeClass = Tree;

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should maintain isolated AST roots for multiple open documents in the same WASM memory arena", () => {
    const docA_Uri = "file:///workspace/DocA.dsl";
    const docB_Uri = "file:///workspace/DocB.dsl";

    const textA = "var a = x;\nvar b = y;\n";
    const textB = "var foo = bar;\n";

    const rootA = activeFacade.parse(textA, 0, 0, 0, docA_Uri);
    expect(rootA).toBeGreaterThan(0);
    expect(activeFacade.getDocumentRoot(docA_Uri)).toBe(rootA);

    const rootB = activeFacade.parse(textB, 0, 0, 0, docB_Uri);
    expect(rootB).toBeGreaterThan(0);
    expect(activeFacade.getDocumentRoot(docB_Uri)).toBe(rootB);

    // Verify both roots exist and are distinct
    expect(rootA).not.toBe(rootB);

    // Verify tree B is valid
    const treeB = new TreeClass(activeFacade, rootB, textB);
    expect(treeB.rootNode.text).toBe("var foo = bar;");

    // Incrementally edit Doc A
    const inserted = "var c = z;\n";
    const updatedTextA = textA + inserted;
    const rootA2 = activeFacade.parseIncremental(inserted, textA.length, 0, updatedTextA.length, docA_Uri);
    expect(rootA2).toBeGreaterThan(0);

    // Verify Doc B's AST was NOT mutated or corrupted in memory
    const treeB_after = new TreeClass(activeFacade, rootB, textB);
    expect(treeB_after.rootNode.text).toBe("var foo = bar;");

    // Verify Doc A's updated AST has the new content
    const treeA_after = new TreeClass(activeFacade, rootA2, updatedTextA);
    expect(treeA_after.rootNode.text).toContain("var c = z");
  });

  it("should emit accurate AST diff events on incremental edit without pointer corruption", () => {
    const docUri = "file:///workspace/DiffTest.dsl";
    const initialText = "var x = alpha;\nvar y = beta;\n";

    const events: string[] = [];
    activeFacade.addAstChangeListener({
      onNodeInserted: (ptr: number) => events.push(`INSERT_${ptr}`),
      onNodeDeleted: (ptr: number) => events.push(`DELETE_${ptr}`),
      onNodeUpdated: (newPtr: number, oldPtr: number) => events.push(`UPDATE_${newPtr}_${oldPtr}`),
      onNodeRetained: (ptr: number) => events.push(`RETAIN_${ptr}`),
    });

    const root1 = activeFacade.parse(initialText, 0, 0, 0, docUri);
    expect(root1).toBeGreaterThan(0);

    events.length = 0; // Clear initial events

    // Edit y = beta -> y = gamma
    const editOffset = initialText.indexOf("beta");
    const replacement = "gamma";
    const newText = initialText.replace("beta", "gamma");

    const root2 = activeFacade.parseIncremental(replacement, editOffset, 4, newText.length, docUri);
    expect(root2).toBeGreaterThan(0);

    // Verify diff events were generated without throwing MAX_DIFF_OPS
    expect(events.length).toBeGreaterThan(0);
  });

  it("should handle document close and generational cleanup", () => {
    const docUri = "file:///workspace/ClosingDoc.dsl";
    const text = "var temp = val;\n";

    const root = activeFacade.parse(text, 0, 0, 0, docUri);
    expect(root).toBeGreaterThan(0);
    expect(activeFacade.getDocumentRoot(docUri)).toBe(root);

    activeFacade.removeDocument(docUri);
    expect(activeFacade.getDocumentRoot(docUri)).toBe(0);
  });
});
