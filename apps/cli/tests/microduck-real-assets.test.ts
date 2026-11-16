// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZip, generateFmu, generateFmuCSources } from "@modelscript/exchange";
import { initBltWasm } from "@modelscript/runtime";
import { importONNXToROM, SampledPolicyController, simulateArena, type PeriodicCallback } from "@modelscript/simulate";
import { coupleElectroThermalDrivetrains, lowerUrdfToDae, parseMjcf } from "@modelscript/urdf";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "microduck");
const MJCF_PATH = path.join(CACHE_DIR, "robot_groundcontact.xml");
const ONNX_PATH = path.join(CACHE_DIR, "velstand.onnx");
const HAS_REAL_ASSETS = fs.existsSync(MJCF_PATH) && fs.existsSync(ONNX_PATH);

describe("Real MicroDuck 14-DOF MJCF + velstand.onnx + Compiled C99 FMU Python Co-Sim", () => {
  it(
    "should ingest real 14-DOF robot_groundcontact.xml + velstand.onnx and simulate closed-loop 50 Hz control",
    { skip: !HAS_REAL_ASSETS },
    async () => {
      await initBltWasm();

      const mjcfXml = fs.readFileSync(MJCF_PATH, "utf-8");
      const robot = parseMjcf(mjcfXml);
      assert.equal(robot.name, "microduck");
      assert.equal(robot.links.size, 16);
      assert.equal(robot.actuators?.length, 14);

      // Lower 6-DOF floating base + 14 articulated joints + CRB/gravity + soft contact
      const dae = lowerUrdfToDae(robot, undefined, { initialBaseZ: 0.12 });
      const jointNames = Array.from(robot.joints.values())
        .filter((j) => j.type !== "fixed" && j.type !== "floating")
        .map((j) => j.name);
      assert.equal(jointNames.length, 14);

      coupleElectroThermalDrivetrains(
        dae,
        jointNames.map((jointName) => ({ jointName, kp: 0.589, kv: 0.03 })),
        { useBattery: true, useThermal: true, batteryVoc: 7.4, batteryRint: 0.07 },
      );

      // Decode real 776 KB velstand.onnx (61-dim obs -> 14-dim action, ELU hidden layers)
      const onnxBytes = new Uint8Array(fs.readFileSync(ONNX_PATH));
      const rom = importONNXToROM(onnxBytes);
      assert.equal(rom.inputNames.length, 61);
      assert.equal(rom.outputNames.length, 14);

      const policy = new SampledPolicyController(rom, {
        name: "velstand",
        samplePeriod: 0.02,
        commandDelay: 0.0225,
        actionScale: 0.5,
        actionOffset: 0.0,
      });

      const qIdxInStates = (name: string) => dae.getVarIdxByName(name);
      assert.notEqual(qIdxInStates(`${jointNames[0]!}.q`), -1);

      // Run 0.12s closed-loop 50 Hz RL policy step on the 14-DOF biped
      const stateIdxCache: number[] = [];
      const policyCb: PeriodicCallback = {
        type: "periodic",
        interval: 0.02,
        affect: (t, y, controls) => {
          const obs = new Array<number>(61).fill(0.0);
          // Populate IMU angular velocity, gravity projection, and 14 joint positions/velocities
          for (let i = 0; i < Math.min(14, y.length); i++) {
            obs[6 + i] = y[stateIdxCache[i] ?? i] ?? 0.0;
          }
          obs[3] = 0.3; // 0.3 m/s forward velocity command
          const cmd = policy.step(t, obs);
          for (let i = 0; i < jointNames.length; i++) {
            controls.reinit(`${jointNames[i]!}.q_target`, cmd[i] ?? 0.0);
          }
        },
      };

      const res = simulateArena(dae, {
        startTime: 0.0,
        stopTime: 0.12,
        step: 0.002,
        solver: "rk4",
        callbacks: [policyCb],
      });

      assert.ok(res.t.length >= 60, `Expected >=60 steps, got ${res.t.length}`);
      const zIdx =
        res.states.indexOf("head.z") !== -1 ? res.states.indexOf("head.z") : res.states.indexOf("trunk_base.z");
      const firstJointIdx = res.states.indexOf(`${jointNames[0]!}.q`);
      const firstTempIdx = res.states.indexOf(`${jointNames[0]!}.T_winding`);
      assert.notEqual(firstJointIdx, -1);
      assert.notEqual(firstTempIdx, -1);

      const finalQ = res.y[res.y.length - 1]![firstJointIdx]!;
      const finalTemp = res.y[res.y.length - 1]![firstTempIdx]!;
      assert.ok(Number.isFinite(finalQ) && Math.abs(finalQ) > 1e-4, `Expected 14-DOF joint motion, got ${finalQ}`);
      assert.ok(Number.isFinite(finalTemp) && finalTemp >= 298.15, `Expected finite servo temp, got ${finalTemp}`);
      if (zIdx !== -1) {
        assert.ok(Number.isFinite(res.y[res.y.length - 1]![zIdx]!));
      }
    },
  );

  it("should compile generated C99 DuckPlant.fmu into a shared library and step it from Python", async () => {
    await initBltWasm();

    // Build a compact 6-DOF + servo + thermal + battery plant and compile it to native .so + .fmu
    const miniMjcf = `
    <mujoco model="DuckPlant">
      <compiler angle="degree"/>
      <worldbody>
        <geom name="floor" type="plane" size="5 5 0.1"/>
        <body name="trunk" pos="0 0 0.12">
          <freejoint name="root"/>
          <inertial pos="0 0 0" mass="0.737" diaginertia="0.003 0.003 0.002"/>
          <geom name="sole" type="box" pos="0 0 -0.117" size="0.04 0.03 0.005" solref="0.02 1.0" solimp="0.9 0.95 0.001"/>
          <body name="hip" pos="0 0 -0.04">
            <joint name="hip_pitch" type="hinge" axis="0 1 0"/>
            <inertial pos="0 0 -0.03" mass="0.1" diaginertia="0.0005 0.0005 0.0002"/>
          </body>
        </body>
      </worldbody>
    </mujoco>`;

    const robot = parseMjcf(miniMjcf);
    const dae = lowerUrdfToDae(robot);
    coupleElectroThermalDrivetrains(dae, [{ jointName: "hip_pitch", kp: 1.0 }], {
      useBattery: true,
      useThermal: true,
    });

    const fmuOpts = { modelIdentifier: "DuckPlant", guid: "{aabbccdd-1122-3344-5566-778899aabbcc}" };
    const fmuResult = generateFmu(dae, fmuOpts);
    const cSources = generateFmuCSources(dae, fmuResult, fmuOpts);

    const buildDir = path.join(CACHE_DIR, "fmu_build");
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, "DuckPlant_model.h"), cSources.modelH);
    fs.writeFileSync(path.join(buildDir, "model.c"), cSources.modelC);
    fs.writeFileSync(path.join(buildDir, "fmi2Functions.c"), cSources.fmi2FunctionsC);

    // Compile standalone C99 FMU shared library
    const fmiIncludeDir = path.join(
      REPO_ROOT,
      "packages",
      "exchange",
      "validation",
      "fmi",
      "reference_fmus_repo",
      "include",
    );
    const soPath = path.join(buildDir, "DuckPlant.so");
    execFileSync(
      "gcc",
      [
        "-shared",
        "-fPIC",
        "-O2",
        "-I",
        buildDir,
        "-I",
        fmiIncludeDir,
        path.join(buildDir, "model.c"),
        path.join(buildDir, "fmi2Functions.c"),
        "-lm",
        "-o",
        soPath,
      ],
      { stdio: "pipe" },
    );
    assert.ok(fs.existsSync(soPath), "DuckPlant.so should be compiled");

    // Package valid .fmu ZIP archive
    const enc = new TextEncoder();
    const fmuZip = createZip(
      new Map<string, Uint8Array>([
        ["modelDescription.xml", enc.encode(fmuResult.modelDescriptionXml)],
        ["binaries/linux64/DuckPlant.so", new Uint8Array(fs.readFileSync(soPath))],
        ["sources/model.c", enc.encode(cSources.modelC)],
        ["sources/DuckPlant_model.h", enc.encode(cSources.modelH)],
      ]),
    );
    const fmuPath = path.join(buildDir, "DuckPlant.fmu");
    fs.writeFileSync(fmuPath, fmuZip);
    assert.ok(fmuZip.byteLength > 1024, "Expected valid DuckPlant.fmu ZIP archive");

    // Step compiled DuckPlant.so directly from Python 3 via ctypes FMI 2.0 ABI
    const pyScript = `
import ctypes, json

lib = ctypes.CDLL(${JSON.stringify(soPath)})
class Cb(ctypes.Structure):
    _fields_ = [("logger", ctypes.c_void_p), ("allocateMemory", ctypes.c_void_p), ("freeMemory", ctypes.c_void_p), ("stepFinished", ctypes.c_void_p), ("componentEnvironment", ctypes.c_void_p)]

c_double = ctypes.c_double
c_uint = ctypes.c_uint
c_int = ctypes.c_int
c_void_p = ctypes.c_void_p
c_char_p = ctypes.c_char_p

lib.fmi2Instantiate.restype = c_void_p
lib.fmi2Instantiate.argtypes = [c_char_p, c_int, c_char_p, c_char_p, ctypes.POINTER(Cb), c_int, c_int]
lib.fmi2SetupExperiment.argtypes = [c_void_p, c_int, c_double, c_double, c_int, c_double]
lib.fmi2EnterInitializationMode.argtypes = [c_void_p]
lib.fmi2ExitInitializationMode.argtypes = [c_void_p]
lib.fmi2DoStep.argtypes = [c_void_p, c_double, c_double, c_int]
lib.fmi2GetReal.argtypes = [c_void_p, ctypes.POINTER(c_uint), ctypes.c_size_t, ctypes.POINTER(c_double)]
lib.fmi2Terminate.argtypes = [c_void_p]
lib.fmi2FreeInstance.argtypes = [c_void_p]

cb = Cb(None, None, None, None, None)
comp = lib.fmi2Instantiate(b"duck", 1, b"{aabbccdd-1122-3344-5566-778899aabbcc}", b"file:///", ctypes.byref(cb), 0, 0)
assert comp, "fmi2Instantiate failed"
assert lib.fmi2SetupExperiment(comp, 0, 1e-6, 0.0, 1, 0.2) == 0
assert lib.fmi2EnterInitializationMode(comp) == 0
assert lib.fmi2ExitInitializationMode(comp) == 0

t = 0.0
dt = 0.002
for _ in range(50):
    assert lib.fmi2DoStep(comp, t, dt, 1) == 0
    t += dt

vrs = (c_uint * 1)(0)
vals = (c_double * 1)(0.0)
assert lib.fmi2GetReal(comp, vrs, 1, vals) == 0
lib.fmi2Terminate(comp)
lib.fmi2FreeInstance(comp)
print(json.dumps({"t": t, "vr0": vals[0]}))
`;
    const pyOut = execFileSync("python3", ["-c", pyScript], { encoding: "utf-8" });
    const parsed = JSON.parse(pyOut.trim()) as { t: number; vr0: number };
    assert.ok(Math.abs(parsed.t - 0.1) < 1e-9, `Expected t=0.1, got ${parsed.t}`);
    assert.ok(Number.isFinite(parsed.vr0), `Expected finite FMI output vr0, got ${parsed.vr0}`);
  });
});
