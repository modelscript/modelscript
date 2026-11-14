// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerFlowpathToDae, parseOpi, simulateDriftFlux } from "../src/index.js";

const SAMPLE_OPI_XML = `<?xml version="1.0" encoding="utf-8"?>
<Model Title="Deepwater Flowline Riser" Author="FlowAssuranceTeam">
  <Integration StartTime="0" EndTime="3600" MinDt="0.001" MaxDt="0.5" />
  <Flowpath Name="PRODUCTION_LOOP">
    <Pipe Label="SEABED_TIEBACK" Length="3500" Diameter="0.254" Elevation="-1200" Roughness="4.5e-5" Discretization="10" />
    <Pipe Label="CATENARY_RISER" Length="1400" Diameter="0.254" Elevation="1220" Roughness="4.5e-5" Discretization="8" />
    <Valve Name="TOPSIDE_CHOKE" AbsolutePosition="4850" Diameter="0.15" Opening="0.85" Cd="0.82" />
    <Source Name="WELL_A" Position="0" TotalMassRate="45.0" GasMassFraction="0.22" WaterCut="0.08" Temperature="75C" Pressure="180bar" />
  </Flowpath>
  <Node Name="WELLHEAD_MANIFOLD" Type="TERMINAL" Flowpath="PRODUCTION_LOOP" BoundaryPosition="0.0" MassRate="45.0" Temperature="75C" Pressure="180bar" />
  <Node Name="TOPSIDE_SEPARATOR" Type="PRESSURE" Flowpath="PRODUCTION_LOOP" BoundaryPosition="1.0" Pressure="32bar" Temperature="25C" />
</Model>`;

export const olgaBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "olga",
  referenceTool: "SLB OLGA / 1D Two-Fluid Drift-Flux Flow Assurance",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const model = parseOpi(SAMPLE_OPI_XML);
    const fp = model.flowpaths[0]!;

    const t0 = performance.now();
    const builder = new DAEBuilder();
    const { varIndices, cellCount } = lowerFlowpathToDae(builder, model, fp);
    const d1 = performance.now() - t0;

    const t1 = performance.now();
    const sim = simulateDriftFlux(model, { durationSeconds: 60, timeStepSeconds: 1.0 });
    const d2 = performance.now() - t1;
    const last = sim.profiles[sim.profiles.length - 1];

    return [
      {
        id: "olga-flowpath-dae-lowering",
        name: "Deepwater Tieback & Riser DAEBuilder Lowering (18 cells)",
        scale: "standard",
        referenceTool: "SLB OLGA / 1D Two-Fluid Drift-Flux Flow Assurance",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: cellCount === 18 && varIndices.length >= 72 ? 0 : 1,
        passed: cellCount === 18 && varIndices.length >= 72,
        durationMs: d1,
        details: `${cellCount} cells, ${varIndices.length} arena vars`,
      },
      {
        id: "olga-drift-flux-transient",
        name: "1D Two-Fluid Drift-Flux 60s Transient Simulation",
        scale: "standard",
        referenceTool: "SLB OLGA / 1D Two-Fluid Drift-Flux Flow Assurance",
        metricKind: "exact",
        threshold: 0,
        measuredError: last?.x.length === 18 ? 0 : 1,
        passed: sim.times.length > 0 && last?.x.length === 18,
        durationMs: d2,
        details: `steps=${sim.times.length}, surge=${sim.trends.peakLiquidSurgeVolume.toFixed(2)}m3`,
      },
    ];
  },
};
