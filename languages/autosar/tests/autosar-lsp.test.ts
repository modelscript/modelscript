// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAutosarAction, getAutosarDocumentSymbols, getAutosarHover, validateAutosar } from "../src/lsp.js";
import { AutosarWorkspaceIndex } from "../src/workspace-index.js";

const VALID_ARXML = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Brakes</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>AbsController</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE>
              <SHORT-NAME>BrakePressureOut</SHORT-NAME>
              <PROVIDED-INTERFACE-TREF>/Brakes/PressureIf</PROVIDED-INTERFACE-TREF>
            </P-PORT-PROTOTYPE>
          </PORTS>
          <INTERNAL-BEHAVIORS>
            <SWC-INTERNAL-BEHAVIOR>
              <SHORT-NAME>Abs_IB</SHORT-NAME>
              <RUNNABLES>
                <RUNNABLE-ENTITY>
                  <SHORT-NAME>RE_ModulatePressure</SHORT-NAME>
                  <DATA-READ-ACCESSS/>
                  <DATA-WRITE-ACCESSS/>
                </RUNNABLE-ENTITY>
              </RUNNABLES>
              <EVENTS>
                <TIMING-EVENT>
                  <SHORT-NAME>TE_5ms</SHORT-NAME>
                  <START-ON-EVENT-REF>RE_ModulatePressure</START-ON-EVENT-REF>
                  <PERIOD>0.005</PERIOD>
                </TIMING-EVENT>
              </EVENTS>
            </SWC-INTERNAL-BEHAVIOR>
          </INTERNAL-BEHAVIORS>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`;

describe("AUTOSAR LSP Services & Workspace Index (@modelscript/autosar)", () => {
  it("should validate clean ARXML without diagnostics", () => {
    const diags = validateAutosar(VALID_ARXML);
    assert.equal(diags.length, 0);
  });

  it("should extract hierarchical document symbols", () => {
    const symbols = getAutosarDocumentSymbols(VALID_ARXML);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "Brakes");
    assert.equal(symbols[0]?.children?.length, 1);
    assert.equal(symbols[0]?.children?.[0]?.name, "AbsController");
  });

  it("should generate hover markdown for SWC elements", () => {
    const hover = getAutosarHover(VALID_ARXML, { line: 6, character: 15 });
    assert.ok(hover);
    assert.ok(hover?.contents.value.includes("AUTOSAR SWC `AbsController`"));
  });

  it("should execute custom actions: lint, to_modelica, to_sysml, to_dae, simulate_rte", async () => {
    const lintRes = await executeAutosarAction("lint", { content: VALID_ARXML });
    assert.ok(Array.isArray(lintRes));

    const moRes = await executeAutosarAction("to_modelica", { content: VALID_ARXML });
    assert.ok(typeof moRes === "string");
    assert.ok(moRes.includes("model AbsController"));

    const sysmlRes = await executeAutosarAction("to_sysml", { content: VALID_ARXML });
    assert.ok(typeof sysmlRes === "string");
    assert.ok(sysmlRes.includes("part def AbsController"));

    const daeRes = await executeAutosarAction("to_dae", { content: VALID_ARXML });
    assert.ok(daeRes.varCount >= 1);

    const rteRes = await executeAutosarAction("simulate_rte", { content: VALID_ARXML, duration: 0.02, dt: 0.005 });
    assert.ok(Array.isArray(rteRes));
    assert.ok(rteRes.length >= 3);
  });

  it("should index and resolve symbols across workspace via AutosarWorkspaceIndex", () => {
    const index = new AutosarWorkspaceIndex();
    index.indexFile("file:///workspace/abs.arxml", VALID_ARXML);

    assert.equal(index.fileCount, 1);
    const results = index.lookup("AbsController");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.name, "AbsController");
    assert.equal(results[0]?.kind, "Class");

    const portResults = index.lookup("BrakePressureOut");
    assert.equal(portResults.length, 1);
    assert.equal(portResults[0]?.kind, "Component");
  });
});
