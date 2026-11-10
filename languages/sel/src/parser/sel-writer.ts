// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SELRelaySettings, SettingsGroup } from "../types.js";

/**
 * Serializes SELRelaySettings into clean ASCII settings dump (.rcf, .sel).
 */
export function writeSELAscii(settings: SELRelaySettings): string {
  const lines: string[] = [];

  lines.push(`// ModelScript SEL Relay Settings Export`);
  lines.push(`// Generated for ${settings.relayId} (${settings.terminalId})`);
  lines.push(`=>>SHOW SET`);
  lines.push(`RELAY="${settings.relayType}"`);
  lines.push(`RID="${settings.relayId}"`);
  lines.push(`TID="${settings.terminalId}"`);
  if (settings.partNumber) lines.push(`PARTNO="${settings.partNumber}"`);
  if (settings.firmwareVersion) lines.push(`FID="${settings.firmwareVersion}"`);
  lines.push(`ACTIVE_GROUP=${settings.activeGroup}`);
  lines.push(`NFREQ=${settings.frequencyHz.toFixed(1)}`);
  lines.push(`PHROT=${settings.phaseRotation}`);
  lines.push(`CTRH=${settings.ratios.ctRatioPhase}`);
  lines.push(`CTRL=${settings.ratios.ctRatioGround}`);
  lines.push(`PTR=${settings.ratios.ptRatioPhase}`);
  lines.push(`PTRN=${settings.ratios.ptRatioNeutral}`);

  for (const [gNum, group] of settings.groups.entries()) {
    lines.push(``);
    lines.push(`GROUP ${gNum}`);

    if (group.phaseOvercurrent) {
      const po = group.phaseOvercurrent;
      if (po.inst50P1P !== undefined) lines.push(`50P1P=${po.inst50P1P.toFixed(2)}`);
      if (po.inst50P2P !== undefined) lines.push(`50P2P=${po.inst50P2P.toFixed(2)}`);
      if (po.time51P1P !== undefined) lines.push(`51P1P=${po.time51P1P.toFixed(2)}`);
      if (po.curve51P1C !== undefined) lines.push(`51P1C=${po.curve51P1C}`);
      if (po.timeDial51P1TD !== undefined) lines.push(`51P1TD=${po.timeDial51P1TD.toFixed(2)}`);
    }

    if (group.groundOvercurrent) {
      const go = group.groundOvercurrent;
      if (go.inst50G1P !== undefined) lines.push(`50G1P=${go.inst50G1P.toFixed(2)}`);
      if (go.time51G1P !== undefined) lines.push(`51G1P=${go.time51G1P.toFixed(2)}`);
      if (go.curve51G1C !== undefined) lines.push(`51G1C=${go.curve51G1C}`);
      if (go.timeDial51G1TD !== undefined) lines.push(`51G1TD=${go.timeDial51G1TD.toFixed(2)}`);
    }

    if (group.distance) {
      const d = group.distance;
      if (d.zone1Reach !== undefined) lines.push(`Z1P=${d.zone1Reach.toFixed(2)}`);
      if (d.zone2Reach !== undefined) lines.push(`Z2P=${d.zone2Reach.toFixed(2)}`);
      if (d.zone3Reach !== undefined) lines.push(`Z3P=${d.zone3Reach.toFixed(2)}`);
      if (d.zone1TimeCycles !== undefined) lines.push(`Z1D=${d.zone1TimeCycles}`);
      if (d.zone2TimeCycles !== undefined) lines.push(`Z2D=${d.zone2TimeCycles}`);
      if (d.zone3TimeCycles !== undefined) lines.push(`Z3D=${d.zone3TimeCycles}`);
    }

    if (group.voltage) {
      const v = group.voltage;
      if (v.underVoltage27P !== undefined) lines.push(`27P=${v.underVoltage27P.toFixed(1)}`);
      if (v.overVoltage59P !== undefined) lines.push(`59P=${v.overVoltage59P.toFixed(1)}`);
    }

    if (group.frequency) {
      const f = group.frequency;
      if (f.underFreq81U !== undefined) lines.push(`81U=${f.underFreq81U.toFixed(2)}`);
      if (f.overFreq81O !== undefined) lines.push(`81O=${f.overFreq81O.toFixed(2)}`);
    }

    for (const [target, expr] of Object.entries(group.equations)) {
      lines.push(`${target}=${expr}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Serializes SELRelaySettings into formatted JSON string.
 */
export function writeSELJson(settings: SELRelaySettings): string {
  const groupsObj: Record<string, SettingsGroup> = {};
  for (const [gNum, group] of settings.groups.entries()) {
    groupsObj[gNum.toString()] = group;
  }

  const exportObj = {
    relayType: settings.relayType,
    relayId: settings.relayId,
    terminalId: settings.terminalId,
    partNumber: settings.partNumber,
    firmwareVersion: settings.firmwareVersion,
    activeGroup: settings.activeGroup,
    frequencyHz: settings.frequencyHz,
    phaseRotation: settings.phaseRotation,
    ratios: settings.ratios,
    groups: groupsObj,
    globalEquations: settings.globalEquations,
  };

  return JSON.stringify(exportObj, null, 2);
}
