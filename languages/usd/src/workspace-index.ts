// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usd — Multi-file Workspace Indexer for OpenUSD Stages.
 */

import { parseUsd } from "./parser/index.js";
import type { UsdPrim, UsdStage } from "./types.js";

export interface UsdIndexedFile {
  filePath: string;
  stage: UsdStage;
  primPaths: Set<string>;
}

export class UsdWorkspaceIndex {
  private files = new Map<string, UsdIndexedFile>();
  private primToFiles = new Map<string, Set<string>>();

  /** Indexes or updates an OpenUSD source file (.usda, .usd) in the workspace. */
  public indexDocument(filePath: string, content: string): UsdStage {
    const stage = parseUsd(content);
    const primPaths = new Set<string>();

    for (const path of stage.prims.keys()) {
      primPaths.add(path);
      let set = this.primToFiles.get(path);
      if (!set) {
        set = new Set();
        this.primToFiles.set(path, set);
      }
      set.add(filePath);
    }

    this.files.set(filePath, { filePath, stage, primPaths });
    return stage;
  }

  /** Removes a document from the index. */
  public removeDocument(filePath: string): void {
    const file = this.files.get(filePath);
    if (!file) return;

    for (const p of file.primPaths) {
      const set = this.primToFiles.get(p);
      if (set) {
        set.delete(filePath);
        if (set.size === 0) this.primToFiles.delete(p);
      }
    }
    this.files.delete(filePath);
  }

  /** Retrieves a stage for an indexed file. */
  public getStage(filePath: string): UsdStage | undefined {
    return this.files.get(filePath)?.stage;
  }

  /** Finds a prim by path across the workspace. */
  public findPrim(primPath: string): { filePath: string; prim: UsdPrim } | null {
    const filePaths = this.primToFiles.get(primPath);
    if (!filePaths || filePaths.size === 0) return null;

    const firstPath = filePaths.values().next().value;
    if (!firstPath) return null;
    const file = this.files.get(firstPath);
    if (!file) return null;

    const prim = file.stage.prims.get(primPath);
    return prim ? { filePath: firstPath, prim } : null;
  }
}
