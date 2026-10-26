// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import { spiceLanguage } from "../src/language.js";
import { parseSpice } from "../src/parser/spice-parser.js";
import { parseModelicaElectrical, synchronizeModelicaToSpice } from "../src/tgg/spice-sync.js";

const SAMPLE_CIRCUIT = `* RC Low-Pass Filter with Directives
V1 in 0 5.0
R1 in out 1000
C1 out 0 1e-6
.TRAN 1u 5m
.END
`;

describe("SPICE Bidirectional TGG Round-Trip Synchronization (@modelscript/spice)", () => {
  it("should compile all declarative SPICE TGG rules via compileTGGRules()", () => {
    assert.ok(spiceLanguage.polyglot, "SPICE language must define polyglot config");
    const compiled = compileTGGRules(spiceLanguage.polyglot);
    assert.strictEqual(compiled.ruleCount, 7, "Should declare 7 TGG rules");
    assert.ok(compiled.sourceCode.includes("tgg_forward_SpiceResistorToModelicaResistor"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_SpiceCapacitorToModelicaCapacitor"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_SpiceVoltageSourceToModelicaConstantVoltage"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_dispatch"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_dispatch"));
  });

  it("should parse Modelica electrical declarations correctly", () => {
    const moText = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=4700);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=2.2e-6);
  Modelica.Electrical.Analog.Sources.ConstantVoltage V1(V=12.0);
equation
  connect(V1.p, R1.p);
end RcFilter;`;

    const parsed = parseModelicaElectrical(moText);
    assert.strictEqual(parsed.components.size, 3);
    assert.strictEqual(parsed.components.get("R1")?.value, 4700);
    assert.strictEqual(parsed.components.get("C1")?.value, 2.2e-6);
    assert.strictEqual(parsed.components.get("V1")?.value, 12.0);
  });

  it("should synchronize parameter modifications (R, C, V) back into SPICE while preserving comments and directives", () => {
    const modifiedMo = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=3300);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=4.7e-6);
  Modelica.Electrical.Analog.Sources.ConstantVoltage V1(V=15.0);
end RcFilter;`;

    const result = synchronizeModelicaToSpice(SAMPLE_CIRCUIT, modifiedMo, { strategy: "target-wins" });

    // Verify updated values in SPICE text
    assert.ok(result.updatedText.includes("3300"), "Updated netlist must have R1=3300");
    assert.ok(
      result.updatedText.includes("4.7e-6") || result.updatedText.includes("0.0000047"),
      "Updated netlist must have C1=4.7e-6",
    );
    assert.ok(result.updatedText.includes("15"), "Updated netlist must have V1=15");

    // Verify comments and directives preserved
    assert.ok(result.updatedText.includes("* RC Low-Pass Filter with Directives"));
    assert.ok(result.updatedText.includes(".TRAN 1u 5m"));
    assert.ok(result.updatedText.includes(".END"));

    // Reload with SPICE parser to verify AST integrity
    const reloaded = parseSpice(result.updatedText);
    const rComp = reloaded.components.find((c) => c.name === "R1");
    const cComp = reloaded.components.find((c) => c.name === "C1");
    const vComp = reloaded.components.find((c) => c.name === "V1");

    assert.strictEqual(rComp?.value, 3300);
    assert.strictEqual(cComp?.value, 4.7e-6);
    assert.strictEqual(vComp?.value, 15.0);
    assert.strictEqual(result.changes.length, 3);
  });

  it("should respect source-wins conflict reconciliation policy", () => {
    const modifiedMo = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=10000);
end RcFilter;`;

    const result = synchronizeModelicaToSpice(SAMPLE_CIRCUIT, modifiedMo, { strategy: "source-wins" });
    const reloaded = parseSpice(result.updatedText);
    const rComp = reloaded.components.find((c) => c.name === "R1");
    assert.strictEqual(rComp?.value, 1000, "Source-wins must preserve original R1=1000");
  });

  it("should respect physics-simplex conflict reconciliation policy with bounds", () => {
    const modifiedMo = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=8000);
end RcFilter;`;

    const result = synchronizeModelicaToSpice(SAMPLE_CIRCUIT, modifiedMo, {
      strategy: "physics-simplex",
      physicsBounds: {
        R1: { min: 500, max: 2500 },
      },
    });
    const reloaded = parseSpice(result.updatedText);
    const rComp = reloaded.components.find((c) => c.name === "R1");
    // (1000 + 8000)/2 = 4500 -> clamped to max bound 2500
    assert.strictEqual(rComp?.value, 2500, "Should clamp to max bound 2500");
  });

  it("should synchronize newly added components from Modelica into SPICE netlist", () => {
    const expandedMo = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=1000);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=1e-6);
  Modelica.Electrical.Analog.Sources.ConstantVoltage V1(V=5.0);
  Modelica.Electrical.Analog.Basic.Resistor R_load(R=50.0);
end RcFilter;`;

    const result = synchronizeModelicaToSpice(SAMPLE_CIRCUIT, expandedMo);
    assert.ok(result.updatedText.includes("R_load"), "New component R_load must be inserted into netlist");

    const reloaded = parseSpice(result.updatedText);
    const rLoad = reloaded.components.find((c) => c.name === "R_load");
    assert.ok(rLoad, "R_load must parse in reloaded circuit");
    assert.strictEqual(rLoad?.value, 50.0);
  });
});
