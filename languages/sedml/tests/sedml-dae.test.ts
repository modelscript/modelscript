// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerSedmlToDae, parseSedml, sedmlToModelica } from "../src/index.js";

const DAE_SEDML = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="20" numberOfSteps="100">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="mod1" language="urn:sedml:language:sbml" source="bio.xml">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" newValue="50.0"/>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task1" modelReference="mod1" simulationReference="sim1"/>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg_S">
      <listOfVariables>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task1"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>S</ci>
      </math>
    </dataGenerator>
  </listOfDataGenerators>
</sedML>
`;

test("SED-ML DAE: lowers experiment to square DAEBuilder", () => {
  const doc = parseSedml(DAE_SEDML);
  const dae = lowerSedmlToDae(doc);

  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 5, `Expected >= 5 variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `Expected square DAE: ${vars.length} === ${eqs.length}`);
});

test("SED-ML Projection: generates Modelica 3.x model with experiment annotations", () => {
  const doc = parseSedml(DAE_SEDML);
  const mo = sedmlToModelica(doc, "DaeSedmlModel");

  assert.ok(mo.includes("model DaeSedmlModel"));
  assert.ok(mo.includes("experiment("));
  assert.ok(mo.includes("output Real dg_dg_S"));
});
