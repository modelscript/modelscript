// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exportCellmlToFmu,
  exportOpenSimToFmu,
  type CellmlFmuModelLike,
  type OpenSimFmuModelLike,
} from "../src/fmu/medical-fmu-exporter.js";
import { parseModelDescription } from "../src/fmu/model-description.js";
import { extractFileFromZip } from "../src/fmu/storage.js";

const sampleOpenSimModel: OpenSimFmuModelLike = {
  modelName: "Arm26_ElbowFlexion",
  version: "40000",
  gravity: [0, -9.80665, 0],
  bodies: [
    {
      id: "humerus",
      name: "humerus",
      mass: 1.864,
      massCenter: [0, -0.18, 0],
      inertia: [0.0148, 0.0045, 0.0131, 0, 0, 0],
    },
    {
      id: "radius_ulna",
      name: "radius_ulna",
      mass: 1.534,
      massCenter: [0, -0.14, 0],
      inertia: [0.0192, 0.0015, 0.02, 0, 0, 0],
    },
  ],
  joints: [
    {
      id: "shoulder",
      name: "shoulder",
      jointType: "PinJoint",
      parentFrame: "ground",
      childFrame: "humerus",
      coordinates: [
        {
          id: "r_shoulder_elev",
          name: "r_shoulder_elev",
          motionType: "rotational",
          defaultValue: 0.0,
          rangeMin: -1.57,
          rangeMax: 3.14,
          clamped: true,
          locked: false,
        },
      ],
    },
    {
      id: "elbow",
      name: "elbow",
      jointType: "PinJoint",
      parentFrame: "humerus",
      childFrame: "radius_ulna",
      coordinates: [
        {
          id: "r_elbow_flex",
          name: "r_elbow_flex",
          motionType: "rotational",
          defaultValue: 0.5236,
          rangeMin: 0.0,
          rangeMax: 2.2689,
          clamped: true,
          locked: false,
        },
      ],
    },
  ],
  muscles: [
    {
      id: "BIClong",
      name: "BIClong",
      muscleType: "Thelen2003Muscle",
      maxIsometricForce: 624.3,
      optimalFiberLength: 0.1157,
      tendonSlackLength: 0.2723,
      pennationAngleAtOptimal: 0.0,
      activationTimeConstant: 0.01,
      deactivationTimeConstant: 0.04,
      maxContractionVelocity: 10.0,
      pathPoints: [
        { name: "p1", bodyFrame: "humerus", location: [0.0, -0.05, 0.02] },
        { name: "p2", bodyFrame: "radius_ulna", location: [0.0, -0.04, 0.03] },
      ],
    },
    {
      id: "TRIlong",
      name: "TRIlong",
      muscleType: "Millard2012EquilibriumMuscle",
      maxIsometricForce: 798.5,
      optimalFiberLength: 0.134,
      tendonSlackLength: 0.143,
      pennationAngleAtOptimal: 0.2094,
      activationTimeConstant: 0.012,
      deactivationTimeConstant: 0.045,
      maxContractionVelocity: 10.0,
      pathPoints: [
        { name: "p1", bodyFrame: "humerus", location: [0.0, -0.06, -0.02] },
        { name: "p2", bodyFrame: "radius_ulna", location: [0.0, -0.02, -0.025] },
      ],
    },
  ],
};

const sampleCellmlModel: CellmlFmuModelLike = {
  name: "HodgkinHuxleyMembrane",
  version: "1.1",
  units: new Map([
    [
      "millisecond",
      {
        name: "millisecond",
        isBaseUnits: false,
        dimensions: {
          second: 1,
          multiplierScale: 1e-3,
          ampere: 0,
          kelvin: 0,
          kilogram: 0,
          metre: 0,
          mole: 0,
          candela: 0,
        },
      },
    ],
    [
      "millivolt",
      {
        name: "millivolt",
        isBaseUnits: false,
        dimensions: {
          kilogram: 1,
          metre: 2,
          second: -3,
          ampere: -1,
          multiplierScale: 1e-3,
          kelvin: 0,
          mole: 0,
          candela: 0,
        },
      },
    ],
    [
      "microA_per_cm2",
      {
        name: "microA_per_cm2",
        isBaseUnits: false,
        dimensions: {
          ampere: 1,
          metre: -2,
          multiplierScale: 1e-2,
          kelvin: 0,
          kilogram: 0,
          mole: 0,
          second: 0,
          candela: 0,
        },
      },
    ],
  ]),
  components: new Map([
    [
      "environment",
      {
        name: "environment",
        variables: new Map([["time", { name: "time", units: "millisecond", publicInterface: "out" }]]),
        equations: [],
      },
    ],
    [
      "membrane",
      {
        name: "membrane",
        variables: new Map([
          ["time", { name: "time", units: "millisecond", publicInterface: "in" }],
          ["V", { name: "V", units: "millivolt", initialValue: -75.0, publicInterface: "out" }],
          ["m", { name: "m", units: "dimensionless", initialValue: 0.05, publicInterface: "out" }],
          ["Cm", { name: "Cm", units: "microF_per_cm2", initialValue: 1.0, publicInterface: "none" }],
          ["g_L", { name: "g_L", units: "milliS_per_cm2", initialValue: 0.3, publicInterface: "none" }],
          ["E_L", { name: "E_L", units: "millivolt", initialValue: -54.387, publicInterface: "none" }],
          ["I_stim", { name: "I_stim", units: "microA_per_cm2", initialValue: 10.0, publicInterface: "in" }],
          ["i_L", { name: "i_L", units: "microA_per_cm2", publicInterface: "out" }],
        ]),
        equations: [
          {
            targetVariable: "i_L",
            isOde: false,
            rhsExpression: "g_L * (V - E_L)",
          },
          {
            targetVariable: "V",
            isOde: true,
            independentVariable: "time",
            rhsExpression: "-(i_L - I_stim) / Cm",
          },
          {
            targetVariable: "m",
            isOde: true,
            independentVariable: "time",
            rhsExpression: "(1.0 / (1.0 + exp((-V - 40.0) / 10.0)) - m) / 0.5",
          },
        ],
      },
    ],
  ]),
  connections: [
    {
      component1: "environment",
      component2: "membrane",
      mappings: [{ variable1: "time", variable2: "time" }],
    },
  ],
};

describe("Medical & Biomechanical FMU Exporter (FMI 2.0 / 3.0)", () => {
  it("exports OpenSim musculoskeletal model to valid FMI 2.0 FMU and parses modelDescription.xml", () => {
    const res = exportOpenSimToFmu(sampleOpenSimModel, {
      fmiVersion: "2.0",
      modelIdentifier: "Arm26Fmu2",
    });

    assert.equal(res.fmiVersion, "2.0");
    assert.equal(res.modelIdentifier, "Arm26Fmu2");
    assert.ok(res.archive instanceof Uint8Array && res.archive.byteLength > 200);
    assert.ok(res.files.includes("modelDescription.xml"));
    assert.ok(res.files.includes("sources/model.c"));
    assert.ok(res.files.includes("sources/runtime.js"));

    const parsed = parseModelDescription(res.modelDescriptionXml);
    assert.equal(parsed.fmiVersion, "2.0");
    assert.equal(parsed.modelName, "Arm26Fmu2");
    assert.equal(parsed.supportsCoSimulation, true);
    assert.equal(parsed.supportsModelExchange, true);

    // Check muscle excitation inputs u_<muscle>
    const uBic = parsed.variables.find((v) => v.name === "u_BIClong");
    const uTri = parsed.variables.find((v) => v.name === "u_TRIlong");
    assert.ok(uBic && uBic.causality === "input" && uBic.variability === "continuous");
    assert.ok(uTri && uTri.causality === "input" && uTri.variability === "continuous");

    // Check muscle activation states a_<muscle> and tendon forces F_<muscle>
    const aBic = parsed.variables.find((v) => v.name === "a_BIClong");
    const fBic = parsed.variables.find((v) => v.name === "F_BIClong");
    assert.ok(aBic && aBic.causality === "output" && aBic.variability === "continuous");
    assert.ok(fBic && fBic.causality === "output" && fBic.unit === "N");

    // Check generalized coordinates q_<coord> and speeds u_<coord>
    const qElbow = parsed.variables.find((v) => v.name === "q_r_elbow_flex");
    const uElbow = parsed.variables.find((v) => v.name === "u_r_elbow_flex");
    assert.ok(qElbow && qElbow.causality === "output" && qElbow.variability === "continuous");
    assert.ok(uElbow && uElbow.causality === "local" && uElbow.variability === "continuous");

    // Check tunable muscle parameters
    const fMaxBic = parsed.variables.find((v) => v.name === "max_isometric_force_BIClong");
    const lOptBic = parsed.variables.find((v) => v.name === "optimal_fiber_length_BIClong");
    const lSlackBic = parsed.variables.find((v) => v.name === "tendon_slack_length_BIClong");
    assert.ok(fMaxBic && fMaxBic.causality === "parameter" && fMaxBic.variability === "tunable");
    assert.equal(fMaxBic.start, 624.3);
    assert.ok(lOptBic && lOptBic.causality === "parameter" && lOptBic.variability === "tunable");
    assert.equal(lOptBic.start, 0.1157);
    assert.ok(lSlackBic && lSlackBic.causality === "parameter" && lSlackBic.variability === "tunable");
    assert.equal(lSlackBic.start, 0.2723);

    // Check ModelStructure outputs & derivatives
    assert.ok(parsed.modelStructure);
    assert.ok(parsed.modelStructure.outputs.length >= 6);
    assert.ok(parsed.modelStructure.derivatives.length >= 8);

    // Verify C99 and WebAssembly RK4 runtime sources
    assert.ok(res.cSource.includes("hill_activation_derivative"));
    assert.ok(res.cSource.includes("hill_active_force_length"));
    assert.ok(res.cSource.includes("opensim_rk4_step"));
    assert.ok(res.cSource.includes("Arm26Fmu2_fmi2DoStep"));
    assert.ok(res.wasmRuntimeSource.includes("OpenSimWasmRk4Runtime"));
    assert.ok(res.wasmRuntimeSource.includes("stepRk4"));
  });

  it("exports OpenSim musculoskeletal model to valid FMI 3.0 FMU and parses Float64 variables", () => {
    const res = exportOpenSimToFmu(sampleOpenSimModel, {
      fmiVersion: "3.0",
      modelIdentifier: "Arm26Fmu3",
    });

    assert.equal(res.fmiVersion, "3.0");
    assert.ok(res.modelDescriptionXml.includes('fmiVersion="3.0"'));
    assert.ok(res.modelDescriptionXml.includes("<Float64 "));
    assert.ok(res.modelDescriptionXml.includes("<ContinuousStateDerivative "));

    const parsed = parseModelDescription(res.modelDescriptionXml);
    assert.equal(parsed.fmiVersion, "3.0");
    assert.equal(parsed.modelName, "Arm26Fmu3");
    assert.ok(parsed.instantiationToken);
    assert.equal(parsed.variables.length, res.variableCount);

    const derABic = parsed.variables.find((v) => v.name === "der(a_BIClong)");
    const aBic = parsed.variables.find((v) => v.name === "a_BIClong");
    assert.ok(derABic && aBic);
    assert.equal(derABic.derivative, aBic.valueReference);
    assert.ok(parsed.modelStructure?.derivatives.includes(derABic.valueReference));
  });

  it("exports CellML model to valid FMI 2.0 and FMI 3.0 FMUs with UnitDefinitions, ModelStructure, and C99 ODE code", () => {
    const res2 = exportCellmlToFmu(sampleCellmlModel, {
      fmiVersion: "2.0",
      modelIdentifier: "HHMembrane2",
    });

    assert.equal(res2.fmiVersion, "2.0");
    assert.ok(res2.modelDescriptionXml.includes("<UnitDefinitions>"));
    assert.ok(res2.modelDescriptionXml.includes('<Unit name="millivolt">'));
    assert.ok(res2.modelDescriptionXml.includes('<Unit name="millisecond">'));

    const parsed2 = parseModelDescription(res2.modelDescriptionXml);
    assert.equal(parsed2.fmiVersion, "2.0");
    assert.equal(parsed2.modelName, "HHMembrane2");

    const vState = parsed2.variables.find((v) => v.name === "membrane.V");
    const mState = parsed2.variables.find((v) => v.name === "membrane.m");
    const derV = parsed2.variables.find((v) => v.name === "der(membrane.V)");
    const derM = parsed2.variables.find((v) => v.name === "der(membrane.m)");
    const iStim = parsed2.variables.find((v) => v.name === "membrane.I_stim");

    assert.ok(vState && vState.start === -75.0 && vState.unit === "millivolt");
    assert.ok(mState && mState.start === 0.05);
    assert.ok(derV && derV.derivative !== undefined);
    assert.ok(derM && derM.derivative !== undefined);
    assert.ok(iStim && iStim.causality === "input");

    assert.ok(parsed2.modelStructure);
    assert.equal(parsed2.modelStructure.derivatives.length, 2);

    // Check C99 ODE evaluation code inside archive
    const cCode = extractFileFromZip(Buffer.from(res2.archive), "sources/model.c");
    assert.ok(cCode);
    assert.ok(cCode.includes("cellml_eval_equations"));
    assert.ok(cCode.includes("cellml_rk4_step"));
    assert.ok(cCode.includes("HHMembrane2_fmi2DoStep"));
    assert.ok(cCode.includes("exp("));

    // Verify FMI 3.0 export for CellML
    const res3 = exportCellmlToFmu(sampleCellmlModel, {
      fmiVersion: "3.0",
      modelIdentifier: "HHMembrane3",
    });
    const parsed3 = parseModelDescription(res3.modelDescriptionXml);
    assert.equal(parsed3.fmiVersion, "3.0");
    assert.equal(parsed3.modelName, "HHMembrane3");
    assert.equal(parsed3.modelStructure?.derivatives.length, 2);
  });
});
