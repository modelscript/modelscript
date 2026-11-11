// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenAdr } from "./parser/openadr-parser.js";
import type { OpenAdrDeck } from "./types.js";

export function indexOpenAdrFile(ctx: DslIndexFileContext): void {
  const deck = parseOpenAdr(ctx.text);
  ctx.setParsedModel(deck);

  for (const prog of deck.programs) {
    const progId = ctx.addSymbol(
      prog.id,
      "Package",
      null,
      0,
      ctx.text.length,
      { name: prog.name, line: prog.line },
      { ruleName: "oadr_program", namePath: prog.id },
    );

    for (const evt of prog.events) {
      ctx.addSymbol(
        evt.id,
        "Component",
        progId,
        0,
        0,
        {
          status: evt.status,
          signalType: evt.signalType,
          targetVenId: evt.targetVenId,
          intervalCount: evt.intervals.length,
          line: evt.line,
        },
        { ruleName: "oadr_event", namePath: `${prog.id}.${evt.id}` },
      );
    }
  }

  for (const evt of deck.events) {
    if (evt.programId && deck.programs.some((p) => p.id === evt.programId)) continue;
    ctx.addSymbol(
      evt.id,
      "Component",
      null,
      0,
      0,
      {
        status: evt.status,
        signalType: evt.signalType,
        targetVenId: evt.targetVenId,
        intervalCount: evt.intervals.length,
        line: evt.line,
      },
      { ruleName: "oadr_event", namePath: evt.id },
    );
  }
}

export function getOpenAdrDeck(workspace: UnifiedWorkspace, uri: string): OpenAdrDeck | undefined {
  return workspace.getParsedModel<OpenAdrDeck>(uri);
}

export function getAllOpenAdrEvents(workspace: UnifiedWorkspace): OpenAdrDeck {
  const decks = Array.from(workspace.getAllParsedModels<OpenAdrDeck>().values());
  const allEvents = decks.flatMap((d) => d.events);
  const allPrograms = decks.flatMap((d) => d.programs);
  return { programs: allPrograms, events: allEvents };
}
