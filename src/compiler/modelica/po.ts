// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PoEntry {
  msgid: string;
  msgstr: string;
  msgctxt?: string;
}

export const ModelicaPoParser = {
  parse(content: string): PoEntry[] {
    const entries: PoEntry[] = [];
    let currentEntry: Partial<PoEntry> | null = null;
    let currentField: "msgid" | "msgstr" | "msgctxt" | null = null;

    const lines = content.split("\n");
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith("#")) continue;

      if (line.startsWith("msgctxt")) {
        if (currentEntry) pushEntry(entries, currentEntry);
        currentEntry = { msgctxt: parseStringValue(line.substring(7).trim()) };
        currentField = "msgctxt";
      } else if (line.startsWith("msgid")) {
        if (!currentEntry || currentEntry.msgid !== undefined) {
          if (currentEntry) pushEntry(entries, currentEntry);
          currentEntry = {};
        }
        currentEntry.msgid = parseStringValue(line.substring(5).trim());
        currentField = "msgid";
      } else if (line.startsWith("msgstr")) {
        currentEntry = currentEntry || {};
        currentEntry.msgstr = parseStringValue(line.substring(6).trim());
        currentField = "msgstr";
      } else if (line.startsWith('"')) {
        if (currentEntry && currentField) {
          const val = parseStringValue(line);
          if (currentField === "msgctxt") currentEntry.msgctxt = (currentEntry.msgctxt ?? "") + val;
          if (currentField === "msgid") currentEntry.msgid = (currentEntry.msgid ?? "") + val;
          if (currentField === "msgstr") currentEntry.msgstr = (currentEntry.msgstr ?? "") + val;
        }
      }
    }
    if (currentEntry) pushEntry(entries, currentEntry);
    return entries;
  },
};

function pushEntry(entries: PoEntry[], entry: Partial<PoEntry>) {
  if (entry.msgid !== undefined && entry.msgstr !== undefined) {
    entries.push(entry as PoEntry);
  }
}

function parseStringValue(s: string): string {
  const match = s.match(/"(.*)"/);
  return (match?.[1] ?? "").replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export class ModelicaTranslation {
  private translations = new Map<string, string>();

  addEntry(entry: PoEntry) {
    const key = this.getKey(entry.msgid, entry.msgctxt);
    this.translations.set(key, entry.msgstr);
  }

  translate(id: string, ctxt?: string): string {
    const key = this.getKey(id, ctxt);
    return this.translations.get(key) ?? id;
  }

  private getKey(id: string, ctxt?: string): string {
    return ctxt ? `${ctxt}\x04${id}` : id;
  }
}
