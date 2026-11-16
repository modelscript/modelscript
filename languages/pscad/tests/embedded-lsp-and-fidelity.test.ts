// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPscadCompletions, getPscadHover } from "../src/catalog/master-library-schemas.js";
import { pscadLanguage, runPscadSimulationPipeline } from "../src/language.js";
import { lintPscx } from "../src/lints/index.js";
import { parsePscx } from "../src/parser/pscx-parser.js";

const SAMPLE_UDM_PSCX = `<project name="udm_test" version="5.0.2">
  <definitions>
    <Definition name="ctrl_udm" classid="UserCmpDefn">
      <script>
        <segment name="Dsdyn"><![CDATA[
          SUBROUTINE CTRL_UDM()
            NSTORF = NSTORF + 1
            STORF(1) = TIME * 2.0 + SIN($Gain)
          END SUBROUTINE
        ]]></segment>
        <segment name="C"><![CDATA[
          double step_ctrl(double u) {
            double y = u / 0;
            return STORF[0] + y;
          }
        ]]></segment>
      </script>
    </Definition>
  </definitions>
</project>`;

describe("PSCAD embedded Fortran/C LSP delegation & fidelity gating", () => {
  it("delegates Fortran hover and completions inside <segment name='Dsdyn'> CDATA", () => {
    const sinOffset = SAMPLE_UDM_PSCX.indexOf("SIN($Gain)") + 1;
    const hoverSin = getPscadHover(SAMPLE_UDM_PSCX, sinOffset);
    assert.ok(hoverSin, "Expected hover inside Fortran CDATA segment");
    assert.ok(hoverSin.contents.toLowerCase().includes("sin"), `Unexpected hover: ${hoverSin.contents}`);

    const storfOffset = SAMPLE_UDM_PSCX.indexOf("STORF(1)") + 2;
    const hoverStorf = getPscadHover(SAMPLE_UDM_PSCX, storfOffset);
    assert.ok(hoverStorf);
    assert.ok(hoverStorf.contents.includes("EMTDC"), `Expected EMTDC STORF doc, got: ${hoverStorf.contents}`);

    const completions = getPscadCompletions(SAMPLE_UDM_PSCX, storfOffset);
    assert.ok(completions.some((c) => c.label === "STORF"));
    assert.ok(completions.some((c) => c.label === "subroutine" || c.label === "matmul"));
  });

  it("delegates C hover, completions, and M6069 diagnostics inside <segment name='C'> CDATA", () => {
    const doubleOffset = SAMPLE_UDM_PSCX.indexOf("double y") + 2;
    const hoverC = getPscadHover(SAMPLE_UDM_PSCX, doubleOffset);
    assert.ok(hoverC, "Expected hover inside C CDATA segment");
    assert.ok(hoverC.contents.toLowerCase().includes("double"), `Unexpected C hover: ${hoverC.contents}`);

    const completions = getPscadCompletions(SAMPLE_UDM_PSCX, doubleOffset);
    assert.ok(completions.some((c) => c.label === "STORF"));
    assert.ok(completions.some((c) => c.label === "memcpy" || c.label === "double"));

    const diags = lintPscx(parsePscx(SAMPLE_UDM_PSCX));
    const cDivZero = diags.find((d) => d.code === "M6069");
    assert.ok(cDivZero, "Expected M6069 embedded C division-by-zero diagnostic");
    assert.ok(
      typeof cDivZero.line === "number" && cDivZero.line > 10,
      `Expected mapped .pscx line > 10, got ${cDivZero.line}`,
    );
  });

  it("surfaces explicit fidelityStatus & fidelitySummary and gates low coverage in simulate_hybrid_emt", async () => {
    const simAction = pscadLanguage.actions?.find((a) => a.id === "simulate_hybrid_emt");
    assert.ok(simAction?.execute);

    // Unsupported-only project (0 sources, dropped custom/unknown def)
    const unsupportedXml = `<project name="incomplete" version="5.0.2">
      <definitions>
        <Definition name="main" classid="Station">
          <schematic>
            <User classid="UserCmp" defn="vendor:MysteryConverter" id="u1" name="u1" x="100" y="100"/>
          </schematic>
        </Definition>
      </definitions>
    </project>`;

    const rejected: any = await simAction.execute({ documentText: unsupportedXml }, {});
    assert.equal(rejected.simulationResult, undefined);
    assert.equal(rejected.simulationReport.status, "rejected");
    assert.ok(rejected.diagnostics.some((d: any) => d.code === "P6100"));

    // Opting out of strictNetlist surfaces fidelitySummary on pipeline report
    const permissive = runPscadSimulationPipeline({
      documentText: unsupportedXml,
      runSimulation: true,
      strictNetlist: false,
    });
    assert.ok(permissive.simulationReport.fidelitySummary.length > 0);
    assert.equal(permissive.simulationReport.status, "degraded");
  });
});
