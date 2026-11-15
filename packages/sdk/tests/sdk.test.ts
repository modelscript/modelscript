// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateSysmlDefinition, parseSysmlDefinitions } from "@modelscript/sysml2";
import assert from "node:assert/strict";
import test from "node:test";
import {
  addGaussianNoise,
  chirpSignal,
  clearCompileCache,
  clearTsCompileCache,
  compileAssemblyScript,
  compileTypeScript,
  discoverImplementationForDefinition,
  hannWindow,
  histogram,
  inferKernelScheme,
  integrateTrapezoidal,
  mean,
  nelderMead,
  parseComtradeAscii,
  parseDelimitedTable,
  parseImplementationUri,
  quantile,
  resampleUniform,
  rfft,
  runTsKernel,
  runWasmKernel,
  sineSignal,
  stepResponseMetrics,
  stepSignal,
} from "../src/index.js";

test("parseImplementationUri parses wasm://, ts://, and sysml:// bindings", () => {
  const ref = parseImplementationUri('"wasm://./assembly/fitter.ts#fitWideband"');
  assert.deepEqual(ref, {
    scheme: "wasm",
    modulePath: "./assembly/fitter.ts",
    exportName: "fitWideband",
  });
});

test("runWasmKernel executes a compiled WASM module export", async () => {
  // Minimal valid WASM module exporting `checkMargin(a: f64, b: f64): f64 => a - b`
  const wasm = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7c, 0x7c, 0x01, 0x7c, 0x03, 0x02,
    0x01, 0x00, 0x07, 0x0f, 0x01, 0x0b, 0x63, 0x68, 0x65, 0x63, 0x6b, 0x4d, 0x61, 0x72, 0x67, 0x69, 0x6e, 0x00, 0x00,
    0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0xa1, 0x0b,
  ]);

  const res = await runWasmKernel(wasm, "checkMargin", {
    definitionName: "MarginCheck",
    parameters: { actual: 3.2, limit: 2.0 },
  });

  assert.equal(res.ok, true);
  assert.ok(Math.abs(Number(res.parameters?.result) - 1.2) < 1e-9);
});

test("compileAssemblyScript compiles user AS source importing @modelscript/sdk/assembly and runs in WASM", async () => {
  const userSource = `
    import { rmse } from "@modelscript/sdk/assembly";

    export function evaluateRmse(a0: f64, a1: f64, r0: f64, r1: f64): f64 {
      const actual = new Float64Array(2);
      actual[0] = a0;
      actual[1] = a1;
      const ref = new Float64Array(2);
      ref[0] = r0;
      ref[1] = r1;
      return rmse(actual, ref);
    }
  `;

  const compiled = await compileAssemblyScript("./assembly/custom.ts", {
    "assembly/custom.ts": userSource,
  });

  assert.equal(compiled.ok, true, compiled.diagnostics.join("\n"));
  assert.ok(compiled.wasmBytes && compiled.wasmBytes.length > 0);

  const res = await runWasmKernel(compiled.wasmBytes, "evaluateRmse", {
    definitionName: "RmseCheck",
    parameters: { a0: 1.0, a1: 2.0, r0: 1.0, r1: 5.0 },
  });
  assert.ok(Math.abs(Number(res.parameters?.result) - Math.SQRT2 * 1.5) < 1e-9);
});

test("AssemblyScript msx_run_json emits structured VisualArtifact timeseries via SDK helpers", async () => {
  const userSource = `
    import {
      decodeUtf8,
      kernelResultJson,
      msx_alloc,
      plotSeriesJson,
      returnJsonResult,
    } from "@modelscript/sdk/assembly";

    export { msx_alloc };

    export function msx_run_json(expPtr: usize, expLen: i32, _inPtr: usize, _inLen: i32): u64 {
      const fnName = decodeUtf8(expPtr, expLen);
      const t = new Float64Array(3);
      t[0] = 0.0;
      t[1] = 0.5;
      t[2] = 1.0;
      const y = new Float64Array(3);
      y[0] = 1.0;
      y[1] = 0.8;
      y[2] = 0.95;

      const plot = plotSeriesJson("timeseries", "v-poi", "POI Voltage", "t (s)", "V (pu)", "Measured", t, y);
      const json = kernelResultJson(true, fnName, "Emitted POI timeseries", [plot]);
      return returnJsonResult(json);
    }
  `;

  const compiled = await compileAssemblyScript("./assembly/plotter.ts", {
    "assembly/plotter.ts": userSource,
  });

  assert.equal(compiled.ok, true, compiled.diagnostics.join("\n"));
  assert.ok(compiled.wasmBytes);

  const res = await runWasmKernel(compiled.wasmBytes, "fitPoi", {
    definitionName: "PoiCheck",
    parameters: {},
  });

  assert.equal(res.ok, true);
  assert.equal(res.kernelId, "fitPoi");
  assert.equal(res.artifacts?.length, 1);
  assert.equal(res.artifacts?.[0]?.kind, "timeseries");
  if (res.artifacts?.[0]?.kind === "timeseries") {
    assert.deepEqual(res.artifacts[0].series[0]?.x, [0, 0.5, 1]);
    assert.deepEqual(res.artifacts[0].series[0]?.y, [1, 0.8, 0.95]);
  }
});

test("parseSysmlDefinitions & evaluateSysmlDefinition parse constraints and wasm:// bindings", () => {
  const sysml = `
    package UserPack {
      verification def CustomFitter {
        attribute standard = "USER-FIT";
        attribute implementation = "wasm://./assembly/fitter.ts#fitWideband";
        require constraint { rmse <= 0.05 }
      }
    }
  `;

  const pkg = parseSysmlDefinitions(sysml);
  assert.equal(pkg.packageName, "UserPack");
  assert.equal(pkg.definitions.length, 1);
  const def = pkg.definitions[0]!;
  assert.deepEqual(def.implementation, {
    scheme: "wasm",
    modulePath: "./assembly/fitter.ts",
    exportName: "fitWideband",
  });

  assert.equal(evaluateSysmlDefinition(def, { rmse: 0.03 }).passed, true);
  assert.equal(evaluateSysmlDefinition(def, { rmse: 0.08 }).passed, false);
});

test("compileAssemblyScript caches compiled WASM by content hash", async () => {
  clearCompileCache();
  const files = {
    "assembly/add.ts": "export function add(a: f64, b: f64): f64 { return a + b; }",
  };

  const first = await compileAssemblyScript("./assembly/add.ts", files);
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);

  const second = await compileAssemblyScript("./assembly/add.ts", files);
  assert.equal(second.ok, true);
  assert.equal(second.cached, true);
  assert.deepEqual(second.wasmBytes, first.wasmBytes);

  clearCompileCache();
  const third = await compileAssemblyScript("./assembly/add.ts", files);
  assert.equal(third.ok, true);
  assert.equal(third.cached, false);
});

test("evaluateSysmlDefinition supports compound arithmetic, assume vacuity, and quantitative margins", () => {
  const sysml = `
    package GridStudy {
      verification def CompoundMarginCheck {
        attribute limit = 0.05;
        assume constraint { isIbr == 1 }
        require constraint { rmse <= limit and scr >= 2.0 }
      }
    }
  `;

  const pkg = parseSysmlDefinitions(sysml);
  const def = pkg.definitions[0]!;

  // Assumption false -> vacuously satisfied
  const vac = evaluateSysmlDefinition(def, { isIbr: 0, rmse: 0.99, scr: 0.5 });
  assert.equal(vac.passed, true);
  assert.equal(vac.checks[0]?.vacuous, true);

  // Assumption true, constraints satisfied with positive margin
  const ok = evaluateSysmlDefinition(def, { isIbr: 1, rmse: 0.03, scr: 2.5 });
  assert.equal(ok.passed, true);
  assert.equal(ok.checks[0]?.vacuous, false);
  assert.ok(ok.minMargin > 0);

  // Assumption true, SCR violated -> fails with negative margin
  const fail = evaluateSysmlDefinition(def, { isIbr: 1, rmse: 0.03, scr: 1.4 });
  assert.equal(fail.passed, false);
  assert.ok(fail.minMargin < 0);
});

test("zero-copy Float64Array waveform ABI marshals 10k samples in and out of WASM linear memory", async () => {
  const userSource = `
    import {
      allocF64,
      decodeUtf8,
      kernelResultJson,
      loadF64,
      msx_alloc,
      plotSeriesRefJson,
      returnJsonResult,
      storeF64,
    } from "@modelscript/sdk/assembly";

    export { msx_alloc };

    function parseUnsignedInt(s: string): i32 {
      return I32.parseInt(s);
    }

    // Minimal field extractor for {"waveformPtrs":{"v":{"xPtr":...,"yPtr":...,"len":...}}}
    function extractIntField(json: string, key: string): i32 {
      const needle = '"' + key + '":';
      const idx = json.indexOf(needle);
      if (idx < 0) return 0;
      let start = idx + needle.length;
      let end = start;
      while (end < json.length) {
        const c = json.charCodeAt(end);
        if (c < 48 || c > 57) break;
        end++;
      }
      return parseUnsignedInt(json.slice(start, end));
    }

    export function msx_run_json(_expPtr: usize, _expLen: i32, inPtr: usize, inLen: i32): u64 {
      const inputJson = decodeUtf8(inPtr, inLen);
      const xPtr = extractIntField(inputJson, "xPtr") as usize;
      const yPtr = extractIntField(inputJson, "yPtr") as usize;
      const len = extractIntField(inputJson, "len");

      const outYPtr = allocF64(len);
      for (let i = 0; i < len; i++) {
        storeF64(outYPtr, i, loadF64(yPtr, i) * 2.0);
      }

      const plot = plotSeriesRefJson("timeseries", "scaled", "Scaled Waveform", "t", "V", "2x", xPtr, outYPtr, len);
      return returnJsonResult(kernelResultJson(true, "scaleWaveform", "Zero-copy 10k points", [plot]));
    }
  `;

  const compiled = await compileAssemblyScript("./assembly/waveform.ts", {
    "assembly/waveform.ts": userSource,
  });
  assert.equal(compiled.ok, true, compiled.diagnostics.join("\n"));

  const n = 10_000;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i * 0.0001;
    y[i] = Math.sin(i * 0.01);
  }

  const res = await runWasmKernel(compiled.wasmBytes!, "scaleWaveform", {
    definitionName: "Scale10k",
    parameters: {},
    waveforms: { v: { x, y } },
  });

  assert.equal(res.ok, true);
  assert.equal(res.artifacts?.[0]?.kind, "timeseries");
  if (res.artifacts?.[0]?.kind === "timeseries") {
    const series = res.artifacts[0].series[0]!;
    assert.equal(series.x.length, n);
    assert.equal(series.y.length, n);
    assert.ok(Math.abs(series.y[1234]! - y[1234]! * 2.0) < 1e-12);
  }
});

test("parseSysmlDefinitions ignores comments with braces and :> specializations", () => {
  const sysml = `
    package CommentTest {
      // comment with { unmatched braces }
      /* block comment { with } braces */
      verification def ChildCheck :> BaseCheck {
        attribute note = "hello { world }";
        require constraint { x <= 10 }
      }
    }
  `;
  const pkg = parseSysmlDefinitions(sysml);
  assert.equal(pkg.definitions.length, 1);
  assert.equal(pkg.definitions[0]?.name, "ChildCheck");
  assert.equal(pkg.definitions[0]?.attributes["note"], "hello { world }");
  assert.equal(evaluateSysmlDefinition(pkg.definitions[0]!, { x: 5 }).passed, true);
});

test("E2E: packages/examples/sysml-wasm-pack compiles, analyzes step waveform, and passes SysML constraints", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const packDir = path.resolve(import.meta.dirname, "../../examples/sysml-wasm-pack");
  const sysmlSource = fs.readFileSync(path.join(packDir, "src/system.sysml"), "utf8");
  const analyzerSource = fs.readFileSync(path.join(packDir, "assembly/analyzer.ts"), "utf8");

  const pkg = parseSysmlDefinitions(sysmlSource);
  const def = pkg.definitions[0]!;
  assert.equal(def.name, "StepResponseCheck");
  assert.equal(def.implementation?.scheme, "wasm");

  const compiled = await compileAssemblyScript(def.implementation!.modulePath, {
    "assembly/analyzer.ts": analyzerSource,
  });
  assert.equal(compiled.ok, true, compiled.diagnostics.join("\n"));

  // Feed synthetic step response 1 - exp(-t/0.2) over 0..1s
  const n = 50;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 1.0;
    tx[i] = t;
    ty[i] = 1.0 - Math.exp(-t / 0.2);
  }

  const res = await runWasmKernel(
    compiled.wasmBytes!,
    def.implementation!.exportName,
    {
      definitionName: def.name,
      packageName: pkg.packageName,
      parameters: {},
      waveforms: { y: { x: tx, y: ty } },
    },
    { timeoutMs: 5000 },
  );

  assert.equal(res.ok, true);
  assert.equal(res.artifacts?.[0]?.kind, "timeseries");
  const evalRes = evaluateSysmlDefinition(def, res.parameters ?? {});
  assert.equal(evalRes.passed, true);
  assert.ok(evalRes.minMargin > 0);
});

test("runWasmKernel preemptively terminates synchronous infinite loops in Worker", async () => {
  const compiled = await compileAssemblyScript("./assembly/hang.ts", {
    "assembly/hang.ts": "export function hang(): f64 { while (true) {} return 0.0; }",
  });
  assert.equal(compiled.ok, true);

  await assert.rejects(
    () =>
      runWasmKernel(
        compiled.wasmBytes!,
        "hang",
        { definitionName: "HangCheck", parameters: {} },
        { timeoutMs: 150, preemptible: true },
      ),
    /timed out after 150ms/,
  );
});

test("dsp helpers compute stepResponseMetrics, resampleUniform, and mean", () => {
  const { x, y } = resampleUniform([0, 1, 2], [0, 1, 1], 0.5);
  assert.deepEqual(x, [0, 0.5, 1, 1.5, 2]);
  assert.deepEqual(y, [0, 0.5, 1, 1, 1]);
  assert.ok(Math.abs(mean([2, 4, 6]) - 4) < 1e-12);

  const metrics = stepResponseMetrics([0, 0.1, 0.2, 0.5, 1.0], [0, 0.2, 1.1, 1.02, 1.0], 1.0);
  assert.ok(Math.abs(metrics.overshootPct - 10) < 1e-9);
  assert.ok(metrics.riseTime > 0);
  assert.ok(Math.abs(metrics.steadyStateError) < 1e-9);
});

test("compileTypeScript caches results and runTsKernel executes ts:// multi-file kernels with @modelscript/sdk in Worker", async () => {
  clearTsCompileCache();
  const files = {
    "src/helper.ts": `
      export function scaleFactor(k: number): number {
        return k * 2;
      }
    `,
    "src/analyze.ts": `
      import { ResultBuilder, stepResponseMetrics, type KernelInput } from "@modelscript/sdk";
      import { scaleFactor } from "./helper";

      export async function checkStep(input: KernelInput) {
        const gain = Number(input.parameters.gain ?? 1);
        const wf = input.waveforms?.step;
        const m = stepResponseMetrics(wf?.x ?? [], wf?.y ?? [], 1.0);
        return new ResultBuilder("checkStep")
          .metric("overshootPct", m.overshootPct)
          .metric("scaledGain", scaleFactor(gain))
          .timeSeries("step-plot", "Step Response", "t (s)", "y", [
            { name: "y", x: Array.from(wf?.x ?? []), y: Array.from(wf?.y ?? []) },
          ])
          .summary("Checked step response")
          .build();
      }
    `,
  };

  const c1 = compileTypeScript("src/analyze.ts", files);
  const c2 = compileTypeScript("src/analyze.ts", files);
  assert.equal(c1.ok, true);
  assert.equal(c1.cacheHit, false);
  assert.equal(c2.cacheHit, true);

  const res = await runTsKernel(
    "src/analyze.ts",
    files,
    "checkStep",
    {
      definitionName: "TsStepCheck",
      parameters: { gain: 3 },
      waveforms: {
        step: {
          x: new Float64Array([0, 0.1, 0.2, 0.5, 1.0]),
          y: new Float64Array([0, 0.25, 1.05, 1.0, 1.0]),
        },
      },
    },
    { timeoutMs: 5000, preemptible: true },
  );

  assert.equal(res.ok, true);
  assert.equal(res.kernelId, "checkStep");
  assert.equal(res.parameters?.scaledGain, 6);
  assert.ok(Math.abs(Number(res.parameters?.overshootPct) - 5) < 1e-9);
  assert.equal(res.artifacts?.[0]?.kind, "timeseries");
});

test("runTsKernel preemptively terminates synchronous infinite loops in Worker", async () => {
  await assert.rejects(
    () =>
      runTsKernel(
        "src/hang.ts",
        {
          "src/hang.ts": "export function hang() { while (true) {} }",
        },
        "hang",
        { definitionName: "TsHangCheck", parameters: {} },
        { timeoutMs: 150, preemptible: true },
      ),
    /exceeded timeout of 150ms/,
  );
});

test("AssemblyScript SDK getParamF64, getParamBool, and getParamString extract typed inputs", async () => {
  const compiled = await compileAssemblyScript("./assembly/params.ts", {
    "assembly/params.ts": `
      import {
        decodeUtf8,
        getParamBool,
        getParamF64,
        getParamString,
        kernelResultJson,
        msx_alloc,
        returnJsonResult,
      } from "@modelscript/sdk/assembly";

      export { msx_alloc };

      export function msx_run_json(_ePtr: usize, _eLen: i32, inPtr: usize, inLen: i32): u64 {
        const json = decodeUtf8(inPtr, inLen);
        const gain = getParamF64(json, "gain", 1.0);
        const enabled = getParamBool(json, "enabled", false);
        const mode = getParamString(json, "mode", "none");
        const ok = enabled && gain > 2.0 && mode == "fast";
        return returnJsonResult(kernelResultJson(ok, "paramsCheck", mode + ":" + gain.toString(), []));
      }
    `,
  });
  assert.equal(compiled.ok, true, compiled.diagnostics.join("\n"));

  const res = await runWasmKernel(
    compiled.wasmBytes!,
    "msx_run_json",
    {
      definitionName: "ParamsCheck",
      parameters: { gain: 3.5, enabled: true, mode: "fast" },
    },
    { timeoutMs: 5000 },
  );
  assert.equal(res.ok, true);
  assert.equal(res.summary, "fast:3.5");
});

test("rfft, integrateTrapezoidal, quantile, histogram, and nelderMead work accurately", () => {
  const n = 32;
  const signal = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 4 * i) / n));
  assert.equal(hannWindow(signal).length, n);

  const spec = rfft(signal);
  assert.equal(spec.fftSize, 32);
  // Bin 4 corresponds to 4 cycles across 32 samples with amplitude 1.0
  assert.ok((spec.magnitudes[4] ?? 0) > 0.99);

  assert.ok(Math.abs(integrateTrapezoidal([0, 1, 2], [0, 2, 4]) - 4) < 1e-12);
  assert.ok(Math.abs(quantile([10, 20, 30, 40], 0.5) - 25) < 1e-12);
  const hist = histogram([1, 2, 2, 8, 9], 2);
  assert.deepEqual(hist.counts, [3, 2]);

  const opt = nelderMead(([x, y]) => (x - 3) ** 2 + (y + 2) ** 2, [0, 0], { tolerance: 1e-8 });
  assert.equal(opt.converged, true);
  assert.ok(Math.abs((opt.x[0] ?? 0) - 3) < 1e-3);
  assert.ok(Math.abs((opt.x[1] ?? 0) + 2) < 1e-3);
});

test("runTsKernel supports closed-loop KernelContext RPC (readFile, simulate, progress) and kpi-cards/markdown", async () => {
  const progressEvents: Array<{ pct: number; msg?: string }> = [];
  const res = await runTsKernel(
    "src/sweep.ts",
    {
      "src/sweep.ts": `
        import { ResultBuilder, type KernelContext, type KernelInput } from "@modelscript/sdk";

        export async function runSweep(input: KernelInput, ctx: KernelContext) {
          ctx.progress(10, "Reading config");
          const cfg = JSON.parse(await ctx.readFile("config.json"));
          ctx.progress(50, "Simulating");
          const wf = await ctx.simulate("src/plant.mo", { parameters: { K: cfg.gain } });
          const finalVal = wf.y?.y[wf.y.y.length - 1] ?? 0;
          ctx.progress(100, "Done");
          return new ResultBuilder("runSweep")
            .metric("finalVal", finalVal)
            .kpiCards("kpis", "Sweep KPIs", [
              { label: "Final Value", value: finalVal, unit: "V", status: "pass" },
            ])
            .markdown("notes", "Methodology", "Closed-loop sweep via KernelContext RPC.")
            .histogram("dist", "Sample Distribution", "Value", "Count", [1, 2], [3, 4])
            .summary("Sweep completed")
            .build();
        }
      `,
    },
    "runSweep",
    { definitionName: "SweepCheck", parameters: {} },
    {
      timeoutMs: 5000,
      preemptible: true,
      host: {
        readFile: (relPath) => {
          assert.equal(relPath, "config.json");
          return JSON.stringify({ gain: 2.5 });
        },
        simulate: async (_modelPath, opts) => {
          const k = Number(opts?.parameters?.["K"] ?? 1);
          return { y: { x: [0, 1], y: [0, k] } };
        },
        onProgress: (pct, msg) => progressEvents.push({ pct, msg }),
      },
    },
  );

  assert.equal(res.ok, true);
  assert.equal(res.parameters?.["finalVal"], 2.5);
  assert.equal(
    res.artifacts?.some((a) => a.kind === "kpi-cards"),
    true,
  );
  assert.equal(
    res.artifacts?.some((a) => a.kind === "markdown"),
    true,
  );
  assert.equal(
    res.artifacts?.some((a) => a.kind === "histogram"),
    true,
  );
  assert.equal(progressEvents.length, 3);
  assert.equal(progressEvents[2]?.pct, 100);
});

test("synthetic signal generators produce valid waveforms for unit testing", () => {
  const step = stepSignal({ duration: 1.0, dt: 0.01, finalValue: 2.0, tau: 0.1, overshoot: 0.2 });
  assert.equal(step.x.length, 101);
  const m = stepResponseMetrics(step.x, step.y, 2.0);
  assert.ok(m.overshootPct > 0);

  const sine = sineSignal({ freqHz: 100, duration: 0.1, sampleRateHz: 1000 });
  assert.equal(sine.x.length, 100);

  const chirp = chirpSignal({ f0Hz: 5, f1Hz: 50, duration: 0.5, sampleRateHz: 500 });
  assert.equal(chirp.x.length, 250);

  const noisy = addGaussianNoise(sine, 0.05, 42);
  assert.equal(noisy.y.length, sine.y.length);
  assert.notEqual(noisy.y[0], sine.y[0]);
});

test("implicit linking resolves scheme-less paths and discovers @sysml or naming-convention kernels", () => {
  const asRef = parseImplementationUri('"./assembly/analyzer.ts#analyzeStep"');
  assert.deepEqual(asRef, {
    scheme: "wasm",
    modulePath: "./assembly/analyzer.ts",
    exportName: "analyzeStep",
  });

  const tsRef = parseImplementationUri('"./src/ts-analyzer.ts#analyzeSpectrum"');
  assert.deepEqual(tsRef, {
    scheme: "ts",
    modulePath: "./src/ts-analyzer.ts",
    exportName: "analyzeSpectrum",
  });

  // Import-based inference even outside assembly/
  const files = {
    "kernels/fast.ts": `
      import { msx_alloc } from "@modelscript/sdk/assembly";
      /** @sysml FastCheck */
      export function runFast() {}
    `,
    "src/auditor.ts": `
      import { ResultBuilder } from "@modelscript/sdk";
      export function stepResponseCheck() {}
    `,
  };
  assert.equal(inferKernelScheme("kernels/fast.ts", files), "wasm");
  assert.deepEqual(discoverImplementationForDefinition("FastCheck", files), {
    scheme: "wasm",
    modulePath: "kernels/fast.ts",
    exportName: "runFast",
  });
  assert.deepEqual(discoverImplementationForDefinition("StepResponseCheck", files), {
    scheme: "ts",
    modulePath: "src/auditor.ts",
    exportName: "stepResponseCheck",
  });
});

test("parseDelimitedTable and parseComtradeAscii parse engineering profiles and C37.111 records", () => {
  const table = parseDelimitedTable("# t  v\n0.0 1.00\n0.5 0.92\n1.0 0.98", { hasHeader: false });
  assert.deepEqual(table.columns["col0"], [0, 0.5, 1]);
  assert.deepEqual(table.columns["col1"], [1, 0.92, 0.98]);

  const cfg = [
    "SubstationA,Relay1,1999",
    "1,1A,0D",
    "1,VA,A,,kV,0.1,0.0,0,-100,100,1,1,P",
    "60",
    "1",
    "1000,2",
    "01/01/2026,00:00:00.000000",
    "01/01/2026,00:00:00.000000",
    "ASCII",
    "1",
  ].join("\n");
  const dat = "1,0,100\n2,1000,150";

  const comtrade = parseComtradeAscii(cfg, dat);
  assert.equal(comtrade.stationName, "SubstationA");
  assert.equal(comtrade.sampleRateHz, 1000);
  assert.deepEqual(comtrade.time, [0, 0.001]);
  assert.deepEqual(comtrade.channels["VA"]?.values, [10, 15]);
});
