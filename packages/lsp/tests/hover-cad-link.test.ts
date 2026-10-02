// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerHoverProvider } from "../src/providers/hoverProvider.js";

describe("Cross-Domain Semantic Navigation: LSP Hover to 3D Anatomy CAD Canvas", () => {
  it("enriches hover with coupled CAD anchor navigation link when CAD annotation is present", () => {
    const uri = "file:///workspace/PacemakerSystem.mo";
    const content = `model PacemakerSystem
  Modelica.Electrical.Analog.Interfaces.PositivePin lead_rv annotation(CAD(uri="modelica://CAD/Lead.glb", feature="rv_lead_anchor"));
  Real ventricle_pressure;
end PacemakerSystem;
`;
    const doc = TextDocument.create(uri, "modelica", 1, content);

    let hoverHandler: any = null;
    const hoverConn: any = {
      onHover: (h: any) => {
        hoverHandler = h;
      },
    };
    const mockDocs: any = {
      get: (u: string) => (u === uri ? doc : undefined),
    };
    const mockBridge: any = {
      hover: () => ({
        contents: "```modelica\nPositivePin lead_rv\n```\nRight-ventricular pacemaker pacing electrode.",
        range: { start: { line: 1, character: 40 }, end: { line: 1, character: 47 } },
      }),
    };
    const validationService: any = {
      documentLSPBridges: new Map([[uri, mockBridge]]),
    };

    registerHoverProvider(hoverConn, mockDocs, validationService);
    assert.ok(hoverHandler);

    // Hover over lead_rv
    const hoverOffset = content.indexOf("lead_rv");
    const hoverPos = doc.positionAt(hoverOffset);

    const result = hoverHandler({
      textDocument: { uri },
      position: hoverPos,
    });

    assert.ok(result);
    assert.ok(result.contents.value.includes("Coupled 3D CAD Anchor:"));
    assert.ok(result.contents.value.includes("Inspect in 3D Anatomy Canvas"));
    assert.ok(result.contents.value.includes("command:modelscript.focusCadPart?"));

    const decoded = decodeURIComponent(result.contents.value);
    assert.ok(decoded.includes('"partName":"rv_lead_anchor"'));
  });

  it("enriches hover for biomedical organ & device components based on coupling domain rules", () => {
    const uri = "file:///workspace/CardiacSuction.mo";
    const content = `model CardiacSuction
  Real cannula_clearance;
  Real left_ventricle_volume;
end CardiacSuction;
`;
    const doc = TextDocument.create(uri, "modelica", 1, content);

    let hoverHandler: any = null;
    const hoverConn: any = {
      onHover: (h: any) => {
        hoverHandler = h;
      },
    };
    const mockDocs: any = {
      get: (u: string) => (u === uri ? doc : undefined),
    };
    const mockBridge: any = {
      hover: () => ({
        contents: "```modelica\nReal cannula_clearance\n```\nInstantaneous spatial clearance to left ventricular wall.",
        range: { start: { line: 1, character: 7 }, end: { line: 1, character: 24 } },
      }),
    };
    const validationService: any = {
      documentLSPBridges: new Map([[uri, mockBridge]]),
    };

    registerHoverProvider(hoverConn, mockDocs, validationService);

    // Hover over cannula_clearance
    const hoverOffset = content.indexOf("cannula_clearance");
    const hoverPos = doc.positionAt(hoverOffset);

    const result = hoverHandler({
      textDocument: { uri },
      position: hoverPos,
    });

    assert.ok(result);
    assert.ok(result.contents.value.includes("Coupled 3D CAD Anchor:"));
    assert.ok(result.contents.value.includes("Inspect in 3D Anatomy Canvas"));
    const decoded = decodeURIComponent(result.contents.value);
    assert.ok(decoded.includes('"partName":"cannula_clearance"'));
  });
});
