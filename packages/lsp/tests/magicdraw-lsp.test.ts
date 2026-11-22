// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  getMagicDrawDiagnostics,
  getMagicDrawDocumentSymbols,
  getMagicDrawHover,
  magicDrawLanguage,
} from "@modelscript/magicdraw";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LanguageRegistry } from "../src/registry/LanguageRegistry.js";

describe("LSP integration for @modelscript/magicdraw (.mdzip, .mdxml, .xmi)", () => {
  it("resolves magicdraw plugin by extension and XML header sniffing and serves symbols, diagnostics, and hover", () => {
    const registry = new LanguageRegistry();
    registry.register({
      id: "magicdraw",
      name: "MagicDraw / Cameo",
      extensions: [".mdzip", ".mdxml", ".xmi"],
      languageDef: magicDrawLanguage,
      symbols: getMagicDrawDocumentSymbols as never,
      validate: (text: string) => getMagicDrawDiagnostics(text) as never,
      customHandlers: {
        hover: (offset: number, text: string) => getMagicDrawHover(text, offset) as never,
      },
    });

    const byMdzip = registry.getPluginForUri("file:///models/System.mdzip");
    assert.strictEqual(byMdzip?.id, "magicdraw");

    const byMdxml = registry.getPluginForUri("file:///models/System.mdxml");
    assert.strictEqual(byMdxml?.id, "magicdraw");

    const byXmi = registry.getPluginForUri("file:///models/System.xmi");
    assert.strictEqual(byXmi?.id, "magicdraw");

    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m1" name="LspTestModel">
          <packagedElement xmi:type="uml:Class" xmi:id="b1" name="Actuator"/>
        </uml:Model>
        <sysml:Block xmi:id="s1" base_Class="b1"/>
      </xmi:XMI>`;

    const bySniff = registry.getPluginForUri("file:///models/exported.xml", sampleXml);
    assert.strictEqual(bySniff?.id, "magicdraw");

    const syms = byMdxml?.symbols?.(sampleXml) ?? [];
    assert.ok(syms.length >= 1);
    const diags = byMdxml?.validate?.(sampleXml) ?? [];
    assert.strictEqual(diags.length, 0);
  });
});
