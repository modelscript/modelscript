import * as childProcess from "child_process";
import * as fs from "fs";
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import * as path from "path";
import { buildParser, choice, field, language, repeat, seq } from "../src/index.js";

const testDir = typeof __dirname !== "undefined" ? __dirname : path.resolve("packages/dsl/tests");

describe("External Scanner DSL Lambda Key Compilation & Execution", () => {
  const tmpDir = path.join(testDir, "scratch_build_external_scanner");
  let activeFacade: any;

  const testLang = language({
    name: "ExternalScannerLang",
    externals: ($) => [$.CUSTOM_TOKEN],
    rules: {
      SourceFile: ($) => repeat(choice($.Item, $.Statement)),
      Item: ($) => seq(field("tag", $.CUSTOM_TOKEN), field("name", $.Identifier), ";"),
      Statement: ($) => seq(field("name", $.Identifier), "=", field("val", $.Number), ";"),
      Identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,
      Number: ($) => /[0-9]+/,
    },
    extras: ($) => [/\s/],
    scanner: ($, lexer: any, valid: any) => {
      // If CUSTOM_TOKEN is expected in parser state and lookahead is '@' (char code 64)
      if (valid.has($.CUSTOM_TOKEN)) {
        if (lexer.lookahead === 64) {
          lexer.state = 99;
          lexer.advance();
          lexer.markEnd();
          return $.CUSTOM_TOKEN;
        }
      }
      return 0;
    },
  });

  before(async () => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const build = buildParser(testLang as any);

    // Verify that the generated parser.ts includes scanExternal and helper primitives
    const parserFile = build.assemblyScriptFiles.find((f: any) => f.filename === "parser.ts");
    assert.ok(parserFile, "parser.ts should be generated");
    assert.ok(parserFile.content.includes("export function scanExternal"), "Should export scanExternal");
    assert.ok(parserFile.content.includes("scanIsExpected"), "Should emit scanIsExpected");
    assert.ok(parserFile.content.includes("scanAdvance"), "Should emit scanAdvance");
    assert.ok(
      parserFile.content.includes("currentScannerState = scannerState;"),
      "Should set currentScannerState in scanExternal",
    );
    assert.ok(parserFile.content.includes("SyntaxType.CUSTOM_TOKEN"), "Should resolve $.CUSTOM_TOKEN to SyntaxType");

    for (const file of build.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(testDir, "../../node_modules/.bin/asc"),
        path.resolve(testDir, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";

    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    assert.ok(fs.existsSync(outWasm), "parser.wasm should exist");

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      build.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

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
  });

  after(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should successfully scan external custom token and parse into AST", () => {
    const code = `@alpha;\nx = 42;\n`;
    const ast = activeFacade.parse(code);
    assert.ok(ast > 0, "AST root pointer should be nonzero");

    const diags = activeFacade.getDiagnostics(ast);
    console.log("DIAGS:", diags);
    assert.strictEqual(diags.length, 0, "Should have 0 diagnostics");

    const rootType = activeFacade.exports.getNodeType(ast);
    assert.ok(rootType > 0, "Root node type should be valid");
  });
});
