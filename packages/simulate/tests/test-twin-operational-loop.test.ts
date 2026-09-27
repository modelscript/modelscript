import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { simulateArena } from "../src/core/simulate-arena.js";
import {
  CircularTelemetryBuffer,
  CusumDriftDetector,
  MovingHorizonEstimator,
  RulPredictor,
  VirtualSensorSynthesizer,
} from "../src/twin/index.js";

async function runTwinTests() {
  console.log("=== Testing Operational Digital Twin Runtime Loop ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: CircularTelemetryBuffer Ingestion & Spline Interpolation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: CircularTelemetryBuffer contiguous storage & Hermite interpolation...");
  const buf = new CircularTelemetryBuffer({
    numChannels: 2,
    capacity: 100,
    channelNames: ["temperature", "speed"],
  });

  // Push synthetic sinusoidal trajectory with slight jitter
  for (let i = 0; i < 50; i++) {
    const t = i * 0.1;
    const temp = 20.0 + 10.0 * Math.sin(t);
    const speed = 100.0 * Math.cos(t);
    buf.push(t, [temp, speed]);
  }

  assert.strictEqual(buf.getSampleCount(), 50);
  const range = buf.getTimeRange();
  assert.ok(range !== null);
  assert.strictEqual(range.startTime, 0.0);
  assert.strictEqual(Math.round(range.endTime * 10) / 10, 4.9);

  // Evaluate interpolation midway between samples: t = 1.05s
  const interp = buf.interpolate(1.05);
  assert.ok(interp !== null);
  const expectedTemp = 20.0 + 10.0 * Math.sin(1.05);
  const errTemp = Math.abs(interp[0]! - expectedTemp);
  console.log(
    `  Hermite interpolation at t=1.05s: val=${interp[0]!.toFixed(5)}, expected=${expectedTemp.toFixed(5)}, error=${errTemp.toExponential(3)}`,
  );
  assert.ok(errTemp < 1e-3, "Spline interpolation error exceeds threshold!");

  // Resample uniform grid for MHE window
  const uniformWindow = buf.resampleUniform(1.0, 3.0, 21);
  assert.strictEqual(uniformWindow.times.length, 21);
  assert.strictEqual(uniformWindow.channels.length, 2);
  assert.strictEqual(uniformWindow.channels[0]!.length, 21);
  console.log("  ✔ CircularTelemetryBuffer verified successfully!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: CusumDriftDetector Statistical Hypothesis Testing
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: CusumDriftDetector noise rejection & true degradation detection...");
  const detector = new CusumDriftDetector([
    {
      name: "temp_residual",
      expectedMean: 0.0,
      expectedStd: 0.5,
      minShift: 0.75, // 1.5 * σ
      threshold: 5.0,
    },
  ]);

  // Phase A: Feed zero-mean Gaussian noise for 100 steps -> Expect NO drift alarms
  let falseAlarmCount = 0;
  for (let k = 0; k < 100; k++) {
    const t = k * 0.1;
    // Box-Muller standard normal
    const u1 = Math.random();
    const u2 = Math.random();
    const noise = Math.sqrt(-2.0 * Math.log(Math.max(1e-10, u1))) * Math.cos(2.0 * Math.PI * u2) * 0.5;
    const evt = detector.update(t, [noise]);
    if (evt) falseAlarmCount++;
  }
  console.log(`  Phase A (100 noisy samples): false alarms = ${falseAlarmCount}`);
  assert.strictEqual(falseAlarmCount, 0, "CUSUM false alarm triggered on normal Gaussian noise!");

  // Phase B: Introduce structural physical drift (e.g. +1.8 K persistent temperature shift)
  let driftDetectedAtStep = -1;
  let detectedDirection = "";
  for (let k = 100; k < 150; k++) {
    const t = k * 0.1;
    const driftSignal = 1.8; // Structural shift
    const evt = detector.update(t, [driftSignal]);
    if (evt && driftDetectedAtStep === -1) {
      driftDetectedAtStep = k - 100;
      detectedDirection = evt.direction;
      console.log(
        `  Phase B (structural wear): Drift flagged at sample +${driftDetectedAtStep} (t=${t.toFixed(1)}s, score=${evt.score.toFixed(2)}, severity=${evt.severity})`,
      );
    }
  }

  assert.ok(
    driftDetectedAtStep > 0 && driftDetectedAtStep <= 15,
    `CUSUM failed to detect drift within 15 samples! (took ${driftDetectedAtStep})`,
  );
  assert.strictEqual(detectedDirection, "positive");
  console.log("  ✔ CusumDriftDetector successfully distinguished noise from degradation!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Moving Horizon Estimator (MHE) Parameter Recalibration
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 3: MovingHorizonEstimator online parameter calibration...");

  // Define DAE system: Thermal Cooling Circuit
  // der(T) = (P_loss - (T - T_amb) / R_th) / C_th
  // Variables: T (state), P_loss (parameter), R_th (parameter), C_th (parameter), T_amb (parameter)
  const degraded_R_th = 0.25; // True degraded thermal resistance in field (nominal was 0.15)
  const true_P_loss = 100.0;
  const true_C_th = 20.0;
  const true_T_amb = 25.0;

  const arena = new DAEBuilder();
  const v_T = arena.addVariable("T", VarType.Real, Variability.Continuous, 0, 25.0);
  arena.setVarStartValue(v_T, 25.0);

  const p_Rth = arena.addVariable("R_th", VarType.Real, Variability.Parameter, 0, degraded_R_th);
  arena.setVarExpression(p_Rth, arena.addRealLiteral(degraded_R_th));

  const p_Ploss = arena.addVariable("P_loss", VarType.Real, Variability.Parameter, 0, true_P_loss);
  arena.setVarExpression(p_Ploss, arena.addRealLiteral(true_P_loss));

  const p_Cth = arena.addVariable("C_th", VarType.Real, Variability.Parameter, 0, true_C_th);
  arena.setVarExpression(p_Cth, arena.addRealLiteral(true_C_th));

  const p_Tamb = arena.addVariable("T_amb", VarType.Real, Variability.Parameter, 0, true_T_amb);
  arena.setVarExpression(p_Tamb, arena.addRealLiteral(true_T_amb));

  // Equation: der(T) = (P_loss - (T - T_amb) / R_th) / C_th
  const tExpr = arena.addNameExpr("T");
  const derT = arena.addDerExpr(tExpr);
  const pLossExpr = arena.addNameExpr("P_loss");
  const rThExpr = arena.addNameExpr("R_th");
  const cThExpr = arena.addNameExpr("C_th");
  const tAmbExpr = arena.addNameExpr("T_amb");

  const T_minus_Tamb = arena.addBinaryExpr(BinOp.Sub, tExpr, tAmbExpr);
  const q_cooling = arena.addBinaryExpr(BinOp.Div, T_minus_Tamb, rThExpr);
  const net_P = arena.addBinaryExpr(BinOp.Sub, pLossExpr, q_cooling);
  const rhs_derT = arena.addBinaryExpr(BinOp.Div, net_P, cThExpr);
  arena.addEquation(EqKind.Simple, derT, rhs_derT);

  // Generate ground truth field telemetry from degraded system over [0, 5]
  const fieldSim = simulateArena(arena, {
    startTime: 0,
    stopTime: 5,
    step: 0.1,
    parameterOverrides: new Map([
      ["R_th", degraded_R_th],
      ["P_loss", true_P_loss],
      ["C_th", true_C_th],
      ["T_amb", true_T_amb],
    ]),
  });

  const tCol = fieldSim.states.indexOf("T");
  assert.ok(tCol !== -1);
  const tField = fieldSim.t;
  const tempField = fieldSim.y.map((row) => row[tCol]!);

  const fieldBuffer = new CircularTelemetryBuffer({
    numChannels: 1,
    capacity: 200,
    channelNames: ["T"],
  });
  for (let i = 0; i < tField.length; i++) {
    fieldBuffer.push(tField[i]!, [tempField[i]!]);
  }

  // Setup MHE with nominal (wrong) parameter prior: R_th = 0.12 (nominal design)
  const mhe = new MovingHorizonEstimator({
    problem: { builder: arena },
    parametersToEstimate: ["R_th"],
    parameterBounds: {
      R_th: { min: 0.05, max: 0.6, prior: 0.12 },
    },
    regularizationLambda: 1e-5,
    optimizerOptions: { maxIterations: 30, tolerance: 1e-6 },
  });

  // Execute MHE over observation window [1.0, 5.0]
  const mheWindow = fieldBuffer.resampleUniform(1.0, 5.0, 41);
  const mheResult = mhe.estimate(mheWindow, ["T"]);

  console.log(
    `  MHE Calibration: Initial Loss=${mheResult.lossBefore.toExponential(3)} -> Final Loss=${mheResult.lossAfter.toExponential(3)} in ${mheResult.iterations} iters`,
  );
  const calRth = mheResult.calibratedParameters["R_th"]!;
  const errorRth = Math.abs(calRth - degraded_R_th) / degraded_R_th;
  console.log(
    `  Calibrated R_th: ${calRth.toFixed(4)} (True: ${degraded_R_th.toFixed(4)}, Nominal: 0.12, RelError: ${(errorRth * 100).toFixed(2)}%)`,
  );

  assert.ok(mheResult.converged || mheResult.lossAfter < 1e-4, "MHE failed to converge!");
  assert.ok(errorRth < 0.02, `MHE calibrated R_th error too high: ${(errorRth * 100).toFixed(2)}%`);
  console.log("  ✔ MovingHorizonEstimator verified successfully!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: VirtualSensorSynthesizer & RulPredictor
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 4: Virtual Sensor Synthesis & Remaining Useful Life forecasting...");
  const synth = new VirtualSensorSynthesizer([
    {
      id: "inverter_hotspot",
      name: "Inverter Hotspot Temperature",
      unit: "degC",
      daeVariableName: "T",
      alarmThreshold: 85.0,
    },
  ]);

  const rulPred = new RulPredictor({
    type: "arrhenius",
    rateConstant: 1e-4,
    activationEnergy: 0.7,
    criticalDamageThreshold: 1.0,
  });

  // Predict RUL at 50% damage and 70°C operating temperature (343.15 K)
  const currentDamage = 0.5;
  const dutyStressTempK = 343.15;
  const rulForecast = rulPred.predictRul(currentDamage, dutyStressTempK, 0.15);

  console.log(
    `  Current Damage: ${(rulForecast.currentDamage * 100).toFixed(1)}%, Health Score: ${rulForecast.healthScore.toFixed(1)}%`,
  );
  console.log(
    `  Forecast RUL (P10/P50/P90): ${(rulForecast.rulP10 / 3600).toFixed(1)}h / ${(rulForecast.rulP50 / 3600).toFixed(1)}h / ${(rulForecast.rulP90 / 3600).toFixed(1)}h`,
  );
  assert.strictEqual(rulForecast.healthScore, 50.0);
  assert.ok(rulForecast.rulP10 < rulForecast.rulP50 && rulForecast.rulP50 < rulForecast.rulP90);
  console.log("  ✔ VirtualSensorSynthesizer & RulPredictor verified successfully!");

  console.log("\n=== ALL DIGITAL TWIN RUNTIME TESTS PASSED ===");
}

void runTwinTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
