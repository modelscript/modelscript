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
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  let start = 0;
  while (start < sanitized.length && sanitized[start] === "_") {
    start++;
  }
  let end = sanitized.length;
  while (end > start && sanitized[end - 1] === "_") {
    end--;
  }
  return sanitized.slice(start, end) || "olga_model";
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
 * Builds standard FMI 2.0 / 3.0 Co-Simulation C source code embedding the multi-segment drift-flux solver.
 */
export function generateOlgaCosimCSource(modelIdentifier: string, model: OlgaModel): string {
  const allPipes = model.flowpaths.flatMap((fp) =>
    fp.pipes.map((pipe) => ({
      pipe,
      uHeat: fp.heatTransfer?.ambientHeatTransferCoeff ?? 15.0,
    })),
  );
  const pipeLength = allPipes.length > 0 ? allPipes.reduce((acc, p) => acc + p.pipe.length, 0) : 5000.0;
  const pipeDiameter = allPipes[0]?.pipe.diameter ?? 0.254;

  // Discretize model.flowpaths pipes into finite-volume segments
  const segments: { length: number; diameter: number; elevation: number; roughness: number; uHeat: number }[] = [];
  if (allPipes.length > 0) {
    for (const { pipe, uHeat } of allPipes) {
      const nSeg = Math.max(1, Math.min(16, pipe.discretization || 4));
      const segLen = Math.max(1.0, pipe.length / nSeg);
      const segElev = (pipe.elevation ?? 0.0) / nSeg;
      const segDiam = Math.max(0.02, pipe.diameter || pipeDiameter);
      const segRough = Math.max(1e-6, pipe.roughness ?? 4.5e-5);
      const segU = Math.max(0.5, uHeat);
      for (let i = 0; i < nSeg; i++) {
        segments.push({
          length: segLen,
          diameter: segDiam,
          elevation: segElev,
          roughness: segRough,
          uHeat: segU,
        });
      }
    }
  } else {
    for (let i = 0; i < 8; i++) {
      segments.push({
        length: pipeLength / 8.0,
        diameter: pipeDiameter,
        elevation: i >= 6 ? 50.0 : -15.0,
        roughness: 4.5e-5,
        uHeat: 15.0,
      });
    }
  }

  const nSegments = segments.length;
  const segLenInit = segments.map((s) => s.length.toFixed(2)).join(", ");
  const segDiamInit = segments.map((s) => s.diameter.toFixed(4)).join(", ");
  const segElevInit = segments.map((s) => s.elevation.toFixed(2)).join(", ");
  const segRoughInit = segments.map((s) => s.roughness.toExponential(3)).join(", ");
  const segUInit = segments.map((s) => s.uHeat.toFixed(2)).join(", ");

  const source = model.flowpaths[0]?.sources[0];
  const initMassRate = source?.totalMassRate ?? 35.0;
  const initPressure = source?.pressure ?? 12000000.0;
  const initTemp = source?.temperature ?? 335.15;
  const initGasFrac = source?.gasMassFraction ?? 0.25;
  const initChoke = model.flowpaths[0]?.valves[0]?.opening ?? 1.0;

  return `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* ModelScript OLGA FMI 2.0 / 3.0 Co-Simulation Multi-Segment Drift-Flux Solver */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define FMI2_FUNCTION_PREFIX ${modelIdentifier}_
#define MODEL_IDENTIFIER "${modelIdentifier}"
#define N_SEGMENTS ${nSegments}

typedef void* fmi2Component;
typedef void* fmi2ComponentEnvironment;
typedef void* fmi2FMUstate;
typedef unsigned int fmi2ValueReference;
typedef double fmi2Real;
typedef int fmi2Integer;
typedef int fmi2Boolean;
typedef const char* fmi2String;

typedef enum {
    fmi2OK = 0,
    fmi2Warning = 1,
    fmi2Discard = 2,
    fmi2Error = 3,
    fmi2Fatal = 4,
    fmi2Pending = 5
} fmi2Status;

typedef void* fmi3Instance;
typedef unsigned int fmi3ValueReference;
typedef double fmi3Float64;
typedef int fmi3Status;

static const fmi2Real SEG_LENGTH[N_SEGMENTS]    = { ${segLenInit} };
static const fmi2Real SEG_DIAMETER[N_SEGMENTS]  = { ${segDiamInit} };
static const fmi2Real SEG_ELEVATION[N_SEGMENTS] = { ${segElevInit} };
static const fmi2Real SEG_ROUGHNESS[N_SEGMENTS] = { ${segRoughInit} };
static const fmi2Real SEG_U_HEAT[N_SEGMENTS]    = { ${segUInit} };

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
    fmi2Real gas_fraction;

    /* Multi-segment finite-volume states */
    fmi2Real seg_p[N_SEGMENTS];
    fmi2Real seg_holdup[N_SEGMENTS];
    fmi2Real seg_temp[N_SEGMENTS];

    /* Auxiliary integer/boolean/string variables */
    fmi2Integer active_slugs;
    fmi2Boolean initialized;
    fmi2Real current_time;
    fmi2Real start_time;
    fmi2Real accumulated_surge;
} OlgaModelInstance;

static void olga_reset_instance(OlgaModelInstance* inst) {
    memset(inst, 0, sizeof(OlgaModelInstance));
    inst->choke_opening = ${initChoke.toFixed(4)};
    inst->inlet_mass_rate = ${initMassRate.toFixed(4)};
    inst->inlet_pressure = ${initPressure.toFixed(2)};
    inst->inlet_temperature = ${initTemp.toFixed(2)};
    inst->gas_fraction = ${initGasFrac.toFixed(4)};

    inst->pipe_length = ${pipeLength.toFixed(2)};
    inst->pipe_diameter = ${pipeDiameter.toFixed(4)};
    inst->step_size = 1.0;

    for (int i = 0; i < N_SEGMENTS; i++) {
        fmi2Real frac = (fmi2Real)(i + 1) / (fmi2Real)N_SEGMENTS;
        inst->seg_p[i] = inst->inlet_pressure * (1.0 - 0.65 * frac);
        inst->seg_holdup[i] = 0.22 + 0.08 * (SEG_ELEVATION[i] > 0.0 ? 1.0 : -0.3);
        if (inst->seg_holdup[i] < 0.05) inst->seg_holdup[i] = 0.05;
        if (inst->seg_holdup[i] > 0.90) inst->seg_holdup[i] = 0.90;
        inst->seg_temp[i] = 277.15 + (inst->inlet_temperature - 277.15) * exp(-0.12 * frac);
    }

    inst->p_inlet = inst->inlet_pressure;
    inst->p_arrival = inst->seg_p[N_SEGMENTS - 1];
    inst->t_arrival = inst->seg_temp[N_SEGMENTS - 1];
    inst->holdup_arrival = inst->seg_holdup[N_SEGMENTS - 1];
    inst->surge_vol = 0.0;
    inst->mean_slug_length = 25.0;
    inst->slug_frequency = 0.02;
    inst->active_slugs = 1;
}

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
    olga_reset_instance(inst);
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
    inst->start_time = startTime;
    inst->current_time = startTime;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2EnterInitializationMode(fmi2Component c) {
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2ExitInitializationMode(fmi2Component c) {
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    inst->initialized = 1;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Terminate(fmi2Component c) {
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    inst->initialized = 0;
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Reset(fmi2Component c) {
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    olga_reset_instance(inst);
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

    int nSub = (int)ceil(communicationStepSize / 0.5);
    if (nSub < 1) nSub = 1;
    if (nSub > 50) nSub = 50;
    fmi2Real dt = communicationStepSize / (fmi2Real)nSub;

    const fmi2Real rho_l = 840.0;
    const fmi2Real rho_g = 68.0;
    const fmi2Real cp_mix = 2150.0;
    const fmi2Real t_seabed = 277.15;
    const fmi2Real g_acc = 9.81;

    fmi2Real choke_eff = fmax(0.01, fmin(1.0, inst->choke_opening));
    fmi2Real w_in = inst->inlet_mass_rate * (0.25 + 0.75 * choke_eff);
    fmi2Real w_liq_in = w_in * (1.0 - inst->gas_fraction);
    fmi2Real w_gas_in = w_in * inst->gas_fraction;

    for (int sub = 0; sub < nSub; sub++) {
        fmi2Real prev_q_liq = w_liq_in / rho_l;
        fmi2Real prev_temp = inst->inlet_temperature;
        fmi2Real cum_dp = 0.0;

        for (int i = 0; i < N_SEGMENTS; i++) {
            fmi2Real L_i = SEG_LENGTH[i];
            fmi2Real D_i = SEG_DIAMETER[i];
            fmi2Real dZ_i = SEG_ELEVATION[i];
            fmi2Real eps_i = SEG_ROUGHNESS[i];
            fmi2Real U_i = SEG_U_HEAT[i];
            fmi2Real area_i = 3.141592653589793 * D_i * D_i * 0.25;
            fmi2Real vol_i = area_i * L_i;

            fmi2Real alpha_l = fmax(0.02, fmin(0.95, inst->seg_holdup[i]));
            fmi2Real rho_m = alpha_l * rho_l + (1.0 - alpha_l) * rho_g;
            fmi2Real j_l = prev_q_liq / area_i;
            fmi2Real j_g = (w_gas_in / rho_g) / area_i;
            fmi2Real j_m = j_l + j_g;

            /* Zuber-Findlay drift-flux slip closure */
            fmi2Real sin_theta = dZ_i / fmax(1.0, L_i);
            fmi2Real v_drift = 0.35 * sqrt(g_acc * D_i * (rho_l - rho_g) / rho_l) +
                               0.54 * sqrt(g_acc * D_i) * sin_theta;
            fmi2Real v_g = 1.18 * j_m + v_drift;
            fmi2Real alpha_g_eq = (v_g > 1e-3) ? fmax(0.05, fmin(0.95, j_g / v_g)) : (1.0 - alpha_l);
            fmi2Real alpha_l_eq = 1.0 - alpha_g_eq;
            fmi2Real v_l = fmax(0.05, j_m * (1.0 - 0.15 * sin_theta));
            fmi2Real q_liq_out = alpha_l * v_l * area_i;

            /* 1. Liquid holdup conservation PDE */
            fmi2Real d_alpha_dt = (prev_q_liq - q_liq_out) / fmax(1.0, vol_i) +
                                  (alpha_l_eq - alpha_l) / fmax(5.0, L_i / fmax(0.2, j_m));
            inst->seg_holdup[i] = fmax(0.03, fmin(0.95, alpha_l + dt * d_alpha_dt));

            /* 2. Momentum Darcy-Weisbach + hydrostatic pressure drop */
            fmi2Real re = fmax(2500.0, rho_m * fabs(j_m) * D_i / 0.0025);
            fmi2Real f_darcy = 0.25 / pow(log10((eps_i / (3.7 * D_i)) + (5.74 / pow(re, 0.9))), 2.0);
            fmi2Real dp_fric = f_darcy * (L_i / D_i) * 0.5 * rho_m * j_m * j_m;
            fmi2Real dp_grav = rho_m * g_acc * dZ_i;
            cum_dp += (dp_fric + dp_grav);

            fmi2Real p_target = fmax(100000.0, inst->inlet_pressure - cum_dp);
            fmi2Real tau_p = fmax(2.0, L_i / 350.0);
            inst->seg_p[i] += fmin(1.0, dt / tau_p) * (p_target - inst->seg_p[i]);

            /* 3. Advective-convective thermal energy PDE */
            fmi2Real perim_i = 3.141592653589793 * D_i;
            fmi2Real d_temp_dt = ( fabs(j_m) * (prev_temp - inst->seg_temp[i]) / L_i ) -
                                 ( U_i * perim_i * (inst->seg_temp[i] - t_seabed) / fmax(1.0, rho_m * area_i * cp_mix) );
            inst->seg_temp[i] = fmax(t_seabed, fmin(450.0, inst->seg_temp[i] + dt * d_temp_dt));

            prev_q_liq = q_liq_out;
            prev_temp = inst->seg_temp[i];
        }
    }

    inst->current_time = currentCommunicationPoint + communicationStepSize;

    /* Choke throttling & topside arrival state */
    fmi2Real d_last = SEG_DIAMETER[N_SEGMENTS - 1];
    fmi2Real area_last = 3.141592653589793 * d_last * d_last * 0.25;
    fmi2Real alpha_arr = inst->seg_holdup[N_SEGMENTS - 1];
    fmi2Real rho_arr = alpha_arr * rho_l + (1.0 - alpha_arr) * rho_g;
    fmi2Real j_arr = inst->inlet_mass_rate / fmax(1e-3, area_last * rho_arr);
    fmi2Real choke_dp = (1.0 - choke_eff) * (rho_arr * j_arr * j_arr * 5.0);

    inst->p_inlet = inst->inlet_pressure;
    inst->p_arrival = fmax(100000.0, inst->seg_p[N_SEGMENTS - 1] - choke_dp);
    inst->t_arrival = inst->seg_temp[N_SEGMENTS - 1];
    inst->holdup_arrival = alpha_arr;

    /* Hydrodynamic + terrain slugging correlations across riser/dip segments */
    fmi2Real max_holdup = 0.0;
    for (int i = 0; i < N_SEGMENTS; i++) {
        if (inst->seg_holdup[i] > max_holdup) max_holdup = inst->seg_holdup[i];
    }
    inst->mean_slug_length = fmax(5.0, 28.0 * d_last * pow(fmax(0.1, j_arr), 0.38) * (1.0 + max_holdup));
    inst->slug_frequency = (j_arr > 0.3) ? (0.022 * j_arr / d_last) * alpha_arr : 0.0;
    inst->active_slugs = (max_holdup > 0.45) ? 2 : 1;

    /* Liquid surge volume accumulation */
    fmi2Real liq_vol_rate = (inst->inlet_mass_rate * (1.0 - inst->gas_fraction) / rho_l) * choke_eff;
    inst->accumulated_surge += liq_vol_rate * communicationStepSize;
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
            case 100: inst->pipe_length = fmax(1.0, value[i]); break;
            case 101: inst->pipe_diameter = fmax(0.01, value[i]); break;
            case 102: inst->step_size = fmax(0.001, value[i]); break;
            default: return fmi2Discard;
        }
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetInteger(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    fmi2Integer value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    for (size_t i = 0; i < nvr; i++) {
        (void)vr;
        value[i] = inst->active_slugs;
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetInteger(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    const fmi2Integer value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    for (size_t i = 0; i < nvr; i++) {
        (void)vr;
        inst->active_slugs = value[i];
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetBoolean(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    fmi2Boolean value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    for (size_t i = 0; i < nvr; i++) {
        (void)vr;
        value[i] = inst->initialized;
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetBoolean(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    const fmi2Boolean value[])
{
    OlgaModelInstance* inst = (OlgaModelInstance*)c;
    if (!inst) return fmi2Error;
    for (size_t i = 0; i < nvr; i++) {
        (void)vr;
        inst->initialized = value[i];
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetString(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    fmi2String value[])
{
    (void)vr;
    if (!c) return fmi2Error;
    for (size_t i = 0; i < nvr; i++) {
        value[i] = MODEL_IDENTIFIER;
    }
    return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetString(
    fmi2Component c,
    const fmi2ValueReference vr[],
    size_t nvr,
    const fmi2String value[])
{
    (void)vr; (void)nvr; (void)value;
    if (!c) return fmi2Error;
    return fmi2OK;
}

const char* ${modelIdentifier}_fmi2GetVersion(void) {
    return "2.0";
}

const char* ${modelIdentifier}_fmi2GetTypesPlatform(void) {
    return "default";
}

/* FMI 3.0 Co-Simulation Lifecycle & Accessor Wrappers */
fmi3Instance ${modelIdentifier}_fmi3InstantiateCoSimulation(
    const char* instanceName,
    const char* instantiationToken,
    const char* resourcePath,
    int visible,
    int loggingOn,
    int eventModeUsed,
    int earlyReturnAllowed,
    const fmi3ValueReference requiredIntermediateVariables[],
    size_t nRequiredIntermediateVariables,
    void* instanceEnvironment,
    void* logMessage,
    void* intermediateUpdate)
{
    (void)eventModeUsed; (void)earlyReturnAllowed; (void)requiredIntermediateVariables;
    (void)nRequiredIntermediateVariables; (void)instanceEnvironment; (void)logMessage; (void)intermediateUpdate;
    return ${modelIdentifier}_fmi2Instantiate(instanceName, 1, instantiationToken, resourcePath, NULL, visible, loggingOn);
}

void ${modelIdentifier}_fmi3FreeInstance(fmi3Instance instance) {
    ${modelIdentifier}_fmi2FreeInstance(instance);
}

fmi3Status ${modelIdentifier}_fmi3EnterInitializationMode(
    fmi3Instance instance,
    int toleranceDefined,
    fmi3Float64 tolerance,
    fmi3Float64 startTime,
    int stopTimeDefined,
    fmi3Float64 stopTime)
{
    ${modelIdentifier}_fmi2SetupExperiment(instance, toleranceDefined, tolerance, startTime, stopTimeDefined, stopTime);
    return (fmi3Status)${modelIdentifier}_fmi2EnterInitializationMode(instance);
}

fmi3Status ${modelIdentifier}_fmi3ExitInitializationMode(fmi3Instance instance) {
    return (fmi3Status)${modelIdentifier}_fmi2ExitInitializationMode(instance);
}

fmi3Status ${modelIdentifier}_fmi3Terminate(fmi3Instance instance) {
    return (fmi3Status)${modelIdentifier}_fmi2Terminate(instance);
}

fmi3Status ${modelIdentifier}_fmi3Reset(fmi3Instance instance) {
    return (fmi3Status)${modelIdentifier}_fmi2Reset(instance);
}

fmi3Status ${modelIdentifier}_fmi3GetFloat64(
    fmi3Instance instance,
    const fmi3ValueReference valueReferences[],
    size_t nValueReferences,
    fmi3Float64 values[],
    size_t nValues)
{
    (void)nValues;
    return (fmi3Status)${modelIdentifier}_fmi2GetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3SetFloat64(
    fmi3Instance instance,
    const fmi3ValueReference valueReferences[],
    size_t nValueReferences,
    const fmi3Float64 values[],
    size_t nValues)
{
    (void)nValues;
    return (fmi3Status)${modelIdentifier}_fmi2SetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3DoStep(
    fmi3Instance instance,
    fmi3Float64 currentCommunicationPoint,
    fmi3Float64 communicationStepSize,
    int noSetFMUStatePriorToCurrentPoint,
    int* eventHandlingNeeded,
    int* terminateSimulation,
    int* earlyReturn,
    fmi3Float64* lastSuccessfulTime)
{
    fmi3Status st = (fmi3Status)${modelIdentifier}_fmi2DoStep(
        instance, currentCommunicationPoint, communicationStepSize, noSetFMUStatePriorToCurrentPoint
    );
    if (eventHandlingNeeded) *eventHandlingNeeded = 0;
    if (terminateSimulation) *terminateSimulation = 0;
    if (earlyReturn) *earlyReturn = 0;
    if (lastSuccessfulTime) *lastSuccessfulTime = currentCommunicationPoint + communicationStepSize;
    return st;
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
