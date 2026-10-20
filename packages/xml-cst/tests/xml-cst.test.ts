// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  appendChildSplice,
  applySplices,
  initXmlParser,
  parseXml,
  removeElementSplice,
  setAttributeSplice,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("xml-cst", () => {
  before(() => initXmlParser(path.join(here, "../dist/parser.wasm")));

  const src =
    '<?xml version="1.0"?>\r\n<!-- c -->\r\n<a x="1" y=\'2\'>\r\n  <b/>\r\n  <c k="v &amp; w"><![CDATA[ hi <>]]></c>\r\n</a>';

  it("parses elements, attributes, CDATA", () => {
    const d = parseXml(src);
    assert.deepEqual(d.errors, []);
    const a = d.root!;
    assert.equal(a.name, "a");
    assert.equal(a.attributes[1]!.value, "2");
    assert.equal(a.children.length, 2);
    assert.equal(a.children[0]!.selfClosing, true);
    const c = a.children[1]!;
    assert.equal(c.attributes[0]!.value, "v & w");
    assert.equal(c.cdata[0]!.text, " hi <>");
    assert.equal(src.slice(c.start, c.end).startsWith("<c"), true);
    assert.equal(src.slice(c.closeStart, c.end), "</c>");
  });

  it("edits with minimal splices", () => {
    const a = parseXml(src).root!;
    const out = applySplices(src, [setAttributeSplice(a, "x", "9", src), removeElementSplice(a.children[0]!, src)]);
    assert.ok(out.includes('x="9"') && !out.includes("<b/>"));
    const out2 = applySplices(src, [appendChildSplice(a, "<d/>", src)]);
    assert.deepEqual(parseXml(out2).errors, []);
    assert.equal(parseXml(out2).root!.children.length, 3);
  });

  const corpus = path.resolve(here, "../../../.cache/pscad-corpus");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ps[cl]x$|\.pswx$/.test(e.name)) files.push(p);
    }
  };
  if (existsSync(corpus)) walk(corpus);
  for (const f of files) {
    it("corpus " + path.basename(f), () => {
      const s = readFileSync(f, "utf8");
      const d = parseXml(s);
      assert.deepEqual(d.errors.slice(0, 3), []);
      assert.ok(d.root);
    });
  }
});
