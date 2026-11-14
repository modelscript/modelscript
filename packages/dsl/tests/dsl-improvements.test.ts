// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  blank,
  buildParser,
  choice,
  extendLanguage,
  fromMeta,
  generateGrammarSamples,
  language,
  mutateSample,
  NormalizedGrammar,
  optional,
  repeat,
  resolveSourceUrl,
  seq,
  SOURCE_PATH_SYMBOL,
  tabularLanguage,
  validateGrammar,
  validateLanguageQueries,
  validateTranspilableSubset,
  verifyRoundTrip,
  withActions,
  withLints,
  withLsp,
  withQueries,
  xml,
} from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";

describe("DSL Improvements Suite", () => {
  it("resolves sourceUrl and fromMeta without stack-trace inspection", () => {
    const lang = language({
      name: "UrlTest",
      ...fromMeta({ url: "file:///workspace/languages/demo/src/language.ts" }),
      rules: {
        Program: () => "ok",
      },
    });
    assert.strictEqual((lang as any)[SOURCE_PATH_SYMBOL], "/workspace/languages/demo/src/language.ts");
    assert.strictEqual(resolveSourceUrl("file:///C:/repo/test%20file.ts"), "C:/repo/test file.ts");
  });

  it("composes language slices purely via extendLanguage and with* helpers", () => {
    const base = language({
      name: "ComposedDSL",
      rules: {
        Program: ($) => repeat($["Stmt"]!),
        Stmt: () => "pass",
      },
      inline: ["Stmt"],
    });

    const extended = extendLanguage(
      base,
      withLsp({ fileExtensions: [".cdsl"], folding: ["Program"] }),
      withLints({
        noPass: {
          nodes: ["Stmt"],
          severity: "warning",
          message: "Avoid pass",
          query: (db, node) => {
            db.diagnostic(node);
          },
        },
      }),
      withQueries({
        countStmts: (db, node) => db.ast.childCount(node),
      }),
      withActions([
        {
          id: "run",
          title: "Run",
          description: "Run composed DSL",
          category: "simulate",
        },
      ]),
    );

    assert.strictEqual(base.lsp, undefined);
    assert.strictEqual(base.lints, undefined);
    assert.deepStrictEqual(extended.lsp?.fileExtensions, [".cdsl"]);
    assert.ok(extended.lints?.noPass);
    assert.ok(extended.queries?.countStmts);
    assert.strictEqual(extended.actions?.length, 1);
    assert.deepStrictEqual(extended.inline, ["Stmt"]);
  });

  it("supports tabularLanguage and xml.toXmlLanguageOptions builders", () => {
    const tab = tabularLanguage({
      name: "ReqTable",
      fileExtensions: [".req.csv"],
      tabular: {
        tables: {
          requirements: {
            title: "Requirements",
            columns: [{ id: "id", header: "ID", type: "string" }],
          },
        },
      } as any,
    });
    assert.deepStrictEqual(tab.lsp?.fileExtensions, [".req.csv"]);

    const xmlOpts = xml.toXmlLanguageOptions({
      name: "DemoXml",
      fileExtensions: [".dxml"],
      root: "Root",
      elements: {
        Root: { tags: ["DemoRoot"], attributes: {}, children: {} },
      },
    });
    assert.strictEqual(xmlOpts.name, "DemoXml");
    assert.strictEqual(xmlOpts.indexing.canIndex("a.dxml", "<DemoRoot/>"), true);
    assert.strictEqual(xmlOpts.indexing.canIndex("a.dxml", "<Other/>"), false);
  });

  it("detects static grammar diagnostics (undefined, unreachable, unproductive, nullable-repeat)", () => {
    const badLang = language({
      name: "BadGrammar",
      rules: {
        Start: ($) => seq($["MissingRule"]!, $["Loop"]!, $["CycleA"]!),
        Loop: () => repeat(optional("x")),
        CycleA: ($) => seq($["CycleB"]!, "a"),
        CycleB: ($) => $["CycleA"]!,
        DeadRule: () => choice("dead", blank()),
      },
    });

    const result = buildParser(badLang as Parameters<typeof buildParser>[0]);
    const codes = new Set((result.grammarDiagnostics || []).map((d) => d.code));
    assert.ok(codes.has("undefined-rule"), `Expected undefined-rule in ${[...codes]}`);
    assert.ok(codes.has("nullable-repeat"), `Expected nullable-repeat in ${[...codes]}`);
    assert.ok(codes.has("unproductive-rule"), `Expected unproductive-rule in ${[...codes]}`);
    assert.ok(codes.has("unreachable-rule"), `Expected unreachable-rule in ${[...codes]}`);

    const cleanGrammar = new NormalizedGrammar(
      language({
        name: "CleanGrammar",
        rules: {
          Start: ($) => repeat($["Item"]!),
          Item: () => /[a-z]+/,
        },
      }) as unknown as ConstructorParameters<typeof NormalizedGrammar>[0],
    );
    assert.deepStrictEqual(validateGrammar(cleanGrammar), []);
  });

  it("validates TS-to-AssemblyScript query/lint subset before asc compilation", () => {
    type MockDb = { ast: { childCount: (n: number) => number }; diagnostic: (n: number) => void };
    const validDiags = validateTranspilableSubset((db: MockDb, node: number) => {
      const n = db.ast.childCount(node);
      if (n > 0) db.diagnostic(node);
    }, "lints.ok");
    assert.deepStrictEqual(validDiags, []);

    const badDiags = validateLanguageQueries({
      queries: {
        asyncBad: async () => 1,
        closureBad: (_db: MockDb, node: number) => {
          const fn = () => node;
          return fn();
        },
      },
      lints: {
        tryBad: {
          query: (db: MockDb, node: number) => {
            try {
              db.diagnostic(node);
            } catch {
              // noop
            }
          },
        },
      },
    });
    const badCodes = new Set(badDiags.map((d) => d.code));
    assert.ok(badCodes.has("unsupported-async"));
    assert.ok(badCodes.has("unsupported-closure"));
    assert.ok(badCodes.has("unsupported-try-catch"));
  });

  it("generates deterministic grammar samples, mutations, and verifies round-trip", () => {
    const g = new NormalizedGrammar(
      language({
        name: "ExprGrammar",
        rules: {
          Program: ($) => seq($["Expr"]!, ";"),
          Expr: ($) => choice(/[0-9]+/, seq("(", $["Expr"]!, "+", $["Expr"]!, ")")),
        },
      }) as unknown as ConstructorParameters<typeof NormalizedGrammar>[0],
    );

    const samples1 = generateGrammarSamples(g, { count: 5, maxDepth: 6, seed: 42 });
    const samples2 = generateGrammarSamples(g, { count: 5, maxDepth: 6, seed: 42 });
    assert.strictEqual(samples1.length, 5);
    assert.deepStrictEqual(samples1, samples2);
    for (const s of samples1) {
      assert.ok(s.endsWith(";"), `Expected sample '${s}' to end with ';'`);
    }

    const mutated = mutateSample(samples1[0]!, 7);
    assert.notStrictEqual(mutated, samples1[0]);

    const mockParser = {
      parse(text: string) {
        return { rootNode: { type: "Program", hasError: false, text } };
      },
    };
    const rt = verifyRoundTrip(mockParser, samples1[0]!);
    assert.strictEqual(rt.ok, true);
    assert.strictEqual(rt.unparsed, samples1[0]);
  });
});
