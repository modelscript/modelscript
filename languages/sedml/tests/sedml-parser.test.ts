// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSedml, serializeSedml } from "../src/index.js";

const SIMPLE_SEDML = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="50">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="mod1" language="urn:sedml:language:sbml" source="bio.xml">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='k']/@value" newValue="0.5"/>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task1" modelReference="mod1" simulationReference="sim1"/>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg_time">
      <listOfVariables>
        <variable id="t" symbol="urn:sedml:symbol:time" taskReference="task1"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>t</ci>
      </math>
    </dataGenerator>
  </listOfDataGenerators>
  <listOfOutputs>
    <report id="rep1">
      <listOfDataSets>
        <dataSet id="ds_t" label="Time" dataReference="dg_time"/>
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>
`;

test("SED-ML Parser: parses simulations, models, tasks, and data generators", () => {
  const doc = parseSedml(SIMPLE_SEDML, "simple.sedml");

  assert.equal(doc.simulations.length, 1);
  assert.equal(doc.simulations[0]?.id, "sim1");
  assert.equal(doc.simulations[0]?.numberOfSteps, 50);

  assert.equal(doc.models.length, 1);
  assert.equal(doc.models[0]?.id, "mod1");
  assert.equal(doc.models[0]?.changes.length, 1);

  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.tasks[0]?.id, "task1");

  assert.equal(doc.dataGenerators.length, 1);
  assert.equal(doc.outputs.length, 1);
});

test("SED-ML Parser: serializes and roundtrips to valid XML", () => {
  const doc = parseSedml(SIMPLE_SEDML);
  const xml = serializeSedml(doc);

  assert.ok(xml.includes("<sedML"));
  assert.ok(xml.includes('id="sim1"'));
  assert.ok(xml.includes('id="mod1"'));

  const reparsed = parseSedml(xml);
  assert.equal(reparsed.simulations.length, 1);
  assert.equal(reparsed.models.length, 1);
  assert.equal(reparsed.tasks.length, 1);
});
