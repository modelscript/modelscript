// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for COMTRADE fault & disturbance records (.cfg, .dat, .cff).
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseComtradeCff, parseComtradeCfg } from "./parser/comtrade-reader.js";
import type { ComtradeConfig } from "./types.js";

export interface ComtradeWorkspaceModel {
  uri: string;
  stationName: string;
  recDevId: string;
  year: number;
  analogChannelCount: number;
  digitalChannelCount: number;
  sampleRate: number;
}

export function canIndexComtrade(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".cff")) return true;
  if (text && text.includes("--- file type: CFG ---")) return true;
  if (lower.endsWith(".cfg") && text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length >= 2 && /^\s*\d+\s*,\s*\d+A\s*,\s*\d+D/i.test(lines[1] ?? "")) {
      return true;
    }
  }
  return false;
}

function buildComtradeModel(uri: string, cfg: ComtradeConfig): ComtradeWorkspaceModel {
  return {
    uri,
    stationName: cfg.stationName,
    recDevId: cfg.recordingDeviceId ?? cfg.recDevId ?? "",
    year: cfg.standardVersionYear ?? cfg.revYear ?? 1999,
    analogChannelCount: cfg.analogChannels?.length ?? cfg.analogCount ?? 0,
    digitalChannelCount: cfg.digitalChannels?.length ?? cfg.digitalCount ?? 0,
    sampleRate: cfg.samplingRates?.[0]?.rateHz ?? cfg.sampleRates?.[0]?.rate ?? 0,
  };
}

export function indexComtradeDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    let cfg: ComtradeConfig | undefined;
    if (uri.toLowerCase().endsWith(".cff") || text.includes("--- file type: CFG ---")) {
      const record = parseComtradeCff(text);
      cfg = record.config ?? record.cfg;
    } else if (uri.toLowerCase().endsWith(".cfg") || text.includes(",")) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length >= 2) {
        cfg = parseComtradeCfg(text);
      }
    }
    if (!cfg) return;

    const model = buildComtradeModel(uri, cfg);
    ctx.setParsedModel(model);

    const stationName = model.stationName || "COMTRADE_Record";
    const rootId = ctx.addSymbol(
      stationName,
      "Package",
      null,
      0,
      text.length,
      {
        stationName: model.stationName,
        recDevId: model.recDevId,
        year: model.year,
        analogChannelCount: model.analogChannelCount,
        digitalChannelCount: model.digitalChannelCount,
        sampleRate: model.sampleRate,
      },
      {
        ruleName: "comtrade_station",
        namePath: stationName,
        aliases: model.recDevId ? [model.recDevId] : undefined,
      },
    );

    for (const ch of cfg.analogChannels ?? []) {
      const chName = ch.name || ch.chId || `Analog_${ch.index}`;
      ctx.addSymbol(
        chName,
        "Variable",
        rootId,
        0,
        0,
        { index: ch.index, phase: ch.phase, unit: ch.unit },
        {
          ruleName: "comtrade_analog_channel",
          namePath: `${stationName}.${chName}`,
        },
      );
    }

    for (const ch of cfg.digitalChannels ?? []) {
      const chName = ch.name || ch.chId || `Digital_${ch.index}`;
      ctx.addSymbol(
        chName,
        "Variable",
        rootId,
        0,
        0,
        { index: ch.index, phase: ch.phase, normalState: ch.normalState },
        {
          ruleName: "comtrade_digital_channel",
          namePath: `${stationName}.${chName}`,
        },
      );
    }
  } catch {
    // Ignore indexing errors for non-COMTRADE files
  }
}

export function getComtradeModel(workspace: UnifiedWorkspace, uri: string): ComtradeWorkspaceModel | undefined {
  return workspace.getParsedModel<ComtradeWorkspaceModel>(uri);
}

export function getAllComtradeModels(workspace: UnifiedWorkspace): ComtradeWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<ComtradeWorkspaceModel>().values());
}
