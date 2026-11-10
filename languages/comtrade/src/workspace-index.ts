// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for COMTRADE fault & disturbance records (.cfg, .dat, .cff).
 */

import { parseComtradeCff, parseComtradeCfg } from "./parser/comtrade-reader.js";
import type { ComtradeRecord } from "./types.js";

export interface ComtradeWorkspaceModel {
  uri: string;
  stationName: string;
  recDevId: string;
  year: number;
  analogChannelCount: number;
  digitalChannelCount: number;
  sampleRate: number;
}

export class ComtradeWorkspaceIndex {
  private readonly models = new Map<string, ComtradeWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      if (uri.endsWith(".cff") || content.includes("--- file type: CFG ---")) {
        const record = parseComtradeCff(content);
        this.addRecord(uri, record);
      } else if (uri.endsWith(".cfg") || content.includes(",")) {
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length >= 2) {
          const cfg = parseComtradeCfg(content);
          this.models.set(uri, {
            uri,
            stationName: cfg.stationName,
            recDevId: cfg.recordingDeviceId ?? cfg.recDevId ?? "",
            year: cfg.standardVersionYear ?? cfg.revYear ?? 1999,
            analogChannelCount: cfg.analogChannels?.length ?? cfg.analogCount ?? 0,
            digitalChannelCount: cfg.digitalChannels?.length ?? cfg.digitalCount ?? 0,
            sampleRate: cfg.samplingRates?.[0]?.rateHz ?? cfg.sampleRates?.[0]?.rate ?? 0,
          });
        }
      }
    } catch {
      // Ignore indexing errors for non-COMTRADE files
    }
  }

  private addRecord(uri: string, record: ComtradeRecord): void {
    const cfg = record.config ?? record.cfg;
    if (!cfg) return;
    this.models.set(uri, {
      uri,
      stationName: cfg.stationName,
      recDevId: cfg.recordingDeviceId ?? cfg.recDevId ?? "",
      year: cfg.standardVersionYear ?? cfg.revYear ?? 1999,
      analogChannelCount: cfg.analogChannels?.length ?? cfg.analogCount ?? 0,
      digitalChannelCount: cfg.digitalChannels?.length ?? cfg.digitalCount ?? 0,
      sampleRate: cfg.samplingRates?.[0]?.rateHz ?? cfg.sampleRates?.[0]?.rate ?? 0,
    });
  }

  public getModel(uri: string): ComtradeWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): ComtradeWorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public clear(): void {
    this.models.clear();
  }
}
