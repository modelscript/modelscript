// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for IEC 61850 SCL files (.scd, .cid, .icd, .ssd, .iid).
 */

import { parseSclXml } from "./parser/scl-parser.js";
import type { SclDocument } from "./types.js";

export interface SclWorkspaceModel {
  uri: string;
  substationName: string;
  headerId: string;
  voltageLevelsCount: number;
  iedCount: number;
  doc: SclDocument;
}

export class SclWorkspaceIndex {
  private readonly documents = new Map<string, SclWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    if (content.includes("<SCL") || content.includes("<Substation") || content.includes("<IED")) {
      try {
        const doc = parseSclXml(content);
        this.documents.set(uri, {
          uri,
          substationName: doc.substation?.name ?? "Substation",
          headerId: doc.header.id,
          voltageLevelsCount: doc.substation?.voltageLevels.length ?? 0,
          iedCount: doc.ieds.size,
          doc,
        });
      } catch {
        // Ignore parsing errors during indexation
      }
    }
  }

  public getModel(uri: string): SclWorkspaceModel | undefined {
    return this.documents.get(uri);
  }

  public getAllModels(): SclWorkspaceModel[] {
    return Array.from(this.documents.values());
  }

  public clear(): void {
    this.documents.clear();
  }
}
