// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for Wastewater Treatment Plant Models (.asm, .bsm, .wrrf).
 */

import { parseAsmPlant } from "./parser/asm-parser.js";
import type { AsmPlantModel } from "./types.js";

export interface AsmWorkspaceModel {
  uri: string;
  plantName: string;
  modelType: string;
  reactorCount: number;
  clarifierCount: number;
  plant: AsmPlantModel;
}

export class AsmWorkspaceIndex {
  private readonly plants = new Map<string, AsmWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    if (content.includes("plant ") || content.includes("bioreactor ") || content.includes("clarifier ")) {
      try {
        const plant = parseAsmPlant(content);
        this.plants.set(uri, {
          uri,
          plantName: plant.name,
          modelType: plant.modelType,
          reactorCount: plant.reactors.length,
          clarifierCount: plant.clarifiers.length,
          plant,
        });
      } catch {
        // Ignore parsing errors during indexing
      }
    }
  }

  public getModel(uri: string): AsmWorkspaceModel | undefined {
    return this.plants.get(uri);
  }

  public getAllModels(): AsmWorkspaceModel[] {
    return Array.from(this.plants.values());
  }

  public clear(): void {
    this.plants.clear();
  }
}
