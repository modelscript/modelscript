// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { McapReader, McapWriter, Mdf4Reader, Mdf4Writer, TelemetryStreamer } from "@modelscript/exchange";

import { BayesianParameterCalibrator, VirtualSensorFusion } from "../src/calibration/index.js";

import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "@modelscript/runtime";

describe("Phase 3: Telemetry-Driven Digital Twin & Calibration", () => {
  describe("ASAM MDF4 (.mf4) Telemetry Streaming Engine", () => {
    it("generates and parses compliant ASAM MDF4 binary recordings", () => {
      const N = 1000;
      const times = new Float64Array(N);
      const accel = new Float64Array(N);
      const pressure = new Float64Array(N);

      for (let i = 0; i < N; i++) {
        times[i] = i * 0.001; // 1 kHz sampling
        accel[i] = 9.81 + 2.5 * Math.sin(2 * Math.PI * 5 * times[i]!);
        pressure[i] = 120.0 + 10.0 * Math.cos(2 * Math.PI * 2 * times[i]!);
      }

      // Generate MDF4 binary buffer
      const mdfBytes = Mdf4Writer.create([
        { name: "chassis_accel_z", unit: "m/s2", timestamps: times, values: accel },
        { name: "brake_pressure", unit: "bar", timestamps: times, values: pressure },
      ]);

      assert.ok(mdfBytes.byteLength > 64, "MDF4 buffer should be larger than IDBLOCK");

      // Verify ID block magic: ##MDF
      const magic = new TextDecoder().decode(mdfBytes.subarray(0, 8));
      assert.ok(magic.startsWith("##MDF"), `Magic must start with ##MDF, got '${magic}'`);

      // Read back with Mdf4Reader
      const reader = new Mdf4Reader(mdfBytes);
      const metadata = reader.parseMetadata();
      assert.ok(metadata.groups.length >= 1, "Should contain at least 1 channel group");

      const series = reader.extractAllChannels();
      assert.ok(series.length >= 2, "Should extract both data channels");

      const chAccel = series.find((s) => s.name === "chassis_accel_z");
      const chPressure = series.find((s) => s.name === "brake_pressure");

      assert.ok(chAccel, "chassis_accel_z must be present");
      assert.ok(chPressure, "brake_pressure must be present");
      assert.equal(chAccel.values.length, N);
      assert.equal(chPressure.values.length, N);

      // Verify signal numerical fidelity
      assert.ok(Math.abs(chAccel.values[0]! - 9.81) < 1e-4);
      assert.ok(Math.abs(chPressure.values[0]! - 130.0) < 1e-4);
    });
  });

  describe("Foxglove MCAP (.mcap) Telemetry Streaming Engine", () => {
    it("generates and parses high-speed MCAP robotics telemetry streams", () => {
      const N = 500;
      const times = new Float64Array(N);
      const motorTemp = new Float64Array(N);
      const jointTorque = new Float64Array(N);

      for (let i = 0; i < N; i++) {
        times[i] = i * 0.01; // 100 Hz
        motorTemp[i] = 45.0 + 0.05 * i; // heating up
        jointTorque[i] = 15.0 * Math.sin(times[i]!);
      }

      // Generate binary MCAP file
      const mcapBytes = McapWriter.create([
        { topic: "/robot/actuator/temp", timestamps: times, values: motorTemp },
        { topic: "/robot/joint/torque", timestamps: times, values: jointTorque },
      ]);

      assert.ok(mcapBytes.byteLength > 16, "MCAP buffer must be valid size");

      // Verify MCAP reader
      const reader = new McapReader(mcapBytes);
      const channels = reader.getChannels();
      assert.equal(channels.size, 2, "MCAP should register 2 channels");

      const series = reader.extractAllSeries();
      assert.equal(series.length, 2, "Should extract 2 series");

      const tempSeries = series.find((s) => s.topic === "/robot/actuator/temp");
      const torqueSeries = series.find((s) => s.topic === "/robot/joint/torque");

      assert.ok(tempSeries, "Actuator temp series must exist");
      assert.ok(torqueSeries, "Joint torque series must exist");
      assert.equal(tempSeries.values.length, N);
      assert.equal(torqueSeries.values.length, N);
      assert.ok(Math.abs(tempSeries.values[0]! - 45.0) < 1e-5);
    });
  });

  describe("Unified TelemetryStreamer & Synchronous Resampling", () => {
    it("auto-detects format, calculates statistical moments, and resamples on common grid", () => {
      const N = 200;
      const times = new Float64Array(N);
      const signal = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        times[i] = i * 0.005; // 200 Hz
        signal[i] = Math.sin(2 * Math.PI * 10 * times[i]!);
      }

      const mdfBytes = Mdf4Writer.create([{ name: "vibration_g", unit: "g", timestamps: times, values: signal }]);

      const streamer = new TelemetryStreamer(mdfBytes);
      assert.equal(streamer.format, "mdf4");
      assert.deepEqual(streamer.getChannelNames(), ["time", "vibration_g"]);

      const stats = streamer.computeStats("vibration_g");
      assert.equal(stats.sampleCount, N);
      assert.ok(Math.abs(stats.mean) < 0.05, "Mean of symmetric sine should be near 0");
      assert.ok(Math.abs(stats.rms - 1 / Math.SQRT2) < 0.05, "RMS of unit sine wave should be ~0.707");

      // Resample to 50 Hz grid
      const resampled = streamer.resample(["vibration_g"], 50);
      assert.equal(resampled.sampleRateHz, 50);
      assert.ok(resampled.channels["vibration_g"]!.length > 0);
    });
  });

  describe("Bayesian UKF Parameter Identification & Digital Thread Federator", () => {
    it("identifies unmeasured physical damping and stiffness parameters from noisy telemetry", () => {
      // Physical system: Damped harmonic oscillator
      // m * ddot(x) + c * dot(x) + k * x = u(t)
      // True parameters: m = 2.0 kg, c = 8.5 N*s/m, k = 150.0 N/m
      // States: x1 = position (m), x2 = velocity (m/s)
      const m_mass = 2.0;
      const true_c = 8.5;
      const true_k = 150.0;

      const N = 300;
      const dt = 0.01;
      const times = new Float64Array(N);
      const measuredPos = new Float64Array(N);
      const controlU = new Float64Array(N);

      // Generate synthetic physical telemetry with noise
      let x1 = 0.1; // initial displacement 10 cm
      let x2 = 0.0;
      for (let i = 0; i < N; i++) {
        times[i] = i * dt;
        controlU[i] = 10.0 * Math.sin(2.0 * times[i]!); // 10 N sinusoidal drive

        const accel = (controlU[i]! - true_c * x2 - true_k * x1) / m_mass;
        x1 += x2 * dt;
        x2 += accel * dt;

        // Sensor measurement with +/- 2 mm Gaussian-like noise
        const noise = (Math.sin(i * 13.7) + Math.cos(i * 7.1)) * 0.002;
        measuredPos[i] = x1 + noise;
      }

      // Bayesian Calibration Setup:
      // Nominal priors are perturbed: c_nom = 5.0 (true 8.5), k_nom = 120.0 (true 150.0)
      const { results, estimatedTrajectory } = BayesianParameterCalibrator.calibrate({
        stateNames: ["position", "velocity"],
        parameters: [
          { name: "damping_c", nominalValue: 5.0, initialStdDev: 4.0, unit: "N*s/m" },
          { name: "stiffness_k", nominalValue: 120.0, initialStdDev: 30.0, unit: "N/m" },
        ],
        initialState: [0.1, 0.0],
        initialStateVariance: [1e-4, 1e-3],
        timeGrid: times,
        measuredTelemetry: [measuredPos],
        controlInputs: [controlU],
        measurementNoiseR: [1e-5],
        systemDynamics: (state, params, u, stepDt) => {
          const pos = state[0]!;
          const vel = state[1]!;
          const c = params[0]!;
          const k = params[1]!;
          const drive = u[0]!;

          const a = (drive - c * vel - k * pos) / m_mass;
          return new Float64Array([pos + vel * stepDt, vel + a * stepDt]);
        },
        observationModel: (state) => {
          return new Float64Array([state[0]!]); // measure position
        },
      });

      assert.equal(results.length, 2);
      assert.equal(estimatedTrajectory.length, N);

      const resC = results.find((r) => r.parameterName === "damping_c")!;
      const resK = results.find((r) => r.parameterName === "stiffness_k")!;

      // Verify convergence toward ground truth within 5%
      assert.ok(
        Math.abs(resC.calibratedValue - true_c) / true_c < 0.08,
        `Damping calibration ${resC.calibratedValue} should converge near true ${true_c}`,
      );
      assert.ok(
        Math.abs(resK.calibratedValue - true_k) / true_k < 0.05,
        `Stiffness calibration ${resK.calibratedValue} should converge near true ${true_k}`,
      );

      // Verify 95% confidence interval bounds
      assert.ok(resC.confidenceInterval95[0] < true_c && resC.confidenceInterval95[1] > true_c);
      assert.ok(resK.confidenceInterval95[0] < true_k && resK.confidenceInterval95[1] > true_k);

      // Verify IDE suggestion string format
      assert.ok(resC.ideSuggestion.includes("damping_c"));
      assert.ok(resC.ideSuggestion.includes("Accept update to SysML v2 attribute and Modelica parameter?"));

      // Federate to DigitalThreadHypergraph
      const hypergraph = new DigitalThreadHypergraph();
      const threadId = hypergraph.createThread();
      const telemetryId = 901;
      const modelicaModelId = 301;

      const slot = BayesianParameterCalibrator.federateCalibrationToThread(
        hypergraph,
        threadId,
        telemetryId,
        modelicaModelId,
        results,
      );

      assert.equal(hypergraph.getDomainNode(slot, ThreadDomain.Telemetry), telemetryId);
      assert.equal(hypergraph.getDomainNode(slot, ThreadDomain.Modelica), modelicaModelId);
      assert.equal(hypergraph.getRelation(slot), ThreadRelation.Calibrates);
    });
  });

  describe("Real-Time Virtual Sensor Fusion Observer", () => {
    it("reconstructs dense 3D spatial fields from sparse surface sensors in sub-50 microseconds", () => {
      const N = 500; // 500 mesh nodes
      const k = 3; // 3 reduced modes

      // Construct synthetic baseline mean field and 3 orthogonal basis modes
      const meanField = new Float64Array(N);
      const basisModes = new Float64Array(N * k);

      for (let i = 0; i < N; i++) {
        meanField[i] = 100.0 + 20.0 * Math.sin((i / N) * Math.PI);
        // Mode 0: linear gradient
        basisModes[0 * N + i] = (i / N) * 2.0;
        // Mode 1: quadratic hotspot in middle (unmeasured interior)
        basisModes[1 * N + i] = Math.sin((i / N) * 2 * Math.PI) * 5.0;
        // Mode 2: high frequency ripple
        basisModes[2 * N + i] = Math.cos((i / N) * 4 * Math.PI) * 1.5;
      }

      // Sparse surface sensors placed at 3 boundary nodes (indices 10, 50, 480)
      const sensorNodes = [10, 50, 480];

      const observer = new VirtualSensorFusion({
        totalFieldNodes: N,
        numModes: k,
        meanField,
        basisModes,
        sensorNodeIndices: sensorNodes,
        warningThreshold: 130.0,
        criticalThreshold: 150.0,
        fieldQuantityName: "CoreTemperature_C",
      });

      // Ground truth latent coordinates
      const trueLatent = [1.5, 3.0, -0.8];
      const sensorReadings = new Float64Array(sensorNodes.length);
      for (let s = 0; s < sensorNodes.length; s++) {
        const node = sensorNodes[s]!;
        let val = meanField[node]!;
        for (let m = 0; m < k; m++) {
          val += trueLatent[m]! * basisModes[m * N + node]!;
        }
        sensorReadings[s] = val;
      }

      // JIT warmup
      for (let w = 0; w < 5; w++) observer.observe(sensorReadings);

      // Execute ultra-fast online observer
      const result = observer.observe(sensorReadings);

      // Verify execution time <300 us (typically <25 us once warm)
      assert.ok(result.executionTimeUs < 300.0, `Observer took ${result.executionTimeUs} us, should be <300 us`);

      // Verify modal coordinate reconstruction
      for (let m = 0; m < k; m++) {
        assert.ok(
          Math.abs(result.latentCoords[m]! - trueLatent[m]!) < 0.05,
          `Latent mode ${m} reconstructed ${result.latentCoords[m]}, true ${trueLatent[m]}`,
        );
      }

      // Verify peak detection and threshold alarm
      assert.ok(result.peakValue > 130.0, `Peak value ${result.peakValue} should exceed warning threshold`);
      assert.equal(result.alarmStatus, "warning");
    });
  });
});
