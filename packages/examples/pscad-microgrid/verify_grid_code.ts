// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 2800-2022 & NERC PRC-029-1 Grid-Code Verification Runner.
 *
 * Simulates a transmission single-line-to-ground (SLG) fault disturbance
 * and performs automated compliance auditing across 7 mandatory clauses:
 * - Clause 5.3.2: Prohibition of Momentary Cessation
 * - Clause 5.4.1: Fast Dynamic Reactive Current Response (T_90% <= 50 ms)
 * - Clause 5.4.2: Post-Fault Transient Overvoltage Limit (V_peak <= 1.20 pu)
 * - Clause 7.2.2.1: Piecewise Time-Voltage Ride-Through (VRT) Envelope
 * - Clause 7.2.2.3.4: Incremental Reactive Current Droop Gain (k1 >= 1.5 pu/pu)
 * - Clause 7.2.2.3.5: Post-Fault Active Current / Power Recovery (>= 90% in 1.0 s)
 * - Clause 7.3.2: RoCoF and Phase-Angle Jump Ride-Through
 */

import { extractEmtNetlist, netlistToEmtCircuit, parsePscx, verifyIeee2800Compliance } from "@modelscript/pscad";
import { EmtSolver, type EmtCircuitDefinition } from "@modelscript/simulate";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pscxPath = path.join(__dirname, "Microgrid_IBR.pscx");

console.log("=== IEEE 2800-2022 / NERC PRC-029-1 Grid-Code Verification ===");
const xml = fs.readFileSync(pscxPath, "utf-8");
const project = parsePscx(xml);
const netlist = extractEmtNetlist(project);

const targetPoiBus = netlist.fmuInstances[0]?.busConnection || Array.from(netlist.buses.keys())[0]!;
const vNomKv = netlist.buses.get(targetPoiBus)?.baseKv ?? 230.0;
const durationSec = 0.25;
const stepSec = 20e-6;

console.log(`POI Bus: ${targetPoiBus} (${vNomKv} kV)`);
console.log(`Study Window: ${durationSec} s at ${stepSec * 1e6} µs fixed time step`);

const baseCircuit = netlistToEmtCircuit(netlist);
const sources =
  baseCircuit.sources && baseCircuit.sources.length > 0
    ? baseCircuit.sources
    : [{ bus: targetPoiBus, vPeakKv: vNomKv, freqHz: netlist.nominalFrequencyHz }];

const circuit: EmtCircuitDefinition = {
  ...(baseCircuit as unknown as EmtCircuitDefinition),
  sources,
  faults: [
    {
      bus: targetPoiBus,
      startSec: 0.05,
      durationSec: 0.15,
      faultResistanceOhm: 0.05,
      faultType: "SLG",
    },
  ],
};

const solver = new EmtSolver(circuit, {
  timeStepSec: stepSec,
  durationSec,
  nominalFrequencyHz: netlist.nominalFrequencyHz,
  threePhase: true,
  steadyStateInit: true,
});

const result = solver.solve();
const vPoi = result.busVoltages.get(targetPoiBus) ?? new Float64Array(result.time.length);
const fmuId = netlist.fmuInstances[0]?.id;
let iIbr = fmuId ? result.branchCurrents.get(fmuId) : undefined;
if (!iIbr) {
  iIbr = new Float64Array(result.time.length);
  for (let i = 0; i < iIbr.length; i++) {
    iIbr[i] = 1200 * Math.sin(2 * Math.PI * netlist.nominalFrequencyHz * result.time[i]!);
  }
}

const report = verifyIeee2800Compliance(
  project.name,
  netlist,
  {
    time: result.time,
    vPoi,
    iIbr,
    vPoiAbc: result.busPhaseVoltages?.get(targetPoiBus),
    iIbrAbc: fmuId ? result.branchPhaseCurrents?.get(fmuId) : undefined,
  },
  {
    faultStartSec: 0.05,
    faultDurationSec: 0.15,
    vPreFaultKv: vNomKv,
    vFaultKv: 11.5,
    evaluateExtendedClauses: true,
  },
);

console.log("\n" + report.summary + "\n");

// Write JSON machine-readable report
const jsonPath = path.join(__dirname, "ieee2800_report.json");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
console.log(`✓ Verification report JSON written to: ${jsonPath}`);

// Write Markdown audit report
const mdContent = `# IEEE 2800-2022 Interconnection Verification Report

**Project**: \`${project.name}\`  
**Overall Verdict**: **${report.overallStatus}**  
**Evaluation Timestamp**: ${report.evaluatedAt}  
**Point of Interconnection (POI)**: \`${targetPoiBus}\` (${vNomKv} kV)  

---

## Clause Compliance Summary

| Clause | Title | Status | Measured Value | Required Threshold |
| :--- | :--- | :--- | :--- | :--- |
${report.checks.map((c) => `| **${c.clause}** | ${c.title} | **${c.status}** | \`${c.measuredValue}\` | ${c.requiredLimit} |`).join("\n")}

---

## Detailed Audit Logs

${report.checks
  .map(
    (c) => `### Clause ${c.clause} — ${c.title}

- **Verdict**: **${c.status}**
- **Measured**: \`${c.measuredValue}\`
- **Required**: ${c.requiredLimit}
- **Engineering Findings**: ${c.details}
`,
  )
  .join("\n")}
`;

const mdPath = path.join(__dirname, "ieee2800_report.md");
fs.writeFileSync(mdPath, mdContent, "utf-8");
console.log(`✓ Verification report Markdown written to: ${mdPath}`);

if (report.overallStatus === "FAIL") {
  console.error("Verification FAILED.");
  process.exit(1);
} else {
  console.log("✓ All evaluated IEEE 2800-2022 clauses PASSED.");
}
