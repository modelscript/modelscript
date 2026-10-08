// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, initBltWasm, UnaryOp, Variability, VarType } from "@modelscript/runtime";
import { StringInterner } from "@modelscript/runtime/wasm_string_pool.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TrainedROM } from "@modelscript/simulate";
import {
  generateModelEvaluateHessian,
  generateModelEvaluateJacobian,
  generateModelEvaluateObjective,
  generateNlpC,
} from "../src/fmu/ad-codegen.js";
import { generateFmu } from "../src/fmu/fmi.js";
import { generateFmi3 } from "../src/fmu/fmi3.js";
import { generateFmuAsSources } from "../src/fmu/fmu-as-codegen.js";
import { generateFmuJsSources } from "../src/fmu/fmu-js-codegen.js";
import { generateFmuWasmSource } from "../src/fmu/fmu-wasm-codegen.js";
import { extractFromZip, parseFmuModelDescription } from "../src/fmu/fmu.js";
import { generateFmi3CSources } from "../src/fmu/fmu3-codegen.js";
import { generateFmuHarnessC, generateFmuHarnessCMake } from "../src/fmu/harness-codegen.js";
import { generateFmi3HarnessC } from "../src/fmu/harness3-codegen.js";
import { generateRomWasmSource } from "../src/fmu/rom-wasm-codegen.js";
import { generateSundialsMainC } from "../src/fmu/sundials-codegen.js";
import {
  binaryOpToC,
  binaryOpToJs,
  escapeCString,
  escapeJsString,
  formatCDouble,
  mapFunctionName,
  mapFunctionNameJs,
  sanitizeIdentifier,
} from "../src/fmu/transpiler-utils.js";
import { generateMultiModelWrapper } from "../src/fmu/wrapper-template.js";

describe("FMU Codegen & Exchange Extended Coverage Tests", async () => {
  await initBltWasm();

  // Helper to build a comprehensive DAE system
  function buildTestDae(): { dae: DAEBuilder; interner: StringInterner } {
    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "PendulumModel");

    // Continuous states and derivatives
    dae.addVariable("theta", VarType.Real, Variability.Continuous, Causality.Output, 0.785);
    dae.addVariable("omega", VarType.Real, Variability.Continuous, Causality.Output, 0.0);
    dae.addVariable("der(theta)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    dae.addVariable("der(omega)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Parameters
    dae.addVariable("mass", VarType.Real, Variability.Parameter, Causality.Local, 2.5);
    dae.addVariable("length", VarType.Real, Variability.Parameter, Causality.Local, 1.0);
    dae.addVariable("g", VarType.Real, Variability.Parameter, Causality.Local, 9.81);
    dae.addVariable("damping", VarType.Real, Variability.Parameter, Causality.Local, 0.1);

    // Discrete / Boolean / Integer variables
    dae.addVariable("count", VarType.Integer, Variability.Discrete, Causality.Local, 10);
    dae.addVariable("enabled", VarType.Boolean, Variability.Discrete, Causality.Input, 1);
    dae.addVariable("tag", VarType.String, Variability.Parameter, Causality.Local, 0);

    // der(theta) = omega
    const derTheta = dae.addDerExpr(dae.addNameExpr("theta"));
    const omega = dae.addNameExpr("omega");
    dae.addEquation(EqKind.Simple, derTheta, omega);

    // der(omega) = -(g / length) * sin(theta) - damping * omega
    const derOmega = dae.addDerExpr(dae.addNameExpr("omega"));
    const g = dae.addNameExpr("g");
    const len = dae.addNameExpr("length");
    const damp = dae.addNameExpr("damping");
    const theta = dae.addNameExpr("theta");

    const gDivL = dae.addBinaryExpr(BinOp.Div, g, len);
    const sinTheta = dae.addCallExpr(interner.intern("sin"), [theta]);
    const gravityTorque = dae.addBinaryExpr(BinOp.Mul, gDivL, sinTheta);
    const negGravity = dae.addUnaryExpr(UnaryOp.Negate, gravityTorque);

    const dampTorque = dae.addBinaryExpr(BinOp.Mul, damp, omega);
    const acc = dae.addBinaryExpr(BinOp.Sub, negGravity, dampTorque);
    dae.addEquation(EqKind.Simple, derOmega, acc);

    // Add zero crossing event: theta > 0
    const zeroExpr = dae.addRealLiteral(0.0);
    const zcCond = dae.addBinaryExpr(BinOp.Gt, theta, zeroExpr);
    dae.addEventIndicator(zcCond);

    return { dae, interner };
  }

  describe("Harness Generators", () => {
    it("generates FMI 2.0 C harness and CMakeLists", () => {
      const c = generateFmuHarnessC();
      assert.ok(c.includes("fmi2Component"), "Must define fmi2Component");
      assert.ok(c.includes("fmi2DoStep"), "Must support fmi2DoStep");
      assert.ok(c.includes("json_respond_ok"), "Must support JSON-RPC responses");

      const cmake = generateFmuHarnessCMake();
      assert.ok(cmake.includes("cmake_minimum_required"), "Must be a valid CMake script");
      assert.ok(cmake.includes("fmu-harness"), "Must declare fmu-harness target");
    });

    it("generates FMI 3.0 C harness", () => {
      const c = generateFmi3HarnessC();
      assert.ok(c.includes("fmi3Instance"), "Must define fmi3Instance");
      assert.ok(c.includes("fmi3DoStep"), "Must support fmi3DoStep");
      assert.ok(c.includes("intermediateUpdate"), "Must proxy intermediateUpdate");
      assert.ok(c.includes("enterEventMode"), "Must support event mode");
    });
  });

  describe("Transpiler Utilities", () => {
    it("sanitizes identifiers correctly", () => {
      assert.strictEqual(sanitizeIdentifier("foo.bar.baz"), "foo_bar_baz");
      assert.strictEqual(sanitizeIdentifier("arr[1][2]"), "arr_1_2");
      assert.strictEqual(sanitizeIdentifier("valid_name_123"), "valid_name_123");
      assert.strictEqual(sanitizeIdentifier("invalid-char#@$"), "invalid_char___");
    });

    it("maps binary operators to C", () => {
      assert.strictEqual(binaryOpToC(BinOp.Add), "+");
      assert.strictEqual(binaryOpToC(BinOp.Sub), "-");
      assert.strictEqual(binaryOpToC(BinOp.Mul), "*");
      assert.strictEqual(binaryOpToC(BinOp.Div), "/");
      assert.strictEqual(binaryOpToC(BinOp.Pow), "pow");
      assert.strictEqual(binaryOpToC(BinOp.Lt), "<");
      assert.strictEqual(binaryOpToC(BinOp.Lte), "<=");
      assert.strictEqual(binaryOpToC(BinOp.Gt), ">");
      assert.strictEqual(binaryOpToC(BinOp.Gte), ">=");
      assert.strictEqual(binaryOpToC(BinOp.Eq), "==");
      assert.strictEqual(binaryOpToC(BinOp.Neq), "!=");
      assert.strictEqual(binaryOpToC(BinOp.And), "&&");
      assert.strictEqual(binaryOpToC(BinOp.Or), "||");
      assert.strictEqual(binaryOpToC(999 as any), "+");
    });

    it("maps binary operators to JS", () => {
      assert.strictEqual(binaryOpToJs(BinOp.Add), "+");
      assert.strictEqual(binaryOpToJs(BinOp.Eq), "===");
      assert.strictEqual(binaryOpToJs(BinOp.Neq), "!==");
      assert.strictEqual(binaryOpToJs(BinOp.Pow), "pow");
      assert.strictEqual(binaryOpToJs(999 as any), "+");
    });

    it("maps math functions for C and JS", () => {
      assert.strictEqual(mapFunctionName("sin"), "sin");
      assert.strictEqual(mapFunctionName("abs"), "fabs");
      assert.strictEqual(mapFunctionName("sign"), "copysign");
      assert.strictEqual(mapFunctionName("Modelica.Math.sin"), "sin");
      assert.strictEqual(mapFunctionName("customFunc"), "customFunc");

      assert.strictEqual(mapFunctionNameJs("sin"), "Math.sin");
      assert.strictEqual(mapFunctionNameJs("sqrt"), "Math.sqrt");
      assert.strictEqual(mapFunctionNameJs("customFunc"), "Math.customFunc");
    });

    it("formats C double literals accurately", () => {
      assert.strictEqual(formatCDouble(5), "5.0");
      assert.strictEqual(formatCDouble(3.1415), "3.1415");
      assert.strictEqual(formatCDouble(1e-5), "0.00001");
      assert.strictEqual(formatCDouble(Infinity), "INFINITY");
      assert.strictEqual(formatCDouble(-Infinity), "(-INFINITY)");
      assert.strictEqual(formatCDouble(NaN), "NAN");
    });

    it("escapes C and JS strings", () => {
      assert.strictEqual(escapeCString('hello "world"\n'), 'hello \\"world\\"\\n');
      assert.strictEqual(escapeJsString('test "quote"\n\\path'), 'test \\"quote\\"\\n\\\\path');
    });
  });

  describe("FMU Description and ZIP Parser", () => {
    it("parses modelDescription.xml scalar variables and metadata", () => {
      const xml = `<fmiModelDescription fmiVersion="2.0" modelName="TestFmu" description="Test FMU Model">
  <ModelVariables>
    <ScalarVariable name="r" valueReference="1" causality="input" variability="continuous">
      <Real start="1.5" />
    </ScalarVariable>
    <ScalarVariable name="i" valueReference="2" causality="output" variability="discrete">
      <Integer start="42" />
    </ScalarVariable>
    <ScalarVariable name="b" valueReference="3" causality="local" variability="discrete">
      <Boolean start="true" />
    </ScalarVariable>
    <ScalarVariable name="s" valueReference="4" causality="parameter" variability="fixed">
      <String start="abc" />
    </ScalarVariable>
    <ScalarVariable name="e" valueReference="5" causality="output" variability="discrete">
      <Enumeration start="1" />
    </ScalarVariable>
  </ModelVariables>
</fmiModelDescription>`;

      const parsed = parseFmuModelDescription(xml);
      assert.strictEqual(parsed.modelName, "TestFmu");
      assert.strictEqual(parsed.description, "Test FMU Model");
      assert.strictEqual(parsed.variables.length, 5);
      assert.strictEqual(parsed.variables[0]?.name, "r");
      assert.strictEqual(parsed.variables[0]?.type, "Real");
      assert.strictEqual(parsed.variables[0]?.start, 1.5);
      assert.strictEqual(parsed.variables[1]?.type, "Integer");
      assert.strictEqual(parsed.variables[2]?.type, "Boolean");
      assert.strictEqual(parsed.variables[3]?.type, "String");
      assert.strictEqual(parsed.variables[4]?.type, "Enumeration");
    });

    it("returns null for non-zip data in extractFromZip", () => {
      const empty = new Uint8Array([1, 2, 3, 4]);
      assert.strictEqual(extractFromZip(empty, "test.txt"), null);
    });
  });

  describe("Multi-Model Wrapper Template", () => {
    it("generates Modelica multi-FMU wrapper text", () => {
      const result = generateMultiModelWrapper(
        "DualPendulumSystem",
        [
          { className: "Pendulum1", instanceName: "p1", fileName: "Pendulum1.fmu" },
          { className: "Pendulum2", instanceName: "p2", fileName: "Pendulum2.fmu" },
        ],
        [{ source: "p1.theta", target: "p2.theta_in" }],
      );

      assert.ok(result.includes("model DualPendulumSystem"), "Must contain model declaration");
      assert.ok(result.includes("Pendulum1 p1"), "Must declare first FMU");
      assert.ok(result.includes("Pendulum2 p2"), "Must declare second FMU");
      assert.ok(result.includes("connect(p1.theta, p2.theta_in)"), "Must wire ports");
    });
  });

  describe("FMI 3.0 C Code Generation", () => {
    it("generates complete FMI 3.0 C sources (header, source, API glue, CMake)", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel", guid: "{11111111-2222-3333-4444-555555555555}" };
      const fmi3Res = generateFmi3(dae, options);

      const sources = generateFmi3CSources(dae, fmi3Res, options);
      assert.ok(sources.modelH.includes("PENDULUMMODEL_MODEL_H"), "Header must include guard");
      assert.ok(sources.modelH.includes("typedef struct"), "Header must declare instance struct");
      assert.ok(sources.modelC.includes("PendulumModel_initialize"), "Must implement init");
      assert.ok(sources.modelC.includes("PendulumModel_getDerivatives"), "Must implement getDerivatives");
      assert.ok(sources.modelC.includes("PendulumModel_getEventIndicators"), "Must implement zero crossings");
      assert.ok(sources.fmi3FunctionsC.includes("fmi3InstantiateModelExchange"), "Must provide FMI 3.0 ME API");
      assert.ok(sources.fmi3FunctionsC.includes("fmi3InstantiateCoSimulation"), "Must provide FMI 3.0 CS API");
      assert.ok(sources.cmakeLists.includes("add_library(PendulumModel SHARED"), "Must configure CMake build");
    });
  });

  describe("WASM & AssemblyScript Code Generation", () => {
    it("generates Emscripten C code from DAE", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmuRes = generateFmu(dae, options);

      const wasmRes = generateFmuWasmSource(dae, fmuRes, options);
      assert.ok(wasmRes.wasmC.includes("wasm_do_step"), "Must export wasm_do_step");
      assert.ok(wasmRes.wasmC.includes("wasm_get_derivatives"), "Must export get_derivatives");
      assert.ok(wasmRes.emccFlags.includes("-sWASM=1"), "Must specify WASM flag");
      assert.ok(wasmRes.exportedFunctions.includes("_wasm_init"), "Must include _wasm_init export");
    });

    it("generates AssemblyScript code from DAE", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmuRes = generateFmu(dae, options);

      const asSource = generateFmuAsSources(dae, fmuRes, options);
      assert.ok(asSource.includes("export function doStep"), "Must export doStep in AS");
      assert.ok(asSource.includes("export function getDerivatives"), "Must export getDerivatives in AS");
    });

    it("generates JavaScript source from DAE", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmuRes = generateFmu(dae, options);

      const jsSource = generateFmuJsSources(dae, fmuRes, options);
      assert.ok(jsSource.includes("class FmuModel"), "Must declare JS class");
      assert.ok(jsSource.includes("getDerivatives()"), "Must implement getDerivatives");
    });
  });

  describe("ROM Surrogate WASM Code Generation", () => {
    it("generates ROM WASM C code for MLP architectures (relu, tanh, sigmoid)", () => {
      const romRelu: TrainedROM = {
        architecture: "mlp",
        inputNames: ["in1", "in2"],
        outputNames: ["out1"],
        inputScaling: [
          { mean: 0.0, std: 1.0 },
          { mean: 1.0, std: 2.0 },
        ],
        outputScaling: [{ mean: 10.0, std: 5.0 }],
        weights: {
          type: "mlp",
          activation: "relu",
          layers: [
            {
              W: [
                [0.5, -0.2],
                [0.1, 0.9],
              ],
              b: [0.0, 0.1],
            },
            { W: [[1.0, -1.0]], b: [0.5] },
          ],
        },
        metrics: { trainMSE: 0.001, valMSE: 0.002, r2: 0.995 },
      };

      const resRelu = generateRomWasmSource(romRelu, "MlpSurrogate");
      assert.ok(resRelu.wasmC.includes("rom_evaluate"), "Must implement rom_evaluate");
      assert.ok(resRelu.wasmC.includes("relu"), "Must evaluate relu activation");
      assert.ok(resRelu.modelDescriptionXml.includes("MlpSurrogate"), "Must generate XML description");

      const romTanh: TrainedROM = {
        ...romRelu,
        weights: {
          type: "mlp",
          activation: "tanh",
          layers: [
            { W: [[0.5, -0.2]], b: [0.0] },
            { W: [[1.0]], b: [0.0] },
          ],
        },
      };
      const resTanh = generateRomWasmSource(romTanh, "MlpTanh");
      assert.ok(resTanh.wasmC.includes("tanh("), "Must evaluate tanh activation");

      const romSigmoid: TrainedROM = {
        ...romRelu,
        weights: {
          type: "mlp",
          activation: "sigmoid",
          layers: [
            { W: [[0.5, -0.2]], b: [0.0] },
            { W: [[1.0]], b: [0.0] },
          ],
        },
      };
      const resSigmoid = generateRomWasmSource(romSigmoid, "MlpSigmoid");
      assert.ok(resSigmoid.wasmC.includes("1.0 / (1.0 + exp(-z))"), "Must evaluate sigmoid activation");
    });

    it("generates ROM WASM C code for Polynomial and RBF architectures", () => {
      const romPoly: TrainedROM = {
        architecture: "polynomial",
        inputNames: ["u"],
        outputNames: ["y"],
        inputScaling: [{ mean: 0.0, std: 1.0 }],
        outputScaling: [{ mean: 0.0, std: 1.0 }],
        weights: {
          type: "polynomial",
          degree: 2,
          nInputs: 1,
          coefficients: [[1.0, 2.0, 0.5]],
        },
        metrics: { trainMSE: 0.005, valMSE: 0.008, r2: 0.98 },
      };

      const resPoly = generateRomWasmSource(romPoly, "PolySurrogate");
      assert.ok(resPoly.wasmC.includes("POLY_DEGREE"), "Must define polynomial degree");
      assert.ok(resPoly.wasmC.includes("poly_coefficients"), "Must emit polynomial coefficients");

      const romRbf: TrainedROM = {
        architecture: "rbf",
        inputNames: ["u"],
        outputNames: ["y"],
        inputScaling: [{ mean: 0.0, std: 1.0 }],
        outputScaling: [{ mean: 0.0, std: 1.0 }],
        weights: {
          type: "rbf",
          centers: [[0.0], [1.0]],
          weights: [[0.5], [1.5]],
          gamma: 0.5,
          epsilon: 1.0,
        },
        metrics: { trainMSE: 0.002, valMSE: 0.003, r2: 0.99 },
      };

      const resRbf = generateRomWasmSource(romRbf, "RbfSurrogate");
      assert.ok(resRbf.wasmC.includes("RBF_N_CENTERS"), "Must define RBF centers");
      assert.ok(resRbf.wasmC.includes("rbf_centers"), "Must emit RBF centers matrix");
    });
  });

  describe("Automatic Differentiation & Jacobian Codegen", () => {
    it("generates exact Analytical Jacobian and Directional Derivatives", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmi3Res = generateFmi3(dae, options);

      const jacLines = generateModelEvaluateJacobian("PendulumModel", dae, fmi3Res.variables);
      const jacCode = jacLines.join("\n");
      assert.ok(jacCode.includes("PendulumModel_evaluate_jacobian"), "Must declare evaluate_jacobian function");
      assert.ok(jacCode.includes("Forward Pass"), "Must include forward tape pass");
      assert.ok(jacCode.includes("Reverse Pass"), "Must include reverse tape pass");

      const objLines = generateModelEvaluateObjective("PendulumModel", dae, fmi3Res.variables);
      const objCode = objLines.join("\n");
      assert.ok(objCode.includes("PendulumModel_evaluate_objective"), "Must declare evaluate_objective function");

      const hessLines = generateModelEvaluateHessian("PendulumModel", dae, fmi3Res.variables);
      const hessCode = hessLines.join("\n");
      assert.ok(hessCode.includes("PendulumModel_evaluate_hessian"), "Must declare evaluate_hessian function");
    });

    it("generates Standalone IPOPT NLP evaluation C code", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumOpt" };
      const fmi3Res = generateFmi3(dae, options);

      const thetaExpr = dae.addNameExpr("theta");
      const costExpr = dae.addBinaryExpr(BinOp.Mul, thetaExpr, thetaExpr);
      const consExpr = dae.addBinaryExpr(BinOp.Sub, thetaExpr, dae.addRealLiteral(1.0));

      const nlpLines = generateNlpC("PendulumOpt", dae.varCount, 1, 2, dae, fmi3Res.variables);
      const nlpCode = nlpLines.join("\n");

      assert.ok(nlpCode.includes("eval_f"), "Must generate cost evaluation function");
      assert.ok(nlpCode.includes("eval_grad_f"), "Must generate gradient evaluation function");
    });
  });

  describe("SUNDIALS CVODE and IDA Integration Codegen", () => {
    it("generates CVODE driver with exact analytical Jacobian", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmuRes = generateFmu(dae, options);

      const cvodeRes = generateSundialsMainC(dae, fmuRes, {
        modelIdentifier: "PendulumModel",
        solver: "cvode",
        useExactJacobian: true,
        startTime: 0,
        stopTime: 5,
        numberOfIntervals: 100,
        atol: 1e-9,
        rtol: 1e-7,
      });

      assert.ok(cvodeRes.mainC.includes("sundials_cvode_run"), "Must call sundials_cvode_run");
      assert.ok(cvodeRes.cmakeSnippet.includes("SUNDIALS"), "Must include SUNDIALS CMake configuration");
    });

    it("generates IDA implicit DAE driver", () => {
      const { dae } = buildTestDae();
      const options = { modelIdentifier: "PendulumModel" };
      const fmuRes = generateFmu(dae, options);

      const idaRes = generateSundialsMainC(dae, fmuRes, {
        modelIdentifier: "PendulumModel",
        solver: "ida",
        useExactJacobian: false,
      });

      assert.ok(idaRes.mainC.includes("sundials_ida_run"), "Must call sundials_ida_run");
    });
  });
});
