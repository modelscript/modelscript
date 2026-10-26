// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileTGGRules } from "@modelscript/dsl";
import assert from "node:assert";
import { describe, it } from "node:test";
import { parseEasy5 } from "../src/parser/easy5-parser.js";
import { easy5PolyglotConfig, easy5TggRules } from "../src/tgg/easy5-rules.js";
import { synchronizeModelicaToEasy5 } from "../src/tgg/easy5-sync.js";

const SAMPLE_EZ5 = `MODEL: FlightControl
TITLE: "Actuator Loop with User Fortran"

COMPONENTS:
  SJ01 TYPE=GP/SJ TITLE="Summing Junction" X=50 Y=100
  GA01 TYPE=GP/GA TITLE="Forward Gain" X=150 Y=100
    XP: K=10.0
  IN01 TYPE=GP/IN TITLE="Hydraulic Integrator" X=250 Y=100
    XP: GAIN=1.0, S0=0.0
  LM01 TYPE=GP/LM TITLE="Stroke Limiter" X=350 Y=100
    XP: UL=1.0, LL=-1.0
  UG01 TYPE=GP/UG TITLE="Custom Fortran Logic" X=450 Y=100
    FORTRAN:
      C User code block
      OUTPUT = INPUT * 2.0
    ENDFORTRAN

CONNECTIONS:
  SJ01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
  IN01.OUT -> LM01.IN
  LM01.OUT -> SJ01.IN2
`;

describe("EASY5 Bidirectional TGG Round-Trip Synchronization (@modelscript/easy5)", () => {
  it("should compile all declarative EASY5 TGG rules via compileTGGRules()", () => {
    assert.strictEqual(easy5TggRules.length, 8, "Should declare 8 TGG transformation rules");
    const compiled = compileTGGRules(easy5PolyglotConfig);
    assert.strictEqual(compiled.ruleCount, 8);
    assert.ok(compiled.sourceCode.includes("tgg_forward_Easy5GainToModelicaGain"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_Easy5GainToModelicaGain"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_Easy5IntegratorToModelicaIntegrator"));
    assert.ok(compiled.sourceCode.includes("tgg_forward_dispatch"));
    assert.ok(compiled.sourceCode.includes("tgg_backward_dispatch"));
  });

  it("should synchronize parameter tuning (Gain, Integrator, Limiter) while preserving Fortran blocks", () => {
    const modifiedMo = `model FlightControl
  Modelica.Blocks.Math.Add SJ01;
  Modelica.Blocks.Math.Gain GA01(k=25.0);
  Modelica.Blocks.Continuous.Integrator IN01(k=2.0, y_start=4.5);
  Modelica.Blocks.Nonlinear.Limiter LM01(uMax=2.5, uMin=-2.5);

equation
  connect(SJ01.y, GA01.u);
  connect(GA01.y, IN01.u);
  connect(IN01.y, LM01.u);
  connect(LM01.y, SJ01.u2);
end FlightControl;`;

    const result = synchronizeModelicaToEasy5(SAMPLE_EZ5, modifiedMo, { strategy: "target-wins" });

    // Verify parameters updated in .ez5 text
    assert.ok(result.updatedText.includes("K=25"), "Updated EZ5 must contain K=25");
    assert.ok(result.updatedText.includes("GAIN=2"), "Updated EZ5 must contain GAIN=2");
    assert.ok(
      result.updatedText.includes("S0=4.5") || result.updatedText.includes("S1=4.5"),
      "Updated EZ5 must contain S0=4.5",
    );
    assert.ok(result.updatedText.includes("UL=2.5"), "Updated EZ5 must contain UL=2.5");
    assert.ok(result.updatedText.includes("LL=-2.5"), "Updated EZ5 must contain LL=-2.5");

    // Verify Fortran block is intact
    assert.ok(result.updatedText.includes("FORTRAN:"), "Fortran block start must be preserved");
    assert.ok(result.updatedText.includes("OUTPUT = INPUT * 2.0"), "Fortran user logic must be preserved");
    assert.ok(result.updatedText.includes("ENDFORTRAN"), "Fortran block end must be preserved");

    // Verify title and layout coordinates preserved
    assert.ok(result.updatedText.includes('TITLE: "Actuator Loop with User Fortran"'));
    assert.ok(result.updatedText.includes("X=150 Y=100"));

    // Reload with EASY5 parser to verify AST integrity
    const reloaded = parseEasy5(result.updatedText);
    const ga = reloaded.components.get("GA01");
    const inComp = reloaded.components.get("IN01");
    const lm = reloaded.components.get("LM01");
    const ug = reloaded.components.get("UG01");

    assert.strictEqual(ga?.parameters["K"], 25.0);
    assert.strictEqual(inComp?.parameters["GAIN"], 2.0);
    assert.strictEqual(inComp?.parameters["S0"] ?? inComp?.initialStates["S1"], 4.5);
    assert.strictEqual(lm?.parameters["UL"], 2.5);
    assert.strictEqual(lm?.parameters["LL"], -2.5);
    assert.ok(ug?.userCode?.includes("OUTPUT = INPUT * 2.0"), "User code must parse intact");

    assert.strictEqual(result.changes.length, 5);
  });

  it("should respect source-wins conflict reconciliation policy", () => {
    const modifiedMo = `model FlightControl
  Modelica.Blocks.Math.Gain GA01(k=100.0);
end FlightControl;`;

    const result = synchronizeModelicaToEasy5(SAMPLE_EZ5, modifiedMo, { strategy: "source-wins" });
    const reloaded = parseEasy5(result.updatedText);
    const ga = reloaded.components.get("GA01");
    assert.strictEqual(ga?.parameters["K"], 10.0, "Source-wins must keep original K=10.0");
  });

  it("should respect physics-simplex conflict reconciliation policy with bounds", () => {
    const modifiedMo = `model FlightControl
  Modelica.Blocks.Math.Gain GA01(k=50.0);
end FlightControl;`;

    const result = synchronizeModelicaToEasy5(SAMPLE_EZ5, modifiedMo, {
      strategy: "physics-simplex",
      physicsBounds: {
        "GA01.K": { min: 5.0, max: 20.0 },
      },
    });
    const reloaded = parseEasy5(result.updatedText);
    const ga = reloaded.components.get("GA01");
    // Midpoint: (10 + 50)/2 = 30 -> clamped to max 20.0
    assert.strictEqual(ga?.parameters["K"], 20.0, "Should clamp to max bound 20.0");
  });

  it("should synchronize newly added components and connections from Modelica into EASY5", () => {
    const expandedMo = `model FlightControl
  Modelica.Blocks.Math.Add SJ01;
  Modelica.Blocks.Math.Gain GA01(k=10.0);
  Modelica.Blocks.Math.Gain GA02(k=3.0);

equation
  connect(SJ01.y, GA01.u);
  connect(GA01.y, GA02.u);
end FlightControl;`;

    const result = synchronizeModelicaToEasy5(SAMPLE_EZ5, expandedMo);
    assert.ok(result.updatedText.includes("GA02 TYPE=GP/GA"), "New component GA02 must be added to EZ5");
    assert.ok(result.updatedText.includes("GA01.OUT -> GA02.IN"), "New connection GA01 -> GA02 must be added");

    const reloaded = parseEasy5(result.updatedText);
    assert.ok(reloaded.components.has("GA02"), "GA02 must parse in reloaded model");
    assert.strictEqual(reloaded.components.get("GA02")?.type, "GP/GA");
    assert.strictEqual(reloaded.components.get("GA02")?.parameters["K"], 3.0);
  });
});
