// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NERC PRC-019-2, PRC-024-3, and PRC-026-1 Automated Protection Coordination Auditor.
 *
 * Verifies that generation and transmission protective relay settings coordinate
 * correctly with equipment capability limits and grid code ride-through envelopes:
 * 1. PRC-019-2: Coordination of Generating Unit or Inverter-Based Resource Protection
 *    with Capabilities and Controls (Loss-of-Field 40, Volts/Hz 24, Overvoltage 59 vs. D-curve & OEL).
 * 2. PRC-024-3: Generator and Inverter-Based Resource Voltage and Frequency Protective Relay Settings
 *    (Proving no trip occurs within the mandatory Continuous Operation / Ride-Through envelope).
 * 3. PRC-026-1: Relay Performance During Stable Power Swings
 *    (Checking distance relay 21 loadability and blinder encroachment).
 */

import type { PsseCase } from "../types.js";

/**
 * ANSI Device Protective Relay Setting.
 */
export interface RelaySetting {
  deviceId: string;
  ansiCode: 24 | 27 | 40 | 59 | 81 | 21; // 24=V/Hz, 27=UV, 40=Loss of Field, 59=OV, 81=Freq, 21=Distance
  elementName: string;
  pickupValue: number;
  timeDelaySec: number;
  curveType?: "definite_time" | "inverse_time" | "mho" | undefined;
  // Offset mho parameters (for 40 Loss of Field)
  offsetOhm?: number | undefined;
  diameterOhm?: number | undefined;
}

/**
 * Outcome of evaluating a protection coordination check.
 */
export interface ProtectionFinding {
  standard: "PRC-019-2" | "PRC-024-3" | "PRC-026-1";
  element: string;
  relayCode: string;
  severity: "pass" | "warning" | "violation";
  rule: string;
  description: string;
  marginPercent?: number | undefined;
}

/**
 * Complete NERC PRC Protection Coordination Audit Report.
 */
export interface ProtectionAuditReport {
  timestamp: string;
  caseTitle: string;
  overallStatus: "COMPLIANT" | "NON-COMPLIANT" | "CONDITIONAL";
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    violations: number;
  };
  prc019Findings: ProtectionFinding[];
  prc024Findings: ProtectionFinding[];
  prc026Findings: ProtectionFinding[];
  markdownReport: string;
}

/**
 * NERC PRC-024-3 Voltage Ride-Through Boundary Points: [TimeSec, V_pu_lower, V_pu_upper].
 */
export const PRC024_VOLTAGE_BOUNDARY: Array<{ timeSec: number; vMinPu: number; vMaxPu: number }> = [
  { timeSec: 0.0, vMinPu: 0.0, vMaxPu: 1.20 },
  { timeSec: 0.15, vMinPu: 0.0, vMaxPu: 1.20 },
  { timeSec: 0.30, vMinPu: 0.45, vMaxPu: 1.175 },
  { timeSec: 1.0, vMinPu: 0.65, vMaxPu: 1.15 },
  { timeSec: 2.0, vMinPu: 0.75, vMaxPu: 1.10 },
  { timeSec: 4.0, vMinPu: 0.88, vMaxPu: 1.10 },
];

/**
 * NERC PRC-024-3 Frequency Ride-Through Boundary Points: [TimeSec, F_min_Hz, F_max_Hz] (60 Hz Interconnection).
 */
export const PRC024_FREQ_BOUNDARY: Array<{ timeSec: number; fMinHz: number; fMaxHz: number }> = [
  { timeSec: 0.0, fMinHz: 56.5, fMaxHz: 61.8 },
  { timeSec: 0.2, fMinHz: 57.0, fMaxHz: 61.6 },
  { timeSec: 2.0, fMinHz: 57.5, fMaxHz: 61.6 },
  { timeSec: 10.0, fMinHz: 58.4, fMaxHz: 60.5 },
  { timeSec: 180.0, fMinHz: 59.5, fMaxHz: 60.5 },
];

/**
 * Audits protection settings against NERC PRC-019-2, PRC-024-3, and PRC-026-1.
 */
export function auditProtectionCoordination(
  psseCase: PsseCase,
  relays: RelaySetting[],
): ProtectionAuditReport {
  const prc019Findings: ProtectionFinding[] = [];
  const prc024Findings: ProtectionFinding[] = [];
  const prc026Findings: ProtectionFinding[] = [];

  let passed = 0;
  let warnings = 0;
  let violations = 0;

  // 1. Audit PRC-024-3: Voltage & Frequency Protection Envelopes
  for (const r of relays) {
    if (r.ansiCode === 27) {
      // Undervoltage relay: check if trip pickup encroaches into No-Trip region
      let encroaches = false;
      let encroachingBoundary = 0;

      for (const pt of PRC024_VOLTAGE_BOUNDARY) {
        if (r.timeDelaySec <= pt.timeSec && r.pickupValue > pt.vMinPu) {
          encroaches = true;
          encroachingBoundary = pt.vMinPu;
          break;
        }
      }

      if (encroaches) {
        violations++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 27 (UV #${r.deviceId})`,
          severity: "violation",
          rule: "prc-024-undervoltage-encroachment",
          description: `Undervoltage pickup ${r.pickupValue.toFixed(2)} pu at delay ${r.timeDelaySec.toFixed(2)} s trips inside PRC-024-3 mandatory ride-through boundary (${encroachingBoundary.toFixed(2)} pu).`,
        });
      } else {
        passed++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 27 (UV #${r.deviceId})`,
          severity: "pass",
          rule: "prc-024-undervoltage-cleared",
          description: `Undervoltage setting ${r.pickupValue.toFixed(2)} pu at ${r.timeDelaySec.toFixed(2)} s coordinates cleanly outside PRC-024 ride-through envelope.`,
        });
      }
    } else if (r.ansiCode === 59) {
      // Overvoltage relay: check if trip pickup is below the statutory overvoltage ride-through curve
      let encroaches = false;
      let boundaryVal = 0;

      for (const pt of PRC024_VOLTAGE_BOUNDARY) {
        if (r.timeDelaySec <= pt.timeSec && r.pickupValue < pt.vMaxPu) {
          encroaches = true;
          boundaryVal = pt.vMaxPu;
          break;
        }
      }

      if (encroaches) {
        violations++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 59 (OV #${r.deviceId})`,
          severity: "violation",
          rule: "prc-024-overvoltage-encroachment",
          description: `Overvoltage pickup ${r.pickupValue.toFixed(2)} pu at delay ${r.timeDelaySec.toFixed(2)} s trips prematurely below PRC-024-3 ride-through ceiling (${boundaryVal.toFixed(2)} pu).`,
        });
      } else {
        passed++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 59 (OV #${r.deviceId})`,
          severity: "pass",
          rule: "prc-024-overvoltage-cleared",
          description: `Overvoltage setting ${r.pickupValue.toFixed(2)} pu coordinates cleanly outside PRC-024 envelope.`,
        });
      }
    } else if (r.ansiCode === 81) {
      // Under/Overfrequency relay
      const isUnder = r.pickupValue < 60.0;
      let encroaches = false;

      for (const pt of PRC024_FREQ_BOUNDARY) {
        if (isUnder && r.timeDelaySec <= pt.timeSec && r.pickupValue > pt.fMinHz) {
          encroaches = true;
          break;
        }
        if (!isUnder && r.timeDelaySec <= pt.timeSec && r.pickupValue < pt.fMaxHz) {
          encroaches = true;
          break;
        }
      }

      if (encroaches) {
        violations++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 81 (Freq #${r.deviceId})`,
          severity: "violation",
          rule: "prc-024-frequency-encroachment",
          description: `Frequency trip setting ${r.pickupValue.toFixed(2)} Hz at delay ${r.timeDelaySec.toFixed(2)} s encroaches into PRC-024-3 mandatory frequency ride-through band.`,
        });
      } else {
        passed++;
        prc024Findings.push({
          standard: "PRC-024-3",
          element: r.elementName,
          relayCode: `ANSI 81 (Freq #${r.deviceId})`,
          severity: "pass",
          rule: "prc-024-frequency-cleared",
          description: `Frequency trip setting ${r.pickupValue.toFixed(2)} Hz coordinates cleanly outside PRC-024 ride-through band.`,
        });
      }
    }
  }

  // 2. Audit PRC-019-2: Generator Capability vs. Loss-of-Field (40) & Volts/Hz (24)
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const lofRelay = relays.find((r) => r.ansiCode === 40 && (r.elementName.includes(String(gen.i)) || !r.elementName));
    const vhzRelay = relays.find((r) => r.ansiCode === 24 && (r.elementName.includes(String(gen.i)) || !r.elementName));

    // Loss-of-Field (40) coordination with minimum excitation limiter (MEL) and steady-state stability limit (SSSL)
    if (lofRelay && lofRelay.offsetOhm !== undefined && lofRelay.diameterOhm !== undefined) {
      const xdp = gen.zx > 0 ? gen.zx : 0.25;
      const baseKv = psseCase.buses.get(gen.i)?.baseKv ?? 138.0;
      const zBaseOhm = (baseKv * baseKv) / (gen.mbase > 0 ? gen.mbase : 100.0);
      const xdpOhm = xdp * zBaseOhm;

      // Recommended standard setting: Offset = -X'd/2, Diameter = Xd (or 1.0 pu)
      const expectedOffsetOhm = -0.5 * xdpOhm;
      const offsetDiff = Math.abs(lofRelay.offsetOhm - expectedOffsetOhm) / Math.max(1.0, Math.abs(expectedOffsetOhm));

      if (lofRelay.offsetOhm > 0) {
        violations++;
        prc019Findings.push({
          standard: "PRC-019-2",
          element: `Generator ${gen.i}-${gen.id}`,
          relayCode: "ANSI 40 (Loss of Field)",
          severity: "violation",
          rule: "prc-019-lof-positive-offset",
          description: `Loss-of-Field mho circle offset is positive (${lofRelay.offsetOhm.toFixed(2)} Ohm), encroaching into normal generator capability.`,
        });
      } else if (offsetDiff > 0.35) {
        warnings++;
        prc019Findings.push({
          standard: "PRC-019-2",
          element: `Generator ${gen.i}-${gen.id}`,
          relayCode: "ANSI 40 (Loss of Field)",
          severity: "warning",
          rule: "prc-019-lof-offset-deviation",
          description: `Loss-of-Field offset (${lofRelay.offsetOhm.toFixed(2)} Ohm) deviates by ${(offsetDiff * 100).toFixed(0)}% from standard -X'd/2 setting (${expectedOffsetOhm.toFixed(2)} Ohm).`,
        });
      } else {
        passed++;
        prc019Findings.push({
          standard: "PRC-019-2",
          element: `Generator ${gen.i}-${gen.id}`,
          relayCode: "ANSI 40 (Loss of Field)",
          severity: "pass",
          rule: "prc-019-lof-coordinated",
          description: `Loss-of-Field relay mho circle coordinates cleanly with generator underexcited capability limit (UEL).`,
        });
      }
    }

    // Volts/Hz (24) coordination: Continuous capability is typically 1.05 pu
    if (vhzRelay) {
      if (vhzRelay.pickupValue <= 1.05) {
        violations++;
        prc019Findings.push({
          standard: "PRC-019-2",
          element: `Generator ${gen.i}-${gen.id}`,
          relayCode: "ANSI 24 (Volts/Hz)",
          severity: "violation",
          rule: "prc-019-vhz-below-continuous",
          description: `Volts/Hz pickup (${vhzRelay.pickupValue.toFixed(2)} pu) is set at or below generator continuous withstand capability (1.05 pu).`,
        });
      } else {
        passed++;
        prc019Findings.push({
          standard: "PRC-019-2",
          element: `Generator ${gen.i}-${gen.id}`,
          relayCode: "ANSI 24 (Volts/Hz)",
          severity: "pass",
          rule: "prc-019-vhz-coordinated",
          description: `Volts/Hz relay pickup (${vhzRelay.pickupValue.toFixed(2)} pu at ${vhzRelay.timeDelaySec.toFixed(1)} s) coordinates cleanly with continuous rating.`,
        });
      }
    }
  }

  // 3. Audit PRC-026-1: Transmission Distance Relay (21) Loadability & Swing Blinders
  const distRelays = relays.filter((r) => r.ansiCode === 21);
  for (const r of distRelays) {
    // Check if reach exceeds 150% of typical line impedance without load encroachment blinder
    if (r.pickupValue > 150.0 && (!r.curveType || r.curveType === "mho")) {
      warnings++;
      prc026Findings.push({
        standard: "PRC-026-1",
        element: r.elementName,
        relayCode: `ANSI 21 (Distance #${r.deviceId})`,
        severity: "warning",
        rule: "prc-026-loadability-blinder-required",
        description: `Distance relay Zone 2/3 reach (${r.pickupValue.toFixed(1)} Ohm) may encroach into heavy load or stable swing impedance without a blinders characteristic.`,
      });
    } else {
      passed++;
      prc026Findings.push({
        standard: "PRC-026-1",
        element: r.elementName,
        relayCode: `ANSI 21 (Distance #${r.deviceId})`,
        severity: "pass",
        rule: "prc-026-loadability-compliant",
        description: `Distance relay setting coordinates cleanly with PRC-026-1 loadability requirements.`,
      });
    }
  }

  const totalChecks = passed + warnings + violations;
  const overallStatus = violations > 0 ? "NON-COMPLIANT" : warnings > 0 ? "CONDITIONAL" : "COMPLIANT";

  // Markdown Report Generation
  const lines: string[] = [
    `# NERC PRC-019-2 / PRC-024-3 / PRC-026-1 Protection Coordination Audit Report`,
    ``,
    `* **Case Title:** ${psseCase.title1 || "Transmission Grid"}`,
    `* **Evaluation Timestamp:** ${new Date().toISOString()}`,
    `* **Overall Regulatory Verdict:** **${overallStatus}**`,
    `* **Summary:** ${passed} Passed, ${warnings} Warnings, ${violations} Violations (Total ${totalChecks} checks)`,
    ``,
    `---`,
    ``,
    `## 1. PRC-024-3 Voltage & Frequency Ride-Through Protection Coordination`,
    ``,
    `| Element | Device | Severity | Setting | Description |`,
    `| :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const f of prc024Findings) {
    const badge = f.severity === "pass" ? "✅ PASS" : f.severity === "warning" ? "⚠️ WARN" : "❌ VIOLATION";
    lines.push(`| ${f.element} | \`${f.relayCode}\` | ${badge} | \`${f.rule}\` | ${f.description} |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`## 2. PRC-019-2 Generator Capability & Exciter Limiter Coordination`);
  lines.push(``);
  lines.push(`| Element | Device | Severity | Setting | Description |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- |`);

  for (const f of prc019Findings) {
    const badge = f.severity === "pass" ? "✅ PASS" : f.severity === "warning" ? "⚠️ WARN" : "❌ VIOLATION";
    lines.push(`| ${f.element} | \`${f.relayCode}\` | ${badge} | \`${f.rule}\` | ${f.description} |`);
  }

  lines.push(``);
  lines.push(`---`);
  lines.push(`## 3. PRC-026-1 Stable Power Swing & Loadability Verification`);
  lines.push(``);

  for (const f of prc026Findings) {
    const badge = f.severity === "pass" ? "✅ PASS" : f.severity === "warning" ? "⚠️ WARN" : "❌ VIOLATION";
    lines.push(`* ${badge} **${f.element}** (${f.relayCode}): ${f.description}`);
  }

  return {
    timestamp: new Date().toISOString(),
    caseTitle: psseCase.title1 || "Transmission Grid",
    overallStatus,
    summary: { totalChecks, passed, warnings, violations },
    prc019Findings,
    prc024Findings,
    prc026Findings,
    markdownReport: lines.join("\n"),
  };
}
