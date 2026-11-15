// SPDX-License-Identifier: AGPL-3.0-or-later

import { ResultBuilder, parseDelimitedTable, type KernelContext, type KernelInput } from "@modelscript/sdk";

/**
 * Grid strength gatekeeper: computes POI Short-Circuit Ratio (`SCR = Ssc / P_ibr`)
 * and flags when `SCR < minScr` (mandatory full EMT study per interconnection criteria).
 * @sysml GridStrengthGate
 */
export function checkGridStrength(input: KernelInput) {
  const faultMva = Number(input.parameters.poiFaultMva ?? 500);
  const ratedMw = Math.max(1e-6, Number(input.parameters.ibrRatedMw ?? 200));
  const minScr = Number(input.parameters.minScr ?? 2.0);
  const scr = faultMva / ratedMw;
  const emtMandatory = scr < minScr;

  return new ResultBuilder("checkGridStrength")
    .metric("scr", scr)
    .kpiCards("scr-kpis", "POI Grid Strength Screening", [
      {
        label: "Short-Circuit Ratio (SCR)",
        value: scr.toFixed(2),
        status: emtMandatory ? "warn" : "pass",
        subtitle: emtMandatory ? "Weak grid — full EMT mandatory" : "Meets SCR threshold",
      },
      { label: "POI Fault Level", value: faultMva.toFixed(0), unit: "MVA", status: "neutral" },
    ])
    .markdown(
      "scr-note",
      "Screening Rule",
      emtMandatory
        ? `SCR = ${scr.toFixed(2)} < ${minScr.toFixed(2)}: full EMT study is mandatory.`
        : `SCR = ${scr.toFixed(2)} >= ${minScr.toFixed(2)}: passes minimum grid-strength screen.`,
    )
    .summary(`SCR = ${scr.toFixed(2)} (${emtMandatory ? "EMT mandatory" : "strong grid"})`)
    .build();
}

/**
 * PMView LVRT boundary ride-through checker using `parseDelimitedTable` + `ctx.readFile`.
 * @sysml PmviewLvrtCheck
 */
export async function checkPmviewLvrt(input: KernelInput, ctx: KernelContext) {
  const relPath = String(input.parameters.profileFile ?? "data/pmview_lvrt_profile.txt");
  const raw = await ctx.readFile(relPath);
  const table = parseDelimitedTable(raw, {
    hasHeader: false,
  });

  const time = table.columns["col0"] ?? [];
  const vPoi = table.columns["col1"] ?? [];
  const pPoi = table.columns["col2"] ?? [];

  let minP = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pPoi.length; i++) {
    if ((pPoi[i] ?? 0) < minP) minP = pPoi[i]!;
    if ((vPoi[i] ?? 0) < minV) minV = vPoi[i]!;
  }
  if (!Number.isFinite(minP)) minP = 0;
  if (!Number.isFinite(minV)) minV = 0;

  return new ResultBuilder("checkPmviewLvrt")
    .metric("minPowerDuringRideThrough", minP)
    .metric("sampleCount", time.length)
    .kpiCards("lvrt-kpis", "PMView LVRT Ride-Through", [
      { label: "Min POI Voltage", value: minV.toFixed(2), unit: "pu", status: "neutral" },
      { label: "Min Active Power", value: minP.toFixed(2), unit: "pu", status: "pass" },
    ])
    .timeSeries("lvrt-trace", "PMView LVRT Trajectory", "Time (s)", "p.u.", [
      { name: "V_poi (pu)", x: time, y: vPoi },
      { name: "P_poi (pu)", x: time, y: pPoi },
    ])
    .summary(`Parsed ${time.length} PMView samples (minP=${minP.toFixed(2)} pu)`)
    .build();
}
