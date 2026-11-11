// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for Alternative Transients Program (ATP-EMTP) Decks.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
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

/**
 * Disambiguates ATP-EMTP `.atp` and `.dat` decks in polyglot `UnifiedWorkspace` instances.
 */
export function canIndexAtp(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".atp")) return true;
  if (!text) return lower.endsWith(".dat");
  return /\b(?:BEGIN\s+NEW\s+DATA\s+CASE|BLANK\s+RECORD)\b|\/(?:BRANCH|SWITCH|SOURCE)\b/i.test(text);
}

/**
 * Declarative per-file indexer for ATP-EMTP card decks.
 */
export function indexAtpDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    const atpCase = parseAtp(text);
    const nodeSet = new Set<string>();
    for (const b of atpCase.branches) {
      if (b.node1) nodeSet.add(b.node1);
      if (b.node2) nodeSet.add(b.node2);
    }
    for (const s of atpCase.sources) {
      if (s.node) nodeSet.add(s.node);
    }

    const nodes = Array.from(nodeSet);
    const model: AtpWorkspaceModel = {
      uri,
      title: atpCase.title,
      branchCount: atpCase.branches.length,
      switchCount: atpCase.switches.length,
      sourceCount: atpCase.sources.length,
      deltaTSec: atpCase.control.deltaTSec,
      tMaxSec: atpCase.control.tMaxSec,
      nodes,
    };
    ctx.setParsedModel<AtpWorkspaceModel>(model);
    ctx.setParsedModel<AtpCase>(atpCase, "case");

    const rootId = ctx.addSymbol(
      atpCase.title || "AtpCase",
      "Class",
      null,
      0,
      text.length,
      {
        branchCount: model.branchCount,
        switchCount: model.switchCount,
        sourceCount: model.sourceCount,
        deltaTSec: model.deltaTSec,
        tMaxSec: model.tMaxSec,
      },
      { ruleName: "atp_case" },
    );

    for (const node of nodes) {
      ctx.addSymbol(node, "Variable", rootId, 0, text.length, {}, { ruleName: "atp_node" });
    }
  } catch {
    // Ignore indexing errors for non-ATP files
  }
}

/**
 * Retrieves an indexed `AtpWorkspaceModel` from `UnifiedWorkspace` for `uri`.
 */
export function getAtpModel(workspace: UnifiedWorkspace, uri: string): AtpWorkspaceModel | undefined {
  return workspace.getParsedModel<AtpWorkspaceModel>(uri);
}

/**
 * Returns all indexed `AtpWorkspaceModel` entries in `UnifiedWorkspace`.
 */
export function getAllAtpModels(workspace: UnifiedWorkspace): AtpWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<AtpWorkspaceModel>().values());
}
