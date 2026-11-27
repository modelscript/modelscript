// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DebugProtocol } from "@vscode/debugprotocol";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";
import { defaultBasename, WasmSimulationStepper, type DapFileSystem } from "../src/dap/simulation-debug-session.js";
import { createVscodeDapFileSystem, ModelScriptDebugSession, SimulationDebugSession } from "../src/debug-adapter.js";

const THERMAL_MODEL_SOURCE = [
  "model ThermalMass",
  "  parameter Real tau = 2.0;",
  "  Real T(start = 100.0);",
  "  Real q;",
  "equation",
  "  der(T) = -T / tau;",
  "  q = 4.0 * T;",
  "end ThermalMass;",
].join("\n");

interface TestDebugSessionAccess {
  sendResponse: (response: DebugProtocol.Response) => void;
  sendEvent: (event: unknown) => void;
  launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments): Promise<void>;
  nextRequest(response: DebugProtocol.NextResponse): Promise<void>;
  stackTraceRequest(response: DebugProtocol.StackTraceResponse): void;
  variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void>;
}

describe("DAP DapFileSystem abstraction & browser decoupling", () => {
  it("keeps simulation-debug-session.ts free of static node:fs and node:path imports", () => {
    const srcPath = fileURLToPath(new URL("../src/dap/simulation-debug-session.ts", import.meta.url));
    const source = readFileSync(srcPath, "utf8");
    assert.equal(/^\s*import\s+[^;]*["']node:(?:fs|path)["']/m.test(source), false);
  });

  it("loads and steps a .mo model via a synchronous injected DapFileSystem without node:fs", () => {
    const readCalls: string[] = [];
    const memFs: DapFileSystem = {
      readFile: (uriOrPath: string) => {
        readCalls.push(uriOrPath);
        return uriOrPath === "memfs:/models/ThermalMass.mo" ? THERMAL_MODEL_SOURCE : "";
      },
      basename: (p: string) => defaultBasename(p),
    };

    const stepper = new WasmSimulationStepper("memfs:/models/ThermalMass.mo", 0.1, memFs);
    assert.deepEqual(readCalls, ["memfs:/models/ThermalMass.mo"]);
    assert.equal(stepper.loadedFromSource, true);
    assert.equal(stepper.modelName, "ThermalMass");
    assert.equal(stepper.stateValues.get("T"), 100.0);
    assert.equal(stepper.algebraicValues.get("q"), 400.0);

    const snap = stepper.step();
    assert.equal(snap.step, 1);
    assert.ok((snap.variables["T"] ?? 0) < 100.0 && (snap.variables["T"] ?? 0) > 90.0);
    assert.ok(Math.abs((snap.variables["q"] ?? 0) - 4.0 * (snap.variables["T"] ?? 0)) < 1e-6);
  });

  it("loads and steps a .mo model via an async injected DapFileSystem in SimulationDebugSession", async () => {
    const readCalls: string[] = [];
    const basenameCalls: string[] = [];
    const asyncFs: DapFileSystem = {
      readFile: async (uriOrPath: string) => {
        readCalls.push(uriOrPath);
        return uriOrPath === "memfs:/workspace/ThermalMass.mo" ? THERMAL_MODEL_SOURCE : "";
      },
      basename: (p: string) => {
        basenameCalls.push(p);
        return defaultBasename(p);
      },
    };

    assert.strictEqual(SimulationDebugSession, ModelScriptDebugSession);
    const session = new SimulationDebugSession(asyncFs);
    const access = session as unknown as TestDebugSessionAccess;
    access.sendResponse = () => {};
    access.sendEvent = () => {};

    const launchRes = {} as DebugProtocol.LaunchResponse;
    await access.launchRequest(launchRes, {
      program: "memfs:/workspace/ThermalMass.mo",
    } as DebugProtocol.LaunchRequestArguments);

    assert.deepEqual(readCalls, ["memfs:/workspace/ThermalMass.mo"]);
    assert.ok(session.stepper);
    assert.equal(session.stepper.loadedFromSource, true);
    assert.equal(session.stepper.modelName, "ThermalMass");
    assert.equal(session.stepper.stateValues.get("T"), 100.0);

    const stackRes = {} as DebugProtocol.StackTraceResponse;
    access.stackTraceRequest(stackRes);
    assert.equal(stackRes.body?.stackFrames[0]?.source?.name, "ThermalMass.mo");
    assert.ok(basenameCalls.length >= 1);

    const nextRes = {} as DebugProtocol.NextResponse;
    await access.nextRequest(nextRes);
    assert.equal(session.stepper.stepCount, 1);
    assert.ok((session.stepper.stateValues.get("T") ?? 0) < 100.0);
  });

  it("reads memfs:// workspace files via createVscodeDapFileSystem()", async () => {
    const originalReadFile = vscode.workspace.fs.readFile;
    const seenUris: string[] = [];
    const mutableFs = vscode.workspace.fs as { readFile: typeof originalReadFile };
    mutableFs.readFile = async (uri: vscode.Uri) => {
      seenUris.push(uri.toString());
      return new TextEncoder().encode(THERMAL_MODEL_SOURCE);
    };

    try {
      const dapFs = createVscodeDapFileSystem();
      const text = await dapFs.readFile("memfs:/browser/ThermalMass.mo");
      assert.equal(text, THERMAL_MODEL_SOURCE);
      assert.equal(seenUris.length, 1);
      assert.ok(seenUris[0]!.startsWith("memfs:"));
      assert.equal(dapFs.basename("memfs:/browser/ThermalMass.mo"), "ThermalMass.mo");
    } finally {
      mutableFs.readFile = originalReadFile;
    }
  });
});
