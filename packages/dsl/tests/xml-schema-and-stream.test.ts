// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendChildSplice,
  applySplices,
  createXmlCstTree,
  ensureXmlParser,
  parseXml,
  removeElementSplice,
  setAttributeSplice,
  xmlAttr,
  xmlChild,
  xmlElement,
  xmlLanguage,
  XmlStreamReader,
  type XmlCstNode,
} from "../src/xml/index.js";

describe("XML DSL Integration, CST Adapter, Schema & Streaming Suite", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="TestProject" version="5.1.0">
  <paramlist name="Settings">
    <param name="time_step" value="25.0"/>
    <param name="duration" value="1.5"/>
  </paramlist>
  <definitions>
    <Definition name="Main">
      <schematic>
        <User id="U1" defn="source_3p" x="100" y="200" orient="0">
          <param name="Name" value="Gen1"/>
          <port name="out" pos="[20, 0]"/>
        </User>
        <User id="U2" defn="resistor" x="300" y="200" orient="1">
          <param name="R" value="50.0"/>
          <port name="p1" pos="[-18, 0]"/>
          <port name="p2" pos="[18, 0]"/>
        </User>
        <Wire id="W1">
          <vertex x="120" y="200"/>
          <vertex x="282" y="200"/>
        </Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  it("parses XML into lossless XmlDocument via @modelscript/dsl/xml", () => {
    ensureXmlParser();
    const doc = parseXml(sampleXml);
    assert.ok(doc.root, "Expected valid root element");
    assert.equal(doc.root.name, "project");
    assert.equal(doc.root.attributes.find((a) => a.name === "name")?.value, "TestProject");
    assert.equal(doc.root.attributes.find((a) => a.name === "version")?.value, "5.1.0");
    assert.equal(doc.errors.length, 0);
  });

  it("provides rich SyntaxNode CST API parity via XmlCstNode and createXmlCstTree", () => {
    const doc = parseXml(sampleXml);
    const tree = createXmlCstTree(doc);
    assert.ok(tree.rootNode, "Expected rootNode in Tree");
    assert.equal(tree.rootNode.type, "project");

    // Children & Navigation
    assert.ok(tree.rootNode.children.length >= 2);
    const defsNode = tree.rootNode.childForFieldName("definitions");
    assert.ok(defsNode, "Expected definitions child node");
    assert.equal(defsNode.type, "definitions");
    assert.equal(defsNode.parent, tree.rootNode);

    // closest()
    const wireNode = tree.rootNode.descendantForIndex(sampleXml.indexOf('<Wire id="W1">') + 2);
    assert.ok(wireNode, "Expected wire node from index");
    const ancestorDef = wireNode.closest("Definition") as XmlCstNode;
    assert.ok(ancestorDef, "Expected closest Definition ancestor");
    assert.equal(ancestorDef.attr("name"), "Main");

    // TreeCursor walking
    const cursor = tree.rootNode.walk();
    assert.equal(cursor.nodeType, "project");
    assert.ok(cursor.gotoFirstChild(), "Expected to navigate to first child");
    assert.ok(cursor.gotoNextSibling(), "Expected to navigate to next sibling");
  });

  it("validates and instantiates typed ASTs using declarative xmlLanguage schema", () => {
    const pscadSchema = xmlLanguage({
      name: "pscad",
      fileExtensions: [".pscx"],
      root: "Project",
      elements: {
        Project: xmlElement("project", {
          attributes: {
            name: xmlAttr.string({ required: true }),
            version: xmlAttr.string({ default: "5.0" }),
          },
          children: {
            settings: xmlChild.optional("Settings", {
              tag: "paramlist",
              match: (el) => el.attributes.some((a) => a.name === "name" && a.value === "Settings"),
            }),
            definitions: xmlChild.repeat("Definition", { container: "definitions", tag: "Definition" }),
          },
        }),
        Settings: xmlElement("paramlist", {
          children: {
            params: xmlChild.dictionary("Param", {
              tag: "param",
              key: (el) => el.attributes.find((a) => a.name === "name")?.value ?? "",
              value: (el) => parseFloat(el.attributes.find((a) => a.name === "value")?.value ?? "0"),
            }),
          },
        }),
        Definition: xmlElement("Definition", {
          attributes: {
            name: xmlAttr.string({ required: true }),
          },
          children: {
            schematic: xmlChild.optional("Schematic", { tag: "schematic" }),
          },
        }),
        Schematic: xmlElement("schematic", {
          children: {
            users: xmlChild.repeat("User", { tag: "user" }),
            wires: xmlChild.repeat("Wire", { tag: "wire" }),
          },
        }),
        User: xmlElement("User", {
          attributes: {
            id: xmlAttr.string({ required: true }),
            defn: xmlAttr.string({ required: true }),
            x: xmlAttr.number({ default: 0 }),
            y: xmlAttr.number({ default: 0 }),
            orient: xmlAttr.number({ default: 0 }),
          },
        }),
        Wire: xmlElement("Wire", {
          attributes: {
            id: xmlAttr.string({ optional: true }),
          },
        }),
      },
    });

    const diagnostics = pscadSchema.validate(sampleXml);
    assert.equal(diagnostics.length, 0, `Expected 0 validation diagnostics, got: ${JSON.stringify(diagnostics)}`);

    const ast = pscadSchema.instantiate(sampleXml) as any;
    assert.equal(ast.$type, "Project");
    assert.equal(ast.name, "TestProject");
    assert.equal(ast.version, "5.1.0");

    assert.equal(ast.settings.params["time_step"], 25.0);
    assert.equal(ast.settings.params["duration"], 1.5);

    assert.equal(ast.definitions.length, 1);
    const mainDef = ast.definitions[0];
    assert.equal(mainDef.name, "Main");
    assert.equal(mainDef.schematic.users.length, 2);
    assert.equal(mainDef.schematic.users[0].id, "U1");
    assert.equal(mainDef.schematic.users[0].defn, "source_3p");
    assert.equal(mainDef.schematic.users[0].x, 100);
    assert.equal(mainDef.schematic.users[1].id, "U2");
    assert.equal(mainDef.schematic.users[1].orient, 1);
    assert.equal(mainDef.schematic.wires.length, 1);
    assert.equal(mainDef.schematic.wires[0].id, "W1");
  });

  it("streams XML tokens and windowed subtrees with constant memory via XmlStreamReader", async () => {
    const reader = new XmlStreamReader(sampleXml);

    const users: string[] = [];
    for await (const userEl of reader.iterateElements("User")) {
      const id = userEl.attributes.find((a) => a.name.toLowerCase() === "id")?.value;
      if (id) users.push(id);
    }

    assert.deepEqual(users, ["U1", "U2"], "Expected streamed User elements to match U1, U2");
  });

  it("applies surgical text splices via @modelscript/dsl/xml", () => {
    const doc = parseXml(sampleXml);
    const userEl = doc
      .root!.children.find((c) => c.name === "definitions")!
      .children.find((c) => c.name === "Definition")!
      .children.find((c) => c.name === "schematic")!
      .children.find((c) => c.name === "User")!;

    const splice = setAttributeSplice(userEl, "x", "999", sampleXml);
    const patched = applySplices(sampleXml, [splice]);

    assert.ok(patched.includes('x="999"'));
    assert.ok(patched.includes('id="U1"'));
  });

  it("parses elements, attributes, CDATA and edits with minimal splices", () => {
    const src =
      '<?xml version="1.0"?>\r\n<!-- c -->\r\n<a x="1" y=\'2\'>\r\n  <b/>\r\n  <c k="v &amp; w"><![CDATA[ hi <>]]></c>\r\n</a>';
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

    const out = applySplices(src, [setAttributeSplice(a, "x", "9", src), removeElementSplice(a.children[0]!, src)]);
    assert.ok(out.includes('x="9"') && !out.includes("<b/>"));
    const out2 = applySplices(src, [appendChildSplice(a, "<d/>", src)]);
    assert.deepEqual(parseXml(out2).errors, []);
    assert.equal(parseXml(out2).root!.children.length, 3);
  });
});
