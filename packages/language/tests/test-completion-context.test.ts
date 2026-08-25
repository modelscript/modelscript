import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "TestGrammar",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        "model",
        field("name", $.Identifier),
        repeat(choice($.Decl, $.EquationSection)),
        "end",
        optional(field("endName", $.Identifier)),
        ";",
      ),
    Decl: ($) =>
      seq(
        field("type", $.Identifier),
        field("name", $.Identifier),
        optional(seq("[", field("dim", $.Number), "]")),
        ";",
      ),
    EquationSection: ($) => seq("equation", repeat($.Equation)),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.CallExpr, $.IndexExpr, $.DotExpr, $.Identifier, $.Number),
    DotExpr: ($) => prec.left(3, seq(field("left", $.Expr), ".", field("right", $.Identifier))),
    IndexExpr: ($) => prec.left(4, seq(field("base", $.Expr), "[", field("index", $.Number), "]")),
    CallExpr: ($) => prec.left(5, seq(field("callee", $.Identifier), "(", optional($.Expr), ")")),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s+/],
});

describe("SOTA CST Completion Context", () => {
  let facade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar);
    tmpDir = path.join(__dirname, "scratch_completion_ctx_test");
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

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e: any) {
      if (e.stdout) console.log("ASC stdout:\n" + e.stdout.toString());
      if (e.stderr) console.log("ASC stderr:\n" + e.stderr.toString());
      throw e;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => {},
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
    facade = new LspFacade(instance.exports.memory, instance.exports);
    facade.syntaxNames = result.syntaxNames;
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("should extract target expression and replacement range for simple dot access", () => {
    const code = `model M\n  A a;\nequation\n  a.\nend M;`;
    const root = facade.parse(code);
    const isUtf16 = facade.getInputEncoding ? facade.getInputEncoding() === 1 : false;
    const dotCharOffset = code.indexOf("a.") + 2;
    const dotByteOffset = dotCharOffset * (isUtf16 ? 2 : 1);
    const ctx = facade.getCompletionContext(root, dotByteOffset);

    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.hasTarget).toBe(true);
      expect(ctx.targetText).toBe("a");
      expect(ctx.replaceRange.start).toBe(dotByteOffset);
      expect(ctx.replaceRange.end).toBe(dotByteOffset);
    }
  });

  it("should extract target expression for array index lookup", () => {
    const code = `model M\n  A a[5];\nequation\n  a[0].\nend M;`;
    const root = facade.parse(code);
    const isUtf16 = facade.getInputEncoding ? facade.getInputEncoding() === 1 : false;
    const dotCharOffset = code.indexOf("a[0].") + 5;
    const dotByteOffset = dotCharOffset * (isUtf16 ? 2 : 1);
    const ctx = facade.getCompletionContext(root, dotByteOffset);

    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.hasTarget).toBe(true);
      expect(ctx.targetText).toBe("a[0]");
      expect(ctx.replaceRange.start).toBe(dotByteOffset);
    }
  });

  it("should extract target expression for function call lookup", () => {
    const code = `model M\n  A a;\nequation\n  getA().\nend M;`;
    const root = facade.parse(code);
    const isUtf16 = facade.getInputEncoding ? facade.getInputEncoding() === 1 : false;
    const dotCharOffset = code.indexOf("getA().") + 7;
    const dotByteOffset = dotCharOffset * (isUtf16 ? 2 : 1);
    const ctx = facade.getCompletionContext(root, dotByteOffset);

    expect(ctx).not.toBeNull();
    if (ctx) {
      expect(ctx.hasTarget).toBe(true);
      expect(ctx.targetText).toBe("getA()");
      expect(ctx.replaceRange.start).toBe(dotByteOffset);
    }
  });
});
