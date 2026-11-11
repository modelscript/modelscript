// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sel — Declarative UnifiedWorkspace Indexing & Model Helpers.
 *
 * Indexes Schweitzer Engineering Laboratories (SEL) Relay Settings (.rcf, .rdb, .sel, .txt) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
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

export function buildSelWorkspaceModel(uri: string, settings: SELRelaySettings): SelWorkspaceModel {
  let equationCount = Object.keys(settings.globalEquations).length;
  for (const group of settings.groups.values()) {
    equationCount += Object.keys(group.equations).length;
  }

  return {
    uri,
    relayType: settings.relayType,
    relayId: settings.relayId,
    terminalId: settings.terminalId,
    activeGroup: settings.activeGroup,
    groupCount: settings.groups.size,
    equationCount,
  };
}

export const selIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".rcf") || lower.endsWith(".rdb") || lower.endsWith(".sel")) {
      return true;
    }
    if (!text) return false;
    return /\b(?:RELAY|RID|TID|FID)\s*=/i.test(text) || /^\s*GROUP\s+\d+/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    try {
      const settings = parseSELSettings(ctx.text);
      const model = buildSelWorkspaceModel(ctx.uri, settings);
      ctx.setParsedModel(model);
      ctx.setParsedModel(settings, "settings");

      const relayName = settings.relayId || settings.relayType || "SEL_Relay";
      const rootId = ctx.addSymbol(
        relayName,
        "Package",
        null,
        0,
        ctx.text.length,
        {
          relayType: settings.relayType,
          relayId: settings.relayId,
          terminalId: settings.terminalId,
          activeGroup: settings.activeGroup,
          groupCount: model.groupCount,
          equationCount: model.equationCount,
        },
        {
          ruleName: "sel_relay",
          namePath: relayName,
        },
      );

      for (const [grpNum, group] of settings.groups) {
        const grpLabel = group.groupName ? `GROUP ${grpNum} (${group.groupName})` : `GROUP ${grpNum}`;
        const grpId = ctx.addSymbol(
          grpLabel,
          "Module",
          rootId,
          0,
          0,
          {
            groupId: grpNum,
            equationCount: Object.keys(group.equations).length,
          },
          {
            ruleName: "sel_group",
            namePath: `${relayName}.GROUP_${grpNum}`,
          },
        );

        for (const [target, expr] of Object.entries(group.equations)) {
          ctx.addSymbol(
            target,
            "Variable",
            grpId,
            0,
            0,
            { expression: expr },
            {
              ruleName: "sel_equation",
              namePath: `${relayName}.GROUP_${grpNum}.${target}`,
            },
          );
        }
      }
    } catch {
      // Ignore indexing errors for invalid files
    }
  },
};

/**
 * Retrieves the indexed `SelWorkspaceModel` for `uri` from `UnifiedWorkspace`.
 */
export function getSelWorkspaceModel(workspace: UnifiedWorkspace, uri: string): SelWorkspaceModel | undefined {
  return workspace.getParsedModel<SelWorkspaceModel>(uri);
}

/**
 * Retrieves all indexed `SelWorkspaceModel` entries from `UnifiedWorkspace`.
 */
export function getAllSelWorkspaceModels(workspace: UnifiedWorkspace): SelWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<SelWorkspaceModel>().values());
}
