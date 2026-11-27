// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CstBlockAdapter,
  CstDocumentSession,
  CstRecordAdapter,
  CstTransaction,
  CstXmlAdapter,
  type CstIncrementalParser,
} from "../src/index.js";
import { getXmlWasmParser } from "../src/xml/index.js";

describe("CstDocumentSession + CstTransaction + Adapters", () => {
  it("performs surgical XML attribute, child, delete, and multi-edit coalescing via CstXmlAdapter", () => {
    const xml = [
      `<project name="Demo" version="5.0.2">`,
      `  <definitions>`,
      `    <Definition name="Main" classid="UserCmpDefn">`,
      `      <schematic>`,
      `        <User classid="UserCmp" defn="master:resistor" id="10" x="108" y="144" orient="0"/>`,
      `        <User classid="UserCmp" defn="master:inductor" id="20" x="216" y="144" orient="0"/>`,
      `      </schematic>`,
      `    </Definition>`,
      `  </definitions>`,
      `</project>`,
      "",
    ].join("\r\n");

    const wasmParser = getXmlWasmParser() as unknown as CstIncrementalParser | null;
    const session = new CstDocumentSession({
      uri: "file:///demo.pscx",
      text: xml,
      parser: wasmParser,
      xmlFallback: true,
    });
    assert.ok(session.rootNode, "session must produce a root CST node");
    assert.equal(session.eol, "\r\n");

    const u10 = CstXmlAdapter.findElementByAttr(session.rootNode, session.text, "id", "10", "User");
    assert.ok(u10, 'must locate <User id="10"> in CST');

    const tx = new CstTransaction(session);
    CstXmlAdapter.setAttribute(tx, u10, "x", "180");
    CstXmlAdapter.setAttribute(tx, u10, "y", "216");
    CstXmlAdapter.setAttribute(tx, u10, "disabled", "true");

    const schematic = CstXmlAdapter.findElements(session.rootNode, session.text, (_n, tag) => tag === "schematic")[0]!;
    assert.ok(schematic);
    CstXmlAdapter.appendChild(
      tx,
      schematic,
      `<User classid="UserCmp" defn="master:capacitor" id="30" x="300" y="144"/>`,
    );
    CstXmlAdapter.appendChild(tx, schematic, `<Wire id="40"><vertex x="180" y="216"/><vertex x="300" y="144"/></Wire>`);

    const res = tx.commit();
    assert.equal(res.skipped.length, 0);
    const updated = res.applyToString();

    assert.match(updated, /id="10" x="180" y="216" orient="0" disabled="true"\/>/);
    assert.match(updated, /id="20" x="216" y="144" orient="0"\/>/); // untouched sibling verbatim
    assert.match(updated, /<User classid="UserCmp" defn="master:capacitor" id="30"/);
    assert.match(updated, /<Wire id="40">/);
    assert.ok(updated.includes("\r\n"), "must preserve CRLF EOL");

    // Incremental update of the live CST session using minimal deltas
    session.setText(updated);
    const u30 = CstXmlAdapter.findElementByAttr(session.rootNode, session.text, "id", "30", "User");
    assert.ok(u30, "incremental CST update must immediately index newly inserted element");
    const attrs30 = CstXmlAdapter.getAttributes(u30, session.text);
    assert.equal(attrs30.find((a) => a.name === "x")?.value, "300");

    // Delete <User id="20"> cleanly
    const u20 = CstXmlAdapter.findElementByAttr(session.rootNode, session.text, "id", "20", "User");
    assert.ok(u20);
    const txDel = new CstTransaction(session);
    CstXmlAdapter.deleteElement(txDel, u20);
    const afterDel = txDel.commit().applyToString();
    assert.ok(!afterDel.includes(`id="20"`));
    assert.ok(afterDel.includes(`id="10"`));
    assert.ok(afterDel.includes(`id="30"`));
    session.dispose();
  });

  it("expands self-closing <schematic/> and preserves \\r\\r\\n PSCAD line endings", () => {
    const xml = `<project name="Empty">\r\r\n  <Definition name="Main">\r\r\n    <schematic/>\r\r\n  </Definition>\r\r\n</project>\r\r\n`;
    const session = new CstDocumentSession({
      uri: "file:///empty.pscx",
      text: xml,
      parser: getXmlWasmParser() as unknown as CstIncrementalParser | null,
      xmlFallback: true,
    });
    assert.equal(session.eol, "\r\r\n");

    const schematic = CstXmlAdapter.findElements(session.rootNode, session.text, (_n, tag) => tag === "schematic")[0]!;
    const tx = new CstTransaction(session);
    CstXmlAdapter.appendChild(tx, schematic, `<User id="1" x="72" y="72"/>`);
    const out = tx.commit().applyToString();

    assert.ok(out.includes('<schematic>\r\r\n      <User id="1" x="72" y="72"/>\r\r\n    </schematic>'));
    session.dispose();
  });

  it("remains error-tolerant when sibling XML is malformed or </schematic> is missing", () => {
    // Broken sibling tag (<User id="broken" x="100) AND unclosed </schematic>
    const brokenXml = [
      `<project name="Broken">`,
      `  <definitions>`,
      `    <Definition name="Main">`,
      `      <schematic>`,
      `        <User id="broken" x="100`,
      `        <User id="good" x="144" y="180" orient="0"/>`,
      `    </Definition>`,
      `  </definitions>`,
      `</project>`,
    ].join("\n");

    const session = new CstDocumentSession({
      uri: "file:///broken.pscx",
      text: brokenXml,
      parser: getXmlWasmParser() as unknown as CstIncrementalParser | null,
      xmlFallback: true,
    });
    assert.ok(session.rootNode, "must still produce a partial CST root despite errors");

    const goodNode = CstXmlAdapter.findElementByAttr(session.rootNode, session.text, "id", "good", "User");
    assert.ok(goodNode, 'must locate healthy sibling <User id="good"> past broken sibling');

    const tx = new CstTransaction(session);
    CstXmlAdapter.setAttribute(tx, goodNode, "x", "288");
    const schematic = CstXmlAdapter.findElements(session.rootNode, session.text, (_n, tag) => tag === "schematic")[0];
    if (schematic) {
      CstXmlAdapter.appendChild(tx, schematic, `<User id="added" x="360" y="180"/>`);
    }
    const updated = tx.commit().applyToString();

    // Healthy sibling updated, broken sibling untouched verbatim, new element inserted safely
    assert.ok(updated.includes(`<User id="broken" x="100`), "broken sibling must remain verbatim");
    assert.ok(updated.includes(`<User id="good" x="288" y="180" orient="0"/>`), "healthy sibling must be updated");
    assert.ok(
      updated.includes(`<User id="added" x="360" y="180"/>`),
      "new child must be inserted despite missing </schematic>",
    );
    session.dispose();
  });

  it("supports CstRecordAdapter surgical field and comment-tag edits", () => {
    const raw = `   101, 'BUS_ONE     ', 230.000, 3, 1, 1, 1, 1.0200,  0.0000 / original comment\n0 / END OF BUS DATA\n`;
    const session = new CstDocumentSession({ uri: "file:///case.raw", text: raw });
    const fakeRecordNode = {
      type: "BusRecord",
      startIndex: 0,
      endIndex: raw.indexOf("\n"),
      startOffset: 0,
      endOffset: raw.indexOf("\n"),
      text: raw.slice(0, raw.indexOf("\n")),
      children: [],
    } as never;

    const tx = new CstTransaction(session);
    CstRecordAdapter.upsertTrailingCommentTag(
      tx,
      fakeRecordNode,
      "/",
      /@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i,
      "@pos(320, 140)",
    );
    const out = tx.commit().applyToString();
    assert.ok(out.includes("1.0200,  0.0000 / original comment @pos(320, 140)"), `got: ${out}`);

    // Update existing @pos tag in place without altering any column precision or comments
    session.setText(out);
    const lineEnd = out.indexOf("\n");
    const tx2 = new CstTransaction(session);
    CstRecordAdapter.upsertTrailingCommentTag(
      tx2,
      {
        type: "BusRecord",
        startIndex: 0,
        endIndex: lineEnd,
        startOffset: 0,
        endOffset: lineEnd,
        children: [],
      } as never,
      "/",
      /@pos\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/i,
      "@pos(400, 220)",
    );
    const out2 = tx2.commit().applyToString();
    assert.ok(out2.includes("1.0200,  0.0000 / original comment @pos(400, 220)"), `got: ${out2}`);
    session.dispose();
  });

  it("supports CstBlockAdapter error-resilient statement insertion into unclosed blocks", () => {
    const src = `package Demo {\n  part a : Resistor;\n`;
    const session = new CstDocumentSession({ uri: "file:///demo.sysml", text: src });
    const childStart = src.indexOf("part a");
    const childEnd = src.indexOf(";") + 1;
    const blockNode = {
      type: "PackageBody",
      startIndex: src.indexOf("{"),
      endIndex: src.length,
      startOffset: src.indexOf("{"),
      endOffset: src.length,
      children: [
        {
          type: "{",
          startIndex: src.indexOf("{"),
          endIndex: src.indexOf("{") + 1,
          startOffset: src.indexOf("{"),
          endOffset: src.indexOf("{") + 1,
          children: [],
        },
        {
          type: "PartUsage",
          startIndex: childStart,
          endIndex: childEnd,
          startOffset: childStart,
          endOffset: childEnd,
          children: [],
        },
      ],
    } as never;

    const tx = new CstTransaction(session);
    CstBlockAdapter.insertStatement(tx, blockNode, "part b : Capacitor;");
    const out = tx.commit().applyToString();
    assert.ok(out.includes("  part a : Resistor;\n  part b : Capacitor;"), `got: ${out}`);
    session.dispose();
  });
});
