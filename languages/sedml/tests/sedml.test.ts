// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  SedmlErrorCode,
  SedmlWorkspaceIndex,
  executeSedmlAction,
  executeSedmlExperiment,
  getSedmlDocumentSymbols,
  getSedmlHover,
  lintSedml,
  lowerSedmlToDae,
  parseSedml,
  sedmlLanguage,
  sedmlToModelica,
  serializeSedml,
  validateSedml,
} from "../src/index.js";

const VALID_SEDML_EXPERIMENT = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim_tc" name="CVODE Time Course" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="50">
      <algorithm kisaoID="KISAO:0000019" name="CVODE">
        <listOfAlgorithmParameters>
          <algorithmParameter kisaoID="KISAO:0000209" name="relative tolerance" value="1e-6"/>
        </listOfAlgorithmParameters>
      </algorithm>
    </uniformTimeCourse>
    <oneStep id="sim_step" step="0.5">
      <algorithm kisaoID="KISAO:0000032"/>
    </oneStep>
    <steadyState id="sim_ss">
      <algorithm kisaoID="KISAO:0000407"/>
    </steadyState>
  </listOfSimulations>
  <listOfModels>
    <model id="model_base" name="Base Enzyme Model" language="urn:sedml:language:sbml" source="enzyme_kinetics.xml">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" newValue="20.0"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='P']/@initialConcentration" newValue="0.0"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='k1']/@value" newValue="0.3"/>
      </listOfChanges>
    </model>
    <model id="model_derived" name="Derived Perturbed Model" language="urn:sedml:language:sbml" source="model_base">
      <listOfChanges>
        <computeChange target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='k1']/@value">
          <listOfVariables>
            <variable id="S0" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" modelReference="model_base"/>
          </listOfVariables>
          <listOfParameters>
            <parameter id="scale_k" value="0.02"/>
          </listOfParameters>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply>
              <times/>
              <ci>S0</ci>
              <ci>scale_k</ci>
            </apply>
          </math>
        </computeChange>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task_base" name="Baseline Run" modelReference="model_base" simulationReference="sim_tc"/>
    <task id="task_derived" name="Perturbed Run" modelReference="model_derived" simulationReference="sim_tc"/>
    <repeatedTask id="task_sweep" name="Parameter Sweep" range="r_uniform" resetModel="true">
      <listOfRanges>
        <uniformRange id="r_uniform" start="0.1" end="0.5" numberOfSteps="2" type="linear"/>
      </listOfRanges>
      <listOfChanges>
        <setValue modelReference="model_base" target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='k1']/@value" range="r_uniform">
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <ci>r_uniform</ci>
          </math>
        </setValue>
      </listOfChanges>
      <listOfSubTasks>
        <subTask order="1" task="task_base"/>
      </listOfSubTasks>
    </repeatedTask>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg_time" name="Time">
      <listOfVariables>
        <variable id="time" symbol="urn:sedml:symbol:time" taskReference="task_derived"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>time</ci>
      </math>
    </dataGenerator>
    <dataGenerator id="dg_S" name="Substrate Concentration">
      <listOfVariables>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task_derived"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>S</ci>
      </math>
    </dataGenerator>
    <dataGenerator id="dg_P_norm" name="Normalized Product">
      <listOfVariables>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task_derived"/>
        <variable id="P" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='P']" taskReference="task_derived"/>
      </listOfVariables>
      <listOfParameters>
        <parameter id="pct" value="100.0"/>
      </listOfParameters>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply>
          <times/>
          <ci>pct</ci>
          <apply>
            <divide/>
            <ci>P</ci>
            <apply>
              <plus/>
              <ci>S</ci>
              <ci>P</ci>
            </apply>
          </apply>
        </apply>
      </math>
    </dataGenerator>
  </listOfDataGenerators>
  <listOfOutputs>
    <plot2D id="plot_kinetics" name="Substrate and Product Dynamics">
      <listOfCurves>
        <curve id="curve_S" name="S(t)" logX="false" logY="false" xDataReference="dg_time" yDataReference="dg_S"/>
        <curve id="curve_P" name="P_norm(t)" logX="false" logY="false" xDataReference="dg_time" yDataReference="dg_P_norm"/>
      </listOfCurves>
    </plot2D>
    <report id="report_kinetics" name="Simulation Summary Table">
      <listOfDataSets>
        <dataSet id="ds_time" label="Time_s" dataReference="dg_time"/>
        <dataSet id="ds_S" label="Substrate_mM" dataReference="dg_S"/>
        <dataSet id="ds_P_norm" label="Product_Pct" dataReference="dg_P_norm"/>
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>`;

test("SED-ML Parser: parses simulations, models, changes, tasks, dataGenerators, and outputs", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT, "experiment.sedml");

  assert.equal(doc.level, 1);
  assert.equal(doc.version, 4);
  assert.equal(doc.sourceFile, "experiment.sedml");

  // Simulations
  assert.equal(doc.simulations.length, 3);
  const simTc = doc.simulations[0]!;
  assert.equal(simTc.id, "sim_tc");
  assert.equal(simTc.type, "uniformTimeCourse");
  assert.equal(simTc.initialTime, 0);
  assert.equal(simTc.outputStartTime, 0);
  assert.equal(simTc.outputEndTime, 10);
  assert.equal(simTc.numberOfSteps, 50);
  assert.equal(simTc.algorithm?.kisaoID, "KISAO:0000019");
  assert.equal(simTc.algorithm?.parameters.length, 1);
  assert.equal(simTc.algorithm?.parameters[0]?.kisaoID, "KISAO:0000209");

  assert.equal(doc.simulations[1]?.type, "oneStep");
  assert.equal(doc.simulations[1]?.step, 0.5);
  assert.equal(doc.simulations[2]?.type, "steadyState");

  // Models & Changes
  assert.equal(doc.models.length, 2);
  const mBase = doc.models[0]!;
  assert.equal(mBase.id, "model_base");
  assert.equal(mBase.changes.length, 3);
  assert.equal(mBase.changes[0]?.type, "changeAttribute");
  assert.equal(mBase.changes[0]?.newValue, "20.0");

  const mDerived = doc.models[1]!;
  assert.equal(mDerived.id, "model_derived");
  assert.equal(mDerived.source, "model_base");
  assert.equal(mDerived.changes[0]?.type, "computeChange");
  assert.equal(mDerived.changes[0]?.math, "(S0 * scale_k)");

  // Tasks & RepeatedTask
  assert.equal(doc.tasks.length, 3);
  assert.equal(doc.tasks[0]?.type, "task");
  assert.equal(doc.tasks[2]?.type, "repeatedTask");
  assert.equal(doc.tasks[2]?.ranges?.length, 1);
  assert.equal(doc.tasks[2]?.taskChanges?.length, 1);
  assert.equal(doc.tasks[2]?.subTasks?.length, 1);

  // DataGenerators
  assert.equal(doc.dataGenerators.length, 3);
  assert.equal(doc.dataGenerators[2]?.id, "dg_P_norm");
  assert.equal(doc.dataGenerators[2]?.math, "(pct * (P / (S + P)))");

  // Outputs
  assert.equal(doc.outputs.length, 2);
  assert.equal(doc.outputs[0]?.type, "plot2D");
  assert.equal(doc.outputs[0]?.curves.length, 2);
  assert.equal(doc.outputs[1]?.type, "report");
  assert.equal(doc.outputs[1]?.dataSets.length, 3);
});

test("SED-ML Serializer: roundtrips AST into valid SED-ML XML", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT);
  const xml = serializeSedml(doc);

  assert.ok(xml.includes('<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4"'));
  assert.ok(xml.includes('<uniformTimeCourse id="sim_tc"'));
  assert.ok(xml.includes('<algorithm kisaoID="KISAO:0000019"'));
  assert.ok(xml.includes('<model id="model_derived"'));
  assert.ok(xml.includes('<repeatedTask id="task_sweep"'));
  assert.ok(xml.includes('<plot2D id="plot_kinetics"'));
  assert.ok(xml.includes('<report id="report_kinetics"'));

  const reparsed = parseSedml(xml);
  assert.equal(reparsed.simulations.length, doc.simulations.length);
  assert.equal(reparsed.models.length, doc.models.length);
  assert.equal(reparsed.tasks.length, doc.tasks.length);
  assert.equal(reparsed.dataGenerators.length, doc.dataGenerators.length);
  assert.equal(reparsed.outputs.length, doc.outputs.length);
});

test("SED-ML Linter: valid experiment produces zero diagnostics", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT);
  const diags = lintSedml(doc);
  assert.equal(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
});

test("SED-ML Linter: detects M9151 invalid time course bounds and M9152 malformed KiSAO ID", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim_bad_bounds" initialTime="5" outputStartTime="2" outputEndTime="10" numberOfSteps="20">
      <algorithm kisaoID="KISAO:19"/>
    </uniformTimeCourse>
    <uniformTimeCourse id="sim_bad_end" initialTime="0" outputStartTime="10" outputEndTime="5" numberOfSteps="20">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
    <uniformTimeCourse id="sim_bad_steps" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="0">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="m1" language="urn:sedml:language:sbml" source="model.xml"/>
  </listOfModels>
  <listOfTasks>
    <task id="t1" modelReference="m1" simulationReference="sim_bad_bounds"/>
  </listOfTasks>
</sedML>`;

  const doc = parseSedml(xml);
  const diags = lintSedml(doc);

  const m9151 = diags.filter((d) => d.code === SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code);
  assert.equal(m9151.length, 3, "Expected 3 M9151 time-course bound errors");

  const m9152 = diags.find((d) => d.code === SedmlErrorCode.INVALID_KISAO_ID.code);
  assert.ok(m9152, "Expected M9152 invalid KiSAO ID error");
});

test("SED-ML Linter: detects M9153, M9154, M9155, M9156 unresolved references", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim1" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="10">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="m1" language="urn:sedml:language:sbml" source="missing_base_model"/>
  </listOfModels>
  <listOfTasks>
    <task id="t1" modelReference="missing_model" simulationReference="missing_sim"/>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg1">
      <listOfVariables>
        <variable id="v1" target="S" taskReference="missing_task"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><ci>v1</ci></math>
    </dataGenerator>
  </listOfDataGenerators>
  <listOfOutputs>
    <plot2D id="p1">
      <listOfCurves>
        <curve id="c1" logX="false" logY="false" xDataReference="dg1" yDataReference="missing_dg"/>
      </listOfCurves>
    </plot2D>
  </listOfOutputs>
</sedML>`;

  const doc = parseSedml(xml);
  const diags = lintSedml(doc);

  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code),
    "Expected M9153 unresolved model reference",
  );
  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.UNRESOLVED_SIMULATION_REFERENCE.code),
    "Expected M9154 unresolved simulation reference",
  );
  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.code),
    "Expected M9155 unresolved task reference",
  );
  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.code),
    "Expected M9156 unresolved dataGenerator reference",
  );
});

test("SED-ML Linter: detects M9157 circular model source, M9158 undefined math variable, M9159 empty experiment, and M9160 duplicate ID", () => {
  const emptyDoc = parseSedml(`<sedML level="1" version="4"/>`);
  const emptyDiags = lintSedml(emptyDoc);
  assert.ok(
    emptyDiags.some((d) => d.code === SedmlErrorCode.EMPTY_SEDML_EXPERIMENT.code),
    "Expected M9159 empty SED-ML experiment diagnostic",
  );

  const cycleAndDupXml = `<?xml version="1.0" encoding="UTF-8"?>
<sedML level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="dup_id" initialTime="0" outputStartTime="0" outputEndTime="10" numberOfSteps="10">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfModels>
    <model id="mA" language="urn:sedml:language:sbml" source="mB"/>
    <model id="mB" language="urn:sedml:language:sbml" source="mA"/>
  </listOfModels>
  <listOfTasks>
    <task id="dup_id" modelReference="mA" simulationReference="dup_id"/>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg1">
      <listOfVariables>
        <variable id="S" target="S" taskReference="dup_id"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply><plus/><ci>S</ci><ci>undeclared_var</ci></apply>
      </math>
    </dataGenerator>
  </listOfDataGenerators>
</sedML>`;

  const doc = parseSedml(cycleAndDupXml);
  const diags = lintSedml(doc);

  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.CIRCULAR_MODEL_SOURCE.code),
    "Expected M9157 circular model source",
  );
  assert.ok(
    diags.some(
      (d) =>
        d.code === SedmlErrorCode.UNDEFINED_DATA_GENERATOR_MATH_VARIABLE.code && d.message.includes("undeclared_var"),
    ),
    "Expected M9158 undefined dataGenerator math variable",
  );
  assert.ok(
    diags.some((d) => d.code === SedmlErrorCode.DUPLICATE_SEDML_ID.code),
    "Expected M9160 duplicate SED-ML ID",
  );
});

test("SED-ML Runner: executes uniform time course, model changes, dataGenerators, plot2D curves, and report datasets", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT);
  const res = executeSedmlExperiment(doc);

  const derivedTask = res.taskResults["task_derived"];
  assert.ok(derivedTask);
  assert.equal(derivedTask.time.length, 51); // 50 steps + initial point
  assert.equal(derivedTask.time[0], 0);
  assert.equal(derivedTask.time[50], 10);

  // Verify model_base changeAttribute set S(0) = 20.0 and model_derived computeChange set k1 = S0 * 0.02 = 0.4
  assert.equal(derivedTask.appliedInitialStates["S"], 20.0);
  assert.ok(Math.abs((derivedTask.appliedParameters["k1"] ?? 0) - 0.4) < 1e-9);

  // Substrate S decays from 20.0 over [0, 10] while Product P increases from 0.0
  const sSeries = res.dataGeneratorValues["dg_S"]!;
  const pNormSeries = res.dataGeneratorValues["dg_P_norm"]!;
  assert.equal(sSeries.length, 51);
  assert.ok(Math.abs(sSeries[0]! - 20.0) < 1e-9);
  assert.ok(sSeries[50]! < sSeries[0]!);
  assert.ok(Math.abs(pNormSeries[0]! - 0.0) < 1e-9);
  assert.ok(pNormSeries[50]! > 90.0);

  // Plot2D curves
  const plot = res.plots["plot_kinetics"];
  assert.ok(plot);
  assert.equal(plot.curves.length, 2);
  assert.equal(plot.curves[0]?.points.length, 51);

  // Report dataset columns
  const report = res.reports["report_kinetics"];
  assert.ok(report);
  assert.equal(report.rowCount, 51);
  assert.equal(report.table["Substrate_mM"]?.length, 51);
  assert.equal(report.table["Product_Pct"]?.length, 51);

  // RepeatedTask parameter sweep (3 sweep points * 51 time points = 153 points)
  const sweepTask = res.taskResults["task_sweep"];
  assert.ok(sweepTask);
  assert.equal(sweepTask.time.length, 153);
});

test("SED-ML DAE Lowering: compiles experiment parameters, model overrides, and dataGenerators into a square DAEBuilder", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT);
  const dae = lowerSedmlToDae(doc);

  assert.ok(dae.variables().length >= 10, "Expected at least 10 DAE variables");
  assert.equal(dae.variables().length, dae.equations().length, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("sim_sim_tc_outputEndTime"), -1);
  assert.notEqual(dae.lookupVariable("sim_sim_tc_numberOfSteps"), -1);
  assert.notEqual(dae.lookupVariable("state_S"), -1);
  assert.notEqual(dae.lookupVariable("dg_dg_time"), -1);
  assert.notEqual(dae.lookupVariable("dg_dg_P_norm"), -1);
});

test("SED-ML Modelica Projection: generates Modelica 3.x model with experiment annotation", () => {
  const doc = parseSedml(VALID_SEDML_EXPERIMENT);
  const mo = sedmlToModelica(doc, "EnzymeSedmlExperiment");

  assert.ok(mo.includes("model EnzymeSedmlExperiment"));
  assert.ok(mo.includes("output Real dg_dg_P_norm"));
  assert.ok(mo.includes("der(S) = -0.25 * S;"));
  assert.ok(mo.includes("annotation(experiment(StartTime=0, StopTime=10, NumberOfIntervals=50));"));
  assert.ok(mo.includes("end EnzymeSedmlExperiment;"));
});

test("SED-ML WorkspaceIndex & LSP: indexes symbols, validates diagnostics, provides hover, and executes actions", async () => {
  const index = new SedmlWorkspaceIndex();
  index.indexFile("file:///experiments/enzyme.sedml", VALID_SEDML_EXPERIMENT);

  assert.equal(index.fileCount, 1);
  const symbols = index.getSymbols("file:///experiments/enzyme.sedml");
  assert.ok(symbols.length >= 10);

  assert.ok(index.findDefinition("sim_tc"));
  assert.ok(index.findDefinition("model_derived"));
  assert.ok(index.findDefinition("task_derived"));
  assert.ok(index.findDefinition("dg_P_norm"));
  assert.ok(index.findDefinition("plot_kinetics"));

  const lspDiags = validateSedml(VALID_SEDML_EXPERIMENT);
  assert.equal(lspDiags.length, 0);

  const docSymbols = getSedmlDocumentSymbols(VALID_SEDML_EXPERIMENT);
  assert.equal(docSymbols.length, 1);
  assert.ok((docSymbols[0]?.children?.length ?? 0) >= 10);

  const hover = getSedmlHover(VALID_SEDML_EXPERIMENT, { line: 3, character: 25 });
  assert.ok(hover);
  assert.ok(hover.contents.value.includes("sim_tc"));

  const daeInfo = await executeSedmlAction("sedml_to_dae", VALID_SEDML_EXPERIMENT);
  assert.equal(daeInfo.variableCount, daeInfo.equationCount);

  assert.equal(sedmlLanguage.name, "sedml");
});
