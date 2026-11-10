// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { executeSedmlExperiment, parseSedml } from "../src/index.js";

const SOLVER_SEDML = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="50">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="mod" language="urn:sedml:language:sbml" source="bio.xml">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" newValue="100.0"/>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task1" modelReference="mod" simulationReference="sim"/>
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
  <listOfOutputs>
    <report id="rep">
      <listOfDataSets>
        <dataSet id="ds_S" label="Substrate" dataReference="dg_S"/>
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>
`;

test("SED-ML Solver: executes simulation and evaluates data generator series", () => {
  const doc = parseSedml(SOLVER_SEDML);
  const result = executeSedmlExperiment(doc);

  assert.ok(result.taskResults["task1"]);
  const sData = result.dataGeneratorValues["dg_S"];
  assert.ok(sData);
  assert.equal(sData.length, 51);
  assert.equal(sData[0], 100.0);
  assert.ok(sData[50]! < sData[0]!);
});
