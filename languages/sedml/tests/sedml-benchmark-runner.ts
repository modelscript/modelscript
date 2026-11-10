// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Simulation Experiment Description Markup Language (SED-ML).
 *
 * Evaluates:
 * 1. Multi-stage biochemical simulation experiment (uniform time course, repeated parameter sweep)
 * 2. Model modifications (changeAttribute, computeChange with MathML expressions)
 * 3. Execution of simulation tasks, data generators, 2D plots, and report tables
 * 4. Lowering to structurally square DAEBuilder linear memory arena
 * 5. Modelica 3.x simulation experiment projection
 */

import assert from "node:assert/strict";
import {
  executeSedmlExperiment,
  lowerSedmlToDae,
  parseSedml,
  sedmlToModelica,
  type SedmlDocument,
} from "../src/index.js";

export const SEDML_INDUSTRIAL_EXPERIMENT = `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfSimulations>
    <uniformTimeCourse id="sim_cvode" name="CVODE High-Precision Integration" initialTime="0" outputStartTime="0" outputEndTime="25.0" numberOfSteps="100">
      <algorithm kisaoID="KISAO:0000019" name="CVODE">
        <listOfAlgorithmParameters>
          <algorithmParameter kisaoID="KISAO:0000209" name="relative tolerance" value="1e-7"/>
          <algorithmParameter kisaoID="KISAO:0000211" name="absolute tolerance" value="1e-10"/>
        </listOfAlgorithmParameters>
      </algorithm>
    </uniformTimeCourse>
    <steadyState id="sim_equilibrium">
      <algorithm kisaoID="KISAO:0000407" name="NLEQ2 Non-linear algebraic solver"/>
    </steadyState>
  </listOfSimulations>
  <listOfModels>
    <model id="model_wildtype" name="Wildtype Metabolic Model" language="urn:sedml:language:sbml" source="metabolism.xml">
      <listOfChanges>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']/@initialConcentration" newValue="50.0"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='P']/@initialConcentration" newValue="0.0"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='Vmax']/@value" newValue="2.5"/>
        <changeAttribute target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='Km']/@value" newValue="5.0"/>
      </listOfChanges>
    </model>
    <model id="model_overexpressed" name="Overexpressed Enzyme Variant" language="urn:sedml:language:sbml" source="model_wildtype">
      <listOfChanges>
        <computeChange target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='Vmax']/@value">
          <listOfVariables>
            <variable id="base_Vmax" target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='Vmax']" modelReference="model_wildtype"/>
          </listOfVariables>
          <listOfParameters>
            <parameter id="boost_factor" value="3.5"/>
          </listOfParameters>
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <apply>
              <times/>
              <ci>base_Vmax</ci>
              <ci>boost_factor</ci>
            </apply>
          </math>
        </computeChange>
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfTasks>
    <task id="task_wt" name="Wildtype Kinetics" modelReference="model_wildtype" simulationReference="sim_cvode"/>
    <task id="task_oe" name="Overexpressed Kinetics" modelReference="model_overexpressed" simulationReference="sim_cvode"/>
    <repeatedTask id="task_vmax_sweep" name="Enzyme Titration Sweep" range="r_vmax" resetModel="true">
      <listOfRanges>
        <uniformRange id="r_vmax" start="1.0" end="10.0" numberOfSteps="3" type="linear"/>
      </listOfRanges>
      <listOfChanges>
        <setValue modelReference="model_wildtype" target="/sbml:sbml/sbml:model/sbml:listOfParameters/sbml:parameter[@id='Vmax']/@value" range="r_vmax">
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <ci>r_vmax</ci>
          </math>
        </setValue>
      </listOfChanges>
      <listOfSubTasks>
        <subTask order="1" task="task_wt"/>
      </listOfSubTasks>
    </repeatedTask>
  </listOfTasks>
  <listOfDataGenerators>
    <dataGenerator id="dg_time" name="Time">
      <listOfVariables>
        <variable id="time" symbol="urn:sedml:symbol:time" taskReference="task_oe"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>time</ci>
      </math>
    </dataGenerator>
    <dataGenerator id="dg_substrate" name="Substrate">
      <listOfVariables>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task_oe"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>S</ci>
      </math>
    </dataGenerator>
    <dataGenerator id="dg_product" name="Product">
      <listOfVariables>
        <variable id="P" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='P']" taskReference="task_oe"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <ci>P</ci>
      </math>
    </dataGenerator>
    <dataGenerator id="dg_yield" name="Yield Percentage">
      <listOfVariables>
        <variable id="P" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='P']" taskReference="task_oe"/>
        <variable id="S" target="/sbml:sbml/sbml:model/sbml:listOfSpecies/sbml:species[@id='S']" taskReference="task_oe"/>
      </listOfVariables>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply>
          <times/>
          <cn>100</cn>
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
    <plot2D id="plot_curves" name="Reaction Trajectories">
      <listOfCurves>
        <curve id="c_S" name="Substrate S(t)" xDataReference="dg_time" yDataReference="dg_substrate"/>
        <curve id="c_P" name="Product P(t)" xDataReference="dg_time" yDataReference="dg_product"/>
      </listOfCurves>
    </plot2D>
    <report id="report_summary" name="Simulation Summary Report">
      <listOfDataSets>
        <dataSet id="ds_time" label="Time_s" dataReference="dg_time"/>
        <dataSet id="ds_S" label="Substrate_mM" dataReference="dg_substrate"/>
        <dataSet id="ds_P" label="Product_mM" dataReference="dg_product"/>
        <dataSet id="ds_yield" label="Yield_pct" dataReference="dg_yield"/>
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>
`;

export interface SedmlBenchmarkMetrics {
  simulationsCount: number;
  modelsCount: number;
  tasksCount: number;
  dataGeneratorsCount: number;
  outputsCount: number;
  timeStepsCount: number;
  initialSubstrate: number;
  finalSubstrate: number;
  finalYieldPct: number;
  reportRowCount: number;
  sweepPointCount: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
  modelicaLines: number;
}

export function runSedmlBenchmark(
  xml = SEDML_INDUSTRIAL_EXPERIMENT,
): SedmlBenchmarkMetrics {
  const doc: SedmlDocument = parseSedml(xml, "industrial_experiment.sedml");

  assert.equal(doc.simulations.length, 2);
  assert.equal(doc.models.length, 2);
  assert.equal(doc.tasks.length, 3);
  assert.equal(doc.dataGenerators.length, 4);
  assert.equal(doc.outputs.length, 2);

  // 1. Execute experiment
  const res = executeSedmlExperiment(doc);

  const oeTask = res.taskResults["task_oe"];
  assert.ok(oeTask, "task_oe execution result required");
  assert.equal(oeTask.time.length, 101); // 100 steps + t=0
  assert.equal(oeTask.time[0], 0);
  assert.equal(oeTask.time[100], 25.0);

  // Verify computeChange applied Vmax = 2.5 * 3.5 = 8.75
  assert.ok(Math.abs((oeTask.appliedParameters["Vmax"] ?? 0) - 8.75) < 1e-9);

  // DataGenerators evaluation
  const sSeries = res.dataGeneratorValues["dg_substrate"]!;
  const pSeries = res.dataGeneratorValues["dg_product"]!;
  const yieldSeries = res.dataGeneratorValues["dg_yield"]!;

  assert.equal(sSeries.length, 101);
  assert.ok(sSeries[0]! >= 50.0);
  assert.ok(sSeries[100]! < sSeries[0]!, "Substrate must decrease");
  assert.ok(pSeries[100]! > pSeries[0]!, "Product must accumulate");
  assert.ok(yieldSeries[100]! > 75.0, "Yield must exceed 75%");

  // Plot and Report validation
  const plot = res.plots["plot_curves"];
  assert.ok(plot && plot.curves.length === 2);

  const report = res.reports["report_summary"];
  assert.ok(report && report.rowCount === 101);
  assert.ok(report.table["Yield_pct"]?.length === 101);

  // Repeated task sweep
  const sweep = res.taskResults["task_vmax_sweep"];
  assert.ok(sweep && sweep.time.length >= 200);

  // 2. Lower to DAEBuilder linear memory arena
  const dae = lowerSedmlToDae(doc);
  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 10, `Expected >= 10 DAE variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `DAE must be square: vars=${vars.length}, eqs=${eqs.length}`);

  // 3. Project to Modelica
  const mo = sedmlToModelica(doc, "IndustrialMetabolicExperiment");
  assert.ok(mo.includes("model IndustrialMetabolicExperiment"));
  assert.ok(mo.includes("experiment("));

  return {
    simulationsCount: doc.simulations.length,
    modelsCount: doc.models.length,
    tasksCount: doc.tasks.length,
    dataGeneratorsCount: doc.dataGenerators.length,
    outputsCount: doc.outputs.length,
    timeStepsCount: oeTask.time.length,
    initialSubstrate: sSeries[0]!,
    finalSubstrate: sSeries[100]!,
    finalYieldPct: yieldSeries[100]!,
    reportRowCount: report.rowCount,
    sweepPointCount: sweep.time.length,
    daeVarCount: vars.length,
    daeEqCount: eqs.length,
    isSquare: vars.length === eqs.length,
    modelicaLines: mo.split("\n").length,
  };
}
