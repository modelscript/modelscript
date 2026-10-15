// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Projection for PSCAD Netlists.
 *
 * Translates electrical branches, transformers, and lines from an EmtNetlist
 * into a native Modelica block model using standard Modelica.Electrical.Analog components.
 */

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscxProject } from "../types.js";

/**
 * Translates a PSCAD project into native Modelica source code.
 */
export function pscadToModelica(project: PscxProject): string {
  const netlist = extractEmtNetlist(project);
  const modelName = project.name.replace(/[^a-zA-Z0-9_]/g, "_");

  const declarations: string[] = [];
  const equations: string[] = [];

  declarations.push(`  Modelica.Electrical.Analog.Basic.Ground ground;`);

  // Collect all referenced non-ground electrical buses
  const busIds = new Set<string>();
  for (const busId of netlist.buses.keys()) {
    if (busId !== "0" && busId !== "GND") busIds.add(busId);
  }
  for (const b of netlist.branches) {
    if (b.fromBus !== "0" && b.fromBus !== "GND") busIds.add(b.fromBus);
    if (b.toBus !== "0" && b.toBus !== "GND") busIds.add(b.toBus);
  }
  for (const xfmr of netlist.transformers) {
    if (xfmr.fromBus !== "0" && xfmr.fromBus !== "GND") busIds.add(xfmr.fromBus);
    if (xfmr.toBus !== "0" && xfmr.toBus !== "GND") busIds.add(xfmr.toBus);
  }
  for (const line of netlist.transmissionLines) {
    if (line.fromBus !== "0" && line.fromBus !== "GND") busIds.add(line.fromBus);
    if (line.toBus !== "0" && line.toBus !== "GND") busIds.add(line.toBus);
  }
  for (const src of netlist.sources) {
    if (src.bus !== "0" && src.bus !== "GND") busIds.add(src.bus);
  }
  for (const sm of netlist.synchronousMachines ?? []) {
    if (sm.bus !== "0" && sm.bus !== "GND") busIds.add(sm.bus);
  }
  for (const im of netlist.inductionMachines ?? []) {
    if (im.bus !== "0" && im.bus !== "GND") busIds.add(im.bus);
  }
  for (const cb of netlist.converterBridges ?? []) {
    if (cb.acBus !== "0" && cb.acBus !== "GND") busIds.add(cb.acBus);
  }
  for (const arr of netlist.surgeArresters ?? []) {
    if (arr.fromBus !== "0" && arr.fromBus !== "GND") busIds.add(arr.fromBus);
    if (arr.toBus !== "0" && arr.toBus !== "GND") busIds.add(arr.toBus);
  }
  for (const flt of netlist.faults ?? []) {
    if (flt.bus !== "0" && flt.bus !== "GND") busIds.add(flt.bus);
  }

  for (const busId of busIds) {
    const safeBus = busId.replace(/[^a-zA-Z0-9_]/g, "_");
    declarations.push(`  Modelica.Electrical.Analog.Interfaces.PositivePin bus_${safeBus};`);
  }

  const busPin = (busId: string): string => {
    if (!busId || busId === "0" || busId === "GND") return "ground.p";
    return `bus_${busId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  };

  // 0. Declare AC Voltage Sources
  for (const src of netlist.sources) {
    const id = (src.name || src.id).replace(/[^a-zA-Z0-9_]/g, "_");
    const vPeakVolts = (src.vPeakKv * 1e3).toFixed(1);
    declarations.push(
      `  Modelica.Electrical.Analog.Sources.SineVoltage ${id}(V = ${vPeakVolts}, f = ${src.frequencyHz}, phase = ${src.phaseRad.toFixed(4)});`,
    );
    equations.push(`  connect(${id}.p, ${busPin(src.bus)});`);
    equations.push(`  connect(${id}.n, ground.p);`);
  }

  // 1. Declare RLC Branches and Timed Circuit Breakers
  for (const b of netlist.branches) {
    const id = b.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const pPin = busPin(b.fromBus);
    const nPin = busPin(b.toBus);

    if (b.kind === "switch" && (b.openTimeSec !== undefined || b.closeTimeSec !== undefined)) {
      const tSwitch = b.openTimeSec ?? b.closeTimeSec ?? 0.1;
      const rOn = Math.max(1e-5, b.resistanceOhm < 1 ? b.resistanceOhm : 0.001);
      declarations.push(`  // Timed Circuit Breaker ${b.id} (t_open=${b.openTimeSec ?? "inf"}s)`);
      declarations.push(
        `  Modelica.Blocks.Sources.BooleanStep ${id}_trip(startTime = ${tSwitch}, startValue = false);`,
      );
      declarations.push(`  Modelica.Electrical.Analog.Ideal.IdealOpeningSwitch ${id}(Ron = ${rOn}, Goff = 1e-9);`);
      equations.push(`  connect(${id}_trip.y, ${id}.control);`);
      equations.push(`  connect(${pPin}, ${id}.p);`);
      equations.push(`  connect(${id}.n, ${nPin});`);
    } else if (b.resistanceOhm > 0 && b.inductanceH > 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}_R(R = ${b.resistanceOhm});`);
      declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_L(L = ${b.inductanceH});`);
      equations.push(`  connect(${pPin}, ${id}_R.p);`);
      equations.push(`  connect(${id}_R.n, ${id}_L.p);`);
      equations.push(`  connect(${id}_L.n, ${nPin});`);
    } else if (b.resistanceOhm > 0 && b.inductanceH === 0 && b.capacitanceF === 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}(R = ${b.resistanceOhm});`);
      equations.push(`  connect(${pPin}, ${id}.p);`);
      equations.push(`  connect(${id}.n, ${nPin});`);
    } else if (b.inductanceH > 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}(L = ${b.inductanceH});`);
      equations.push(`  connect(${pPin}, ${id}.p);`);
      equations.push(`  connect(${id}.n, ${nPin});`);
    } else if (b.capacitanceF > 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}(C = ${b.capacitanceF});`);
      equations.push(`  connect(${pPin}, ${id}.p);`);
      equations.push(`  connect(${id}.n, ${nPin});`);
    }
  }

  // 2. Declare Transformers with IdealTransformer turns ratio and series leakage inductance
  for (const xfmr of netlist.transformers) {
    const id = xfmr.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const zBase = Math.pow(xfmr.primaryKv * 1e3, 2) / (xfmr.mvaRating * 1e6);
    const xOhm = xfmr.leakageReactancePu * zBase;
    const lH = xOhm / (2 * Math.PI * netlist.nominalFrequencyHz);
    const turnsRatio = xfmr.secondaryKv > 0 ? xfmr.primaryKv / xfmr.secondaryKv : 1.0;

    declarations.push(
      `  // Transformer ${xfmr.id}: ${xfmr.primaryKv}kV -> ${xfmr.secondaryKv}kV (n=${turnsRatio.toFixed(4)}, ${xfmr.windingConnection}), ${xfmr.mvaRating} MVA`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_leakage(L = ${lH.toExponential(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.IdealTransformer ${id}_ideal(n = ${turnsRatio.toFixed(4)});`);
    equations.push(`  connect(${busPin(xfmr.fromBus)}, ${id}_leakage.p);`);
    equations.push(`  connect(${id}_leakage.n, ${id}_ideal.p1);`);
    equations.push(`  connect(${id}_ideal.n1, ground.p);`);
    equations.push(`  connect(${id}_ideal.p2, ${busPin(xfmr.toBus)});`);
    equations.push(`  connect(${id}_ideal.n2, ground.p);`);
  }

  // 3. Declare Transmission Lines & Coaxial Cables (Pi-Model equivalent)
  for (const line of netlist.transmissionLines) {
    const id = line.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const rTot = line.rPerKm * line.lengthKm;
    const lTot = line.lPerKm * line.lengthKm;
    const cHalf = (line.cPerKm * line.lengthKm) / 2;
    const kindLabel = line.isCable ? "Coaxial Cable" : "Transmission Line";

    declarations.push(`  // ${kindLabel} ${line.id}: ${line.lengthKm} km (${line.modelType})`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}_R(R = ${rTot.toFixed(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_L(L = ${lTot.toExponential(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}_C1(C = ${cHalf.toExponential(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}_C2(C = ${cHalf.toExponential(4)});`);

    equations.push(`  connect(${busPin(line.fromBus)}, ${id}_R.p);`);
    equations.push(`  connect(${id}_R.n, ${id}_L.p);`);
    equations.push(`  connect(${id}_L.n, ${busPin(line.toBus)});`);
    equations.push(`  connect(${id}_C1.p, ${id}_R.p);`);
    equations.push(`  connect(${id}_C1.n, ground.p);`);
    equations.push(`  connect(${id}_C2.p, ${id}_L.n);`);
    equations.push(`  connect(${id}_C2.n, ground.p);`);
  }

  // 3b. Declare 6th-Order Subtransient Synchronous Machines
  for (const sm of netlist.synchronousMachines ?? []) {
    const id = sm.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const freq = sm.frequencyHz || netlist.nominalFrequencyHz;
    const zBase = Math.pow(sm.ratedKvLL * 1e3, 2) / (sm.ratedMva * 1e6);
    const xdSub = sm.xdSub ?? 0.2;
    const lSubH = (xdSub * zBase) / (2 * Math.PI * freq);
    const vPeak = (sm.ratedKvLL * 1e3 * (sm.fieldVoltagePu ?? 1.05)).toFixed(1);

    declarations.push(
      `  // Synchronous Machine ${sm.id}: ${sm.ratedMva} MVA, ${sm.ratedKvLL} kV, Xd''=${xdSub} pu, H=${sm.hInertiaSec ?? 3.5} s`,
    );
    declarations.push(
      `  Modelica.Electrical.Analog.Sources.SineVoltage ${id}_emf(V = ${vPeak}, f = ${freq}, phase = 0);`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_Lsub(L = ${lSubH.toExponential(4)});`);
    equations.push(`  connect(${id}_emf.p, ${id}_Lsub.p);`);
    equations.push(`  connect(${id}_Lsub.n, ${busPin(sm.bus)});`);
    equations.push(`  connect(${id}_emf.n, ground.p);`);
  }

  // 3c. Declare 5th-Order Induction Machines & DFIG Wind Generators
  for (const im of netlist.inductionMachines ?? []) {
    const id = im.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const freq = im.frequencyHz || netlist.nominalFrequencyHz;
    const zBase = Math.pow(im.ratedKvLL * 1e3, 2) / (im.ratedMva * 1e6);
    const slip = Math.abs(im.initialSlip ?? 0.02) || 0.02;
    const rEq = ((im.rsPu ?? 0.015) + (im.rrPu ?? 0.015) / slip) * zBase;
    const xTransient = ((im.xsPu ?? 0.1) + (im.xrPu ?? 0.1)) * zBase;
    const lEqH = xTransient / (2 * Math.PI * freq);

    declarations.push(
      `  // Induction Machine (${im.machineType ?? "squirrel_cage"}) ${im.id}: ${im.ratedMva} MVA, ${im.ratedKvLL} kV, slip=${im.initialSlip ?? 0.02}`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}_Req(R = ${rEq.toFixed(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_Ltr(L = ${lEqH.toExponential(4)});`);
    equations.push(`  connect(${busPin(im.bus)}, ${id}_Req.p);`);
    equations.push(`  connect(${id}_Req.n, ${id}_Ltr.p);`);
    equations.push(`  connect(${id}_Ltr.n, ground.p);`);
  }

  // 3d. Declare Power-Electronic Converter Bridges (VSC PWM, 6-Pulse LCC, MMC Thévenin)
  for (const cb of netlist.converterBridges ?? []) {
    const id = cb.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const vAcPeak = (cb.ratedKvLL * 1e3 * 0.85).toFixed(1);
    const lArm = cb.armInductanceH ?? 0.015;
    declarations.push(
      `  // Power-Electronic Converter Bridge ${cb.id} (${cb.kind}): ${cb.ratedMva} MVA, Vdc=${cb.vDcNominalKv ?? 400} kV, N_sm=${cb.numSubmodulesPerArm ?? 0}`,
    );
    declarations.push(
      `  Modelica.Electrical.Analog.Sources.SineVoltage ${id}_vconv(V = ${vAcPeak}, f = ${netlist.nominalFrequencyHz}, phase = 0);`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_Larm(L = ${lArm.toExponential(4)});`);
    equations.push(`  connect(${id}_vconv.p, ${id}_Larm.p);`);
    equations.push(`  connect(${id}_Larm.n, ${busPin(cb.acBus)});`);
    equations.push(`  connect(${id}_vconv.n, ground.p);`);
  }

  // 3e. Declare ZnO MOV Surge Arresters & Timed Faults
  for (const arr of netlist.surgeArresters ?? []) {
    const id = arr.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const vRefVolts = (arr.vRefKv * 1e3).toFixed(1);
    declarations.push(`  // ZnO MOV Surge Arrester ${arr.id}: Vref = ${arr.vRefKv} kV`);
    declarations.push(
      `  Modelica.Electrical.Analog.Semiconductors.ZDiode ${id}(Bv = ${vRefVolts}, Ibv = 500.0, R = 0.5);`,
    );
    equations.push(`  connect(${busPin(arr.fromBus)}, ${id}.n);`);
    equations.push(`  connect(${id}.p, ${busPin(arr.toBus)});`);
  }

  for (const flt of netlist.faults ?? []) {
    const id = flt.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const rFlt = Math.max(1e-4, flt.rFaultOhm ?? 0.001);
    declarations.push(
      `  // Timed Fault ${flt.id} (${flt.faultType}): t=[${flt.startSec}, ${flt.endSec}] s, R=${rFlt} Ohm`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}_Rflt(R = ${rFlt});`);
    declarations.push(`  Modelica.Electrical.Analog.Ideal.IdealClosingSwitch ${id}_sw(Ron = 1e-5, Goff = 1e-9);`);
    declarations.push(
      `  Modelica.Blocks.Sources.BooleanStep ${id}_trig(startTime = ${flt.startSec}, startValue = false);`,
    );
    equations.push(`  connect(${id}_trig.y, ${id}_sw.control);`);
    equations.push(`  connect(${busPin(flt.bus)}, ${id}_sw.p);`);
    equations.push(`  connect(${id}_sw.n, ${id}_Rflt.p);`);
    equations.push(`  connect(${id}_Rflt.n, ground.p);`);
  }

  // 4. Declare Continuous System Model Functions (CSMF) Control Blocks as Modelica.Blocks
  if (netlist.controlBlocks && netlist.controlBlocks.length > 0) {
    declarations.push(`  // CSMF Control Blocks`);
    for (const cb of netlist.controlBlocks) {
      const id = cb.id.replace(/[^a-zA-Z0-9_]/g, "_");
      if (cb.kind === "const") {
        const k = cb.params["value"] ?? cb.params["K"] ?? cb.params["k"] ?? 0;
        declarations.push(`  Modelica.Blocks.Sources.Constant ${id}(k = ${k});`);
      } else if (cb.kind === "gain") {
        const k = cb.params["K"] ?? cb.params["k"] ?? cb.params["G"] ?? 1.0;
        declarations.push(`  Modelica.Blocks.Math.Gain ${id}(k = ${k});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u);`);
        }
      } else if (cb.kind === "sum") {
        const k1 = cb.params["s1"] ?? cb.params["k1"] ?? 1.0;
        const k2 = cb.params["s2"] ?? cb.params["k2"] ?? 1.0;
        declarations.push(`  Modelica.Blocks.Math.Add ${id}(k1 = ${k1}, k2 = ${k2});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u1);`);
        }
        if (cb.inputs[1]) {
          equations.push(`  connect(${cb.inputs[1].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u2);`);
        }
      } else if (cb.kind === "pi") {
        const kp = cb.params["Kp"] ?? cb.params["kp"] ?? cb.params["GP"] ?? 1.0;
        const ti = cb.params["Ti"] ?? cb.params["ti"] ?? cb.params["TI"] ?? 0.1;
        declarations.push(`  Modelica.Blocks.Continuous.PI ${id}(k = ${kp}, T = ${ti});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u);`);
        }
      } else if (cb.kind === "lag" || cb.kind === "leadlag") {
        const k = cb.params["K"] ?? cb.params["G"] ?? 1.0;
        const t = cb.params["T"] ?? cb.params["T2"] ?? 0.05;
        declarations.push(`  Modelica.Blocks.Continuous.FirstOrder ${id}(k = ${k}, T = ${t});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u);`);
        }
      } else if (cb.kind === "limit") {
        const uMax = cb.params["max"] ?? cb.params["UL"] ?? 1.0;
        const uMin = cb.params["min"] ?? cb.params["LL"] ?? -1.0;
        declarations.push(`  Modelica.Blocks.Nonlinear.Limiter ${id}(uMax = ${uMax}, uMin = ${uMin});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u);`);
        }
      } else if (cb.kind === "compar") {
        const threshold = cb.params["threshold"] ?? cb.params["Threshold"] ?? cb.params["ref"] ?? 0.0;
        declarations.push(`  Modelica.Blocks.Logical.GreaterThreshold ${id}(threshold = ${threshold});`);
        if (cb.inputs[0]) {
          equations.push(`  connect(${cb.inputs[0].replace(/[^a-zA-Z0-9_]/g, "_")}.y, ${id}.u);`);
        }
      }
    }
  }

  // 5. Grounding references
  equations.push(`  // Ground references`);

  return `// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated automatically by ModelScript PSCAD-to-Modelica Projection

model ${modelName}
  "Translated electrical network from PSCAD project ${project.name}"

${declarations.join("\n")}

equation
${equations.length > 0 ? equations.join("\n") : "  // No custom loop equations"}

end ${modelName};
`;
}
