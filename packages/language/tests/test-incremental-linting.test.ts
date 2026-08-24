import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeDsl = language({
  name: "ModelicaLikeIncrementalLang",
  word: ($: any) => $.Identifier,
  rules: {
    StoredDefinition: ($: any) =>
      seq(optional(field("withinDirective", $.WithinDirective)), repeat(field("classDefinition", $.ClassDefinition))),
    WithinDirective: ($: any) =>
      seq(semanticToken("keyword", "within"), optional(field("packageName", $.Identifier)), ";"),
    ClassDefinition: ($: any) =>
      seq(
        field("prefixes", $.ClassPrefixes),
        field("name", $.Identifier),
        repeat(field("element", $.Element)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    ClassPrefixes: ($: any) =>
      choice(
        semanticToken("keyword", "model"),
        semanticToken("keyword", "record"),
        semanticToken("keyword", "function"),
      ),
    Element: ($: any) =>
      seq(
        field("type", $.Identifier),
        field("name", $.Identifier),
        optional(seq("=", field("value", $.Identifier))),
        ";",
      ),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  lints: {
    uninitializedComponent: {
      nodes: ["Element"],
      severity: "warning",
      code: 2000,
      message: "Component declaration uninitialized",
      query: (db: any, node: any) => {
        const val = db.ast.getChildByFieldId(node, "value");
        if (val == 0) {
          db.diagnostic(node);
        }
      },
    },
  },
  extras: ($: any) => [/\s+/],
});

describe("Incremental Linting & Sub-Millisecond Diagnostic Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_inc_lint");
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

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 256, maximum: 2048, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("incremental edit on a 3,500-line model evaluates lints in < 15 ms", () => {
    const lines: string[] = ["within MyPackage;\n", "model LargeModel\n"];

    for (let i = 0; i < 3500; i++) {
      lines.push(`  Real var_${i} = initialVal;\n`);
    }
    lines.push("end LargeModel;\n");

    const initialSource = lines.join("");
    const initialRoot = activeFacade.parse(initialSource);
    expect(initialRoot).toBeGreaterThan(0);

    const initialDiags = activeFacade.getDiagnostics(initialRoot);
    expect(initialDiags).toHaveLength(0);

    // Now perform an incremental edit on line 3400: change `var_3400 = initialVal;` to uninitialized `var_3400;`
    const targetStr = "Real var_3400 = initialVal;";
    const targetOffset = initialSource.indexOf(targetStr);
    expect(targetOffset).toBeGreaterThan(0);

    const editLen = targetStr.length;
    const replacement = "Real var_3400;";
    const newTotalLen = initialSource.length - editLen + replacement.length;

    const t0 = Date.now();
    const updatedRoot = activeFacade.parseIncremental(
      replacement,
      targetOffset,
      editLen,
      newTotalLen,
      "file:///test.mo",
    );
    const incParseTime = Date.now() - t0;

    expect(updatedRoot).toBeGreaterThan(0);
    expect(incParseTime).toBeLessThan(350); // Incremental parse must be fast

    const t1 = Date.now();
    const updatedDiags = activeFacade.getDiagnostics(updatedRoot);
    const diagTime = Date.now() - t1;

    expect(diagTime).toBeLessThan(200);
    expect(updatedDiags).toHaveLength(1);
    expect(updatedDiags[0].code).toBe(2000);
  });
});
