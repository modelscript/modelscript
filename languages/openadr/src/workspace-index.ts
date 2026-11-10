// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseOpenAdr } from "./parser/openadr-parser.js";
import type { OpenAdrDeck } from "./types.js";

export class OpenAdrWorkspaceIndex {
  private readonly decks = new Map<string, OpenAdrDeck>();

  public indexDocument(uri: string, content: string): void {
    this.decks.set(uri, parseOpenAdr(content));
  }

  public getDeck(uri: string): OpenAdrDeck | undefined {
    return this.decks.get(uri);
  }

  public getAllEvents(): OpenAdrDeck {
    const allEvents = Array.from(this.decks.values()).flatMap((d) => d.events);
    const allPrograms = Array.from(this.decks.values()).flatMap((d) => d.programs);
    return { programs: allPrograms, events: allEvents };
  }

  public clear(): void {
    this.decks.clear();
  }
}
