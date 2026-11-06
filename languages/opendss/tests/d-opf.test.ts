// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenDss, solveDistributionOpf, solveDistributionPowerFlow } from "../src/index.js";

const HIGH_PV_FEEDER = `! 4-Bus Feeder with High Penetration Rooftop Solar
Clear
New Circuit.HighPvGrid basekv=115.0 pu=1.02 phases=3 bus1=SourceBus

New LineCode.100 nphases=3 r1=0.25 x1=0.45 units=km

New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000] %loadloss=0.5 xhl=5.0

New Line.Line1 bus1=SubBus bus2=FeederEnd phases=3 linecode=100 length=4.0

! Light load during noon
New Load.LightLoad bus1=FeederEnd phases=3 kv=12.47 kw=200 kvar=50

! Heavy solar generation causing reverse power flow and overvoltage
New PVSystem.RoofSolar bus1=FeederEnd phases=3 kv=12.47 kva=2500 pmpp=2200

Set VoltageBases = [115, 12.47]
CalcVoltageBases
Solve
`;

const INDUCTIVE_LOAD_FEEDER = `! Feeder with Heavy Inductive Load for Loss Minimization
Clear
New Circuit.LossyGrid basekv=115.0 pu=1.0 phases=3 bus1=SourceBus

New LineCode.100 nphases=3 r1=0.2 x1=0.3 units=km

New Transformer.SubXfmr phases=3 windings=2 buses=[SourceBus, SubBus] kvs=[115, 12.47] kvas=[10000, 10000]

New Line.Line1 bus1=SubBus bus2=MidBus phases=3 linecode=100 length=2.0
New Line.Line2 bus1=MidBus bus2=EndBus phases=3 linecode=100 length=3.0

New Load.HeavyInductive bus1=EndBus phases=3 kv=12.47 kw=1500 kvar=1000

! Smart Inverter solar available for reactive power support
New PVSystem.SmartInverter bus1=EndBus phases=3 kv=12.47 kva=2000 pmpp=1000

Set VoltageBases = [115, 12.47]
CalcVoltageBases
Solve
`;

test("D-OPF: Resolves solar PV overvoltage using Smart Inverter Volt-VAR / Volt-Watt control", () => {
  const deck = parseOpenDss(HIGH_PV_FEEDER);

  // Unoptimized power flow
  const basePf = solveDistributionPowerFlow(deck);
  assert.ok(basePf.converged);

  // Solve D-OPF with target range [0.95, 1.05 pu]
  const dopf = solveDistributionOpf(deck, {
    vMinPu: 0.95,
    vMaxPu: 1.05,
    enableVoltVar: true,
    enableVoltWatt: true,
  });

  assert.equal(dopf.status, "OPTIMAL");
  assert.equal(dopf.derDispatches.length, 1);

  const der = dopf.derDispatches[0]!;
  assert.equal(der.name, "RoofSolar");
  // Inverter should absorb reactive power (qOpt < 0) to pull voltage down
  assert.ok(der.optimizedKvar <= 0, `Smart inverter should absorb Q, got ${der.optimizedKvar} kVAR`);

  // Optimized maximum voltage should be regulated closer to target envelope
  assert.ok(
    dopf.optimizedMaxVoltagePu <= dopf.initialMaxVoltagePu + 1e-4,
    `Optimized max V (${dopf.optimizedMaxVoltagePu}) must be <= initial max V (${dopf.initialMaxVoltagePu})`,
  );

  // Report should be properly generated
  assert.ok(dopf.reportText.includes("3-PHASE UNBALANCED DISTRIBUTION OPTIMAL POWER FLOW (D-OPF)"));
  assert.ok(dopf.reportText.includes("RoofSolar"));
});

test("D-OPF: Minimizes distribution feeder losses via reactive power compensation", () => {
  const deck = parseOpenDss(INDUCTIVE_LOAD_FEEDER);

  const dopf = solveDistributionOpf(deck, {
    objective: "min_losses",
    enableVoltVar: true,
  });

  assert.equal(dopf.status, "OPTIMAL");
  assert.ok(dopf.derDispatches.length > 0);

  const der = dopf.derDispatches[0]!;
  // For inductive load, inverter should inject Q > 0 to support power factor locally
  assert.ok(der.optimizedKvar > 0, `Smart inverter should inject reactive power, got ${der.optimizedKvar} kVAR`);
  assert.ok(dopf.optimizedLossesKw <= dopf.initialLossesKw, "Losses should be reduced or maintained");
});
