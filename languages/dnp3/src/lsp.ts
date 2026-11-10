// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for IEEE 1815 / DNP3 Device Profiles.
 */

import { lintDnp3Profile } from "./lints/index.js";
import { parseDnp3 } from "./parser/dnp3-parser.js";
import type { Dnp3DeviceProfile } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnosticItem {
  range: LspRange;
  severity: 1 | 2 | 3;
  code?: string | number | undefined;
  source: string;
  message: string;
}

export function getDnp3DocumentSymbols(content: string): LspDocumentSymbol[] {
  let profile: Dnp3DeviceProfile;
  try {
    profile = parseDnp3(content);
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  const defaultRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, totalLines - 1), character: (lines[totalLines - 1] ?? "").length },
  };

  const rootSymbol: LspDocumentSymbol = {
    name: `${profile.deviceName} (${profile.vendor})`,
    detail: `DNP3 Outstation (Addr: ${profile.outstationAddress}, Master: ${profile.masterAddress})`,
    kind: LspSymbolKind.Package,
    range: defaultRange,
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: profile.deviceName.length } },
    children: [],
  };

  if (profile.binaryInputs.length > 0) {
    rootSymbol.children?.push({
      name: `Binary Inputs (${profile.binaryInputs.length})`,
      detail: "Breaker Status, Pump State, Alarms",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: profile.binaryInputs.map((bi) => ({
        name: `BI[${bi.index}]: ${bi.name}`,
        detail: `Class ${bi.eventClass}${bi.normalState !== undefined ? ` (normal: ${bi.normalState})` : ""}`,
        kind: LspSymbolKind.Boolean,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (profile.binaryOutputs.length > 0) {
    rootSymbol.children?.push({
      name: `Binary Outputs (${profile.binaryOutputs.length})`,
      detail: "Trip/Close Breakers, Start/Stop Pumps",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: profile.binaryOutputs.map((bo) => ({
        name: `BO[${bo.index}]: ${bo.name}`,
        detail: "Control Command Point",
        kind: LspSymbolKind.Event,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (profile.analogInputs.length > 0) {
    rootSymbol.children?.push({
      name: `Analog Inputs (${profile.analogInputs.length})`,
      detail: "Voltages, Currents, Powers, Pressures, Flows",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: profile.analogInputs.map((ai) => ({
        name: `AI[${ai.index}]: ${ai.name}`,
        detail: `Deadband: ${ai.deadband} | Unit: ${ai.units || "-"} | Scale: ${ai.scalingMultiplier}x + ${ai.scalingOffset}`,
        kind: LspSymbolKind.Number,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  if (profile.counters.length > 0) {
    rootSymbol.children?.push({
      name: `Counters (${profile.counters.length})`,
      detail: "Energy, Cumulative Volume",
      kind: LspSymbolKind.Namespace,
      range: defaultRange,
      selectionRange: defaultRange,
      children: profile.counters.map((c) => ({
        name: `CTR[${c.index}]: ${c.name}`,
        detail: `Class ${c.eventClass}${c.units ? ` [${c.units}]` : ""}`,
        kind: LspSymbolKind.Variable,
        range: defaultRange,
        selectionRange: defaultRange,
      })),
    });
  }

  return [rootSymbol];
}

export function getDnp3Diagnostics(content: string): LspDiagnosticItem[] {
  let profile: Dnp3DeviceProfile;
  try {
    profile = parseDnp3(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
        severity: 1,
        code: "DNP1001",
        source: "dnp3-lint",
        message: `DNP3 parse error: ${msg}`,
      },
    ];
  }

  const lints = lintDnp3Profile(profile);
  return lints.map((l) => ({
    range: {
      start: { line: l.pointIndex !== undefined ? Math.min(l.pointIndex, 500) : 0, character: 0 },
      end: { line: l.pointIndex !== undefined ? Math.min(l.pointIndex, 500) : 0, character: 80 },
    },
    severity: l.severity === "error" ? 1 : l.severity === "warning" ? 2 : 3,
    code: l.code,
    source: "dnp3-lint",
    message: l.message,
  }));
}
