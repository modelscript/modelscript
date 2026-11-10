// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for Schweitzer Engineering Laboratories (SEL) Relay Settings.
 */

import { parseSELSettings } from "./parser/sel-parser.js";
import type { SELRelaySettings } from "./types.js";

export interface SelWorkspaceModel {
  uri: string;
  relayType: string;
  relayId: string;
  terminalId: string;
  activeGroup: number;
  groupCount: number;
  equationCount: number;
}

export class SelWorkspaceIndex {
  private readonly models = new Map<string, SelWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      const settings = parseSELSettings(content);
      this.addSettings(uri, settings);
    } catch {
      // Ignore indexing errors for invalid files
    }
  }

  public addSettings(uri: string, settings: SELRelaySettings): void {
    let equationCount = Object.keys(settings.globalEquations).length;
    for (const group of settings.groups.values()) {
      equationCount += Object.keys(group.equations).length;
    }

    this.models.set(uri, {
      uri,
      relayType: settings.relayType,
      relayId: settings.relayId,
      terminalId: settings.terminalId,
      activeGroup: settings.activeGroup,
      groupCount: settings.groups.size,
      equationCount,
    });
  }

  public getModel(uri: string): SelWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): SelWorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public removeDocument(uri: string): void {
    this.models.delete(uri);
  }

  public clear(): void {
    this.models.clear();
  }
}
