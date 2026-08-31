import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeGrammar = language({
  name: "ModelicaRetentionDSL",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ClassDef),
    ClassDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.EquationSection)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($) => choice($.Identifier, "Real", "Integer"),
    EquationSection: ($) => seq(semanticToken("keyword", "equation"), repeat(field("equation", $.Equation))),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.Identifier, $.Number),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s+/],
});

describe("Completed Subtree Retention in GLR Error Recovery", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_subtree_retention");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    try {
      const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (err: any) {
      if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
      if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
      throw err;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

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
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should retain completed declaration 'X x;' clean and restrict error diagnostic to 'equation x'", () => {
    const code = `model X
  Real x;
end X;

model Y
  X x;
  equation
    x
end Y;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    console.log("SUBTREE RETENTION DIAGS:", JSON.stringify(diags, null, 2));

    // Diagnostics must exist for the incomplete equation on lines 7-8
    expect(diags.length).toBeGreaterThan(0);

    // Line 5 (0-indexed line 5 is "  X x;") MUST have NO error diagnostics overlapping it
    // Code lines:
    // 0: model X
    // 1:   Real x;
    // 2: end X;
    // 3:
    // 4: model Y
    // 5:   X x;
    // 6:   equation
    // 7:     x
    // 8: end Y;
    const line5Diags = diags.filter(
      (d: any) => d.range.start.line <= 5 && d.range.end.line >= 5 && d.range.end.character > 0,
    );
    expect(line5Diags).toHaveLength(0);

    // The syntax diagnostic must start at line 6 ("equation") or line 7 ("x")
    const syntaxDiags = diags.filter((d: any) => d.severity === 1);
    expect(syntaxDiags.length).toBeGreaterThan(0);
    expect(syntaxDiags[0].range.start.line).toBeGreaterThanOrEqual(6);
  });
});
