// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  CompatibleModelItem,
  StudyDefinition,
  StudyDomain,
  StudyExecutionTarget,
  StudyInstanceArtifact,
  StudyKind,
  StudyParameterBinding,
  StudyRunRequest,
  StudyStandardFormat,
} from "./study-types.js";

/**
 * Maps solver names to standard KiSAO (Kinetic Simulation Algorithm Ontology) IDs
 * used by SED-ML L1V4 (http://sed-ml.org/sed-ml/level1/version4).
 */
export const SOLVER_TO_KISAO: Record<string, { kisaoId: string; name: string }> = {
  dassl: { kisaoId: "KISAO:0000083", name: "DASSL (BDF Variable-Order DAE Solver)" },
  cvode: { kisaoId: "KISAO:0000019", name: "SUNDIALS CVODE (BDF / Adams-Moulton)" },
  ida: { kisaoId: "KISAO:0000283", name: "SUNDIALS IDA (Implicit DAE Solver)" },
  radau5: { kisaoId: "KISAO:0000437", name: "Radau IIA (5th-Order Implicit Runge-Kutta)" },
  rk4: { kisaoId: "KISAO:0000032", name: "Explicit 4th/5th-Order Runge-Kutta (DOPRI5)" },
  calculix: { kisaoId: "KISAO:0000407", name: "CalculiX / Abaqus Sparse Direct FEA Solver" },
  arpack: { kisaoId: "KISAO:0000352", name: "ARPACK Implicitly Restarted Arnoldi / Lanczos" },
  su2: { kisaoId: "KISAO:0000408", name: "SU2 Compressible / Incompressible RANS Solver" },
  openfoam: { kisaoId: "KISAO:0000409", name: "OpenFOAM Finite-Volume Navier-Stokes Solver" },
  emt: { kisaoId: "KISAO:0000030", name: "Dommel Trapezoidal EMT Nodal Solver" },
  fastsim: { kisaoId: "KISAO:0000083", name: "Kalker FASTSIM Wheel-Rail Creep Contact Integrator" },
};

const DOMAIN_TO_SEDML_LANGUAGE: Record<string, string> = {
  modelica: "urn:sedml:language:modelica",
  fmu: "urn:sedml:language:fmi",
  ssp: "urn:sedml:language:ssp",
  sbml: "urn:sedml:language:sbml",
  pscad: "urn:sedml:language:pscad-emt",
  spice: "urn:sedml:language:spice",
  fea: "urn:sedml:language:calculix-inp",
  cfd: "urn:sedml:language:su2-cfg",
  gensys: "urn:sedml:language:gensys",
  simpack: "urn:sedml:language:simpack",
  sysml2: "urn:sedml:language:sysml2",
  scad: "urn:sedml:language:openscad",
  step: "urn:sedml:language:iso10303-step",
};

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(raw: string): string {
  return raw
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function inferStudyStandard(
  study: Partial<Pick<StudyDefinition, "kind" | "category" | "standardFormat" | "artifactPath" | "modelContract">>,
): StudyStandardFormat {
  if (study.standardFormat) return study.standardFormat;
  const pathLower = (study.artifactPath || "").toLowerCase();
  if (pathLower.endsWith(".dakota") || pathLower.endsWith(".in")) return "dakota";
  if (pathLower.endsWith(".ssv") || pathLower.endsWith(".ssd") || pathLower.endsWith(".ssp")) return "ssp-ssv";
  if (pathLower.endsWith(".sedml")) return "sedml";

  if (study.kind === "monte-carlo" || study.kind === "optimization" || study.kind === "surrogate") {
    return "dakota";
  }
  if (study.modelContract?.domains?.includes("ssp") && study.modelContract.domains[0] === "ssp") {
    return "ssp-ssv";
  }
  return "sedml";
}

export function getStandardFileExtension(format: StudyStandardFormat): ".sedml" | ".ssv" | ".dakota" {
  switch (format) {
    case "sedml":
      return ".sedml";
    case "ssp-ssv":
      return ".ssv";
    case "dakota":
      return ".dakota";
  }
}

export const standardExtension = getStandardFileExtension;

export function getStandardMimeType(
  format: StudyStandardFormat,
): "application/sedml+xml" | "application/ssp-ssv+xml" | "text/x-dakota" {
  switch (format) {
    case "sedml":
      return "application/sedml+xml";
    case "ssp-ssv":
      return "application/ssp-ssv+xml";
    case "dakota":
      return "text/x-dakota";
  }
}

export interface StudySynthesisContext {
  modelId: string;
  modelName: string;
  modelDomain: StudyDomain;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  executionTarget: StudyExecutionTarget;
  inputs: Record<string, number | string | boolean>;
  parameterBindings: StudyParameterBinding[];
  observables: string[];
}

/**
 * Generates a valid SED-ML Level 1 Version 4 XML document (.sedml)
 * representing either a Study Template or a bound Study Instance.
 */
export function toSedmlXml(study: StudyDefinition, ctx?: Partial<StudySynthesisContext>): string {
  const modelName = ctx?.modelName || "{{MODEL_NAME}}";
  const modelId = ctx?.modelId || `${study.modelContract.domains[0] || "modelica"}.${modelName}`;
  const domain = ctx?.modelDomain || study.modelContract.domains[0] || "modelica";
  const sedmlLang = DOMAIN_TO_SEDML_LANGUAGE[domain] || `urn:sedml:language:${domain}`;
  const target =
    ctx?.executionTarget || (study.execution.defaultTarget === "auto" ? "local-wasm" : study.execution.defaultTarget);

  const mergedInputs: Record<string, number | string | boolean> = {};
  for (const inp of study.inputs) {
    mergedInputs[inp.key] = ctx?.inputs?.[inp.key] ?? inp.defaultValue;
  }

  const solverKey = String(mergedInputs["solver"] || study.execution.recommendedSolver || "dassl")
    .toLowerCase()
    .split(/[\s/]+/)[0]!;
  const kisao = SOLVER_TO_KISAO[solverKey] || SOLVER_TO_KISAO["dassl"]!;
  const stopTime = Number(mergedInputs["stopTime"] ?? mergedInputs["durationS"] ?? 10.0);
  const numPoints = Number(mergedInputs["intervals"] ?? mergedInputs["numPoints"] ?? 500);
  const tolerance = Number(mergedInputs["tolerance"] ?? 1e-6);

  const bindings: StudyParameterBinding[] =
    ctx?.parameterBindings && ctx.parameterBindings.length > 0
      ? ctx.parameterBindings
      : study.modelContract.parameterSlots.map((slot, idx) => ({
          parameterName: `param_${slot.slotId || idx + 1}`,
          slotId: slot.slotId,
          nominalValue: 1.0,
          min: 0.5,
          max: 1.5,
          steps: Number(mergedInputs["gridPointsPerDim"] ?? mergedInputs["sampleCount"] ?? 10),
        }));

  const observables =
    ctx?.observables && ctx.observables.length > 0
      ? ctx.observables
      : study.modelContract.observableSlots.map((s) => s.slotId);

  const changeAttrsXml = bindings
    .map(
      (b) =>
        `        <changeAttribute target="/model/parameter[@id='${escapeXml(b.parameterName)}']/@value" newValue="${b.nominalValue}"/>`,
    )
    .join("\n");

  const isSteady = study.kind === "steady-state" || study.kind === "eigen-frequency";
  const simXml = isSteady
    ? `    <steadyState id="sim_${escapeXml(study.slug)}" name="${escapeXml(study.name)}">
      <algorithm kisaoID="${kisao.kisaoId}" name="${escapeXml(kisao.name)}">
        <listOfAlgorithmParameters>
          <algorithmParameter kisaoID="KISAO:0000209" name="relativeTolerance" value="${tolerance}"/>
        </listOfAlgorithmParameters>
      </algorithm>
    </steadyState>`
    : `    <uniformTimeCourse id="sim_${escapeXml(study.slug)}" name="${escapeXml(study.name)}" initialTime="0.0" outputStartTime="0.0" outputEndTime="${stopTime}" numberOfSteps="${numPoints}">
      <algorithm kisaoID="${kisao.kisaoId}" name="${escapeXml(kisao.name)}">
        <listOfAlgorithmParameters>
          <algorithmParameter kisaoID="KISAO:0000209" name="relativeTolerance" value="${tolerance}"/>
        </listOfAlgorithmParameters>
      </algorithm>
    </uniformTimeCourse>`;

  const primarySweep = bindings[0];
  const isRepeated = study.kind === "parameter-sweep" || study.kind === "verification";
  const taskXml =
    isRepeated && primarySweep
      ? `    <task id="task_base" modelReference="model_primary" simulationReference="sim_${escapeXml(study.slug)}"/>
    <repeatedTask id="task_sweep" range="range_${escapeXml(primarySweep.parameterName)}" resetModel="true">
      <listOfRanges>
        <uniformRange id="range_${escapeXml(primarySweep.parameterName)}" start="${primarySweep.min ?? primarySweep.nominalValue * 0.5}" end="${primarySweep.max ?? primarySweep.nominalValue * 1.5}" numberOfSteps="${primarySweep.steps ?? 10}" type="linear"/>
      </listOfRanges>
      <listOfChanges>
        <setValue modelReference="model_primary" target="/model/parameter[@id='${escapeXml(primarySweep.parameterName)}']/@value" range="range_${escapeXml(primarySweep.parameterName)}">
          <math xmlns="http://www.w3.org/1998/Math/MathML">
            <ci>range_${escapeXml(primarySweep.parameterName)}</ci>
          </math>
        </setValue>
      </listOfChanges>
      <listOfSubTasks>
        <subTask order="1" task="task_base"/>
      </listOfSubTasks>
    </repeatedTask>`
      : `    <task id="task_main" modelReference="model_primary" simulationReference="sim_${escapeXml(study.slug)}"/>`;

  const activeTaskId = isRepeated && primarySweep ? "task_sweep" : "task_main";

  const dataGenXml = [
    `    <dataGenerator id="dg_time" name="time">
      <math xmlns="http://www.w3.org/1998/Math/MathML"><ci>var_time</ci></math>
      <listOfVariables>
        <variable id="var_time" name="time" taskReference="${activeTaskId}" symbol="urn:sedml:symbol:time"/>
      </listOfVariables>
    </dataGenerator>`,
    ...observables.map(
      (obs) => `    <dataGenerator id="dg_${escapeXml(obs)}" name="${escapeXml(obs)}">
      <math xmlns="http://www.w3.org/1998/Math/MathML"><ci>var_${escapeXml(obs)}</ci></math>
      <listOfVariables>
        <variable id="var_${escapeXml(obs)}" name="${escapeXml(obs)}" taskReference="${activeTaskId}" target="/model/observable[@id='${escapeXml(obs)}']"/>
      </listOfVariables>
    </dataGenerator>`,
    ),
  ].join("\n");

  const curvesXml = observables
    .map(
      (obs, idx) =>
        `        <curve id="curve_${idx + 1}" name="${escapeXml(obs)}" logX="false" logY="false" xDataReference="dg_time" yDataReference="dg_${escapeXml(obs)}"/>`,
    )
    .join("\n");

  const kpiDatasetsXml = study.outputs.kpis
    .map(
      (kpi) =>
        `        <dataSet id="ds_${escapeXml(kpi.id)}" label="${escapeXml(kpi.label)}" dataReference="dg_${escapeXml(observables[0] || "time")}"/>`,
    )
    .join("\n");

  const inputsMetaXml = Object.entries(mergedInputs)
    .map(([k, v]) => `      <msx:input key="${escapeXml(k)}" value="${escapeXml(String(v))}"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4"
       xmlns:msx="https://modelscript.org/ns/study-v1"
       level="1" version="4">
  <annotation>
    <msx:studyMetadata
      id="${escapeXml(study.id)}"
      slug="${escapeXml(study.slug)}"
      name="${escapeXml(study.name)}"
      version="${escapeXml(study.version)}"
      kind="${escapeXml(study.kind)}"
      category="${escapeXml(study.category)}"
      domain="${escapeXml(domain)}"
      executionTarget="${escapeXml(target)}"
      packageName="${escapeXml(ctx?.packageName || study.packageName || "")}"
      packageVersion="${escapeXml(ctx?.packageVersion || study.packageVersion || "")}">
      <msx:description>${escapeXml(study.description)}</msx:description>
${inputsMetaXml}
    </msx:studyMetadata>
  </annotation>
  <listOfModels>
    <model id="model_primary" name="${escapeXml(modelName)}" language="${escapeXml(sedmlLang)}" source="${escapeXml(modelId)}">
      <listOfChanges>
${changeAttrsXml}
      </listOfChanges>
    </model>
  </listOfModels>
  <listOfSimulations>
${simXml}
  </listOfSimulations>
  <listOfTasks>
${taskXml}
  </listOfTasks>
  <listOfDataGenerators>
${dataGenXml}
  </listOfDataGenerators>
  <listOfOutputs>
    <plot2D id="plot_primary" name="${escapeXml(study.outputs.views[0]?.title || study.name)}">
      <listOfCurves>
${curvesXml}
      </listOfCurves>
    </plot2D>
    <report id="report_kpis" name="${escapeXml(study.name)} KPI Summary">
      <listOfDataSets>
${kpiDatasetsXml}
      </listOfDataSets>
    </report>
  </listOfOutputs>
</sedML>
`;
}

/**
 * Generates a valid ASAM / Modelica Association SSP 2.0 Parameter Set (.ssv)
 * XML document representing system parameterization & study execution bindings.
 */
export function toSspSsvXml(study: StudyDefinition, ctx?: Partial<StudySynthesisContext>): string {
  const modelName = ctx?.modelName || "{{MODEL_NAME}}";
  const modelId = ctx?.modelId || `${study.modelContract.domains[0] || "ssp"}.${modelName}`;
  const domain = ctx?.modelDomain || study.modelContract.domains[0] || "ssp";
  const target =
    ctx?.executionTarget || (study.execution.defaultTarget === "auto" ? "local-wasm" : study.execution.defaultTarget);

  const mergedInputs: Record<string, number | string | boolean> = {};
  for (const inp of study.inputs) {
    mergedInputs[inp.key] = ctx?.inputs?.[inp.key] ?? inp.defaultValue;
  }

  const bindings: StudyParameterBinding[] =
    ctx?.parameterBindings && ctx.parameterBindings.length > 0
      ? ctx.parameterBindings
      : study.modelContract.parameterSlots.map((slot) => ({
          parameterName: slot.slotId,
          slotId: slot.slotId,
          nominalValue: 1.0,
          min: 0.5,
          max: 1.5,
        }));

  const observables =
    ctx?.observables && ctx.observables.length > 0
      ? ctx.observables
      : study.modelContract.observableSlots.map((s) => s.slotId);

  const paramElements = [
    ...bindings.map(
      (b) => `    <ssv:Parameter name="${escapeXml(b.parameterName)}">
      <ssv:Real value="${b.nominalValue}"/>
    </ssv:Parameter>`,
    ),
    ...Object.entries(mergedInputs).map(([k, v]) => {
      if (typeof v === "boolean") {
        return `    <ssv:Parameter name="study.${escapeXml(k)}">
      <ssv:Boolean value="${v}"/>
    </ssv:Parameter>`;
      }
      if (typeof v === "number") {
        return `    <ssv:Parameter name="study.${escapeXml(k)}">
      <ssv:Real value="${v}"/>
    </ssv:Parameter>`;
      }
      return `    <ssv:Parameter name="study.${escapeXml(k)}">
      <ssv:String value="${escapeXml(String(v))}"/>
    </ssv:Parameter>`;
    }),
  ].join("\n");

  const obsXml = observables.map((o) => `        <msx:observable name="${escapeXml(o)}"/>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                  xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"
                  xmlns:msx="https://modelscript.org/ns/study-v1"
                  version="2.0"
                  name="${escapeXml(study.name)}">
  <ssv:Parameters>
${paramElements}
  </ssv:Parameters>
  <ssc:Annotations>
    <ssc:Annotation type="org.modelscript.study">
      <msx:studyMetadata
        id="${escapeXml(study.id)}"
        slug="${escapeXml(study.slug)}"
        name="${escapeXml(study.name)}"
        version="${escapeXml(study.version)}"
        kind="${escapeXml(study.kind)}"
        category="${escapeXml(study.category)}"
        domain="${escapeXml(domain)}"
        modelId="${escapeXml(modelId)}"
        modelName="${escapeXml(modelName)}"
        executionTarget="${escapeXml(target)}"
        packageName="${escapeXml(ctx?.packageName || study.packageName || "")}"
        packageVersion="${escapeXml(ctx?.packageVersion || study.packageVersion || "")}">
        <msx:description>${escapeXml(study.description)}</msx:description>
${obsXml}
      </msx:studyMetadata>
    </ssc:Annotation>
  </ssc:Annotations>
</ssv:ParameterSet>
`;
}

/**
 * Generates a valid Sandia Dakota (.dakota / .in) study specification
 * for Monte Carlo UQ (LHS / Sobol), Multi-Parameter DoE Sweeps, and Pareto Optimization.
 */
export function toDakotaInput(study: StudyDefinition, ctx?: Partial<StudySynthesisContext>): string {
  const modelName = ctx?.modelName || "{{MODEL_NAME}}";
  const modelId = ctx?.modelId || `${study.modelContract.domains[0] || "modelica"}.${modelName}`;
  const domain = ctx?.modelDomain || study.modelContract.domains[0] || "modelica";
  const target =
    ctx?.executionTarget || (study.execution.defaultTarget === "auto" ? "local-wasm" : study.execution.defaultTarget);

  const mergedInputs: Record<string, number | string | boolean> = {};
  for (const inp of study.inputs) {
    mergedInputs[inp.key] = ctx?.inputs?.[inp.key] ?? inp.defaultValue;
  }

  const bindings: StudyParameterBinding[] =
    ctx?.parameterBindings && ctx.parameterBindings.length > 0
      ? ctx.parameterBindings
      : study.modelContract.parameterSlots.map((slot) => ({
          parameterName: slot.slotId,
          slotId: slot.slotId,
          nominalValue: 1.0,
          min: 0.5,
          max: 1.5,
          steps: 10,
        }));

  const observables =
    ctx?.observables && ctx.observables.length > 0
      ? ctx.observables
      : study.modelContract.observableSlots.map((s) => s.slotId);

  const samples = Number(
    mergedInputs["sampleCount"] ?? mergedInputs["populationSize"] ?? mergedInputs["gridPointsPerDim"] ?? 64,
  );
  const seed = Number(mergedInputs["randomSeed"] ?? 42);
  const descriptors = bindings.map((b) => `'${b.parameterName}'`).join(" ");
  const initialPoints = bindings.map((b) => b.nominalValue).join(" ");
  const lowerBounds = bindings.map((b) => b.min ?? Number((b.nominalValue * 0.7).toPrecision(4))).join(" ");
  const upperBounds = bindings.map((b) => b.max ?? Number((b.nominalValue * 1.3).toPrecision(4))).join(" ");

  let methodBlock: string;
  if (study.kind === "optimization") {
    const maxIter = Number(mergedInputs["generations"] ?? mergedInputs["maxIterations"] ?? 60);
    methodBlock = `method
  moga
    max_function_evaluations = ${samples * maxIter}
    population_size = ${samples}
    seed = ${seed}
    fitness_type domination_count
    replacement_type below_limit = 6`;
  } else if (study.kind === "parameter-sweep") {
    const partitions = bindings.map((b) => b.steps ?? 8).join(" ");
    methodBlock = `method
  multidim_parameter_study
    partitions = ${partitions}`;
  } else {
    methodBlock = `method
  sampling
    sample_type lhs
    samples = ${samples}
    seed = ${seed}
    variance_based_decomp`;
  }

  const responseCount = Math.max(1, study.outputs.kpis.length || observables.length);
  const responseDescriptors = (
    study.outputs.kpis.length > 0 ? study.outputs.kpis.map((k) => `'${k.id}'`) : observables.map((o) => `'${o}'`)
  ).join(" ");

  const responseKind =
    study.kind === "optimization"
      ? `  objective_functions = ${responseCount}\n  descriptors = ${responseDescriptors}\n  no_gradients\n  no_hessians`
      : `  response_functions = ${responseCount}\n  descriptors = ${responseDescriptors}\n  no_gradients\n  no_hessians`;

  const concurrency = target === "hpc-cluster" ? 32 : target === "local-native" ? 8 : 4;
  const inputsCommentLines = Object.entries(mergedInputs)
    .map(([k, v]) => `# @msx-input ${k} = ${JSON.stringify(v)}`)
    .join("\n");

  return `# ============================================================================
# Sandia Dakota Study Specification (.dakota)
# Generated by ModelScript Polyglot Engineering Study Engine
# ============================================================================
# @msx-id ${study.id}
# @msx-slug ${study.slug}
# @msx-name ${study.name}
# @msx-version ${study.version}
# @msx-kind ${study.kind}
# @msx-category ${study.category}
# @msx-domain ${domain}
# @msx-model-id ${modelId}
# @msx-model-name ${modelName}
# @msx-target ${target}
# @msx-package ${ctx?.packageName || study.packageName || ""}
# @msx-description ${study.description}
${inputsCommentLines}

environment
  tabular_data
    tabular_data_file = '${study.slug}_results.dat'

${methodBlock}

model
  single

variables
  continuous_design = ${bindings.length}
    initial_point = ${initialPoints}
    lower_bounds  = ${lowerBounds}
    upper_bounds  = ${upperBounds}
    descriptors   = ${descriptors}

interface
  fork
    analysis_drivers = 'msx study-driver --domain=${domain} --model=${modelId} --target=${target}'
    asynchronous
    evaluation_concurrency = ${concurrency}

responses
${responseKind}
`;
}

/**
 * Synthesizes a concrete, rerunnable StudyInstanceArtifact in the chosen standard format
 * (.sedml, .ssv, or .dakota).
 */
export interface SynthesizeStudyInstanceOptions {
  study: StudyDefinition;
  model: CompatibleModelItem;
  req?: StudyRunRequest | undefined;
}

/**
 * Synthesizes a concrete, rerunnable StudyInstanceArtifact in the chosen standard format
 * (.sedml, .ssv, or .dakota).
 */
export function synthesizeStudyInstanceArtifact(
  studyOrOpts: StudyDefinition | SynthesizeStudyInstanceOptions,
  requestArg?: StudyRunRequest,
  resolvedModelArg?: CompatibleModelItem,
  resolvedTargetArg?: StudyExecutionTarget,
  mergedInputsArg?: Record<string, number | string | boolean>,
  parameterBindingsArg?: StudyParameterBinding[],
  observablesArg?: string[],
): StudyInstanceArtifact {
  const isOpts = "study" in studyOrOpts && "model" in studyOrOpts;
  const study: StudyDefinition = isOpts ? studyOrOpts.study : studyOrOpts;
  const request: StudyRunRequest = isOpts
    ? studyOrOpts.req || { templateIdOrSlug: study.slug }
    : requestArg || { templateIdOrSlug: study.slug };
  const resolvedModel: CompatibleModelItem = isOpts ? studyOrOpts.model : resolvedModelArg!;

  const resolvedTarget: StudyExecutionTarget =
    resolvedTargetArg ||
    request.executionTarget ||
    (study.execution.defaultTarget === "auto" ? "local-wasm" : study.execution.defaultTarget);

  const defaultInputs: Record<string, number | string | boolean> = {};
  for (const field of study.inputs) {
    defaultInputs[field.key] = field.defaultValue;
  }
  const mergedInputs: Record<string, number | string | boolean> = mergedInputsArg || {
    ...defaultInputs,
    ...(request.inputs || {}),
  };

  const parameterBindings: StudyParameterBinding[] =
    parameterBindingsArg ||
    (request.parameterBindings && request.parameterBindings.length > 0
      ? request.parameterBindings
      : resolvedModel.parameters.map((p) => ({
          parameterName: p.name,
          slotId: p.name,
          nominalValue: typeof p.defaultValue === "number" ? p.defaultValue : 1.0,
          min: p.min,
          max: p.max,
        })));

  const observables: string[] =
    observablesArg ||
    (request.observables && request.observables.length > 0
      ? request.observables
      : resolvedModel.observables.map((o) => o.name));

  const format: StudyStandardFormat = request.standardFormat || inferStudyStandard(study);
  const ext = getStandardFileExtension(format);
  const mimeType = getStandardMimeType(format);

  const safeModelSlug = resolvedModel.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `${safeModelSlug || "model"}__${study.slug}${ext}`;

  const ctx: StudySynthesisContext = {
    modelId: resolvedModel.id,
    modelName: resolvedModel.name,
    modelDomain: resolvedModel.domain,
    packageName: request.packageName || resolvedModel.packageName,
    packageVersion: request.packageVersion || resolvedModel.packageVersion,
    executionTarget: resolvedTarget,
    inputs: mergedInputs,
    parameterBindings,
    observables,
  };

  let sourceContent = request.studyInstanceSource;
  if (!sourceContent) {
    if (format === "sedml") {
      sourceContent = toSedmlXml(study, ctx);
    } else if (format === "ssp-ssv") {
      sourceContent = toSspSsvXml(study, ctx);
    } else {
      sourceContent = toDakotaInput(study, ctx);
    }
  }

  return {
    standardFormat: format,
    filename,
    fileName: filename,
    fileExtension: ext,
    mimeType,
    sourceContent,
    templateSlug: study.slug,
    templateName: study.name,
    modelId: resolvedModel.id,
    modelName: resolvedModel.name,
    modelDomain: resolvedModel.domain,
    packageName: ctx.packageName,
    packageVersion: ctx.packageVersion,
    executionTarget: resolvedTarget,
    inputs: mergedInputs,
    parameterBindings,
    observables,
    createdAt: new Date().toISOString(),
  };
}

export type ParsedStandardStudyResult = StudyDefinition & {
  study: StudyDefinition;
  standardFormat: StudyStandardFormat;
  boundModelId?: string | undefined;
  boundModelName?: string | undefined;
  boundInputs?: Record<string, number | string | boolean> | undefined;
  boundParameters?: StudyParameterBinding[] | undefined;
};

/**
 * Parses a standard study document (.sedml, .ssv, or .dakota) into a normalized
 * StudyDefinition and optional bound instance metadata.
 */
export function parseStandardStudyDocument(rawContent: string, filename = "study.sedml"): ParsedStandardStudyResult {
  const trimmed = rawContent.trim();
  const lowerFile = filename.toLowerCase();

  // 1. Legacy JSON fallback if a user passes JSON string
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as StudyDefinition;
    const fmt = inferStudyStandard(parsed);
    const normalized = { ...parsed, standardFormat: fmt };
    return {
      ...normalized,
      study: normalized,
      standardFormat: fmt,
    };
  }

  // 2. Sandia Dakota (.dakota / .in)
  if (
    lowerFile.endsWith(".dakota") ||
    lowerFile.endsWith(".in") ||
    (!trimmed.startsWith("<") && /method|variables|responses/i.test(trimmed))
  ) {
    const getTag = (key: string, fallback = ""): string => {
      const m = trimmed.match(new RegExp(`^#\\s*@msx-${key}\\s+(.+)$`, "m"));
      return m?.[1]?.trim() || fallback;
    };
    const slug = getTag("slug", filename.replace(/\.(dakota|in)$/i, ""));
    const id = getTag("id", `msx.studies.${slug}`);
    const name = getTag("name", slug.replace(/-/g, " "));
    const version = getTag("version", "1.0.0");
    const kind = getTag(
      "kind",
      trimmed.includes("moga")
        ? "optimization"
        : trimmed.includes("multidim_parameter_study")
          ? "parameter-sweep"
          : "monte-carlo",
    ) as StudyKind;
    const category = getTag(
      "category",
      kind === "optimization" ? "optimization" : "uncertainty",
    ) as StudyDefinition["category"];
    const domain = getTag("domain", "modelica") as StudyDomain;
    const modelId = getTag("model-id", "");
    const modelName = getTag("model-name", "");
    const description = getTag("description", `Sandia Dakota ${kind} study specification.`);

    const boundInputs: Record<string, number | string | boolean> = {};
    const inputMatches = trimmed.matchAll(/^#\s*@msx-input\s+([A-Za-z0-9_]+)\s*=\s*(.+)$/gm);
    for (const m of inputMatches) {
      const k = m[1]!;
      try {
        boundInputs[k] = JSON.parse(m[2]!.trim());
      } catch {
        boundInputs[k] = m[2]!.trim();
      }
    }

    const samplesMatch = trimmed.match(/samples\s*=\s*(\d+)/);
    if (samplesMatch && boundInputs["sampleCount"] === undefined) {
      boundInputs["sampleCount"] = Number(samplesMatch[1]);
    }

    const descMatch = trimmed.match(/descriptors\s*=\s*([^\n]+)/);
    const initMatch = trimmed.match(/initial_point\s*=\s*([^\n]+)/);
    const lowerMatch = trimmed.match(/lower_bounds\s*=\s*([^\n]+)/);
    const upperMatch = trimmed.match(/upper_bounds\s*=\s*([^\n]+)/);

    const varNames = descMatch ? Array.from(descMatch[1]!.matchAll(/'([^']+)'/g)).map((m) => m[1]!) : ["param_1"];
    const initials = initMatch ? initMatch[1]!.trim().split(/\s+/).map(Number) : [];
    const lowers = lowerMatch ? lowerMatch[1]!.trim().split(/\s+/).map(Number) : [];
    const uppers = upperMatch ? upperMatch[1]!.trim().split(/\s+/).map(Number) : [];

    const boundParameters: StudyParameterBinding[] = varNames.map((pName, i) => ({
      parameterName: pName,
      slotId: pName,
      nominalValue: Number.isFinite(initials[i]) ? initials[i]! : 1.0,
      min: Number.isFinite(lowers[i]) ? lowers[i]! : 0.5,
      max: Number.isFinite(uppers[i]) ? uppers[i]! : 1.5,
    }));

    const study: StudyDefinition = {
      schemaVersion: "1.0.0",
      standardFormat: "dakota",
      id,
      slug,
      name,
      version,
      kind,
      category,
      sourceType: "package",
      artifactPath: filename,
      authorUsername: "modelscript",
      icon: kind === "optimization" ? "compass" : "beaker",
      description,
      tags: ["dakota", kind, domain],
      featured: true,
      starsCount: 42,
      runsCount: 120,
      modelContract: {
        domains: [domain],
        minParameters: 1,
        minObservables: 1,
        parameterSlots: varNames.map((v) => ({
          slotId: v,
          label: v,
          description: `Dakota design/uncertain variable '${v}'`,
          type: "Real",
          variability: "parameter",
          multiple: false,
        })),
        observableSlots: [
          {
            slotId: "response_1",
            label: "Primary Response Function",
            description: "Dakota response observable",
            type: "Real",
            multiple: true,
          },
        ],
      },
      inputs: Object.entries(boundInputs).map(([k, v]) => ({
        key: k,
        label: k,
        type: typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "text",
        defaultValue: v,
        group: "sampling",
      })),
      presets: [
        {
          id: "default",
          label: "Default Dakota Configuration",
          description: "Standard Dakota evaluation settings",
          values: boundInputs,
        },
      ],
      execution: {
        supportedTargets: ["local-wasm", "local-native", "hpc-cluster"],
        defaultTarget: "auto",
        recommendedSolver: "Dakota LHS / MOGA",
        recommendedProfile: "high-cpu",
        estimatedCredits: 25,
        pipelineSteps: ["Parse Dakota .dakota deck", "Evaluate ensemble samples", "Compute Sobol / Pareto metrics"],
      },
      outputs: {
        kpis: [{ id: "primary_response", label: "Primary Dakota Response", expr: "mean(y)" }],
        views: [{ kind: kind === "optimization" ? "pareto-front" : "sobol-bar", title: `${name} Results` }],
      },
    };

    return {
      ...study,
      study,
      standardFormat: "dakota",
      boundModelId: modelId || undefined,
      boundModelName: modelName || undefined,
      boundInputs,
      boundParameters,
    };
  }

  // 3. ASAM SSP 2.0 Parameter Set (.ssv / .ssd)
  if (lowerFile.endsWith(".ssv") || lowerFile.endsWith(".ssd") || trimmed.includes("SystemStructureParameterValues")) {
    const getAttr = (attr: string, fallback = ""): string => {
      const m = trimmed.match(new RegExp(`${attr}="([^"]*)"`, "i"));
      return m?.[1] ? unescapeXml(m[1]) : fallback;
    };
    const slug = getAttr("slug", filename.replace(/\.(ssv|ssd)$/i, ""));
    const id = getAttr("id", `msx.studies.${slug}`);
    const name = getAttr("name", slug);
    const version = getAttr("version", "2.0");
    const kind = getAttr("kind", "parameter-sweep") as StudyKind;
    const category = getAttr("category", "simulation") as StudyDefinition["category"];
    const domain = getAttr("domain", "ssp") as StudyDomain;
    const modelId = getAttr("modelId", "");
    const modelName = getAttr("modelName", "");
    const descMatch = trimmed.match(/<msx:description>([\s\S]*?)<\/msx:description>/);
    const description = descMatch?.[1] ? unescapeXml(descMatch[1].trim()) : `ASAM SSP 2.0 Parameter Set (${name}).`;

    const boundParameters: StudyParameterBinding[] = [];
    const boundInputs: Record<string, number | string | boolean> = {};
    const paramRegex =
      /<ssv:Parameter\s+name="([^"]+)"[^>]*>[\s\S]*?<ssv:(Real|Integer|Boolean|String)\s+value="([^"]+)"/g;
    for (const m of trimmed.matchAll(paramRegex)) {
      const pName = unescapeXml(m[1]!);
      const pType = m[2]!;
      const rawVal = unescapeXml(m[3]!);
      if (pName.startsWith("study.")) {
        const key = pName.slice(6);
        boundInputs[key] = pType === "Boolean" ? rawVal === "true" : pType === "String" ? rawVal : Number(rawVal);
      } else {
        const numVal = Number(rawVal);
        boundParameters.push({
          parameterName: pName,
          slotId: pName,
          nominalValue: Number.isFinite(numVal) ? numVal : 1.0,
        });
      }
    }

    const study: StudyDefinition = {
      schemaVersion: "1.0.0",
      standardFormat: "ssp-ssv",
      id,
      slug,
      name,
      version,
      kind,
      category,
      sourceType: "package",
      artifactPath: filename,
      authorUsername: "modelscript",
      icon: "sliders",
      description,
      tags: ["ssp", "ssv", domain],
      featured: true,
      starsCount: 38,
      runsCount: 95,
      modelContract: {
        domains: [domain, "modelica", "fmu"],
        minParameters: 0,
        minObservables: 1,
        parameterSlots: boundParameters.map((b) => ({
          slotId: b.parameterName,
          label: b.parameterName,
          description: `SSP 2.0 parameter '${b.parameterName}'`,
          type: "Real",
          variability: "parameter",
          multiple: false,
        })),
        observableSlots: [
          {
            slotId: "y",
            label: "System Output Observable",
            description: "Tracked SSP system connector observable",
            type: "Real",
            multiple: true,
          },
        ],
      },
      inputs: Object.entries(boundInputs).map(([k, v]) => ({
        key: k,
        label: k,
        type: typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "text",
        defaultValue: v,
        group: "physics",
      })),
      presets: [
        { id: "default", label: "Nominal SSV Parameter Set", description: "SSP 2.0 values", values: boundInputs },
      ],
      execution: {
        supportedTargets: ["local-wasm", "local-native", "hpc-cluster"],
        defaultTarget: "auto",
        recommendedSolver: "OMSimulator / SUNDIALS",
        recommendedProfile: "standard",
        estimatedCredits: 10,
        pipelineSteps: ["Bind SSP 2.0 .ssv parameter set", "Execute co-simulation / DAE", "Verify outputs"],
      },
      outputs: {
        kpis: [{ id: "steady_val", label: "Final Value", expr: "last(y)" }],
        views: [{ kind: "trajectory", title: `${name} Trajectories` }],
      },
    };

    return {
      ...study,
      study,
      standardFormat: "ssp-ssv",
      boundModelId: modelId || undefined,
      boundModelName: modelName || undefined,
      boundInputs,
      boundParameters,
    };
  }

  // 4. SED-ML L1V4 (.sedml)
  const getMetaAttr = (attr: string, fallback = ""): string => {
    const metaBlock = trimmed.match(/<msx:studyMetadata([\s\S]*?)>/)?.[1] || trimmed;
    const m = metaBlock.match(new RegExp(`${attr}="([^"]*)"`, "i"));
    return m?.[1] ? unescapeXml(m[1]) : fallback;
  };

  const slug = getMetaAttr("slug", filename.replace(/\.sedml$/i, ""));
  const id = getMetaAttr("id", `msx.studies.${slug}`);
  const name = getMetaAttr("name", slug);
  const version = getMetaAttr("version", "1.0.0");
  const hasRepeatedTask = /<repeatedTask/i.test(trimmed);
  const hasSteadyState = /<steadyState/i.test(trimmed);
  const kind = getMetaAttr(
    "kind",
    hasRepeatedTask ? "parameter-sweep" : hasSteadyState ? "steady-state" : "time-course",
  ) as StudyKind;
  const category = getMetaAttr("category", hasRepeatedTask ? "sweep" : "simulation") as StudyDefinition["category"];
  const domain = getMetaAttr("domain", "modelica") as StudyDomain;
  const descMatch = trimmed.match(/<msx:description>([\s\S]*?)<\/msx:description>/);
  const description = descMatch?.[1]
    ? unescapeXml(descMatch[1].trim())
    : `SED-ML L1V4 simulation experiment (${name}).`;

  const modelMatch = trimmed.match(/<model\s+[^>]*name="([^"]*)"[^>]*source="([^"]*)"/i);
  const boundModelName = modelMatch?.[1] ? unescapeXml(modelMatch[1]) : undefined;
  const boundModelId = modelMatch?.[2] ? unescapeXml(modelMatch[2]) : undefined;

  const boundInputs: Record<string, number | string | boolean> = {};
  for (const m of trimmed.matchAll(/<msx:input\s+key="([^"]+)"\s+value="([^"]*)"\s*\/>/g)) {
    const k = unescapeXml(m[1]!);
    const raw = unescapeXml(m[2]!);
    if (raw === "true" || raw === "false") boundInputs[k] = raw === "true";
    else if (raw !== "" && Number.isFinite(Number(raw))) boundInputs[k] = Number(raw);
    else boundInputs[k] = raw;
  }

  const utcMatch = trimmed.match(/<uniformTimeCourse[^>]*outputEndTime="([^"]+)"[^>]*numberOfSteps="([^"]+)"/i);
  if (utcMatch) {
    if (boundInputs["stopTime"] === undefined) boundInputs["stopTime"] = Number(utcMatch[1]);
    if (boundInputs["intervals"] === undefined) boundInputs["intervals"] = Number(utcMatch[2]);
  }

  const boundParameters: StudyParameterBinding[] = [];
  for (const m of trimmed.matchAll(/<changeAttribute\s+target="[^']*['"]([^'"]+)['"][^"]*"\s+newValue="([^"]+)"/g)) {
    boundParameters.push({
      parameterName: unescapeXml(m[1]!),
      slotId: unescapeXml(m[1]!),
      nominalValue: Number(m[2]) || 1.0,
    });
  }

  const rangeMatch = trimmed.match(
    /<uniformRange\s+id="range_([^"]+)"\s+start="([^"]+)"\s+end="([^"]+)"\s+numberOfSteps="([^"]+)"/i,
  );
  if (rangeMatch) {
    const pName = unescapeXml(rangeMatch[1]!);
    const existing = boundParameters.find((b) => b.parameterName === pName);
    if (existing) {
      existing.min = Number(rangeMatch[2]);
      existing.max = Number(rangeMatch[3]);
      existing.steps = Number(rangeMatch[4]);
    } else {
      boundParameters.push({
        parameterName: pName,
        slotId: pName,
        nominalValue: (Number(rangeMatch[2]) + Number(rangeMatch[3])) / 2,
        min: Number(rangeMatch[2]),
        max: Number(rangeMatch[3]),
        steps: Number(rangeMatch[4]),
      });
    }
  }

  const study: StudyDefinition = {
    schemaVersion: "1.0.0",
    standardFormat: "sedml",
    id,
    slug,
    name,
    version,
    kind,
    category,
    sourceType: "package",
    artifactPath: filename,
    authorUsername: "modelscript",
    icon: "activity",
    description,
    tags: ["sed-ml", kind, domain],
    featured: true,
    starsCount: 64,
    runsCount: 240,
    modelContract: {
      domains: [domain],
      minParameters: 0,
      minObservables: 1,
      parameterSlots: boundParameters.map((b) => ({
        slotId: b.parameterName,
        label: b.parameterName,
        description: `SED-ML model attribute '${b.parameterName}'`,
        type: "Real",
        variability: "parameter",
        multiple: false,
      })),
      observableSlots: [
        {
          slotId: "trajectories",
          label: "SED-ML DataGenerator Variables",
          description: "Tracked SED-ML variables",
          type: "Real",
          multiple: true,
        },
      ],
    },
    inputs: Object.entries(boundInputs).map(([k, v]) => ({
      key: k,
      label: k,
      type: typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "text",
      defaultValue: v,
      group: "solver",
    })),
    presets: [
      { id: "default", label: "SED-ML Experiment Defaults", description: "Standard SED-ML task", values: boundInputs },
    ],
    execution: {
      supportedTargets: ["local-wasm", "local-native", "hpc-cluster"],
      defaultTarget: "auto",
      recommendedSolver: "DASSL / SUNDIALS CVODE",
      recommendedProfile: "standard",
      estimatedCredits: 5,
      pipelineSteps: [
        "Parse SED-ML L1V4 XML",
        "Bind model attributes",
        "Run KiSAO simulation task",
        "Evaluate DataGenerators",
      ],
    },
    outputs: {
      kpis: [{ id: "peak_response", label: "Peak Observable", expr: "max(y)" }],
      views: [{ kind: hasRepeatedTask ? "sweep-curve" : "trajectory", title: `${name} Plot2D` }],
    },
  };

  return {
    ...study,
    study,
    standardFormat: "sedml",
    boundModelId,
    boundModelName,
    boundInputs,
    boundParameters,
  };
}
