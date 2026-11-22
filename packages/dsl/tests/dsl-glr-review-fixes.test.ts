// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  $,
  ActionType,
  buildParser,
  choice,
  compileRegexToDFA,
  createKeyValueBlockLanguage,
  extendLanguage,
  GLRTable,
  language,
  LRAutomaton,
  NormalizedGrammar,
  optional,
  prec,
  repeat,
  reserved,
  semanticToken,
  seq,
  token,
} from "../src/index.js";

describe("DSL & GLR Compiler Review Fixes", () => {
  it("rejects lazy quantifiers, lookarounds, and backreferences in DFA regex compiler", () => {
    assert.throws(
      () => compileRegexToDFA([{ pattern: "\\/\\*[\\s\\S]*?\\*\\/", tokenName: "COMMENT" }]),
      /Unsupported lazy quantifier '\*\?'/,
    );
    assert.throws(() => compileRegexToDFA([{ pattern: "a+?", tokenName: "A" }]), /Unsupported lazy quantifier '\+\?'/);
    assert.throws(() => compileRegexToDFA([{ pattern: "a??", tokenName: "A" }]), /Unsupported lazy quantifier '\?\?'/);
    assert.throws(
      () => compileRegexToDFA([{ pattern: "a{1,3}?", tokenName: "A" }]),
      /Unsupported lazy quantifier '\{1,3\}\?'/,
    );
    assert.throws(() => compileRegexToDFA([{ pattern: "(?=abc)a", tokenName: "A" }]), /Unsupported group construct/);
    assert.throws(() => compileRegexToDFA([{ pattern: "(a)\\1", tokenName: "A" }]), /Unsupported backreference/);
  });

  it("matches \\f and \\v in \\s character class", () => {
    const dfa = compileRegexToDFA([{ pattern: "\\s+", tokenName: "WS" }]);
    const lookupClass = (cp: number) => {
      for (const r of dfa.classRanges) {
        if (cp >= r.s && cp <= r.e) return r.c;
      }
      return 0;
    };
    for (const cp of [9, 10, 11, 12, 13, 32]) {
      const cls = lookupClass(cp);
      const next = dfa.table[0 * dfa.numClasses + cls]!;
      assert.ok(next !== -1, `Expected \\s to accept code point ${cp}`);
      assert.ok(dfa.accepts[next]?.includes("WS"), `Expected state ${next} to accept WS for code point ${cp}`);
    }
  });

  it("does not treat EOF or undefined symbols as nullable in computeFirstSets", () => {
    const g = new NormalizedGrammar(
      language({
        name: "NullableFirstSetTest",
        rules: {
          Start: () => optional("a"),
          Broken: ($r) => seq($r["MissingSym"]!, "b"),
        },
      }),
    );
    const aut = new LRAutomaton(g);
    assert.equal(aut.firstSets.get("_START")?.has(""), false, "_START -> Start EOF must not be nullable");
    assert.equal(aut.firstSets.get("Broken")?.has(""), false, "Rule referencing undefined symbol must not be nullable");
  });

  it("honors shiftAssoc and is order-independent in GLRTable conflict resolution", () => {
    const g = new NormalizedGrammar(
      language({
        name: "AssocTest",
        rules: {
          Expr: ($r) => choice(prec.right(1, seq($r["Expr"]!, "^", $r["Expr"]!)), /[0-9]+/),
        },
      }),
    );
    const aut = new LRAutomaton(g);
    const table = new GLRTable(g, aut);
    assert.equal(table.conflicts.length, 0, "Right-associative ^ should resolve shift/reduce cleanly");

    // Verify that on '^' after reducing Expr ^ Expr, SHIFT wins (right associativity)
    let sawShiftOnly = false;
    for (const termMap of table.actionTable.values()) {
      const acts = termMap.get('"^"');
      if (acts && acts.length === 1 && acts[0]!.type === ActionType.SHIFT) {
        sawShiftOnly = true;
      }
    }
    assert.ok(sawShiftOnly, "Expected right-associative '^' to resolve to SHIFT");
  });

  it("exported $ proxy produces SYMBOL references that flatten cleanly", () => {
    const ref = $.MyRule;
    assert.equal(ref.type, "SYMBOL");
    assert.equal(ref.value, "MyRule");

    const g = new NormalizedGrammar(
      language({
        name: "DollarProxyTest",
        rules: {
          Start: () => seq($.MyRule, ";"),
          MyRule: () => "ok",
        },
      }),
    );
    assert.deepEqual(g.diagnostics, []);
  });

  it("merges mixed array and function forms in extendLanguage without dropping either side", () => {
    const base = language({
      name: "MixBase",
      rules: {
        Start: ($r) => choice($r["A"]!, $r["B"]!),
        A: () => "a",
        B: () => "b",
      },
      conflicts: [["A", "B"]],
      supertypes: ["Start"],
      precedences: [["A"]],
    });

    const extended = extendLanguage(base, {
      conflicts: ($r) => [[$r["A"]!, $r["Start"]!]],
      supertypes: ($r) => [$r["A"]!],
      precedences: () => [["B"]],
    });

    const g = new NormalizedGrammar(extended);
    assert.equal(g.conflicts.length, 2, "Both base array conflicts and mixin function conflicts must be preserved");
    assert.ok(g.globalPrecedences.has("A"), "Base array precedence must be preserved");
    assert.ok(g.globalPrecedences.has("B"), "Mixin function precedence must be preserved");
  });

  it("attaches prec*() directly to enclosing productions without synthetic wrapper non-terminals", () => {
    const g = new NormalizedGrammar(
      language({
        name: "DirectPrecTest",
        rules: {
          Expr: ($r) =>
            choice(
              prec.left(2, seq($r["Expr"]!, "*", $r["Expr"]!)),
              prec.left(1, seq($r["Expr"]!, "+", $r["Expr"]!)),
              /[0-9]+/,
            ),
        },
      }),
    );
    // Only Expr, _START, and the choice synthetic should exist — no extra _prec wrappers
    const exprChoiceProds = g.productions.filter((p) => p.right.includes('"*"') || p.right.includes('"+"'));
    assert.equal(exprChoiceProds.length, 2);
    const mulProd = exprChoiceProds.find((p) => p.right.includes('"*"'))!;
    const addProd = exprChoiceProds.find((p) => p.right.includes('"+"'))!;
    assert.equal(mulProd.prec, 2);
    assert.equal(mulProd.assoc, "left");
    assert.equal(addProd.prec, 1);
    assert.equal(addProd.assoc, "left");
  });

  it("compiles composite token(choice/seq) to a single regex terminal and marks KvComment as extra", () => {
    const kvLang = createKeyValueBlockLanguage("KvExtraTest");
    const result = buildParser(kvLang as Parameters<typeof buildParser>[0]);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;

    // KvComment should be compiled into a single regex terminal and registered in initExtras()
    const kvCommentMatches = parserTs.match(/store<u8>\(is_extra_token \+ <u32>\d+, 1\);/g) ?? [];
    assert.ok(
      kvCommentMatches.length >= 2,
      `Expected whitespace + KvComment extras in initExtras, got ${kvCommentMatches.length}`,
    );
  });

  it("respects line-oriented extras without hardcoding newline skipping", () => {
    const lineLang = language({
      name: "LineOriented",
      extras: () => [/[ \t]+/],
      rules: {
        Program: ($r) => repeat(seq($r["Ident"]!, "\n")),
        Ident: () => /[a-z]+/,
      },
    });
    const result = buildParser(lineLang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    // Fast-path whitespace loop should skip 32 and 9, NOT 10 or 13
    assert.match(parserTs, /if \(c == 32 \|\| c == 0xFEFF \|\| c == 9\)/);
    assert.doesNotMatch(parserTs, /if \(c == 32 \|\| c == 9 \|\| c == 10/);
  });

  it("inlines non-recursive inline rules into callers and guards against recursive cycles", () => {
    const g = new NormalizedGrammar(
      language({
        name: "InlineTest",
        inline: ["Helper", "SelfRec"],
        rules: {
          Program: ($r) => seq($r["Helper"]!, $r["SelfRec"]!),
          Helper: () => seq("a", "b"),
          SelfRec: ($r) => choice("x", seq("x", $r["SelfRec"]!)),
        },
      }),
    );
    const progProd = g.productions.find((p) => p.left === "Program")!;
    assert.equal(progProd.right[0], '"a"', "Helper should be inlined directly into Program");
    assert.equal(progProd.right[1], '"b"');
    const unreachable = g.diagnostics.filter((d) => d.code === "unreachable-rule");
    assert.equal(unreachable.length, 0, "Inlined rules should not be flagged as unreachable");
  });

  it("supports typed token.immediate and emits skippedExtras guard", () => {
    const immLang = language({
      name: "ImmediateTest",
      extras: () => [/[ \t]+/],
      rules: {
        Call: () => seq(/[a-z]+/, token.immediate("("), ")"),
      },
    });
    const result = buildParser(immLang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    assert.match(parserTs, /let skippedExtras: bool = lexPos != pos;/);
    assert.match(parserTs, /!skippedExtras/);
  });

  it("throws when strictGrammar is enabled and grammar has fatal diagnostics", () => {
    assert.throws(
      () =>
        new NormalizedGrammar(
          language({
            name: "StrictBad",
            strictGrammar: true,
            rules: {
              Start: ($r) => seq($r["Missing"]!, "a"),
            },
          }),
        ),
      /failed static validation/,
    );
  });

  it("surfaces supertypes on BuildResult, preserves peekToken scanMarkedEnd, and avoids typeSemantics clobbering", () => {
    const lang = language({
      name: "MetaTest",
      word: ($r) => $r["Ident"]!,
      supertypes: ($r) => [$r["Expr"]!],
      reserved: {
        global: () => ["end"],
      },
      scanner: (_$, _lexer) => 0,
      rules: {
        Program: ($r) => $r["Expr"]!,
        Expr: ($r) => choice(semanticToken("keyword", $r["A"]!), semanticToken("variable", $r["B"]!)),
        A: () => "end",
        B: ($r) => $r["Ident"]!,
        Ident: () => /[a-z]+/,
      },
    });
    const result = buildParser(lang);
    assert.ok(result.supertypes);
    assert.deepEqual(result.supertypes["Expr"], ["A", "B"]);

    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    assert.match(parserTs, /if \(scanMarkedEnd\) state \|= 1;/);
    assert.match(parserTs, /Reserved keywords override/);
  });

  it("enforces !skippedExtras on immediate regex tokens in DFA accept dispatch", () => {
    const immRegexLang = language({
      name: "ImmediateRegexTest",
      extras: () => [/[ \t]+/],
      rules: {
        Unit: () => seq(/[0-9]+/, token.immediate(/[a-z]+/)),
      },
    });
    const result = buildParser(immRegexLang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    assert.match(parserTs, /if \(!skippedExtras\) \{\s*lastAcceptingState = dfaState;/);
  });

  it("supports contextual reserved(wordset, rule) alongside global reserved wordsets", () => {
    const lang = language({
      name: "ContextualReservedTest",
      word: ($r) => $r["Ident"]!,
      reserved: {
        global: () => ["end"],
        ctx: () => ["async"],
      },
      rules: {
        Program: ($r) => choice(reserved("ctx", seq("async", $r["Ident"]!)), seq("end", $r["Ident"]!)),
        Ident: () => /[a-z]+/,
      },
    });
    const result = buildParser(lang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    // Contextual wordset 'ctx' is guarded by expected_tokens; 'global' is unconditional
    assert.match(
      parserTs,
      /if \(expected_tokens == 0 \|\| load<u8>\(expected_tokens \+ <u32>SyntaxType\.T_\d+\) == 1\) return SyntaxType\.T_\d+;/,
    );
  });

  it("emits INDENT/DEDENT layout scanner when primitives.layout is configured", () => {
    const pyLike = language({
      name: "LayoutLang",
      primitives: {
        layout: { indent: "INDENT", dedent: "DEDENT" },
      },
      extras: () => [/[ \t]+/],
      rules: {
        Program: ($r) => repeat($r["Block"]!),
        Block: ($r) => seq(/[a-z]+/, ":", "\n", $r["INDENT"]!, /[a-z]+/, "\n", $r["DEDENT"]!),
      },
    });
    const result = buildParser(pyLike);
    assert.equal(result.grammarDiagnostics?.filter((d) => d.code === "undefined-rule").length ?? 0, 0);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    assert.match(parserTs, /layoutIndentStack/);
    assert.match(parserTs, /return SyntaxType\.INDENT;/);
    assert.match(parserTs, /return SyntaxType\.DEDENT;/);
    assert.match(parserTs, /saveLexerAuxState/);
  });

  it("supports scanner.runAfterExtras to run external scanner after skipping whitespace/comments", () => {
    const lang = language({
      name: "ScannerAfterExtras",
      extras: () => [/\s+/],
      externals: ($r) => [$r["RAW"]!],
      scanner: {
        runAfterExtras: true,
        scan: (_$, _lexer) => 0,
      },
      rules: {
        Program: ($r) => $r["RAW"]!,
      },
    });
    const result = buildParser(lang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    const skipIdx = parserTs.indexOf("// Skip extra tokens");
    const scanIdx = parserTs.indexOf("let extToken = scanExternal");
    assert.ok(skipIdx > 0 && scanIdx > skipIdx, "Expected scanExternal to be emitted after skipping extra tokens");
    assert.match(parserTs, /let postExtrasPos: u32 = lexPos;/);
  });

  it("classifies /\\w+/ regex tokens as word tokens in token_is_word", () => {
    const lang = language({
      name: "WordRegexTest",
      rules: {
        Program: () => /\w+/,
      },
    });
    const result = buildParser(lang);
    const parserTs = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts")!.content;
    // token_is_word should have a non-zero byte (1) for the /\w+/ terminal
    const match = parserTs.match(/export const token_is_word: usize = memory\.data<i32>\(\[([^\]]+)\]\)/);
    assert.ok(match, "Expected token_is_word static table");
    const words = match[1]!.split(",").map((w) => Number(w.trim()));
    // words[0] is length, words[1] packs bytes [0, 1, 2, 3]; byte 1 (symId=1) should be 1 -> (words[1] >> 8) & 0xff === 1
    assert.equal((words[1]! >> 8) & 0xff, 1, "Expected /\\w+/ terminal to have token_is_word[1] == 1");
  });
});
