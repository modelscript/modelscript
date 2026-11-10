// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CurveStandard, SELRelaySettings, SettingsGroup, TransformerRatios } from "../types.js";

/**
 * Strips wrapping quotes and trims whitespace.
 */
function cleanVal(str: string): string {
  return str
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

/**
 * Parses SEL ASCII settings dumps (.rcf, .sel, .txt).
 */
export function parseSELAscii(content: string): SELRelaySettings {
  const lines = content.split(/\r?\n/);

  let relayType = "SEL-411L";
  let relayId = "";
  let terminalId = "";
  let partNumber: string | undefined = undefined;
  let firmwareVersion: string | undefined = undefined;
  let activeGroup = 1;
  let frequencyHz = 60;
  let phaseRotation: "ABC" | "ACB" = "ABC";

  const ratios: TransformerRatios = {
    ctRatioPhase: 240,
    ctRatioGround: 240,
    ptRatioPhase: 1200,
    ptRatioNeutral: 1200,
  };

  const groups = new Map<number, SettingsGroup>();
  let currentGroup: SettingsGroup = {
    groupId: 1,
    equations: {},
  };
  groups.set(1, currentGroup);

  const globalEquations: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine || rawLine.startsWith("#") || rawLine.startsWith("//") || rawLine.startsWith("*")) {
      continue;
    }

    // Ignore console prompt lines like "=>>SHOW SET" or "=>SET"
    if (rawLine.startsWith("=>") || rawLine.startsWith("=>>")) {
      continue;
    }

    // Group switch: e.g. "GROUP 1", "GROUP 2", "[GROUP 1]"
    const groupMatch = rawLine.match(/^\[?\s*GROUP\s+(\d+)\s*\]?$/i);
    if (groupMatch && groupMatch[1]) {
      const gNum = parseInt(groupMatch[1], 10);
      let g = groups.get(gNum);
      if (!g) {
        g = { groupId: gNum, equations: {} };
        groups.set(gNum, g);
      }
      currentGroup = g;
      continue;
    }

    // Key-value pair: KEY = VALUE or KEY : VALUE
    const eqIdx = rawLine.indexOf("=");
    const colonIdx = rawLine.indexOf(":");
    let splitIdx = -1;
    if (eqIdx !== -1 && colonIdx !== -1) {
      splitIdx = Math.min(eqIdx, colonIdx);
    } else {
      splitIdx = eqIdx !== -1 ? eqIdx : colonIdx;
    }

    if (splitIdx === -1) {
      // Check for FID string: "FID=SEL-411L-R100..."
      if (rawLine.includes("FID=")) {
        const fidStr = cleanVal(rawLine.replace(/^.*FID=/, ""));
        firmwareVersion = fidStr;
        if (fidStr.startsWith("SEL-")) {
          relayType = fidStr.split("-").slice(0, 2).join("-");
        }
      }
      continue;
    }

    const key = rawLine.substring(0, splitIdx).trim().toUpperCase();
    const val = cleanVal(rawLine.substring(splitIdx + 1));

    switch (key) {
      case "RELAY":
      case "MODEL":
      case "RELAY_TYPE":
        relayType = val;
        break;
      case "RID":
      case "RELAY_ID":
        relayId = val;
        break;
      case "TID":
      case "TERMINAL_ID":
        terminalId = val;
        break;
      case "PARTNO":
      case "PART_NUMBER":
        partNumber = val;
        break;
      case "FID":
        firmwareVersion = val;
        if (val.startsWith("SEL-")) {
          relayType = val.split("-").slice(0, 2).join("-");
        }
        break;
      case "ACTIVE_GROUP":
      case "ACTGROUP":
        activeGroup = parseInt(val, 10) || 1;
        break;
      case "NFREQ":
      case "FREQ":
        frequencyHz = parseFloat(val) || 60;
        break;
      case "PHROT":
        phaseRotation = val.toUpperCase() === "ACB" ? "ACB" : "ABC";
        break;
      case "CTRH":
        ratios.ctRatioPhase = parseFloat(val) || ratios.ctRatioPhase;
        break;
      case "CTRL":
        ratios.ctRatioGround = parseFloat(val) || ratios.ctRatioGround;
        break;
      case "PTR":
        ratios.ptRatioPhase = parseFloat(val) || ratios.ptRatioPhase;
        break;
      case "PTRN":
        ratios.ptRatioNeutral = parseFloat(val) || ratios.ptRatioNeutral;
        break;

      // Phase Overcurrent
      case "50P1P": {
        const po = currentGroup.phaseOvercurrent ?? {};
        po.inst50P1P = parseFloat(val);
        currentGroup.phaseOvercurrent = po;
        break;
      }
      case "50P2P": {
        const po = currentGroup.phaseOvercurrent ?? {};
        po.inst50P2P = parseFloat(val);
        currentGroup.phaseOvercurrent = po;
        break;
      }
      case "51P1P": {
        const po = currentGroup.phaseOvercurrent ?? {};
        po.time51P1P = parseFloat(val);
        currentGroup.phaseOvercurrent = po;
        break;
      }
      case "51P1C": {
        const po = currentGroup.phaseOvercurrent ?? {};
        po.curve51P1C = val as CurveStandard;
        currentGroup.phaseOvercurrent = po;
        break;
      }
      case "51P1TD": {
        const po = currentGroup.phaseOvercurrent ?? {};
        po.timeDial51P1TD = parseFloat(val);
        currentGroup.phaseOvercurrent = po;
        break;
      }

      // Ground Overcurrent
      case "50G1P": {
        const go = currentGroup.groundOvercurrent ?? {};
        go.inst50G1P = parseFloat(val);
        currentGroup.groundOvercurrent = go;
        break;
      }
      case "51G1P": {
        const go = currentGroup.groundOvercurrent ?? {};
        go.time51G1P = parseFloat(val);
        currentGroup.groundOvercurrent = go;
        break;
      }
      case "51G1C": {
        const go = currentGroup.groundOvercurrent ?? {};
        go.curve51G1C = val as CurveStandard;
        currentGroup.groundOvercurrent = go;
        break;
      }
      case "51G1TD": {
        const go = currentGroup.groundOvercurrent ?? {};
        go.timeDial51G1TD = parseFloat(val);
        currentGroup.groundOvercurrent = go;
        break;
      }

      // Distance
      case "Z1P": {
        const d = currentGroup.distance ?? {};
        d.zone1Reach = parseFloat(val);
        currentGroup.distance = d;
        break;
      }
      case "Z2P": {
        const d = currentGroup.distance ?? {};
        d.zone2Reach = parseFloat(val);
        currentGroup.distance = d;
        break;
      }
      case "Z3P": {
        const d = currentGroup.distance ?? {};
        d.zone3Reach = parseFloat(val);
        currentGroup.distance = d;
        break;
      }
      case "Z1D": {
        const d = currentGroup.distance ?? {};
        d.zone1TimeCycles = parseFloat(val);
        currentGroup.distance = d;
        break;
      }
      case "Z2D": {
        const d = currentGroup.distance ?? {};
        d.zone2TimeCycles = parseFloat(val);
        currentGroup.distance = d;
        break;
      }
      case "Z3D": {
        const d = currentGroup.distance ?? {};
        d.zone3TimeCycles = parseFloat(val);
        currentGroup.distance = d;
        break;
      }

      // Voltage
      case "27P": {
        const v = currentGroup.voltage ?? {};
        v.underVoltage27P = parseFloat(val);
        currentGroup.voltage = v;
        break;
      }
      case "59P": {
        const v = currentGroup.voltage ?? {};
        v.overVoltage59P = parseFloat(val);
        currentGroup.voltage = v;
        break;
      }

      // Frequency
      case "81U": {
        const f = currentGroup.frequency ?? {};
        f.underFreq81U = parseFloat(val);
        currentGroup.frequency = f;
        break;
      }
      case "81O": {
        const f = currentGroup.frequency ?? {};
        f.overFreq81O = parseFloat(val);
        currentGroup.frequency = f;
        break;
      }

      // SELogic Equations
      default: {
        // Any recognized SELogic target (TRIP, CLOSE, SV01..16, OUT101..108, LT01..16) or custom target
        if (
          key.startsWith("TRIP") ||
          key.startsWith("CLOSE") ||
          key.startsWith("SV") ||
          key.startsWith("OUT") ||
          key.startsWith("LT") ||
          key.startsWith("IN") ||
          key.startsWith("DLOGIC")
        ) {
          currentGroup.equations[key] = val;
        } else {
          // If in root scope, assign global or group equation
          currentGroup.equations[key] = val;
        }
        break;
      }
    }
  }

  const result: SELRelaySettings = {
    relayType,
    relayId: relayId || "SEL_RELAY_1",
    terminalId: terminalId || "FEEDER_1",
    activeGroup,
    frequencyHz,
    phaseRotation,
    ratios,
    groups,
    globalEquations,
  };
  if (partNumber !== undefined) result.partNumber = partNumber;
  if (firmwareVersion !== undefined) result.firmwareVersion = firmwareVersion;

  return result;
}

/**
 * Parses JSON SEL settings representation (.json, .rdb).
 */
export function parseSELJson(jsonStr: string): SELRelaySettings {
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  const relayType = typeof parsed["relayType"] === "string" ? parsed["relayType"] : "SEL-411L";
  const relayId = typeof parsed["relayId"] === "string" ? parsed["relayId"] : "SEL_RELAY_1";
  const terminalId = typeof parsed["terminalId"] === "string" ? parsed["terminalId"] : "FEEDER_1";
  const activeGroup = typeof parsed["activeGroup"] === "number" ? parsed["activeGroup"] : 1;
  const frequencyHz = typeof parsed["frequencyHz"] === "number" ? parsed["frequencyHz"] : 60;
  const phaseRotation = parsed["phaseRotation"] === "ACB" ? "ACB" : "ABC";

  const rawRatios = (parsed["ratios"] ?? {}) as Partial<TransformerRatios>;
  const ratios: TransformerRatios = {
    ctRatioPhase: rawRatios.ctRatioPhase ?? 240,
    ctRatioGround: rawRatios.ctRatioGround ?? 240,
    ptRatioPhase: rawRatios.ptRatioPhase ?? 1200,
    ptRatioNeutral: rawRatios.ptRatioNeutral ?? 1200,
  };

  const groups = new Map<number, SettingsGroup>();
  if (parsed["groups"] && typeof parsed["groups"] === "object") {
    const rawGroups = parsed["groups"] as Record<string, SettingsGroup>;
    for (const [key, grp] of Object.entries(rawGroups)) {
      const gNum = parseInt(key, 10);
      if (!isNaN(gNum)) {
        groups.set(gNum, {
          groupId: grp.groupId ?? gNum,
          groupName: grp.groupName,
          phaseOvercurrent: grp.phaseOvercurrent,
          groundOvercurrent: grp.groundOvercurrent,
          distance: grp.distance,
          voltage: grp.voltage,
          frequency: grp.frequency,
          equations: grp.equations ?? {},
        });
      }
    }
  }

  if (groups.size === 0) {
    groups.set(1, { groupId: 1, equations: {} });
  }

  const res: SELRelaySettings = {
    relayType,
    relayId,
    terminalId,
    activeGroup,
    frequencyHz,
    phaseRotation,
    ratios,
    groups,
    globalEquations: (parsed["globalEquations"] as Record<string, string>) ?? {},
  };

  if (typeof parsed["partNumber"] === "string") res.partNumber = parsed["partNumber"];
  if (typeof parsed["firmwareVersion"] === "string") res.firmwareVersion = parsed["firmwareVersion"];

  return res;
}

/**
 * Universal SEL settings parser detecting JSON vs ASCII format automatically.
 */
export function parseSELSettings(content: string): SELRelaySettings {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return parseSELJson(trimmed);
    } catch {
      return parseSELAscii(content);
    }
  }
  return parseSELAscii(content);
}
