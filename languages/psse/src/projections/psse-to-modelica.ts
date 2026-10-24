// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Projection for PSS/E RAW Base Cases.
 *
 * Translates transmission grid components (buses, generators, loads, lines,
 * and transformers) from a PsseCase into standard Modelica models using
 * Modelica.Electrical.Analog components and physical parameters.
 */

import type { PsseCase } from "../types.js";

export interface PsseModelicaOptions {
  /** Model name for the generated Modelica model. */
  modelName?: string;
  /** System frequency override in Hz (defaults to case basfrq or 60.0). */
  systemFrequency?: number;
  /** Include branch shunt capacitance in the pi-model (defaults to true). */
  includeLineShunt?: boolean;
}

/**
 * Translates a PSS/E power flow case into native Modelica source code.
 */
export function psseToModelica(psseCase: PsseCase, options?: PsseModelicaOptions): string {
  const rawTitle = options?.modelName ?? (psseCase.title1 || "PowerGrid");
  const modelName = rawTitle.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  const freq = options?.systemFrequency ?? (psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0);
  const omega = 2 * Math.PI * freq;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0; // MVA
  const includeShunt = options?.includeLineShunt ?? true;

  const declarations: string[] = [];
  const equations: string[] = [];

  declarations.push(`  // Ground Reference`);
  declarations.push(`  Modelica.Electrical.Analog.Basic.Ground ground;`);

  // 1. Buses: represented via AC nodal voltage pins or specialized busbar components
  declarations.push(``);
  declarations.push(`  // --- Substation Busbars ---`);
  for (const bus of psseCase.buses.values()) {
    const baseKv = bus.baseKv > 0 ? bus.baseKv : 138.0;
    const cleanBusName = bus.name ? bus.name.replace(/[^a-zA-Z0-9_]/g, "_") : `BUS_${bus.i}`;
    declarations.push(`  // Bus ${bus.i}: ${bus.name.trim()} (${baseKv.toFixed(2)} kV, Type ${bus.ide})`);
    declarations.push(`  Modelica.Electrical.Analog.Interfaces.Pin bus_${bus.i} "Bus ${bus.i} [${cleanBusName}]";`);
  }

  // 2. Generators: modeled as AC sine voltage sources with scheduled voltage magnitude and frequency
  declarations.push(``);
  declarations.push(`  // --- Generation Sources ---`);
  let genIdx = 0;
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue; // Out of service
    genIdx++;
    const bus = psseCase.buses.get(gen.i);
    const baseKv = bus && bus.baseKv > 0 ? bus.baseKv : 138.0;
    const vNomVolts = (baseKv * 1000) / Math.sqrt(3); // Line-to-neutral peak or RMS
    const vSetpoint = gen.vs > 0 ? gen.vs * vNomVolts : vNomVolts;
    const genId = `gen_${gen.i}_${gen.id.trim() || genIdx}`;

    declarations.push(`  // Generator at Bus ${gen.i} (Pg=${gen.pg.toFixed(1)} MW, Qg=${gen.qg.toFixed(1)} MVAr)`);
    declarations.push(
      `  Modelica.Electrical.Analog.Sources.SineVoltage ${genId}(V=${vSetpoint.toFixed(2)}, f=${freq.toFixed(2)});`,
    );
    equations.push(`  connect(${genId}.p, bus_${gen.i});`);
    equations.push(`  connect(${genId}.n, ground.p);`);
  }

  // 3. Loads: modeled as parallel or series R-L equivalent impedances derived from (Pl, Ql)
  declarations.push(``);
  declarations.push(`  // --- Electrical Loads ---`);
  let loadIdx = 0;
  for (const load of psseCase.loads) {
    if (load.status === 0) continue; // Out of service
    loadIdx++;
    const bus = psseCase.buses.get(load.i);
    const baseKv = bus && bus.baseKv > 0 ? bus.baseKv : 138.0;
    const vBaseVolts = baseKv * 1000;
    const loadId = `load_${load.i}_${load.id.trim() || loadIdx}`;

    // Apparent power S = P + jQ in MVA
    const pMva = load.pl;
    const qMva = load.ql;
    const sMvaSq = pMva * pMva + qMva * qMva;

    if (sMvaSq > 1e-4) {
      // Equivalent resistance R = V^2 / P (phase-to-phase)
      const rOhm = pMva > 0.001 ? (baseKv * baseKv) / pMva : 1e6;
      declarations.push(`  // Load at Bus ${load.i} (Pl=${load.pl.toFixed(1)} MW, Ql=${load.ql.toFixed(1)} MVAr)`);
      declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${loadId}_R(R=${rOhm.toFixed(3)});`);
      equations.push(`  connect(${loadId}_R.p, bus_${load.i});`);
      equations.push(`  connect(${loadId}_R.n, ground.p);`);

      if (Math.abs(qMva) > 0.001) {
        if (qMva > 0) {
          // Inductive load L = V^2 / (omega * Q)
          const lHenry = (baseKv * baseKv) / (omega * qMva);
          declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${loadId}_L(L=${lHenry.toFixed(5)});`);
          equations.push(`  connect(${loadId}_L.p, bus_${load.i});`);
          equations.push(`  connect(${loadId}_L.n, ground.p);`);
        } else {
          // Capacitive load C = |Q| / (omega * V^2)
          const cFarad = (Math.abs(qMva) * 1e6) / (omega * vBaseVolts * vBaseVolts);
          declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${loadId}_C(C=${cFarad.toExponential(5)});`);
          equations.push(`  connect(${loadId}_C.p, bus_${load.i});`);
          equations.push(`  connect(${loadId}_C.n, ground.p);`);
        }
      }
    }
  }

  // 4. Transmission Lines / Branches: Pi-model with series R + L and shunt C
  declarations.push(``);
  declarations.push(`  // --- Transmission Lines & Branches (Pi-Model) ---`);
  let branchIdx = 0;
  for (const br of psseCase.branches) {
    if (br.st === 0) continue; // Out of service
    branchIdx++;
    const fromBus = psseCase.buses.get(br.i);
    const toBus = psseCase.buses.get(br.j);
    const baseKv = fromBus && fromBus.baseKv > 0 ? fromBus.baseKv : toBus && toBus.baseKv > 0 ? toBus.baseKv : 138.0;
    const zBase = (baseKv * baseKv) / sbase; // Base impedance in Ohms

    const rOhm = Math.max(1e-4, br.r * zBase);
    const xOhm = Math.max(1e-4, br.x * zBase);
    const lHenry = xOhm / omega;
    const lineId = `line_${br.i}_${br.j}_${br.ckt.trim() || branchIdx}`;

    declarations.push(
      `  // Branch ${br.i} -> ${br.j} Ckt '${br.ckt.trim()}' (R=${rOhm.toFixed(4)} Ohm, L=${(lHenry * 1000).toFixed(3)} mH)`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${lineId}_R(R=${rOhm.toFixed(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${lineId}_L(L=${lHenry.toFixed(6)});`);

    // Connect series branch: bus_i -> R -> L -> bus_j
    equations.push(`  connect(bus_${br.i}, ${lineId}_R.p);`);
    equations.push(`  connect(${lineId}_R.n, ${lineId}_L.p);`);
    equations.push(`  connect(${lineId}_L.n, bus_${br.j});`);

    // Shunt line charging capacitance (B/2 at each end)
    if (includeShunt && br.b > 1e-6) {
      const bSiemens = br.b / zBase;
      const cFaradHalf = bSiemens / (2 * omega);
      if (cFaradHalf > 1e-12) {
        declarations.push(
          `  Modelica.Electrical.Analog.Basic.Capacitor ${lineId}_C1(C=${cFaradHalf.toExponential(5)});`,
        );
        declarations.push(
          `  Modelica.Electrical.Analog.Basic.Capacitor ${lineId}_C2(C=${cFaradHalf.toExponential(5)});`,
        );
        equations.push(`  connect(bus_${br.i}, ${lineId}_C1.p);`);
        equations.push(`  connect(${lineId}_C1.n, ground.p);`);
        equations.push(`  connect(bus_${br.j}, ${lineId}_C2.p);`);
        equations.push(`  connect(${lineId}_C2.n, ground.p);`);
      }
    }
  }

  // 5. Transformers
  declarations.push(``);
  declarations.push(`  // --- Power Transformers ---`);
  let xfmrIdx = 0;
  for (const xfmr of psseCase.transformers) {
    if (xfmr.stat === 0) continue; // Out of service
    xfmrIdx++;
    const fromBus = psseCase.buses.get(xfmr.i);
    const baseKv1 = fromBus && fromBus.baseKv > 0 ? fromBus.baseKv : 138.0;
    const zBase = (baseKv1 * baseKv1) / sbase;

    const rOhm = Math.max(1e-4, xfmr.r12 * zBase);
    const xOhm = Math.max(1e-4, xfmr.x12 * zBase);
    const lHenry = xOhm / omega;
    const tapRatio = xfmr.windv1 > 0 ? xfmr.windv1 : 1.0;
    const xfmrId = `xfmr_${xfmr.i}_${xfmr.j}_${xfmr.ckt.trim() || xfmrIdx}`;

    declarations.push(`  // Transformer ${xfmr.i} -> ${xfmr.j} (Tap=${tapRatio.toFixed(3)}, X=${xOhm.toFixed(3)} Ohm)`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${xfmrId}_R(R=${rOhm.toFixed(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${xfmrId}_L(L=${lHenry.toFixed(6)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.IdealTransformer ${xfmrId}_T(n=${tapRatio.toFixed(4)});`);

    // Connect: bus_i -> IdealTransformer -> R -> L -> bus_j
    equations.push(`  connect(bus_${xfmr.i}, ${xfmrId}_T.p1);`);
    equations.push(`  connect(${xfmrId}_T.n1, ground.p);`);
    equations.push(`  connect(${xfmrId}_T.p2, ${xfmrId}_R.p);`);
    equations.push(`  connect(${xfmrId}_T.n2, ground.p);`);
    equations.push(`  connect(${xfmrId}_R.n, ${xfmrId}_L.p);`);
    equations.push(`  connect(${xfmrId}_L.n, bus_${xfmr.j});`);
  }

  // 6. Assemble Modelica model
  return `model ${modelName}
  "Modelica power transmission grid model projected from PSS/E RAW"

${declarations.join("\n")}

equation
${equations.join("\n")}

end ${modelName};
`;
}
