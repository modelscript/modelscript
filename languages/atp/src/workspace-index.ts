// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for Alternative Transients Program (ATP-EMTP) Decks.
 */

import { parseAtp } from "./parser/atp-parser.js";
import type { AtpCase } from "./types.js";

export interface AtpWorkspaceModel {
  uri: string;
  title: string;
  branchCount: number;
  switchCount: number;
  sourceCount: number;
  deltaTSec: number;
  tMaxSec: number;
  nodes: string[];
}

export class AtpWorkspaceIndex {
  private readonly models = new Map<string, AtpWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    try {
      const atpCase = parseAtp(content);
      this.addCase(uri, atpCase);
    } catch {
      // Ignore indexing errors for non-ATP files
    }
  }

  public addCase(uri: string, atpCase: AtpCase): void {
    const nodeSet = new Set<string>();
    for (const b of atpCase.branches) {
      if (b.node1) nodeSet.add(b.node1);
      if (b.node2) nodeSet.add(b.node2);
    }
    for (const s of atpCase.sources) {
      if (s.node) nodeSet.add(s.node);
    }

    this.models.set(uri, {
      uri,
      title: atpCase.title,
      branchCount: atpCase.branches.length,
      switchCount: atpCase.switches.length,
      sourceCount: atpCase.sources.length,
      deltaTSec: atpCase.control.deltaTSec,
      tMaxSec: atpCase.control.tMaxSec,
      nodes: Array.from(nodeSet),
    });
  }

  public getModel(uri: string): AtpWorkspaceModel | undefined {
    return this.models.get(uri);
  }

  public getAllModels(): AtpWorkspaceModel[] {
    return Array.from(this.models.values());
  }

  public clear(): void {
    this.models.clear();
  }
}
