import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const listTestGrammar = {
  name: "ListPaddingDSL",
  rules: {
    Program: ($: any) => repeat($.Item),
    Item: ($: any) => seq("item", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  extras: ($: any) => [/\s/],
};

describe("concatLists Padding & Split Suite", () => {
  let activeFacade: any;
  let TreeClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(listTestGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_concat_lists_padding");
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

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
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

  it("should preserve leading and inter-element padding when parsing large lists triggering Strategy B splitting", () => {
    // Generate a long list of items (300 items) with varying whitespace/padding
    const items = Array.from({ length: 300 }, (_, i) => `  item var_${i};`).join("\n");
    const code = `\n\n   ${items}\n`;

    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const tree = new TreeClass(activeFacade, ast, code);
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.startIndex).toBe(code.indexOf("item var_0;"));
    expect(tree.rootNode.text.startsWith("item var_0;")).toBe(true);
  });

  it("should incrementally insert into middle of large list without offset drift or AST corruption", () => {
    const items = Array.from({ length: 100 }, (_, i) => `item x_${i};`).join("\n");
    const ast1 = activeFacade.parse(items);
    expect(ast1).toBeGreaterThan(0);

    // Insert an item in the middle
    const insertPos = items.indexOf("item x_50;");
    const insertedText = "   item inserted_mid;\n";
    const updatedCode = items.slice(0, insertPos) + insertedText + items.slice(insertPos);

    const ast2 = activeFacade.parseIncremental(insertedText, insertPos, 0, updatedCode.length);
    expect(ast2).toBeGreaterThan(0);

    const tree = new TreeClass(activeFacade, ast2, updatedCode);
    expect(tree.rootNode.endIndex).toBe(updatedCode.length);
  });
});
