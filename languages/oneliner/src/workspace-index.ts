// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for ASPEN OneLiner / CAPE Short-Circuit Models.
 */

import { parseOneLiner } from "./parser/oneliner-parser.js";
import type { OneLinerCase } from "./types.js";

export interface OneLinerWorkspaceModel {
  uri: string;
  title: string;
  baseMva: number;
  busCount: number;
  branchCount: number;
  generatorCount: number;
  relayCount: number;
  busIds: string[];
}

export class OneLinerWorkspaceIndex {
  private readonly models = new Map<string, OneLinerWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      const c = parseOneLiner(content);
      this.addCase(uri, c);
    } catch {
      // Ignore indexing errors for non-OneLiner files
    }
  }

  public addCase(uri: string, c: OneLinerCase): void {
    this.models.set(uri, {
      uri,
      title: c.title,
      baseMva: c.baseMva,
      busCount: c.busses.length,
      branchCount: c.branches.length,
      generatorCount: c.generators.length,
      relayCount: c.overcurrentRelays.length + c.distanceRelays.length,
      busIds: c.busses.map((b) => b.id),
    });
  }

  public getModel(uri: string): OneLinerWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): OneLinerWorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public clear(): void {
    this.models.clear();
  }
}
