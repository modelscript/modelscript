// SPDX-License-Identifier: AGPL-3.0-or-later

import { detectPolyglotLanguage, injectRealisticFault } from "@modelscript/lsp/utils/polyglot-detector.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PolyglotDomainPanel } from "../../../packages/editor/src/workbench/panels/PolyglotDomainPanel.js";
import { decompressMorselPayload } from "../../../packages/editor/src/workbench/util/permalink.js";
import { buildMorselHandoffUrl } from "../../docs/docs/.vitepress/theme/util/polyglot-paste-detector.js";

describe("Polyglot Paste Auto-Detection, Fault Injection & Docs-to-Morsel Handoff", () => {
  it("detects core and specialized engineering dialects from pasted content and filenames", () => {
    const cases: Array<{ content: string; fileName?: string; expectedSlug: string }> = [
      {
        content: "model ChuaCircuit\n  Real x(start=0.7);\nequation\n  der(x) = -x;\nend ChuaCircuit;",
        expectedSlug: "modelica",
      },
      {
        content: "package PowerSupply {\n  part def FilterStage {\n    attribute v_out = 5.0 [V];\n  }\n}",
        expectedSlug: "sysml2",
      },
      {
        content: "* Filter netlist\n.param v_out=3.3\nR1 in out 1k\n.tran 1u 10m",
        expectedSlug: "spice",
      },
      {
        content: "module flange(r=20) {\n  difference() { cube([10, 10, 2]); }\n}",
        expectedSlug: "scad",
      },
      {
        content: '<robot name="arm"><link name="base_link"/><joint name="j1"/></robot>',
        expectedSlug: "urdf",
      },
      {
        content: '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd"><CORE-CONTENT/></REQ-IF>',
        expectedSlug: "reqif",
      },
      {
        content: "<AUTOSAR><AR-PACKAGES><AR-PACKAGE/></AR-PACKAGES></AUTOSAR>",
        expectedSlug: "autosar",
      },
      {
        content: "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('STEP'), '2;1');",
        expectedSlug: "step",
      },
      {
        content: "0,100.0 / PSS/E RAW\n0 / END OF BUS DATA",
        expectedSlug: "psse",
      },
      {
        content: "Clear\nNew Circuit.Test\nNew Line.L1 Bus1=A Bus2=B",
        expectedSlug: "opendss",
      },
      {
        content: "[JUNCTIONS]\nJ1 100 0\n[PIPES]\nP1 J1 J2 1000 300 100",
        expectedSlug: "epanet",
      },
      {
        content: "[SUBCATCHMENTS]\nS1 G1 N1 5\n[CONDUITS]\nC1 N1 N2 100 0.013",
        expectedSlug: "swmm",
      },
      {
        content: '<sbml xmlns="http://www.sbml.org/sbml/level3"><model><listOfSpecies/></model></sbml>',
        expectedSlug: "sbml",
      },
      {
        content: "*HEADING\nCantilever Beam\n*MATERIAL, NAME=STEEL\n*ELASTIC",
        expectedSlug: "fea",
      },
      {
        content: "PROGRAM MainCtrl\nVAR x : INT; END_VAR\nEND_PROGRAM",
        expectedSlug: "plcopen",
      },
      {
        content: "phases:\n  - name: gas\n    thermo: ideal-gas\nreactions: all",
        expectedSlug: "cantera",
      },
      {
        content: "# GHz S MA R 50\n1.0 0.9 0 0.1 90 0.1 90 0.9 0",
        expectedSlug: "touchstone",
      },
      {
        content: "unknown plain header line",
        fileName: "motor.arxml",
        expectedSlug: "autosar",
      },
    ];

    for (const c of cases) {
      const match = detectPolyglotLanguage(c.content, c.fileName);
      assert.ok(match, `Expected dialect match for ${c.expectedSlug}`);
      assert.equal(match.slug, c.expectedSlug);
    }
  });

  it("injects dialect-specific fault mutations without returning unchanged source", () => {
    for (const [slug, code] of [
      ["modelica", "model M\n  Real x;\nequation\n  der(x) = -x;\nend M;"],
      ["sysml2", "package P {\n  part def B {}\n}"],
      ["spice", "R1 in out 1k"],
      ["scad", "cube([1, 2, 3]);"],
      ["urdf", '<robot name="r"><link name="l"/></robot>'],
      ["psse", "1,'BUS1',138.0,1,1,1,1,1.0,0.0"],
      ["epanet", "[JUNCTIONS]\nJ1 10 0"],
    ] as const) {
      const faulted = injectRealisticFault(slug, code);
      assert.notEqual(faulted.code, code);
      assert.ok(faulted.label.length > 0);
    }
  });

  it("encodes multi-file docs sandbox state into #m= deflate hash readable by decompressMorselPayload", async () => {
    const tabs = [
      {
        fileName: "PowerSupply.sysml",
        langSlug: "sysml2",
        code: "package PowerSupply {\n  part def FilterStage { attribute v_out = 5.0 [V]; }\n}",
      },
      {
        fileName: "FilterStage.sp",
        langSlug: "spice",
        code: "* @twin: v_out <-> PowerSupply::FilterStage.v_out\n.param v_out=3300",
      },
    ];

    const url = await buildMorselHandoffUrl("https://ansatz.social", tabs, 1);
    assert.ok(url.startsWith("https://ansatz.social/editor#m="), `Expected compressed #m= permalink, got: ${url}`);

    const hash = url.slice(url.indexOf("#"));
    const decoded = decompressMorselPayload(hash) as
      | (ReturnType<typeof decompressMorselPayload> & {
          files?: Record<string, string>;
          activeFile?: string;
          isMultiFile?: boolean;
        })
      | null;

    assert.ok(decoded, "Expected decompressMorselPayload to inflate CompressionStream('deflate') token");
    assert.equal(decoded.dialect, "spice");
    assert.equal(decoded.lang, "spice");
    assert.equal(decoded.activeFile, "FilterStage.sp");
    assert.equal(decoded.isMultiFile, true);
    assert.equal(decoded.files?.["PowerSupply.sysml"], tabs[0]!.code);
    assert.equal(decoded.files?.["FilterStage.sp"], tabs[1]!.code);
    assert.equal(decoded.code, tabs[1]!.code);
  });

  it("renders Verify Digital Thread action in PolyglotDomainPanel", () => {
    const html = renderToStaticMarkup(
      React.createElement(PolyglotDomainPanel, {
        dialect: "sysml2",
        code: "package PowerSupply {\n  part def FilterStage { attribute v_out = 5.0 [V]; }\n}",
        documentUri: "file:///PowerSupply.sysml",
        colorMode: "dark",
      }),
    );
    assert.ok(html.includes("Verify Digital Thread"));
  });
});
