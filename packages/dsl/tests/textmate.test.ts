// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateTextMate } from "../src/codegen/parser/textmate.js";
import { createIniDeckLanguage, createJsonLanguage, createXmlLanguage } from "../src/dsl/shared-grammars.js";
import { language } from "../src/index.js";

describe("generateTextMate()", () => {
  it("emits XML tag, attribute, and <!-- --> comment patterns without C-style // comments", () => {
    const reqif = createXmlLanguage("reqif");
    const { tm } = generateTextMate(reqif);
    const parsed = JSON.parse(tm);
    assert.ok(parsed.repository.tags, "XML grammar should include #tags");
    const commentStr = JSON.stringify(parsed.repository.comments);
    assert.ok(commentStr.includes("<!--"), "XML grammar should include <!-- --> comments");
    assert.ok(!commentStr.includes("//.*$"), "XML grammar should not include // comments");
  });

  it("emits INI [SECTION] headers, key=val, and ;/# comments without // comments", () => {
    const epanet = createIniDeckLanguage("epanet");
    const { tm } = generateTextMate(epanet);
    const parsed = JSON.parse(tm);
    const patternsStr = JSON.stringify(parsed.patterns);
    assert.ok(patternsStr.includes("entity.name.section.epanet"), "INI grammar should highlight [SECTION] headers");
    const commentStr = JSON.stringify(parsed.repository.comments);
    assert.ok(commentStr.includes("[;#]"), "INI grammar should support ; and # comments");
    assert.ok(!commentStr.includes("//.*$"), "INI grammar should not include // comments");
  });

  it("emits JSON property-name, boolean, and no comment patterns", () => {
    const jsonLang = createJsonLanguage("myjson");
    const { tm } = generateTextMate(jsonLang);
    const parsed = JSON.parse(tm);
    const patternsStr = JSON.stringify(parsed.patterns);
    assert.ok(patternsStr.includes("support.type.property-name.myjson"));
    assert.ok(!parsed.repository.comments);
  });

  it("emits SPICE *, ;, $ comments and metric suffixes", () => {
    const spice = language({
      name: "spice",
      rules: { Program: () => "GND" },
    });
    const { tm } = generateTextMate(spice);
    const parsed = JSON.parse(tm);
    const commentStr = JSON.stringify(parsed.repository.comments);
    assert.ok(commentStr.includes("\\*.*$"), "SPICE should support * line comments");
    assert.ok(commentStr.includes("[;$]"), "SPICE should support ; and $ comments");
    assert.ok(!commentStr.includes("//.*$"), "SPICE should not include // comments");
    assert.ok(parsed.repository.numbers.patterns[0].match.includes("Meg"));
  });

  it("emits Fortran ! comments without treating // as a comment", () => {
    const fortran = language({
      name: "fortran",
      primitives: { lineComment: "!" },
      rules: { Program: () => "program" },
    });
    const { tm, monarch } = generateTextMate(fortran);
    const parsed = JSON.parse(tm);
    const commentStr = JSON.stringify(parsed.repository.comments);
    assert.ok(commentStr.includes("!.*$"), "Fortran should include ! comments");
    assert.ok(!commentStr.includes("//.*$"), "Fortran must not treat // as a comment");
    assert.ok(!monarch.includes("\\/\\/.*$"), "Monarch Fortran must not treat // as a comment");
  });

  it("protects Modelica matrix transpose A' and populates built-in types", () => {
    const modelica = language({
      name: "modelica",
      primitives: { lineComment: "//" },
      rules: { Program: () => "model" },
    });
    const { tm } = generateTextMate(modelica);
    const parsed = JSON.parse(tm);
    const singleQuote = parsed.repository.strings.patterns[1];
    assert.ok(singleQuote.begin.includes("(?<!"), "Modelica single-quote string should use negative lookbehind");
    assert.ok(parsed.repository.types.patterns.length > 0, "Modelica should populate built-in types");
  });

  it("populates STEP section keywords, #id entity refs, and .ENUM. constants", () => {
    const step = language({
      name: "step",
      rules: { Program: () => "DATA" },
    });
    const { tm } = generateTextMate(step);
    const parsed = JSON.parse(tm);
    assert.ok(parsed.repository.keywords.patterns[0].match.includes("ISO-10303-21"));
    const patternsStr = JSON.stringify(parsed.patterns);
    assert.ok(patternsStr.includes("#[0-9]+"));
    assert.ok(patternsStr.includes("constant.language.step"));
  });
});
