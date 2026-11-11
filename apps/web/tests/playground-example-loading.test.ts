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

  it("verifies Tree.tsx double-click loads simulation models while ignoring package/library container nodes", () => {
    const treePath = path.resolve(import.meta.dirname, "../src/components/morsel/Tree.tsx");
    const content = fs.readFileSync(treePath, "utf-8");

    assert.ok(
      content.includes("if (e.detail >= 2) return;"),
      "Tree.tsx onClick must ignore second click of double-click so double-clicking does not double-fire or collapse",
    );
    assert.ok(
      content.includes('node.classKind === "package"') &&
        content.includes('node.id.startsWith("__LIB__:")') &&
        content.includes("if (isNonLoadableContainer) return;"),
      "Tree.tsx onDoubleClick must not attempt to load package or __LIB__: root containers into the editor",
    );
  });

  it("verifies Morsel.tsx loadClass works even before Monaco mounts (Diagram view) and avoids false-positive dirty freezes", () => {
    const morselPath = path.resolve(import.meta.dirname, "../src/components/morsel/Morsel.tsx");
    const modalsPath = path.resolve(import.meta.dirname, "../src/components/morsel/panels/MorselModals.tsx");
    const pagePath = path.resolve(import.meta.dirname, "../src/pages/PlaygroundPage.tsx");
    const morselContent = fs.readFileSync(morselPath, "utf-8");
    const modalsContent = fs.readFileSync(modalsPath, "utf-8");
    const pageContent = fs.readFileSync(pagePath, "utf-8");

    // Must NOT gate loadClass on editorRef.current being mounted
    assert.ok(
      !morselContent.includes("if (fetchedContent && editorRef.current)"),
      "loadClass in Morsel.tsx must not drop fetched model source when Monaco editorRef.current is null in Diagram view",
    );
    assert.ok(
      morselContent.includes("setLoadedCodeOverride(fetchedContent);") &&
        morselContent.includes(
          "if (editorRef.current) {\n          editorRef.current.setValue(fetchedContent);\n        }",
        ),
      "loadClass in Morsel.tsx must persist loadedCodeOverride and conditionally update Monaco if mounted",
    );

    // Dirty check must not treat unmounted editor (undefined) as dirty or fall through when pendingSelection matches
    assert.ok(
      morselContent.includes("currentEditorVal !== undefined && !isDefaultOrEmpty") &&
        !morselContent.includes("pendingSelection !== className"),
      "handleTreeSelect in Morsel.tsx must not trigger false-positive dirty dialog when editor is unmounted or bypass an open dirty dialog on second click",
    );

    // Closing dirty dialog must reset pendingSelection
    assert.ok(
      modalsContent.includes("setDirtyDialogOpen(false);\n            setPendingSelection(null);"),
      "MorselModals.tsx must clear pendingSelection when closing Unsaved Changes dialog",
    );

    // PlaygroundPage must handle onClassLoaded so freshly loaded library examples update title & baseline without false dirty state
    assert.ok(
      pageContent.includes("const handleClassLoaded =") && pageContent.includes("onClassLoaded={handleClassLoaded}"),
      "PlaygroundPage.tsx must wire onClassLoaded to update baselineCodeRef and title cleanly",
    );
  });
});
