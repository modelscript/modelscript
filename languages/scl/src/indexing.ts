// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scl — Declarative UnifiedWorkspace Indexing & Model Helpers.
 *
 * Indexes IEC 61850 SCL files (.scd, .cid, .icd, .ssd, .iid, .scl) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
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

export const sclIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if ([".scd", ".cid", ".icd", ".ssd", ".iid", ".scl"].some((ext) => lower.endsWith(ext))) {
      return true;
    }
    return Boolean(text && (text.includes("<SCL") || text.includes("<Substation") || text.includes("<IED")));
  },

  indexFile(ctx: DslIndexFileContext): void {
    if (!ctx.text.includes("<SCL") && !ctx.text.includes("<Substation") && !ctx.text.includes("<IED")) {
      return;
    }

    try {
      const doc = parseSclXml(ctx.text);
      const model: SclWorkspaceModel = {
        uri: ctx.uri,
        substationName: doc.substation?.name ?? "Substation",
        headerId: doc.header.id,
        voltageLevelsCount: doc.substation?.voltageLevels.length ?? 0,
        iedCount: doc.ieds.size,
        doc,
      };
      ctx.setParsedModel(model);

      const rootId = ctx.addSymbol(
        model.substationName,
        "Package",
        null,
        0,
        ctx.text.length,
        {
          headerId: model.headerId,
          voltageLevelsCount: model.voltageLevelsCount,
          iedCount: model.iedCount,
        },
        {
          ruleName: "scl_substation",
          namePath: model.substationName,
        },
      );

      if (doc.substation) {
        for (const vl of doc.substation.voltageLevels) {
          const vlId = ctx.addSymbol(
            vl.name,
            "Module",
            rootId,
            0,
            0,
            {},
            {
              ruleName: "scl_voltage_level",
              namePath: `${model.substationName}.${vl.name}`,
            },
          );
          for (const bay of vl.bays) {
            ctx.addSymbol(
              bay.name,
              "Class",
              vlId,
              0,
              0,
              {},
              {
                ruleName: "scl_bay",
                namePath: `${model.substationName}.${vl.name}.${bay.name}`,
              },
            );
          }
        }
      }

      for (const iedName of doc.ieds.keys()) {
        ctx.addSymbol(
          iedName,
          "Component",
          rootId,
          0,
          0,
          {},
          {
            ruleName: "scl_ied",
            namePath: `${model.substationName}.${iedName}`,
          },
        );
      }
    } catch {
      // Ignore parsing errors during indexation
    }
  },
};

/**
 * Retrieves the parsed `SclWorkspaceModel` for `uri` from `UnifiedWorkspace`.
 */
export function getSclWorkspaceModel(workspace: UnifiedWorkspace, uri: string): SclWorkspaceModel | undefined {
  return workspace.getParsedModel<SclWorkspaceModel>(uri);
}

/**
 * Retrieves all parsed `SclWorkspaceModel` entries stored in `UnifiedWorkspace`.
 */
export function getAllSclWorkspaceModels(workspace: UnifiedWorkspace): SclWorkspaceModel[] {
  return Array.from(workspace.getAllParsedModels<SclWorkspaceModel>().values());
}
