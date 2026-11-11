// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for IEEE 1815 / DNP3 Device Profiles.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseDnp3 } from "./parser/dnp3-parser.js";
import type { Dnp3DeviceProfile } from "./types.js";

export interface Dnp3WorkspaceModel {
  uri: string;
  id: string;
  deviceName: string;
  vendor: string;
  outstationAddress: number;
  binaryInputCount: number;
  analogInputCount: number;
  totalPointCount: number;
}

export function canIndexDnp3(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".dnp3")) return true;
  if (text && (text.includes("DNP3DeviceProfile") || text.includes('"outstationAddress"'))) {
    return true;
  }
  return false;
}

export function buildDnp3WorkspaceModel(uri: string, profile: Dnp3DeviceProfile): Dnp3WorkspaceModel {
  const totalPointCount =
    profile.binaryInputs.length +
    profile.binaryOutputs.length +
    profile.analogInputs.length +
    profile.analogOutputs.length +
    profile.counters.length;

  return {
    uri,
    id: profile.id,
    deviceName: profile.deviceName,
    vendor: profile.vendor,
    outstationAddress: profile.outstationAddress,
    binaryInputCount: profile.binaryInputs.length,
    analogInputCount: profile.analogInputs.length,
    totalPointCount,
  };
}

export function indexDnp3Document(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    const profile = parseDnp3(text);
    const model = buildDnp3WorkspaceModel(uri, profile);
    ctx.setParsedModel(model);
    ctx.setParsedModel(profile, "profile");

    const rootName = profile.deviceName || profile.id || "DNP3_Device";
    const aliases = [profile.id, profile.deviceName].filter((s): s is string => Boolean(s) && s !== rootName);

    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      text.length,
      {
        id: profile.id,
        deviceName: profile.deviceName,
        vendor: profile.vendor,
        outstationAddress: profile.outstationAddress,
        totalPointCount: model.totalPointCount,
      },
      {
        ruleName: "dnp3_device",
        namePath: rootName,
        aliases: aliases.length > 0 ? aliases : undefined,
      },
    );

    for (const bi of profile.binaryInputs) {
      ctx.addSymbol(
        bi.name,
        "Variable",
        rootId,
        0,
        0,
        { index: bi.index, eventClass: bi.eventClass },
        { ruleName: "dnp3_binary_input", namePath: `${rootName}.${bi.name}` },
      );
    }

    for (const bo of profile.binaryOutputs) {
      ctx.addSymbol(
        bo.name,
        "Variable",
        rootId,
        0,
        0,
        { index: bo.index },
        { ruleName: "dnp3_binary_output", namePath: `${rootName}.${bo.name}` },
      );
    }

    for (const ai of profile.analogInputs) {
      ctx.addSymbol(
        ai.name,
        "Variable",
        rootId,
        0,
        0,
        { index: ai.index, units: ai.units, deadband: ai.deadband },
        { ruleName: "dnp3_analog_input", namePath: `${rootName}.${ai.name}` },
      );
    }

    for (const ao of profile.analogOutputs) {
      ctx.addSymbol(
        ao.name,
        "Variable",
        rootId,
        0,
        0,
        { index: ao.index, units: ao.units },
        { ruleName: "dnp3_analog_output", namePath: `${rootName}.${ao.name}` },
      );
    }

    for (const ctr of profile.counters) {
      ctx.addSymbol(
        ctr.name,
        "Variable",
        rootId,
        0,
        0,
        { index: ctr.index, units: ctr.units },
        { ruleName: "dnp3_counter", namePath: `${rootName}.${ctr.name}` },
      );
    }
  } catch {
    // Ignore indexing errors for non-DNP3 files
  }
}

export function getDnp3Model(workspace: UnifiedWorkspace, uri: string): Dnp3WorkspaceModel | undefined {
  return workspace.getParsedModel<Dnp3WorkspaceModel>(uri);
}

export function getAllDnp3Models(workspace: UnifiedWorkspace): Dnp3WorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<Dnp3WorkspaceModel>().values());
}
