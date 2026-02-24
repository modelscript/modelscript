// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Scope } from "../scope.js";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaEntity,
  ModelicaModelVisitor,
} from "./model.js";
import { ModelicaShortClassSpecifierSyntaxNode } from "./syntax.js";

interface PotEntry {
  msgid: string;
  msgctxt: string;
  locations: Set<string>;
}

export class I18nVisitor extends ModelicaModelVisitor<void> {
  private entries = new Map<string, PotEntry>();
  private visited = new Set<ModelicaElement>();

  private addEntry(msgid: string | null | undefined, msgctxt: string, node: ModelicaElement | null) {
    if (!msgid) return;

    const key = `${msgctxt}\x04${msgid}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        msgid,
        msgctxt,
        locations: new Set(),
      };
      this.entries.set(key, entry);
    }

    const location = this.getLocation(node);
    if (location) {
      entry.locations.add(location);
    }
  }

  private getLocation(node: ModelicaElement | null): string | null {
    const syntaxNode = node?.abstractSyntaxNode?.concreteSyntaxNode;
    if (!syntaxNode) return null;

    let current: Scope | null = node;
    let sourceFile = "unknown";
    while (current) {
      if (current instanceof ModelicaEntity) {
        sourceFile = (current as ModelicaEntity).path;
        break;
      }
      current = current.parent;
    }

    return `${sourceFile}:${syntaxNode.startPosition.row + 1}`;
  }

  private getQualifiedName(node: ModelicaClassInstance | null): string {
    if (!node) return "";
    return node.compositeName ?? node.name ?? "";
  }

  private extractFromClass(node: ModelicaClassInstance) {
    if (!node.instantiated && !node.instantiating) node.instantiate();
    if (this.visited.has(node)) return;
    this.visited.add(node);

    const qualifiedName = this.getQualifiedName(node);

    if (node.name) {
      this.addEntry(node.name, qualifiedName, node);
    }

    if (node.description) {
      this.addEntry(node.description, qualifiedName, node);
    }

    const doc = node.annotation<{ info?: string; revisions?: string }>("Documentation");
    if (doc?.info) {
      this.addEntry(doc.info, qualifiedName, node);
    }
    if (doc?.revisions) {
      this.addEntry(doc.revisions, qualifiedName, node);
    }

    const classSpecifier = node.abstractSyntaxNode?.classSpecifier;
    if (classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode && classSpecifier.enumeration) {
      for (const literal of classSpecifier.enumerationLiterals) {
        if (literal.identifier?.text) {
          this.addEntry(literal.identifier.text, qualifiedName, node);
        }
        if (literal.description?.strings) {
          const desc = literal.description.strings.map((s) => s.text ?? "").join(" ");
          if (desc) {
            this.addEntry(desc, qualifiedName, node);
          }
        }
      }
    }

    // Extract Text graphics from Icon and Diagram
    this.extractTextFromGraphics(node, "Icon", qualifiedName);
    this.extractTextFromGraphics(node, "Diagram", qualifiedName);
  }

  override visitClassInstance(node: ModelicaClassInstance): void {
    this.extractFromClass(node);
    super.visitClassInstance(node);
  }

  override visitEntity(node: ModelicaEntity): void {
    this.extractFromClass(node);
    super.visitEntity(node);
  }

  override visitComponentInstance(node: ModelicaComponentInstance): void {
    if (!node.instantiated && !node.instantiating) node.instantiate();
    if (this.visited.has(node)) return;
    this.visited.add(node);

    const parentClass = node.parent as ModelicaClassInstance;
    const qualifiedName = this.getQualifiedName(parentClass);

    if (node.name) {
      this.addEntry(node.name, qualifiedName, node);
    }

    if (node.description) {
      this.addEntry(node.description, qualifiedName, node);
    }

    const dialog = node.annotation<{ tab?: string; group?: string }>("Dialog");
    if (dialog?.tab) {
      this.addEntry(dialog.tab, qualifiedName, node);
    }
    if (dialog?.group) {
      this.addEntry(dialog.group, qualifiedName, node);
    }

    super.visitComponentInstance(node);
  }

  private extractTextFromGraphics(node: ModelicaClassInstance, layer: "Icon" | "Diagram", qualifiedName: string) {
    const layerData = node.annotation<{ graphics?: Record<string, unknown>[] }>(layer);
    if (layerData?.graphics) {
      for (const graphic of layerData.graphics) {
        if (graphic["@type"] === "Text" && typeof graphic.textString === "string") {
          this.addEntry(graphic.textString, qualifiedName, node);
        }
      }
    }
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
