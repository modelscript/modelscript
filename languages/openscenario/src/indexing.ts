// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenScenario } from "./parser/openscenario-parser.js";
import type { OpenScenarioDocument } from "./types.js";

/**
 * Declarative file indexer for ASAM OpenSCENARIO documents (.xosc, .osc).
 */
export function indexOpenScenarioFile(ctx: DslIndexFileContext): void {
  const addSym = (
    name: string,
    kind: string,
    parentId: number | null,
    startOffset: number,
    endOffset: number,
    metadata: Record<string, unknown> = {},
  ): number =>
    ctx.addSymbol(name, kind, parentId, startOffset, endOffset, metadata, {
      ruleName: "openscenario_symbol",
      namePath: name,
    });

  try {
    const doc = parseOpenScenario(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const rootName = doc.header.description || "OpenSCENARIO";
    const rootId = addSym(rootName, "package", null, 0, ctx.text.length, {
      author: doc.header.author,
      revMajor: doc.header.revMajor,
    });

    for (const p of doc.parameters) {
      addSym(p.name, "variable", rootId, 0, 50, {
        type: p.parameterType,
        value: p.value,
      });
    }

    for (const [name, ent] of doc.entities) {
      const start = ent.range?.startOffset ?? 0;
      const end = ent.range?.endOffset ?? 50;
      addSym(name, "class", rootId, start, end, {
        objectType: ent.objectType,
        isEgo: ent.isEgo,
        category: ent.category,
      });
    }

    for (const story of doc.stories) {
      const sStart = story.range?.startOffset ?? 0;
      const sEnd = story.range?.endOffset ?? 50;
      const storyId = addSym(story.name, "package", rootId, sStart, sEnd);

      for (const act of story.acts) {
        const aStart = act.range?.startOffset ?? 0;
        const aEnd = act.range?.endOffset ?? 50;
        const actId = addSym(act.name, "class", storyId, aStart, aEnd);

        for (const mg of act.maneuverGroups) {
          for (const m of mg.maneuvers) {
            const mStart = m.range?.startOffset ?? 0;
            const mEnd = m.range?.endOffset ?? 50;
            const mId = addSym(m.name, "component", actId, mStart, mEnd);

            for (const ev of m.events) {
              const evStart = ev.range?.startOffset ?? 0;
              const evEnd = ev.range?.endOffset ?? 50;
              addSym(ev.name, "method", mId, evStart, evEnd, {
                priority: ev.priority,
                actionsCount: ev.actions.length,
              });
            }
          }
        }
      }
    }
  } catch {
    // Preserve partial symbol map if parsing failed
  }
}

export function getOpenScenarioDocument(workspace: UnifiedWorkspace, uri: string): OpenScenarioDocument | undefined {
  return workspace.getParsedModel<OpenScenarioDocument>(uri);
}

export function findOpenScenarioDefinition(workspace: UnifiedWorkspace, name: string): SymbolEntry | undefined {
  return workspace.findSymbolsByName(name)[0];
}
