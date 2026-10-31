// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const robustnessGrammar = language({
  name: "ParserRecoveryRobustnessDSL",
  word: ($) => $.Identifier,
  rules: {
    // Program has a nullable right-edge rule (`OptFooter`) to verify LALR(1) EOF lookahead propagation
    Program: ($) => seq(repeat($.ModelDef), $.OptFooter),
    OptFooter: ($) => optional(seq("footer", ";")),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.AssignStmt)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(
        semanticToken("type", "Real"),
        field("name", $.Identifier),
        optional(seq("=", field("value", $.Number))),
        ";",
      ),
    AssignStmt: ($) => seq(field("lhs", $.Identifier), ":=", field("rhs", $.Number), ";"),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
    LineComment: ($) => semanticToken("comment", /\/\/[^\n]*/),
    BlockComment: ($) => semanticToken("comment", /\/\*[\s\S]*?\*\//),
  },
  extras: ($) => [/\s/, $.LineComment, $.BlockComment],
  lints: {
    uninitializedComponent: {
      nodes: ["Decl"],
      severity: "warning",
      message: "Component declaration uninitialized",
      query: (db: any, node: any) => {
        const valNode = db.ast.getChildByFieldId(node, "value");
        if (valNode == 0) {
          const nameNode = db.ast.getChildByFieldId(node, "name");
          if (nameNode != 0) {
            db.diagnostic(nameNode);
          }
        }
      },
    },
  },
});

describe("Parser, Recovery, and Lint Offset Robustness", () => {
  let facade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(robustnessGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_parser_recovery_robustness");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
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
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

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
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates EOF lookahead to nullable right-edge productions so mid-file errors do not trigger premature accept", () => {
    const code = [
      "model First",
      "  Real x = 1;",
      "end First;",
      "",
      "stray_token",
      "",
      "model Second",
      "  Real y;",
      "end Second;",
    ].join("\n");

    facade.lastAstRoot = 0;
    const ast = facade.parse(code);
    const sExpr = facade.getAstSExpr(ast, true);
    const diags = facade.getDiagnostics(ast);

    // Both ModelDef blocks must be parsed as full ModelDef nodes rather than `Second` being swallowed into trailing ERROR
    const modelMatches = sExpr.match(/\(ModelDef /g) ?? [];
    expect(modelMatches.length).toBe(2);

    // Both the syntax error on `stray_token` and the CST lint on `y` in `Second` must be reported at exact offsets
    const syntaxDiags = diags.filter((d: any) => d.code === undefined);
    const lintDiags = diags.filter((d: any) => d.code !== undefined);
    expect(syntaxDiags.length).toBe(1);
    expect(code.slice(syntaxDiags[0].startOffset, syntaxDiags[0].endOffset)).toBe("stray_token");
    expect(lintDiags.length).toBe(1);
    expect(code.slice(lintDiags[0].startOffset, lintDiags[0].endOffset)).toBe("y");
  });

  it("skips trailing line and block comments as extras after an accepted root", () => {
    const code = [
      "model Clean",
      "  Real x = 10;",
      "end Clean;",
      "footer;",
      "// trailing line comment",
      "/* trailing block comment */",
      "   ",
    ].join("\n");

    facade.lastAstRoot = 0;
    const ast = facade.parse(code);
    const diags = facade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);
  });

  it("highlights exact token spans without trailing whitespace on missing delimiters and unclosed EOF constructs", () => {
    // 1. Missing semicolon after multi-digit number `12345`
    const missingSemiCode = ["model M", "  Real alpha = 12345", "  Real beta = 67;", "end M;"].join("\n");
    facade.lastAstRoot = 0;
    const ast1 = facade.parse(missingSemiCode);
    const diags1 = facade.getDiagnostics(ast1);
    expect(diags1.length).toBeGreaterThan(0);
    for (const d of diags1) {
      const slice = missingSemiCode.slice(d.startOffset, d.endOffset);
      expect(slice.trim()).toBe(slice);
      expect(slice.length).toBeGreaterThan(0);
    }

    // 2. Unexpected multi-character operator `:=` inside a `Real` declaration is reported in full (`:=`), not truncated to `:`
    const multiCharOpCode = ["model M", "  Real alpha := 10;", "end M;"].join("\n");
    facade.lastAstRoot = 0;
    const ast2 = facade.parse(multiCharOpCode);
    const diags2 = facade.getDiagnostics(ast2);
    expect(diags2.length).toBeGreaterThan(0);
    const hasFullMultiCharToken = diags2.some(
      (d: any) => d.message.includes("':='") || d.message.includes("Missing ';'"),
    );
    expect(hasFullMultiCharToken).toBe(true);
    for (const d of diags2) {
      const slice = multiCharOpCode.slice(d.startOffset, d.endOffset);
      expect(slice.trim()).toBe(slice);
    }

    // 3. Unclosed model at EOF with trailing spaces/newlines never highlights whitespace and coexists with CST lints
    const eofCode = "model Unclosed\n  Real uninitVar;\n  Real okVar = 42;    \n\n";
    facade.lastAstRoot = 0;
    const ast3 = facade.parse(eofCode);
    const diags3 = facade.getDiagnostics(ast3);
    const syntaxDiags3 = diags3.filter((d: any) => d.code === undefined);
    const lintDiags3 = diags3.filter((d: any) => d.code !== undefined);
    expect(syntaxDiags3.length).toBeGreaterThan(0);
    expect(lintDiags3.length).toBe(1);
    expect(eofCode.slice(lintDiags3[0].startOffset, lintDiags3[0].endOffset)).toBe("uninitVar");
    for (const sd of syntaxDiags3) {
      const slice = eofCode.slice(sd.startOffset, sd.endOffset);
      expect(slice.trim()).toBe(slice);
      expect(slice.length).toBeGreaterThan(0);
    }
  });
});
