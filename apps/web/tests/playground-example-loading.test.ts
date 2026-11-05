// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { extractPrimaryModelicaClassName } from "../src/components/morsel/util/lsp-bridge.js";

describe("Playground Example Loading & Diagram Synchronization", () => {
  it("extracts primary class name from Modelica models and library examples", () => {
    const untitledCode = `model Untitled "Untitled engineering model"
  annotation(Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
end Untitled;`;
    assert.equal(extractPrimaryModelicaClassName(untitledCode), "Untitled");

    const chuaCircuitCode = `within Modelica.Electrical.Analog.Examples;
model ChuaCircuit "Chua's circuit, ns, V, A"
  extends Modelica.Icons.Example;
  Modelica.Electrical.Analog.Basic.Inductor L(L=18);
end ChuaCircuit;`;
    assert.equal(extractPrimaryModelicaClassName(chuaCircuitCode), "ChuaCircuit");

    const rlcCode = `model RLC "RLC Circuit"
  Modelica.Electrical.Analog.Basic.Resistor R(R=10);
end RLC;`;
    assert.equal(extractPrimaryModelicaClassName(rlcCode), "RLC");
  });

  it("verifies loadClass in Morsel.tsx updates selectedTreeClassName and propagates onCodeChange", () => {
    const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
    const content = fs.readFileSync(morselPath, "utf-8");

    // loadClass must extract the primary class name and set selectedTreeClassName
    assert.ok(
      content.includes("const primaryClassName =") && content.includes("setSelectedTreeClassName(primaryClassName);"),
      "loadClass in Morsel.tsx must set selectedTreeClassName to the loaded class",
    );

    // loadClass must notify props.onCodeChange
    assert.ok(
      content.includes("props.onCodeChange?.(fetchedContent);"),
      "loadClass in Morsel.tsx must propagate loaded source to props.onCodeChange",
    );

    // initialCode effect must also update selectedTreeClassName
    assert.ok(
      content.includes(
        'const primary = dialect === "modelica" || !dialect ? extractPrimaryModelicaClassName(props.initialCode) : null;',
      ),
      "props.initialCode effect in Morsel.tsx must update selectedTreeClassName",
    );
  });

  it("verifies Diagram.tsx always dispatches onRenderComplete in finally block", () => {
    const diagramPath = path.resolve(import.meta.dirname, "../src/components/morsel/Diagram.tsx");
    const content = fs.readFileSync(diagramPath, "utf-8");

    assert.ok(
      content.includes("} finally {") &&
        content.includes("if (props.onRenderComplete) props.onRenderComplete(props.diagramData);"),
      "Diagram.tsx must execute onRenderComplete in finally to prevent infinite diagram spinner",
    );
    assert.ok(
      content.includes("} else if (!props.diagramData && props.onRenderComplete) {"),
      "Diagram.tsx must notify onRenderComplete when diagramData is falsy",
    );
  });

  it("verifies diagram-service.ts falls back to resolving primary class when requested className is stale", () => {
    const servicePath = path.resolve(import.meta.dirname, "../../../packages/lsp/src/services/diagram-service.ts");
    const content = fs.readFileSync(servicePath, "utf-8");

    assert.ok(
      content.includes("classInstance = this.workspaceManager.resolveClassInstance(params.uri);"),
      "diagram-service.ts must fall back to resolving document primary class instance if requested className is not found",
    );
  });

  it("verifies PlaygroundPage.tsx anchors artifact ID regexes and passes initialClassName", () => {
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const content = fs.readFileSync(pagePath, "utf-8");

    // Regexes must be anchored with $ so base64 strings starting with digits are not treated as artifact IDs
    assert.ok(
      content.includes("/^#m=\\d+$/"),
      "PlaygroundPage.tsx must anchor #m=\\d+$ with end-of-string to prevent Base64 false positives",
    );
    assert.ok(content.includes("/^#memfs:\\d+$/"), "PlaygroundPage.tsx must anchor #memfs:\\d+$ with end-of-string");

    // MorselEditor must receive initialClassName
    assert.ok(
      content.includes("initialClassName={extractPrimaryModelicaClassName(currentCode) || undefined}"),
      "PlaygroundPage.tsx must pass initialClassName to MorselEditor",
    );
  });

  it("verifies TemplateGalleryModal supports double-click to select and load templates", () => {
    const modalPath = path.resolve(import.meta.dirname, "../src/pages/playground/components/TemplateGalleryModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");

    assert.ok(
      content.includes("onDoubleClick={() => {") &&
        content.includes("onSelectTemplate(template);") &&
        content.includes("onClose();"),
      "TemplateGalleryModal.tsx must support double-click on template card to select and close",
    );
  });
});
