// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — OLGA FMI 2.0 / 3.0 Co-Simulation FMU Exporter.
 *
 * Generates standards-compliant Functional Mock-up Units (FMU) from OLGA multiphase models:
 * - FMI 2.0 / FMI 3.0 Co-Simulation modelDescription.xml
 * - Standardized flow assurance variables (choke_opening, inlet_mass_rate, p_inlet, p_arrival,
 *   t_arrival, holdup_arrival, surge_vol, mean_slug_length, slug_frequency)
 * - Bundled Co-Simulation C sources and embedded drift-flux solver runtime
 * - Packaged into a standalone .fmu ZIP archive via createZip
 */

import type { OlgaModel } from "@modelscript/olga";
import { serializeOpi } from "@modelscript/olga";
import { createZip } from "./archive.js";

export interface OlgaFmuOptions {
  /** Target model identifier (used as C symbol prefix and FMU filename stem). */
  modelIdentifier?: string | undefined;
  /** FMI specification version: "2.0" | "3.0" | "both" (default: "2.0"). */
  fmiVersion?: "2.0" | "3.0" | "both" | undefined;
  /** Unique GUID / instantiation token for this FMU. */
  guid?: string | undefined;
  /** Human-readable description. */
  description?: string | undefined;
  /** Author name. */
  author?: string | undefined;
  /** Initial simulation time in seconds (default: 0.0). */
  startTime?: number | undefined;
  /** Default communication step size in seconds (default: 1.0). */
  stepSize?: number | undefined;
  /** Include C source code in sources/ (default: true). */
  includeSources?: boolean | undefined;
  /** Include serialized model.opi and model.json in resources/ (default: true). */
  includeResources?: boolean | undefined;
}

export interface OlgaFmuResult {
  /** The complete .fmu ZIP archive bytes. */
  archive: Uint8Array;
  /** The generated FMI 2.0 modelDescription.xml string. */
  modelDescription2Xml: string;
  /** The generated FMI 3.0 modelDescription.xml string (if requested). */
  modelDescription3Xml?: string | undefined;
  /** File manifest inside the FMU archive. */
  files: string[];
  /** Model identifier. */
  modelIdentifier: string;
  /** Number of exposed FMI variables. */
  variableCount: number;
}

/** Sanitize an identifier for C code and XML schema. */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "") || "olga_model";
}

/** Generate a stable GUID from a seed string. */
function generateGuid(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `{${hex.slice(0, 8)}-4f89-9b12-a7cd-${hex.padEnd(12, "0").slice(0, 12)}}`;
}

/**
 * Builds FMI 2.0 modelDescription.xml for an OLGA model.
 */
export function generateOlgaFmi2ModelDescription(
  model: OlgaModel,
  modelIdentifier: string,
  guid: string,
  options: OlgaFmuOptions = {},
): string {
  const startTime = options.startTime ?? model.startTime ?? 0.0;
  const stopTime = model.endTime ?? 3600.0;
  const stepSize = options.stepSize ?? model.maxDt ?? 1.0;
  const desc = options.description ?? `OLGA Multiphase Co-Simulation FMU: ${model.title}`;

  const pipeLength = model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 5000.0;
  const pipeDiameter = model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254;

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="${modelIdentifier}"
  guid="${guid}"
  description="${desc}"
  generationTool="ModelScript OLGA Standards Engine"
  generationDateAndTime="${new Date().toISOString()}"
  variableNamingConvention="structured"
  numberOfEventIndicators="0">

  <CoSimulation
    modelIdentifier="${modelIdentifier}"
    canHandleVariableCommunicationStepSize="true"
    canInterpolateInputs="true"
    maxOutputDerivativeOrder="0"
    canRunAsynchronuously="false"
    canBeInstantiatedOnlyOncePerProcess="false"
    canNotUseMemoryManagementFunctions="true"
    canGetAndSetFMUstate="false"
    canSerializeFMUstate="false"
    providesDirectionalDerivative="false">
    <SourceFiles>
      <File name="olga_cosim.c" />
    </SourceFiles>
  </CoSimulation>

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
    <!-- Inputs (VR 1..4) -->
    <ScalarVariable name="choke_opening" valueReference="1" causality="input" variability="continuous" description="Topside choke opening fraction [0..1]">
      <Real start="1.0" min="0.0" max="1.0" />
    </ScalarVariable>
    <ScalarVariable name="inlet_mass_rate" valueReference="2" causality="input" variability="continuous" description="Inlet total multiphase mass flow rate [kg/s]">
      <Real start="35.0" unit="kg/s" min="0.0" />
    </ScalarVariable>
    <ScalarVariable name="inlet_pressure" valueReference="3" causality="input" variability="continuous" description="Inlet boundary pressure [Pa]">
      <Real start="12000000.0" unit="Pa" min="100000.0" />
    </ScalarVariable>
    <ScalarVariable name="inlet_temperature" valueReference="4" causality="input" variability="continuous" description="Inlet boundary temperature [K]">
      <Real start="335.15" unit="K" min="250.0" max="450.0" />
    </ScalarVariable>

    <!-- Outputs (VR 10..16) -->
    <ScalarVariable name="p_inlet" valueReference="10" causality="output" variability="continuous" description="Flowline inlet dynamic pressure [Pa]">
      <Real unit="Pa" />
    </ScalarVariable>
    <ScalarVariable name="p_arrival" valueReference="11" causality="output" variability="continuous" description="Topside arrival pressure [Pa]">
      <Real unit="Pa" />
    </ScalarVariable>
    <ScalarVariable name="t_arrival" valueReference="12" causality="output" variability="continuous" description="Topside arrival temperature [K]">
      <Real unit="K" />
    </ScalarVariable>
    <ScalarVariable name="holdup_arrival" valueReference="13" causality="output" variability="continuous" description="Topside arrival liquid holdup fraction [-]">
      <Real min="0.0" max="1.0" />
    </ScalarVariable>
    <ScalarVariable name="surge_vol" valueReference="14" causality="output" variability="continuous" description="Topside slug catcher accumulated liquid surge volume [m3]">
      <Real unit="m3" min="0.0" />
    </ScalarVariable>
    <ScalarVariable name="mean_slug_length" valueReference="15" causality="output" variability="continuous" description="Hydrodynamic slug body mean length [m]">
      <Real unit="m" min="0.0" />
    </ScalarVariable>
    <ScalarVariable name="slug_frequency" valueReference="16" causality="output" variability="continuous" description="Hydrodynamic slug arrival frequency [Hz]">
      <Real unit="Hz" min="0.0" />
    </ScalarVariable>

    <!-- Parameters (VR 100..102) -->
    <ScalarVariable name="pipe_length" valueReference="100" causality="parameter" variability="fixed" description="Total flowline horizontal length [m]">
      <Real start="${pipeLength.toFixed(2)}" unit="m" />
    </ScalarVariable>
    <ScalarVariable name="pipe_diameter" valueReference="101" causality="parameter" variability="fixed" description="Nominal internal pipe diameter [m]">
      <Real start="${pipeDiameter.toFixed(4)}" unit="m" />
    </ScalarVariable>
    <ScalarVariable name="step_size" valueReference="102" causality="parameter" variability="fixed" description="Internal drift-flux solver communication step [s]">
      <Real start="${stepSize.toFixed(2)}" unit="s" />
    </ScalarVariable>
  </ModelVariables>

  <ModelStructure>
    <Outputs>
      <Unknown index="5" />
      <Unknown index="6" />
      <Unknown index="7" />
      <Unknown index="8" />
      <Unknown index="9" />
      <Unknown index="10" />
      <Unknown index="11" />
    </Outputs>
    <InitialUnknowns>
      <Unknown index="5" />
      <Unknown index="6" />
      <Unknown index="7" />
      <Unknown index="8" />
      <Unknown index="9" />
      <Unknown index="10" />
      <Unknown index="11" />
    </InitialUnknowns>
  </ModelStructure>

</fmiModelDescription>
`;
}

/**
 * Builds FMI 3.0 modelDescription.xml for an OLGA model.
 */
export function generateOlgaFmi3ModelDescription(
  model: OlgaModel,
  modelIdentifier: string,
  instantiationToken: string,
  options: OlgaFmuOptions = {},
): string {
  const startTime = options.startTime ?? model.startTime ?? 0.0;
  const stopTime = model.endTime ?? 3600.0;
  const stepSize = options.stepSize ?? model.maxDt ?? 1.0;
  const desc = options.description ?? `OLGA Multiphase Co-Simulation FMU: ${model.title}`;

  const pipeLength = model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 5000.0;
  const pipeDiameter = model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254;

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="3.0"
  modelName="${modelIdentifier}"
  instantiationToken="${instantiationToken}"
  description="${desc}"
  generationTool="ModelScript OLGA Standards Engine"
  generationDateAndTime="${new Date().toISOString()}"
  variableNamingConvention="structured">

  <CoSimulation
    modelIdentifier="${modelIdentifier}"
    canHandleVariableCommunicationStepSize="true"
    canInterpolateInputs="true"
    canRunAsynchronuously="false"
    providesPerElementDependencies="false" />

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
    <Float64 name="choke_opening" valueReference="1" causality="input" variability="continuous" start="1.0" min="0.0" max="1.0" description="Topside choke opening fraction [0..1]" />
    <Float64 name="inlet_mass_rate" valueReference="2" causality="input" variability="continuous" start="35.0" unit="kg/s" min="0.0" description="Inlet total multiphase mass flow rate [kg/s]" />
    <Float64 name="inlet_pressure" valueReference="3" causality="input" variability="continuous" start="12000000.0" unit="Pa" min="100000.0" description="Inlet boundary pressure [Pa]" />
    <Float64 name="inlet_temperature" valueReference="4" causality="input" variability="continuous" start="335.15" unit="K" min="250.0" max="450.0" description="Inlet boundary temperature [K]" />

    <Float64 name="p_inlet" valueReference="10" causality="output" variability="continuous" unit="Pa" description="Flowline inlet dynamic pressure [Pa]" />
    <Float64 name="p_arrival" valueReference="11" causality="output" variability="continuous" unit="Pa" description="Topside arrival pressure [Pa]" />
    <Float64 name="t_arrival" valueReference="12" causality="output" variability="continuous" unit="K" description="Topside arrival temperature [K]" />
    <Float64 name="holdup_arrival" valueReference="13" causality="output" variability="continuous" min="0.0" max="1.0" description="Topside arrival liquid holdup fraction [-]" />
    <Float64 name="surge_vol" valueReference="14" causality="output" variability="continuous" unit="m3" min="0.0" description="Topside slug catcher accumulated liquid surge volume [m3]" />
    <Float64 name="mean_slug_length" valueReference="15" causality="output" variability="continuous" unit="m" min="0.0" description="Hydrodynamic slug body mean length [m]" />
    <Float64 name="slug_frequency" valueReference="16" causality="output" variability="continuous" unit="Hz" min="0.0" description="Hydrodynamic slug arrival frequency [Hz]" />

    <Float64 name="pipe_length" valueReference="100" causality="parameter" variability="fixed" start="${pipeLength.toFixed(2)}" unit="m" description="Total flowline horizontal length [m]" />
    <Float64 name="pipe_diameter" valueReference="101" causality="parameter" variability="fixed" start="${pipeDiameter.toFixed(4)}" unit="m" description="Nominal internal pipe diameter [m]" />
    <Float64 name="step_size" valueReference="102" causality="parameter" variability="fixed" start="${stepSize.toFixed(2)}" unit="s" description="Internal drift-flux solver communication step [s]" />
  </ModelVariables>

  <ModelStructure>
    <Output valueReference="10" />
    <Output valueReference="11" />
    <Output valueReference="12" />
    <Output valueReference="13" />
    <Output valueReference="14" />
    <Output valueReference="15" />
    <Output valueReference="16" />
    <InitialUnknown valueReference="10" />
    <InitialUnknown valueReference="11" />
    <InitialUnknown valueReference="12" />
    <InitialUnknown valueReference="13" />
    <InitialUnknown valueReference="14" />
    <InitialUnknown valueReference="15" />
    <InitialUnknown valueReference="16" />
  </ModelStructure>

</fmiModelDescription>
`;
}

/**
 * Builds standard FMI 2.0 Co-Simulation C source code embedding the drift-flux solver.
 */
export function generateOlgaCosimCSource(modelIdentifier: string, model: OlgaModel): string {
  const pipeLength = model.flowpaths[0]?.pipes.reduce((acc, p) => acc + p.length, 0) ?? 5000.0;
  const pipeDiameter = model.flowpaths[0]?.pipes[0]?.diameter ?? 0.254;

  return `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* ModelScript OLGA FMI 2.0 Co-Simulation Solver Implementation */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define FMI2_FUNCTION_PREFIX ${modelIdentifier}_
#define MODEL_IDENTIFIER "${modelIdentifier}"

typedef void* fmi2Component;
typedef void* fmi2ComponentEnvironment;
typedef void* fmi2FMUstate;
typedef unsigned int fmi2ValueReference;
typedef double fmi2Real;
typedef int fmi2Integer;
typedef int fmi2Boolean;
typedef const char* fmi2String;

typedef enum {
    fmi2OK,
    fmi2Warning,
    fmi2Discard,
    fmi2Error,
    fmi2Fatal,
    fmi2Pending
} fmi2Status;

typedef struct {
    /* Inputs */
    fmi2Real choke_opening;
    fmi2Real inlet_mass_rate;
    fmi2Real inlet_pressure;
    fmi2Real inlet_temperature;

    /* Outputs */
    fmi2Real p_inlet;
    fmi2Real p_arrival;
    fmi2Real t_arrival;
    fmi2Real holdup_arrival;
    fmi2Real surge_vol;
    fmi2Real mean_slug_length;
    fmi2Real slug_frequency;

    /* Parameters */
    fmi2Real pipe_length;
    fmi2Real pipe_diameter;
    fmi2Real step_size;

    /* State */
    fmi2Real current_time;
    fmi2Real accumulated_surge;
} OlgaModelInstance;

fmi2Component ${modelIdentifier}_fmi2Instantiate(
    fmi2String instanceName,
    int fmuType,
    fmi2String fmuGUID,
    fmi2String fmuResourceLocation,
    const void* functions,
    fmi2Boolean visible,
    fmi2Boolean loggingOn)
{
    (void)instanceName; (void)fmuType; (void)fmuGUID;
    (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;

    OlgaModelInstance* inst = (OlgaModelInstance*)calloc(1, sizeof(OlgaModelInstance));
    if (!inst) return NULL;

    inst->choke_opening = 1.0;
    inst->inlet_mass_rate = 35.0;
    inst->inlet_pressure = 12000000.0;
    inst->inlet_temperature = 335.15;

    inst->pipe_length = ${pipeLength.toFixed(2)};
    inst->pipe_diameter = ${pipeDiameter.toFixed(4)};
    inst->step_size = 1.0;

    inst->p_inlet = inst->inlet_pressure;
    inst->p_arrival = 3500000.0;
    inst->t_arrival = 295.15;
    inst->holdup_arrival = 0.15;
    inst->surge_vol = 0.0;
    inst->mean_slug_length = 25.0;
    inst->slug_frequency = 0.02;

    return (fmi2Component)inst;
}

void ${modelIdentifier}_fmi2FreeInstance(fmi2Component c) {
    if (c) free(c);
}

fmi2Status ${modelIdentifier}_fmi2SetupExperiment(
    fmi2Component c,
    fmi2Boolean toleranceDefined,
    fmi2Real tolerance,
    fmi2Real startTime,
    fmi2Boolean stopTimeDefined,
    fmi2Real stopTime)
{
    (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    inst->current_time = startTime;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2EnterInitializationMode(fmi2Component c) {
    (void)c;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2ExitInitializationMode(fmi2Component c) {
    (void)c;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2DoStep(
    fmi2Component c,
    fmi2Real currentCommunicationPoint,
    fmi2Real communicationStepSize,
    fmi2Boolean noSetFMUStatePriorToCurrentPoint)
{
    (void)noSetFMUStatePriorToCurrentPoint;
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;

    inst->current_time = currentCommunicationPoint + communicationStepSize;

    /* 1D Drift-Flux Multiphase Hydraulic Step */
    fmi2Real area = 3.141592653589793 * (inst->pipe_diameter * inst->pipe_diameter) * 0.25;
    fmi2Real rho_l = 850.0;
    fmi2Real rho_g = 65.0;
    fmi2Real j_m = inst->inlet_mass_rate / (area * (rho_l * inst->holdup_arrival + rho_g * (1.0 - inst->holdup_arrival)));

    /* Choke pressure throttling */
    fmi2Real choke_eff = fmax(0.01, fmin(1.0, inst->choke_opening));
    fmi2Real choke_dp = (1.0 - choke_eff) * (rho_l * j_m * j_m * 0.5 * 10.0);

    /* Arrival pressure and cooldown */
    fmi2Real friction_dp = 0.02 * (inst->pipe_length / inst->pipe_diameter) * 0.5 * rho_l * j_m * j_m;
    inst->p_arrival = fmax(100000.0, inst->inlet_pressure - friction_dp - choke_dp);
    inst->p_inlet = inst->inlet_pressure;

    /* Thermal cooling along subsea seabed */
    fmi2Real t_seabed = 277.15; /* 4 C */
    fmi2Real cooling_factor = exp(-0.0003 * inst->pipe_length);
    inst->t_arrival = t_seabed + (inst->inlet_temperature - t_seabed) * cooling_factor;

    /* Hydrodynamic slug dynamics */
    fmi2Real slug_v = 1.2 * j_m + 0.35 * sqrt(9.81 * inst->pipe_diameter);
    inst->mean_slug_length = fmax(5.0, 32.0 * inst->pipe_diameter * pow(fmax(0.1, j_m), 0.4));
    inst->slug_frequency = (j_m > 0.5) ? (0.025 * j_m / inst->pipe_diameter) : 0.0;

    /* Liquid surge volume into catcher */
    fmi2Real liquid_rate = inst->inlet_mass_rate * 0.65 / rho_l; /* m3/s */
    fmi2Real surge_increment = liquid_rate * (1.0 + 0.35 * sin(inst->current_time * inst->slug_frequency * 6.28318));
    inst->accumulated_surge += surge_increment * communicationStepSize;
    inst->surge_vol = fmax(0.0, inst->accumulated_surge);

    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetReal(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    fmi2Real value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;

    for (size_t i = 0; i < nvr; i++) {
        switch (vr[i]) {
            case 1:  value[i] = inst->choke_opening; break;
            case 2:  value[i] = inst->inlet_mass_rate; break;
            case 3:  value[i] = inst->inlet_pressure; break;
            case 4:  value[i] = inst->inlet_temperature; break;
            case 10: value[i] = inst->p_inlet; break;
            case 11: value[i] = inst->p_arrival; break;
            case 12: value[i] = inst->t_arrival; break;
            case 13: value[i] = inst->holdup_arrival; break;
            case 14: value[i] = inst->surge_vol; break;
            case 15: value[i] = inst->mean_slug_length; break;
            case 16: value[i] = inst->slug_frequency; break;
            case 100: value[i] = inst->pipe_length; break;
            case 101: value[i] = inst->pipe_diameter; break;
            case 102: value[i] = inst->step_size; break;
            default: return fmi2Discard;
        }
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetReal(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    const fmi2Real value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;

    for (size_t i = 0; i < nvr; i++) {
        switch (vr[i]) {
            case 1: inst->choke_opening = fmax(0.0, fmin(1.0, value[i])); break;
            case 2: inst->inlet_mass_rate = fmax(0.0, value[i]); break;
            case 3: inst->inlet_pressure = fmax(100000.0, value[i]); break;
            case 4: inst->inlet_temperature = fmax(200.0, value[i]); break;
            default: return fmi2Discard;
        }
    }
    return fmi2OK;
}

const char* ${modelIdentifier}_fmi2GetVersion(void) {
    return "2.0";
}

const char* ${modelIdentifier}_fmi2GetTypesPlatform(void) {
    return "default";
}
`;
}

/**
 * Exports an OLGA model as an FMI 2.0/3.0 Co-Simulation FMU package.
 */
export function exportOlgaFmu(model: OlgaModel, options: OlgaFmuOptions = {}): OlgaFmuResult {
  const modelIdentifier = sanitizeIdentifier(options.modelIdentifier || model.title || "olga_pipeline");
  const guid = options.guid || generateGuid(modelIdentifier + model.title);
  const fmiVersion = options.fmiVersion || "2.0";

  const filesMap = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  // 1. Generate modelDescription.xml
  const modelDescription2Xml = generateOlgaFmi2ModelDescription(model, modelIdentifier, guid, options);
  let modelDescription3Xml: string | undefined;

  if (fmiVersion === "3.0") {
    modelDescription3Xml = generateOlgaFmi3ModelDescription(model, modelIdentifier, guid, options);
    filesMap.set("modelDescription.xml", encoder.encode(modelDescription3Xml));
  } else {
    filesMap.set("modelDescription.xml", encoder.encode(modelDescription2Xml));
    if (fmiVersion === "both") {
      modelDescription3Xml = generateOlgaFmi3ModelDescription(model, modelIdentifier, guid, options);
      filesMap.set("modelDescription3.xml", encoder.encode(modelDescription3Xml));
    }
  }

  // 2. Include C Co-Simulation sources
  if (options.includeSources !== false) {
    const cSource = generateOlgaCosimCSource(modelIdentifier, model);
    filesMap.set(`sources/${modelIdentifier}_cosim.c`, encoder.encode(cSource));
  }

  // 3. Include Model Resources
  if (options.includeResources !== false) {
    const opiXml = serializeOpi(model);
    filesMap.set(`resources/model.opi`, encoder.encode(opiXml));
    filesMap.set(`resources/model.json`, encoder.encode(JSON.stringify(model, null, 2)));
  }

  // 4. Create ZIP archive
  const archive = createZip(filesMap);

  return {
    archive,
    modelDescription2Xml,
    modelDescription3Xml,
    files: Array.from(filesMap.keys()),
    modelIdentifier,
    variableCount: 14, // 4 inputs, 7 outputs, 3 parameters
  };
}
