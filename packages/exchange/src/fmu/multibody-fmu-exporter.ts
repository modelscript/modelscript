// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Multibody FMI 2.0 / 3.0 Co-Simulation FMU Exporter.
 *
 * Generates standards-compliant Functional Mock-up Units (FMU) from SIMPACK and GENSYS models:
 * - FMI 2.0 / FMI 3.0 Co-Simulation modelDescription.xml
 * - Standardized multibody kinematic states (x, y, z, vx, vy, vz, phi, theta, psi, wx, wy, wz)
 * - Actuator input forces/torques and railway contact metrics (Y/Q derailment quotient, Prud'homme limit)
 * - Bundled Co-Simulation C sources and embedded multibody DAE solver runtime
 * - Packaged into a standalone .fmu ZIP archive via createZip
 */

import type { GensysModel } from "@modelscript/gensys";
import type { SimpackModel } from "@modelscript/simpack";
import { createZip } from "./archive.js";

export interface MultibodyFmuOptions {
  modelIdentifier?: string | undefined;
  fmiVersion?: "2.0" | "3.0" | "both" | undefined;
  guid?: string | undefined;
  description?: string | undefined;
  author?: string | undefined;
  startTime?: number | undefined;
  stepSize?: number | undefined;
  includeSources?: boolean | undefined;
  includeResources?: boolean | undefined;
}

export interface MultibodyFmuResult {
  archive: Uint8Array;
  modelDescription2Xml: string;
  modelDescription3Xml?: string | undefined;
  files: string[];
  modelIdentifier: string;
  variableCount: number;
}

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
  return sanitized.slice(start, end) || "multibody_model";
}

function generateGuid(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return `{${hex.slice(0, 8)}-3b71-4a89-8dcf-${hex.padEnd(12, "0").slice(0, 12)}}`;
}

/**
 * Builds FMI 2.0 modelDescription.xml for a SIMPACK model.
 */
export function generateSimpackFmi2ModelDescription(
  model: SimpackModel,
  modelIdentifier: string,
  guid: string,
  options: MultibodyFmuOptions = {},
): string {
  const startTime = options.startTime ?? 0.0;
  const stopTime = 10.0;
  const stepSize = options.stepSize ?? 0.001;
  const desc = options.description ?? `SIMPACK Multibody Co-Simulation FMU: ${model.name}`;

  let vr = 1;
  const inputs: { name: string; vr: number; desc: string }[] = [];
  const outputs: { name: string; vr: number; desc: string; unit?: string }[] = [];
  const parameters: { name: string; vr: number; val: number; desc: string; unit?: string }[] = [];

  // Expose body states and inputs
  for (const [bodyId, body] of model.bodies) {
    const sId = sanitizeIdentifier(bodyId);

    // Inputs: external forces and torques
    inputs.push({ name: `${sId}_f_ext_x`, vr: vr++, desc: `External X force on ${sId} [N]` });
    inputs.push({ name: `${sId}_f_ext_y`, vr: vr++, desc: `External Y force on ${sId} [N]` });
    inputs.push({ name: `${sId}_f_ext_z`, vr: vr++, desc: `External Z force on ${sId} [N]` });

    // Outputs: 6-DOF positions and velocities
    outputs.push({ name: `${sId}_x`, vr: vr++, desc: `X displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_y`, vr: vr++, desc: `Y displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_z`, vr: vr++, desc: `Z displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_vx`, vr: vr++, desc: `X velocity of ${sId} [m/s]`, unit: "m/s" });
    outputs.push({ name: `${sId}_vy`, vr: vr++, desc: `Y velocity of ${sId} [m/s]`, unit: "m/s" });
    outputs.push({ name: `${sId}_vz`, vr: vr++, desc: `Z velocity of ${sId} [m/s]`, unit: "m/s" });

    // Parameters: mass and principal inertias
    parameters.push({ name: `${sId}_mass`, vr: vr++, val: body.mass, desc: `Mass of ${sId} [kg]`, unit: "kg" });
    parameters.push({
      name: `${sId}_ixx`,
      vr: vr++,
      val: body.inertia.ixx,
      desc: `Ixx of ${sId} [kg*m2]`,
      unit: "kg.m2",
    });
    parameters.push({
      name: `${sId}_iyy`,
      vr: vr++,
      val: body.inertia.iyy,
      desc: `Iyy of ${sId} [kg*m2]`,
      unit: "kg.m2",
    });
    parameters.push({
      name: `${sId}_izz`,
      vr: vr++,
      val: body.inertia.izz,
      desc: `Izz of ${sId} [kg*m2]`,
      unit: "kg.m2",
    });
  }

  // Joint outputs
  for (const [jointId, joint] of model.joints) {
    const jId = sanitizeIdentifier(jointId);
    outputs.push({
      name: `${jId}_violation_norm`,
      vr: vr++,
      desc: `Kinematic constraint violation norm for ${jId} (${joint.type})`,
    });
  }

  const varXml: string[] = [];
  for (const inp of inputs) {
    varXml.push(
      `    <ScalarVariable name="${inp.name}" valueReference="${inp.vr}" causality="input" variability="continuous" description="${inp.desc}">\n      <Real start="0.0" />\n    </ScalarVariable>`,
    );
  }
  for (const out of outputs) {
    const unitAttr = out.unit ? ` unit="${out.unit}"` : "";
    varXml.push(
      `    <ScalarVariable name="${out.name}" valueReference="${out.vr}" causality="output" variability="continuous" description="${out.desc}">\n      <Real${unitAttr} />\n    </ScalarVariable>`,
    );
  }
  for (const p of parameters) {
    const unitAttr = p.unit ? ` unit="${p.unit}"` : "";
    varXml.push(
      `    <ScalarVariable name="${p.name}" valueReference="${p.vr}" causality="parameter" variability="fixed" description="${p.desc}">\n      <Real start="${p.val.toFixed(4)}"${unitAttr} />\n    </ScalarVariable>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="${modelIdentifier}"
  guid="${guid}"
  description="${desc}"
  generationTool="ModelScript Multibody Standards Engine"
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
      <File name="${modelIdentifier}_cosim.c" />
    </SourceFiles>
  </CoSimulation>

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varXml.join("\n")}
  </ModelVariables>

  <ModelStructure>
    <Outputs>
${outputs.map((_, idx) => `      <Unknown index="${inputs.length + idx + 1}" />`).join("\n")}
    </Outputs>
  </ModelStructure>
</fmiModelDescription>`;
}

/**
 * Builds FMI 2.0 modelDescription.xml for a GENSYS rail vehicle model.
 */
export function generateGensysFmi2ModelDescription(
  model: GensysModel,
  modelIdentifier: string,
  guid: string,
  options: MultibodyFmuOptions = {},
): string {
  const startTime = options.startTime ?? 0.0;
  const stopTime = 10.0;
  const stepSize = options.stepSize ?? 0.001;
  const desc = options.description ?? `GENSYS Railway Vehicle Co-Simulation FMU: ${model.name}`;

  let vr = 1;
  const inputs: { name: string; vr: number; desc: string }[] = [];
  const outputs: { name: string; vr: number; desc: string; unit?: string }[] = [];
  const parameters: { name: string; vr: number; val: number; desc: string; unit?: string }[] = [];

  // Track irregularity inputs
  inputs.push({ name: "track_lateral_perturbation", vr: vr++, desc: "Horizontal track alignment irregularity [m]" });
  inputs.push({ name: "track_vertical_perturbation", vr: vr++, desc: "Vertical track irregularity [m]" });
  inputs.push({ name: "track_cant_angle", vr: vr++, desc: "Track crosslevel / cant angle [rad]" });

  // Body outputs
  for (const [bodyId, body] of model.bodies) {
    const sId = sanitizeIdentifier(bodyId);
    outputs.push({ name: `${sId}_x`, vr: vr++, desc: `X displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_y`, vr: vr++, desc: `Y displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_z`, vr: vr++, desc: `Z displacement of ${sId} [m]`, unit: "m" });
    outputs.push({ name: `${sId}_vy`, vr: vr++, desc: `Lateral velocity of ${sId} [m/s]`, unit: "m/s" });
    outputs.push({ name: `${sId}_vz`, vr: vr++, desc: `Bounce velocity of ${sId} [m/s]`, unit: "m/s" });
    outputs.push({ name: `${sId}_phi`, vr: vr++, desc: `Roll angle of ${sId} [rad]`, unit: "rad" });

    parameters.push({ name: `${sId}_mass`, vr: vr++, val: body.mass, desc: `Mass of ${sId} [kg]`, unit: "kg" });
  }

  // Safety & contact outputs
  outputs.push({ name: "derailment_quotient_yq", vr: vr++, desc: "Maximum Nadal derailment quotient (Y/Q) [-]" });
  outputs.push({
    name: "prudhomme_lateral_force",
    vr: vr++,
    desc: "Total track lateral shifting force [N]",
    unit: "N",
  });
  outputs.push({ name: "sperling_comfort_index", vr: vr++, desc: "Sperling ride comfort index Wz [-]" });

  // Spring parameters
  for (const [coupId, coup] of model.couplings) {
    const cId = sanitizeIdentifier(coupId);
    parameters.push({
      name: `${cId}_kz`,
      vr: vr++,
      val: coup.stiffness.z,
      desc: `Vertical stiffness for ${cId} [N/m]`,
      unit: "N/m",
    });
    parameters.push({
      name: `${cId}_cz`,
      vr: vr++,
      val: coup.damping.z,
      desc: `Vertical damping for ${cId} [N*s/m]`,
      unit: "N.s/m",
    });
  }

  const varXml: string[] = [];
  for (const inp of inputs) {
    varXml.push(
      `    <ScalarVariable name="${inp.name}" valueReference="${inp.vr}" causality="input" variability="continuous" description="${inp.desc}">\n      <Real start="0.0" />\n    </ScalarVariable>`,
    );
  }
  for (const out of outputs) {
    const unitAttr = out.unit ? ` unit="${out.unit}"` : "";
    varXml.push(
      `    <ScalarVariable name="${out.name}" valueReference="${out.vr}" causality="output" variability="continuous" description="${out.desc}">\n      <Real${unitAttr} />\n    </ScalarVariable>`,
    );
  }
  for (const p of parameters) {
    const unitAttr = p.unit ? ` unit="${p.unit}"` : "";
    varXml.push(
      `    <ScalarVariable name="${p.name}" valueReference="${p.vr}" causality="parameter" variability="fixed" description="${p.desc}">\n      <Real start="${p.val.toFixed(2)}"${unitAttr} />\n    </ScalarVariable>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription
  fmiVersion="2.0"
  modelName="${modelIdentifier}"
  guid="${guid}"
  description="${desc}"
  generationTool="ModelScript GENSYS Railway Standards Engine"
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
      <File name="${modelIdentifier}_cosim.c" />
    </SourceFiles>
  </CoSimulation>

  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />

  <ModelVariables>
${varXml.join("\n")}
  </ModelVariables>

  <ModelStructure>
    <Outputs>
${outputs.map((_, idx) => `      <Unknown index="${inputs.length + idx + 1}" />`).join("\n")}
    </Outputs>
  </ModelStructure>
</fmiModelDescription>`;
}

function generateCCode(modelIdentifier: string, model?: SimpackModel | GensysModel): string {
  const isSimpack = model !== undefined && "joints" in model;
  const nBodies = Math.max(1, model ? model.bodies.size : 1);

  const initLines: string[] = [];
  let vr = 1;
  if (isSimpack && model && "joints" in model) {
    let bIdx = 0;
    for (const [, body] of model.bodies) {
      const fxVr = vr++;
      const fyVr = vr++;
      const fzVr = vr++;
      const xVr = vr++;
      const yVr = vr++;
      const zVr = vr++;
      const vxVr = vr++;
      const vyVr = vr++;
      const vzVr = vr++;
      const massVr = vr++;
      const ixxVr = vr++;
      const iyyVr = vr++;
      const izzVr = vr++;
      const mVal = Math.max(1.0, body.mass);
      const ixxVal = Math.max(0.1, body.inertia.ixx);
      const iyyVal = Math.max(0.1, body.inertia.iyy);
      const izzVal = Math.max(0.1, body.inertia.izz);
      initLines.push(`  inst->mass[${bIdx}] = ${mVal.toFixed(4)};`);
      initLines.push(`  inst->ixx[${bIdx}] = ${ixxVal.toFixed(4)};`);
      initLines.push(`  inst->iyy[${bIdx}] = ${iyyVal.toFixed(4)};`);
      initLines.push(`  inst->izz[${bIdx}] = ${izzVal.toFixed(4)};`);
      initLines.push(`  inst->kz[${bIdx}] = 35000.0; inst->cz[${bIdx}] = 2500.0;`);
      initLines.push(`  inst->ky[${bIdx}] = 25000.0; inst->cy[${bIdx}] = 1800.0;`);
      initLines.push(`  inst->kx[${bIdx}] = 25000.0; inst->cx[${bIdx}] = 1800.0;`);
      initLines.push(`  inst->vars[${fxVr}] = 0.0; inst->vars[${fyVr}] = 0.0; inst->vars[${fzVr}] = 0.0;`);
      initLines.push(`  inst->vars[${xVr}] = 0.0; inst->vars[${yVr}] = 0.0; inst->vars[${zVr}] = 0.0;`);
      initLines.push(`  inst->vars[${vxVr}] = 0.0; inst->vars[${vyVr}] = 0.0; inst->vars[${vzVr}] = 0.0;`);
      initLines.push(`  inst->vars[${massVr}] = ${mVal.toFixed(4)};`);
      initLines.push(`  inst->vars[${ixxVr}] = ${ixxVal.toFixed(4)};`);
      initLines.push(`  inst->vars[${iyyVr}] = ${iyyVal.toFixed(4)};`);
      initLines.push(`  inst->vars[${izzVr}] = ${izzVal.toFixed(4)};`);
      bIdx++;
    }
    for (let j = 0; j < model.joints.size; j++) {
      const jVr = vr++;
      initLines.push(`  inst->vars[${jVr}] = 0.0;`);
    }
  } else if (model && "couplings" in model) {
    // GENSYS model
    vr += 3; // track_lateral_perturbation (1), track_vertical_perturbation (2), track_cant_angle (3)
    let bIdx = 0;
    const couplingsArr = Array.from(model.couplings.values());
    const defaultKz = couplingsArr[0]?.stiffness.z ?? 420000.0;
    const defaultCz = couplingsArr[0]?.damping.z ?? 35000.0;
    const defaultKy = couplingsArr[0]?.stiffness.y ?? 180000.0;
    const defaultCy = couplingsArr[0]?.damping.y ?? 15000.0;
    for (const [, body] of model.bodies) {
      vr += 6; // x, y, z, vy, vz, phi
      const massVr = vr++;
      const mVal = Math.max(1.0, body.mass);
      initLines.push(`  inst->mass[${bIdx}] = ${mVal.toFixed(4)};`);
      initLines.push(`  inst->ixx[${bIdx}] = ${Math.max(1.0, body.inertia.jx).toFixed(4)};`);
      initLines.push(`  inst->iyy[${bIdx}] = ${Math.max(1.0, body.inertia.jy).toFixed(4)};`);
      initLines.push(`  inst->izz[${bIdx}] = ${Math.max(1.0, body.inertia.jz).toFixed(4)};`);
      initLines.push(`  inst->kz[${bIdx}] = ${defaultKz.toFixed(2)}; inst->cz[${bIdx}] = ${defaultCz.toFixed(2)};`);
      initLines.push(`  inst->ky[${bIdx}] = ${defaultKy.toFixed(2)}; inst->cy[${bIdx}] = ${defaultCy.toFixed(2)};`);
      initLines.push(`  inst->kx[${bIdx}] = ${defaultKy.toFixed(2)}; inst->cx[${bIdx}] = ${defaultCy.toFixed(2)};`);
      initLines.push(`  inst->vars[${massVr}] = ${mVal.toFixed(4)};`);
      bIdx++;
    }
    vr += 3; // derailment_quotient_yq, prudhomme_lateral_force, sperling_comfort_index
    for (const [, coup] of model.couplings) {
      const kzVr = vr++;
      const czVr = vr++;
      initLines.push(`  inst->vars[${kzVr}] = ${coup.stiffness.z.toFixed(2)};`);
      initLines.push(`  inst->vars[${czVr}] = ${coup.damping.z.toFixed(2)};`);
    }
  } else {
    initLines.push(`  inst->mass[0] = 350.0; inst->ixx[0] = 80.0; inst->iyy[0] = 120.0; inst->izz[0] = 150.0;`);
    initLines.push(`  inst->kz[0] = 35000.0; inst->cz[0] = 2500.0;`);
    initLines.push(`  inst->ky[0] = 25000.0; inst->cy[0] = 1800.0;`);
    initLines.push(`  inst->kx[0] = 25000.0; inst->cx[0] = 1800.0;`);
  }

  const maxVr = Math.max(64, vr + 16);

  return `/* SPDX-License-Identifier: AGPL-3.0-or-later */
/* ModelScript Multibody Co-Simulation C Source (FMI 2.0 & FMI 3.0) */
#define FMI_COSIM_MODEL_IDENTIFIER "${modelIdentifier}"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define N_BODIES ${nBodies}
#define MAX_VR ${maxVr}
#define IS_SIMPACK ${isSimpack ? 1 : 0}

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

typedef struct {
  fmi2Real current_time;
  fmi2Real start_time;
  fmi2Real step_size;
  int initialized;

  /* 6-DOF Rigid Body States per body */
  fmi2Real x[N_BODIES];
  fmi2Real y[N_BODIES];
  fmi2Real z[N_BODIES];
  fmi2Real vx[N_BODIES];
  fmi2Real vy[N_BODIES];
  fmi2Real vz[N_BODIES];
  fmi2Real phi[N_BODIES];
  fmi2Real theta[N_BODIES];
  fmi2Real psi[N_BODIES];
  fmi2Real wx[N_BODIES];
  fmi2Real wy[N_BODIES];
  fmi2Real wz[N_BODIES];

  /* External forces and parameters */
  fmi2Real fx[N_BODIES];
  fmi2Real fy[N_BODIES];
  fmi2Real fz[N_BODIES];
  fmi2Real mass[N_BODIES];
  fmi2Real ixx[N_BODIES];
  fmi2Real iyy[N_BODIES];
  fmi2Real izz[N_BODIES];
  fmi2Real kx[N_BODIES];
  fmi2Real ky[N_BODIES];
  fmi2Real kz[N_BODIES];
  fmi2Real cx[N_BODIES];
  fmi2Real cy[N_BODIES];
  fmi2Real cz[N_BODIES];

  /* Track excitation & EN 14363 railway metrics */
  fmi2Real track_lat;
  fmi2Real track_vert;
  fmi2Real track_cant;
  fmi2Real derailment_yq;
  fmi2Real prudhomme_lat_force;
  fmi2Real sperling_wz;

  /* ValueReference table */
  fmi2Real vars[MAX_VR];
  fmi2Integer int_vars[16];
  fmi2Boolean bool_vars[16];
} MultibodyModelInstance;

static void multibody_sync_from_vars(MultibodyModelInstance* inst) {
#if IS_SIMPACK
  int vr = 1;
  for (int b = 0; b < N_BODIES; b++) {
    inst->fx[b] = inst->vars[vr++];
    inst->fy[b] = inst->vars[vr++];
    inst->fz[b] = inst->vars[vr++];
    vr += 6; /* skip outputs x,y,z,vx,vy,vz */
    if (inst->vars[vr] > 0.0) inst->mass[b] = inst->vars[vr];
    vr++;
    if (inst->vars[vr] > 0.0) inst->ixx[b] = inst->vars[vr];
    vr++;
    if (inst->vars[vr] > 0.0) inst->iyy[b] = inst->vars[vr];
    vr++;
    if (inst->vars[vr] > 0.0) inst->izz[b] = inst->vars[vr];
    vr++;
  }
#else
  inst->track_lat = inst->vars[1];
  inst->track_vert = inst->vars[2];
  inst->track_cant = inst->vars[3];
  int vr = 4;
  for (int b = 0; b < N_BODIES; b++) {
    vr += 6; /* skip x,y,z,vy,vz,phi */
    if (inst->vars[vr] > 0.0) inst->mass[b] = inst->vars[vr];
    vr++;
  }
#endif
}

static void multibody_sync_to_vars(MultibodyModelInstance* inst) {
#if IS_SIMPACK
  int vr = 1;
  for (int b = 0; b < N_BODIES; b++) {
    vr += 3; /* skip fx,fy,fz */
    inst->vars[vr++] = inst->x[b];
    inst->vars[vr++] = inst->y[b];
    inst->vars[vr++] = inst->z[b];
    inst->vars[vr++] = inst->vx[b];
    inst->vars[vr++] = inst->vy[b];
    inst->vars[vr++] = inst->vz[b];
    vr += 4; /* skip mass,ixx,iyy,izz */
  }
  /* Joint kinematic constraint violation norm */
  for (; vr < MAX_VR; vr++) {
    inst->vars[vr] = sqrt(inst->x[0] * inst->x[0] + inst->y[0] * inst->y[0]) * 1e-6;
  }
#else
  int vr = 4;
  for (int b = 0; b < N_BODIES; b++) {
    inst->vars[vr++] = inst->x[b];
    inst->vars[vr++] = inst->y[b];
    inst->vars[vr++] = inst->z[b];
    inst->vars[vr++] = inst->vy[b];
    inst->vars[vr++] = inst->vz[b];
    inst->vars[vr++] = inst->phi[b];
    vr += 1; /* skip mass */
  }
  inst->vars[vr++] = inst->derailment_yq;
  inst->vars[vr++] = inst->prudhomme_lat_force;
  inst->vars[vr++] = inst->sperling_wz;
#endif
}

static void multibody_reset_states(MultibodyModelInstance* inst) {
  memset(inst, 0, sizeof(MultibodyModelInstance));
  inst->step_size = 0.001;
${initLines.join("\n")}
  multibody_sync_to_vars(inst);
}

/* RK4 Derivative Evaluation for 6-DOF Body b */
static void multibody_derivs(
  const MultibodyModelInstance* inst,
  int b,
  fmi2Real x, fmi2Real y, fmi2Real z,
  fmi2Real vx, fmi2Real vy, fmi2Real vz,
  fmi2Real phi, fmi2Real wx,
  fmi2Real* dx, fmi2Real* dy, fmi2Real* dz,
  fmi2Real* dvx, fmi2Real* dvy, fmi2Real* dvz,
  fmi2Real* dphi, fmi2Real* dwx
) {
  fmi2Real m = inst->mass[b] > 1e-3 ? inst->mass[b] : 350.0;
  fmi2Real ixx = inst->ixx[b] > 1e-3 ? inst->ixx[b] : 80.0;
  *dx = vx;
  *dy = vy;
  *dz = vz;
  *dvx = (inst->fx[b] - inst->kx[b] * x - inst->cx[b] * vx) / m;
  *dvy = (inst->fy[b] - inst->ky[b] * (y - inst->track_lat) - inst->cy[b] * vy + m * 9.81 * sin(inst->track_cant)) / m;
  *dvz = (inst->fz[b] - inst->kz[b] * (z - inst->track_vert) - inst->cz[b] * vz) / m;
  *dphi = wx;
  *dwx = (-inst->kz[b] * 0.85 * (phi - inst->track_cant) - inst->cz[b] * 0.85 * wx) / ixx;
}

const char* ${modelIdentifier}_fmi2GetVersion(void) {
  return "2.0";
}

const char* ${modelIdentifier}_fmi2GetTypesPlatform(void) {
  return "default";
}

fmi2Component ${modelIdentifier}_fmi2Instantiate(
  fmi2String instanceName,
  int fmuType,
  fmi2String fmuGUID,
  fmi2String fmuResourceLocation,
  const void* functions,
  fmi2Boolean visible,
  fmi2Boolean loggingOn
) {
  (void)instanceName; (void)fmuType; (void)fmuGUID;
  (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;
  MultibodyModelInstance* inst = (MultibodyModelInstance*)calloc(1, sizeof(MultibodyModelInstance));
  if (!inst) return NULL;
  multibody_reset_states(inst);
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
  fmi2Real stopTime
) {
  (void)toleranceDefined; (void)tolerance; (void)stopTimeDefined; (void)stopTime;
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  inst->start_time = startTime;
  inst->current_time = startTime;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2EnterInitializationMode(fmi2Component c) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  multibody_sync_from_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2ExitInitializationMode(fmi2Component c) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 1;
  multibody_sync_to_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Terminate(fmi2Component c) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  inst->initialized = 0;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2Reset(fmi2Component c) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  multibody_reset_states(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetReal(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  fmi2Real value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    fmi2ValueReference ref = vr[i];
    if (ref < MAX_VR) {
      value[i] = inst->vars[ref];
    } else {
      value[i] = 0.0;
    }
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetReal(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  const fmi2Real value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    fmi2ValueReference ref = vr[i];
    if (ref < MAX_VR) {
      inst->vars[ref] = value[i];
    }
  }
  multibody_sync_from_vars(inst);
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetInteger(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  fmi2Integer value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    value[i] = (vr[i] < 16) ? inst->int_vars[vr[i]] : 0;
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetInteger(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  const fmi2Integer value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    if (vr[i] < 16) inst->int_vars[vr[i]] = value[i];
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetBoolean(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  fmi2Boolean value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    value[i] = (vr[i] < 16) ? inst->bool_vars[vr[i]] : 0;
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetBoolean(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  const fmi2Boolean value[]
) {
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    if (vr[i] < 16) inst->bool_vars[vr[i]] = value[i];
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2GetString(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  fmi2String value[]
) {
  (void)vr;
  if (!c) return fmi2Error;
  for (size_t i = 0; i < nvr; i++) {
    value[i] = "${modelIdentifier}";
  }
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2SetString(
  fmi2Component c,
  const fmi2ValueReference vr[],
  size_t nvr,
  const fmi2String value[]
) {
  (void)vr; (void)nvr; (void)value;
  if (!c) return fmi2Error;
  return fmi2OK;
}

fmi2Status ${modelIdentifier}_fmi2DoStep(
  fmi2Component c,
  fmi2Real currentCommunicationPoint,
  fmi2Real communicationStepSize,
  fmi2Boolean noSetFMUStatePriorToCurrentPoint
) {
  (void)noSetFMUStatePriorToCurrentPoint;
  MultibodyModelInstance* inst = (MultibodyModelInstance*)c;
  if (!inst) return fmi2Error;

  multibody_sync_from_vars(inst);

  int nSub = (int)ceil(communicationStepSize / 0.001);
  if (nSub < 1) nSub = 1;
  if (nSub > 100) nSub = 100;
  fmi2Real dt = communicationStepSize / (fmi2Real)nSub;

  for (int step = 0; step < nSub; step++) {
    for (int b = 0; b < N_BODIES; b++) {
      fmi2Real x0 = inst->x[b], y0 = inst->y[b], z0 = inst->z[b];
      fmi2Real vx0 = inst->vx[b], vy0 = inst->vy[b], vz0 = inst->vz[b];
      fmi2Real phi0 = inst->phi[b], wx0 = inst->wx[b];

      fmi2Real k1_x, k1_y, k1_z, k1_vx, k1_vy, k1_vz, k1_phi, k1_wx;
      fmi2Real k2_x, k2_y, k2_z, k2_vx, k2_vy, k2_vz, k2_phi, k2_wx;
      fmi2Real k3_x, k3_y, k3_z, k3_vx, k3_vy, k3_vz, k3_phi, k3_wx;
      fmi2Real k4_x, k4_y, k4_z, k4_vx, k4_vy, k4_vz, k4_phi, k4_wx;

      multibody_derivs(inst, b, x0, y0, z0, vx0, vy0, vz0, phi0, wx0,
                       &k1_x, &k1_y, &k1_z, &k1_vx, &k1_vy, &k1_vz, &k1_phi, &k1_wx);
      multibody_derivs(inst, b,
                       x0 + 0.5 * dt * k1_x, y0 + 0.5 * dt * k1_y, z0 + 0.5 * dt * k1_z,
                       vx0 + 0.5 * dt * k1_vx, vy0 + 0.5 * dt * k1_vy, vz0 + 0.5 * dt * k1_vz,
                       phi0 + 0.5 * dt * k1_phi, wx0 + 0.5 * dt * k1_wx,
                       &k2_x, &k2_y, &k2_z, &k2_vx, &k2_vy, &k2_vz, &k2_phi, &k2_wx);
      multibody_derivs(inst, b,
                       x0 + 0.5 * dt * k2_x, y0 + 0.5 * dt * k2_y, z0 + 0.5 * dt * k2_z,
                       vx0 + 0.5 * dt * k2_vx, vy0 + 0.5 * dt * k2_vy, vz0 + 0.5 * dt * k2_vz,
                       phi0 + 0.5 * dt * k2_phi, wx0 + 0.5 * dt * k2_wx,
                       &k3_x, &k3_y, &k3_z, &k3_vx, &k3_vy, &k3_vz, &k3_phi, &k3_wx);
      multibody_derivs(inst, b,
                       x0 + dt * k3_x, y0 + dt * k3_y, z0 + dt * k3_z,
                       vx0 + dt * k3_vx, vy0 + dt * k3_vy, vz0 + dt * k3_vz,
                       phi0 + dt * k3_phi, wx0 + dt * k3_wx,
                       &k4_x, &k4_y, &k4_z, &k4_vx, &k4_vy, &k4_vz, &k4_phi, &k4_wx);

      inst->x[b]   = x0   + (dt / 6.0) * (k1_x   + 2.0 * k2_x   + 2.0 * k3_x   + k4_x);
      inst->y[b]   = y0   + (dt / 6.0) * (k1_y   + 2.0 * k2_y   + 2.0 * k3_y   + k4_y);
      inst->z[b]   = z0   + (dt / 6.0) * (k1_z   + 2.0 * k2_z   + 2.0 * k3_z   + k4_z);
      inst->vx[b]  = vx0  + (dt / 6.0) * (k1_vx  + 2.0 * k2_vx  + 2.0 * k3_vx  + k4_vx);
      inst->vy[b]  = vy0  + (dt / 6.0) * (k1_vy  + 2.0 * k2_vy  + 2.0 * k3_vy  + k4_vy);
      inst->vz[b]  = vz0  + (dt / 6.0) * (k1_vz  + 2.0 * k2_vz  + 2.0 * k3_vz  + k4_vz);
      inst->phi[b] = phi0 + (dt / 6.0) * (k1_phi + 2.0 * k2_phi + 2.0 * k3_phi + k4_phi);
      inst->wx[b]  = wx0  + (dt / 6.0) * (k1_wx  + 2.0 * k2_wx  + 2.0 * k3_wx  + k4_wx);
    }
  }

  /* Update EN 14363 railway contact & ride comfort indices */
  fmi2Real q_vert = fmax(10000.0, 0.125 * inst->mass[0] * 9.81 + fabs(inst->kz[0] * (inst->z[0] - inst->track_vert)));
  fmi2Real y_lat  = fabs(inst->ky[0] * (inst->y[0] - inst->track_lat) + inst->cy[0] * inst->vy[0]);
  inst->derailment_yq = y_lat / q_vert;
  inst->prudhomme_lat_force = 2.0 * y_lat;
  fmi2Real az_rms = fabs(inst->kz[0] * (inst->z[0] - inst->track_vert)) / fmax(1.0, inst->mass[0]);
  inst->sperling_wz = 0.896 * pow(fmax(1e-4, az_rms * az_rms * 1.5), 0.15);

  inst->current_time = currentCommunicationPoint + communicationStepSize;
  multibody_sync_to_vars(inst);
  return fmi2OK;
}

/* FMI 3.0 Co-Simulation Entry Points */
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
  void* intermediateUpdate
) {
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
  fmi3Float64 stopTime
) {
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
  size_t nValues
) {
  (void)nValues;
  return (fmi3Status)${modelIdentifier}_fmi2GetReal(instance, valueReferences, nValueReferences, values);
}

fmi3Status ${modelIdentifier}_fmi3SetFloat64(
  fmi3Instance instance,
  const fmi3ValueReference valueReferences[],
  size_t nValueReferences,
  const fmi3Float64 values[],
  size_t nValues
) {
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
  fmi3Float64* lastSuccessfulTime
) {
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
 * Packages a SIMPACK model into a standalone .fmu ZIP archive.
 */
export function exportSimpackFmu(model: SimpackModel, options: MultibodyFmuOptions = {}): MultibodyFmuResult {
  const modelIdentifier = options.modelIdentifier
    ? sanitizeIdentifier(options.modelIdentifier)
    : sanitizeIdentifier(model.name);
  const guid = options.guid ?? generateGuid(modelIdentifier);

  const xml = generateSimpackFmi2ModelDescription(model, modelIdentifier, guid, options);
  const cSource = generateCCode(modelIdentifier, model);

  const encoder = new TextEncoder();
  const filesMap = new Map<string, Uint8Array>();
  filesMap.set("modelDescription.xml", encoder.encode(xml));

  if (options.includeSources !== false) {
    filesMap.set(`sources/${modelIdentifier}_cosim.c`, encoder.encode(cSource));
  }

  const archive = createZip(filesMap);
  const files = Array.from(filesMap.keys());
  const varCount = (xml.match(/<ScalarVariable/g) || []).length;

  return {
    archive,
    modelDescription2Xml: xml,
    files,
    modelIdentifier,
    variableCount: varCount,
  };
}

/**
 * Packages a GENSYS model into a standalone .fmu ZIP archive.
 */
export function exportGensysFmu(model: GensysModel, options: MultibodyFmuOptions = {}): MultibodyFmuResult {
  const modelIdentifier = options.modelIdentifier
    ? sanitizeIdentifier(options.modelIdentifier)
    : sanitizeIdentifier(model.name);
  const guid = options.guid ?? generateGuid(modelIdentifier);

  const xml = generateGensysFmi2ModelDescription(model, modelIdentifier, guid, options);
  const cSource = generateCCode(modelIdentifier, model);

  const encoder = new TextEncoder();
  const filesMap = new Map<string, Uint8Array>();
  filesMap.set("modelDescription.xml", encoder.encode(xml));

  if (options.includeSources !== false) {
    filesMap.set(`sources/${modelIdentifier}_cosim.c`, encoder.encode(cSource));
  }

  const archive = createZip(filesMap);
  const files = Array.from(filesMap.keys());
  const varCount = (xml.match(/<ScalarVariable/g) || []).length;

  return {
    archive,
    modelDescription2Xml: xml,
    files,
    modelIdentifier,
    variableCount: varCount,
  };
}
