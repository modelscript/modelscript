// SPDX-License-Identifier: AGPL-3.0-or-later

import type { I18nConfig } from "./language-dsl.js";

export interface TSPoint {
  readonly row: number;
  readonly column: number;
}

export interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
  readonly children: TSNode[];
  childForFieldName(fieldName: string): TSNode | null;
}

export interface PotEntry {
  msgid: string;
  msgctxt: string;
  locations: Set<string>;
}

export class I18nExtractor {
  private entries = new Map<string, PotEntry>();
  private scopeStack: string[] = [];

  constructor(
    private readonly i18nConfig: Record<string, I18nConfig>,
    private readonly db: unknown = null,
  ) {}

  private cleanString(str: string): string {
    if (str.startsWith('"') && str.endsWith('"')) {
      return str.slice(1, -1);
    }
    return str;
  }

  private addEntry(msgid: string | null | undefined, msgctxt: string, sourceFile: string, line?: number) {
    if (!msgid) return;
    const cleanId = this.cleanString(msgid);
    if (!cleanId) return;

    const key = `${msgctxt}\x04${cleanId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        msgid: cleanId,
        msgctxt,
        locations: new Set(),
      };
      this.entries.set(key, entry);
    }

    if (line != null) {
      entry.locations.add(`${sourceFile}:${line}`);
    }
  }

  extract(rootNode: TSNode, sourceFile: string) {
    this.walk(rootNode, sourceFile);
  }

  private walk(node: TSNode, sourceFile: string) {
    if (!node) return;

    const config = this.i18nConfig[node.type];
    let pushedScope = false;

    // 1. Handle scope stack pushing
    if (config?.scope) {
      try {
        const scopeFn = (config as { scope?: (self: TSNode) => string | null }).scope;
        const scopeName = scopeFn ? scopeFn(node) : null;
        if (scopeName) {
          const cleanedName = this.cleanString(scopeName);
          if (cleanedName) {
            this.scopeStack.push(cleanedName);
            pushedScope = true;
          }
        }
      } catch (err) {
        console.error(`Error resolving scope name on ${node.type}:`, err);
      }
    }

    const currentContext = this.scopeStack.join(".");
    const line = node.startPosition ? node.startPosition.row + 1 : undefined;

    // 2. Extract texts from declared fields
    if (config?.texts) {
      for (const item of config.texts) {
        if (typeof item === "string") {
          const child = node.childForFieldName(item);
          if (child && child.text) {
            this.addEntry(child.text, currentContext, sourceFile, line);
          }
        } else {
          const child = node.childForFieldName(item.field);
          if (child && child.text) {
            const context =
              item.context === "self"
                ? currentContext
                  ? `${currentContext}.${child.text}`
                  : child.text
                : currentContext;
            this.addEntry(child.text, context, sourceFile, line);
          }
        }
      }
    }

    // 3. Dynamic custom extraction callbacks
    if (config?.extract) {
      try {
        const result = config.extract(this.db, node);
        if (result) {
          const items = Array.isArray(result) ? result : [result];
          for (const item of items) {
            if (item.msgid) {
              const context = item.context || currentContext;
              this.addEntry(item.msgid, context, sourceFile, line);
            }
          }
        }
      } catch (err) {
        console.error(`Error executing extract hook on ${node.type}:`, err);
      }
    }

    // 4. Recurse down all children
    if (node.children) {
      for (const child of node.children) {
        this.walk(child, sourceFile);
      }
    }

    // 5. Pop scope stack
    if (pushedScope) {
      this.scopeStack.pop();
    }
  }

  getEntries(): Map<string, PotEntry> {
    return this.entries;
  }

  generatePot(): string {
    let pot = "";
    pot += `msgid ""\n`;
    pot += `msgstr ""\n`;
    pot += `"Content-Type: text/plain; charset=UTF-8\\n"\n`;
    pot += `"Content-Transfer-Encoding: 8bit\\n"\n`;
    pot += `"Project-Id-Version: \\n"\n`;
    pot += `\n`;

    for (const entry of this.entries.values()) {
      for (const location of entry.locations) {
        pot += `#: ${location}\n`;
      }
      if (entry.msgctxt) {
        pot += `msgctxt ${JSON.stringify(entry.msgctxt)}\n`;
      }
      pot += `msgid ${JSON.stringify(entry.msgid)}\n`;
      pot += `msgstr ""\n`;
      pot += `\n`;
    }

    return pot;
  }
}
