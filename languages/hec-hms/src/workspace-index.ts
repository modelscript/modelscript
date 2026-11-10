// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for USACE HEC-HMS projects (.hms, .basin).
 */

import { parseHmsBasin } from "./parser/hms-parser.js";
import type { HmsBasinModel } from "./types.js";

export interface HmsWorkspaceModel {
  uri: string;
  basin: HmsBasinModel;
}

export class HmsWorkspaceIndex {
  private readonly basins = new Map<string, HmsWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    if (content.includes("Basin:") || content.includes("Subbasin:") || content.includes("Reach:")) {
      const basin = parseHmsBasin(content);
      this.basins.set(uri, { uri, basin });
    }
  }

  public getModel(uri: string): HmsWorkspaceModel | undefined {
    return this.basins.get(uri);
  }

  public getAllModels(): HmsWorkspaceModel[] {
    return Array.from(this.basins.values());
  }

  public clear(): void {
    this.basins.clear();
  }
}
