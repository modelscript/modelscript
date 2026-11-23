// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderJcampDxSpectrumSvg } from "../src/diagram/index.js";
import { jcampDxIndexing } from "../src/indexing.js";
import { jcampDxLanguage } from "../src/language.js";
import { getJcampDxCompletions, getJcampDxDocumentSymbols, getJcampDxHover, validateJcampDx } from "../src/lsp.js";
import { jcampDxToCsv, jcampDxToJson } from "../src/projections/index.js";
import { JcampDxPanel } from "../src/ui/JcampDxPanel.tsx";

const SAMPLE_IR = `##TITLE=Ethanol FTIR
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##FIRSTX=3500
##LASTX=3300
##NPOINTS=5
##XFACTOR=1
##YFACTOR=0.01
##XYDATA=(X++(Y..Y))
3500 95 70 20 68 94
##END=
`;

describe("@modelscript/jcamp-dx LSP, Projections, SVG Diagram & React Panel", () => {
  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateJcampDx(SAMPLE_IR);
    assert.strictEqual(diags.length, 0);

    const symbols = getJcampDxDocumentSymbols(SAMPLE_IR);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "Ethanol FTIR");
    assert.ok((symbols[0]!.children?.length ?? 0) >= 10);

    const hover = getJcampDxHover(SAMPLE_IR, { line: 2, character: 4 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("DATA TYPE"));

    const completions = getJcampDxCompletions("##XY", { line: 0, character: 4 });
    assert.ok(completions.some((c) => c.label === "##XYDATA="));
  });

  it("supports UnifiedWorkspace indexing via jcampDxIndexing", () => {
    assert.strictEqual(jcampDxIndexing.canIndex("sample.jdx", ""), true);
    assert.strictEqual(jcampDxIndexing.canIndex("unknown.txt", SAMPLE_IR), true);
    assert.strictEqual(jcampDxIndexing.canIndex("other.txt", "hello world"), false);
  });

  it("projects spectra to CSV and JSON", () => {
    const csv = jcampDxToCsv(SAMPLE_IR);
    assert.ok(csv.startsWith("1/CM,TRANSMITTANCE\n"));
    assert.ok(csv.includes("3500,0.95"));

    const json = jcampDxToJson(SAMPLE_IR);
    assert.strictEqual(json.title, "Ethanol FTIR");
    assert.strictEqual(json.nPoints, 5);
    assert.strictEqual(json.points.length, 5);
  });

  it("renders pure SVG IR spectrum with reversed X-axis and Absorbance/Transmittance toggle", () => {
    const svgNative = renderJcampDxSpectrumSvg(SAMPLE_IR);
    assert.ok(svgNative.startsWith("<svg "));
    assert.ok(svgNative.includes('data-reverse-x="true"'));
    assert.ok(svgNative.includes("Ethanol FTIR"));
    assert.ok(svgNative.includes("3400 (O-H)"));

    const svgAbs = renderJcampDxSpectrumSvg(SAMPLE_IR, { yMode: "absorbance" });
    assert.ok(svgAbs.includes('data-y-mode="absorbance"'));
    assert.ok(svgAbs.includes("ABSORBANCE (AU)"));
  });

  it("exports interactive JcampDxPanel and registers it in jcampDxLanguage.ui.panels", () => {
    assert.strictEqual(typeof JcampDxPanel, "function");
    assert.ok(
      jcampDxLanguage.ui?.panels?.some((p) => p.id === "jcampDxViewer" && p.entry === "./src/ui/JcampDxPanel.tsx"),
    );
  });
});
