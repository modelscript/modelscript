// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Workspace Index for MATPOWER cases (.m).
 */

import { parseMatpowerCase } from "./parser/matpower-parser.js";
import type { MatpowerCase } from "./types.js";

export interface MatpowerWorkspaceModel {
  uri: string;
  caseData: MatpowerCase;
}

export class MatpowerWorkspaceIndex {
  private readonly cases = new Map<string, MatpowerWorkspaceModel>();

  public indexDocument(uri: string, content: string): void {
    if (content.includes("mpc.bus") || content.includes("mpc.gen") || content.includes("mpc.baseMVA")) {
      const caseData = parseMatpowerCase(content);
      this.cases.set(uri, { uri, caseData });
    }
  }

  public getModel(uri: string): MatpowerWorkspaceModel | undefined {
    return this.cases.get(uri);
  }

  public getAllModels(): MatpowerWorkspaceModel[] {
    return Array.from(this.cases.values());
  }

  public clear(): void {
    this.cases.clear();
  }
}
