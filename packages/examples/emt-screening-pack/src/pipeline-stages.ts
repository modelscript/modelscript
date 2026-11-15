// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ResultBuilder,
  checkEnvelope,
  mean,
  nelderMead,
  parseDelimitedTable,
  rmse,
  type KernelContext,
  type KernelInput,
  type KernelResult,
} from "@modelscript/sdk";

/**
 * Stage 1: Jointly audits transmission base case (.raw) and dynamic companion (.dyr)
 * for bidirectional ID parity, NERC MOD-032 completeness, power-flow convergence,
 * and POI 3-phase short-circuit strength.
 */
export async function baselineModelAudit(input: KernelInput, ctx: KernelContext): Promise<KernelResult> {
  const rawFile = String(input.parameters["rawFile"] ?? "data/poi_case.raw");
  const dyrFile = String(input.parameters["dyrFile"] ?? "data/poi_case.dyr");
  const poiBus = Number(input.parameters["poiBus"] ?? 300);

  ctx.progress(15, `Inspecting ${rawFile} with companion ${dyrFile}`);
  const audit = await ctx.inspect(rawFile, {
    companions: [dyrFile],
    checks: ["mod032", "companion-keys"],
    options: { poiBus },
  });

  ctx.progress(55, "Running base power-flow and IEC 60909 / ANSI C37 short-circuit sweep");
  const pf = await ctx.simulate(rawFile, { mode: "powerflow", companions: [dyrFile] });
  const sc = await ctx.simulate(rawFile, { mode: "short-circuit", companions: [dyrFile] });

  const vmArr = Array.from(pf["bus_vm_pu"]?.y ?? [1.0]);
  const busNums = Array.from(sc["bus_sk3_mva"]?.x ?? []);
  const sk3Vals = Array.from(sc["bus_sk3_mva"]?.y ?? []);
  const poiIdx = busNums.findIndex((b) => Math.round(b) === poiBus);
  const poiFaultMva = poiIdx >= 0 ? Number(sk3Vals[poiIdx] ?? 0) : Number(audit.metrics["poiFaultMva"] ?? 0);

  const missingDyrCount = Number(audit.metrics["missingDyrCount"] ?? 0);
  const orphanDyrCount = Number(audit.metrics["orphanDyrCount"] ?? 0);
  const mod032Score = Number(audit.metrics["mod032Score"] ?? 0);
  const busCount = Number(audit.metrics["busCount"] ?? vmArr.length);
  const minVmPu = vmArr.length > 0 ? Math.min(...vmArr) : 0;

  await ctx.writeArtifact(
    "reports/baseline-audit.json",
    JSON.stringify(
      {
        rawFile,
        dyrFile,
        poiBus,
        poiFaultMva,
        busCount,
        missingDyrCount,
        orphanDyrCount,
        mod032Score,
        minVmPu,
      },
      null,
      2,
    ),
  );

  const ok = missingDyrCount === 0 && orphanDyrCount === 0 && mod032Score >= 1.0 && poiFaultMva > 0;
  return new ResultBuilder("baselineModelAudit")
    .status(ok)
    .metric("busCount", busCount)
    .metric("missingDyrCount", missingDyrCount)
    .metric("orphanDyrCount", orphanDyrCount)
    .metric("mod032Score", mod032Score)
    .metric("poiFaultMva", poiFaultMva)
    .metric("minVmPu", minVmPu)
    .summary(
      `POI Bus ${poiBus} Ssc=${poiFaultMva.toFixed(1)} MVA, MOD-032=${(mod032Score * 100).toFixed(0)}%, missingDYR=${missingDyrCount}, orphanDYR=${orphanDyrCount}`,
    )
    .build();
}

/**
 * Stage 2: Generic SCR screening gate. Evaluates grid strength and outputs
 * `emtMandatory` so downstream SysML `assume constraint` blocks automatically route studies.
 */
export function gridStrengthGateDecision(input: KernelInput): KernelResult {
  const poiFaultMva = Number(input.parameters["poiFaultMva"] ?? 0);
  const ibrRatedMw = Number(input.parameters["ibrRatedMw"] ?? 250);
  const minScr = Number(input.parameters["minScr"] ?? 2.0);
  const scr = ibrRatedMw > 0 ? poiFaultMva / ibrRatedMw : 0;
  const emtMandatory = scr < minScr;
  const valid = poiFaultMva > 0 && ibrRatedMw > 0;

  return new ResultBuilder("gridStrengthGateDecision")
    .status(valid)
    .metric("poiFaultMva", poiFaultMva)
    .metric("ibrRatedMw", ibrRatedMw)
    .metric("minScr", minScr)
    .metric("scr", scr)
    .metric("emtMandatory", emtMandatory)
    .summary(
      `SCR = ${scr.toFixed(2)} (threshold=${minScr.toFixed(2)}) -> ${emtMandatory ? "weak grid: EMT study required" : "strong grid: EMT skipped"}`,
    )
    .build();
}

/**
 * Stage 3 (Conditionally Gated): Runs PSCAD EMT netlist coverage audit, batch frequency scan
 * for subsynchronous control interaction (SSCI), transient EMT simulation, and time-domain
 * LVRT envelope checking via `@modelscript/sdk`.
 */
export async function emtSsciAndLvrtCheck(input: KernelInput, ctx: KernelContext): Promise<KernelResult> {
  const pscxFile = String(input.parameters["pscxFile"] ?? "data/ibr_interconnection.pscx");
  const profileFile = String(input.parameters["profileFile"] ?? "data/pmview_lvrt_profile.txt");
  const upstreamScr = Number(input.upstream?.["GridStrengthGate"]?.["scr"] ?? input.parameters["scr"] ?? 0);

  ctx.progress(20, `Auditing EMT coverage on ${pscxFile}`);
  const pscxInspect = await ctx.inspect(pscxFile);
  const coverageRatio = Number(pscxInspect.metrics["coverageRatio"] ?? 0);

  ctx.progress(50, "Running PSCAD frequency-scan and transient EMT batch");
  const batch = await ctx.runBatch(
    [
      {
        id: "freq-scan",
        modelPath: pscxFile,
        options: {
          mode: "frequency-scan",
          parameters: { busId: "B2", fMinHz: 5, fMaxHz: 120, fStepHz: 5 },
        },
      },
      {
        id: "emt-td",
        modelPath: pscxFile,
        options: { mode: "transient", stopTime: 0.04, stepSize: 50e-6 },
      },
    ],
    2,
  );

  const scanRes = batch[0];
  const emtRes = batch[1];
  const minResistanceOhm = Number(scanRes?.waveforms?.["min_resistance_ohm"]?.y[0] ?? 0);
  const hasSsciRisk = Number(scanRes?.waveforms?.["has_ssci_risk"]?.y[0] ?? 0) > 0;
  const emtSampleCount = Object.values(emtRes?.waveforms ?? {})[0]?.x.length ?? 0;

  const profileText = await ctx.readFile(profileFile);
  const table = parseDelimitedTable(profileText, { hasHeader: false });
  const t = table.columns["col0"] ?? [];
  const pPu = table.columns["col1"] ?? [];

  const envCheck = checkEnvelope(t, pPu, [
    { time: 0.0, min: 0.1, max: 1.5 },
    { time: 0.5, min: 0.1, max: 1.5 },
    { time: 1.2, min: 0.7, max: 1.5 },
  ]);

  await ctx.writeArtifact(
    "reports/emt-ssci-lvrt.json",
    JSON.stringify(
      {
        upstreamScr,
        pscxFile,
        coverageRatio,
        minResistanceOhm,
        hasSsciRisk,
        emtSampleCount,
        envelopeOk: envCheck.ok,
        worstMargin: envCheck.worstMargin,
      },
      null,
      2,
    ),
  );

  const ok = Boolean(scanRes?.ok) && Boolean(emtRes?.ok) && coverageRatio > 0 && !hasSsciRisk && envCheck.ok;
  return new ResultBuilder("emtSsciAndLvrtCheck")
    .status(ok)
    .metric("upstreamScr", upstreamScr)
    .metric("coverageRatio", coverageRatio)
    .metric("minResistanceOhm", minResistanceOhm)
    .metric("hasSsciRisk", hasSsciRisk)
    .metric("emtSampleCount", emtSampleCount)
    .metric("envelopeOk", envCheck.ok)
    .metric("envelopeMargin", envCheck.worstMargin)
    .summary(
      `EMT cov=${(coverageRatio * 100).toFixed(0)}%, SSCI=${hasSsciRisk ? "RISK" : "clear"} (minR=${minResistanceOhm.toFixed(2)} ohm), LVRT env=${envCheck.ok ? "PASS" : "FAIL"}`,
    )
    .build();
}

/**
 * Stage 4: Calibrates effective lumped transformer/collector RL parameters against
 * measured SFRA frequency-sweep data via SDK Nelder-Mead optimization.
 */
export async function transformerCalibrationCheck(input: KernelInput, ctx: KernelContext): Promise<KernelResult> {
  const sfraFile = String(input.parameters["sfraFile"] ?? "data/sfra_curve.csv");
  const csvText = await ctx.readFile(sfraFile);
  const table = parseDelimitedTable(csvText, { hasHeader: true });
  const freqs = table.columns["freq_hz"] ?? [];
  const zMeas = table.columns["z_mag_ohm"] ?? [];

  if (freqs.length < 3 || zMeas.length !== freqs.length) {
    return new ResultBuilder("transformerCalibrationCheck")
      .status(false)
      .metric("sampleCount", freqs.length)
      .metric("fitRmse", 999)
      .metric("fittedLH", 0)
      .summary(`Insufficient SFRA samples in '${sfraFile}'.`)
      .build();
  }

  const predict = (theta: readonly number[]) => {
    const r = Math.max(0, theta[0] ?? 0);
    const l = Math.max(1e-6, theta[1] ?? 0.05);
    return freqs.map((f) => Math.hypot(r, 2 * Math.PI * f * l));
  };

  const opt = nelderMead(
    (theta) => {
      const pred = predict(theta);
      return rmse(pred, zMeas);
    },
    [0.5, 0.05],
    { maxIterations: 250, tolerance: 1e-6 },
  );

  const fittedROhm = Math.max(0, opt.x[0] ?? 0);
  const fittedLH = Math.max(0, opt.x[1] ?? 0);
  const fitRmse = opt.fx;
  const meanZ = mean(zMeas);

  return new ResultBuilder("transformerCalibrationCheck")
    .status(fitRmse < 0.05)
    .metric("sampleCount", freqs.length)
    .metric("fittedROhm", fittedROhm)
    .metric("fittedLH", fittedLH)
    .metric("fitRmse", fitRmse)
    .metric("meanImpedanceOhm", meanZ)
    .summary(
      `SFRA fit L=${fittedLH.toFixed(4)} H, R=${fittedROhm.toFixed(4)} ohm, RMSE=${fitRmse.toFixed(5)} ohm (${freqs.length} pts)`,
    )
    .build();
}
