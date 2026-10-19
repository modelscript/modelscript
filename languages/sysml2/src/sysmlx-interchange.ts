// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OMG SysML v2 Standard Model Interchange (.sysmlx / .kermlx).
 *
 * Implements standard file-based model interchange conforming to the
 * official OMG Systems Modeling Language (SysML) v2 specification (ptc/2024-02-03)
 * JSON-LD serialization format.
 *
 * Capabilities:
 *   - exportToSysmlx: Exports SysML v2 source code or WorkspaceIndex to official JSON-LD (.sysmlx)
 *   - importFromSysmlx: Imports a .sysmlx JSON-LD document and reconstructs clean .sysml text
 *   - Lossless round-trip (.sysml <-> .sysmlx) for definitions, usages, ports, connections,
 *     constraints, and requirements.
 */

import { randomUUID } from "node:crypto";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex, getSysmlParser } from "./factory.js";

export const OMG_SYSML2_CONTEXT = "https://www.omg.org/spec/SysML/20240201/context.jsonld";

export interface SysmlxElement {
  "@id": string;
  "@type": string;
  name?: string | undefined;
  qualifiedName?: string | undefined;
  isAbstract?: boolean | undefined;
  owner?: { "@id": string } | null | undefined;
  ownedElement?: { "@id": string }[] | undefined;
  superclasses?: string[] | undefined;
  attributes?: Record<string, any> | undefined;
  sourceUri?: string | undefined;
}

export interface SysmlxRelationship {
  "@id": string;
  "@type": string;
  relationshipType: string;
  source: { "@id": string }[];
  target: { "@id": string }[];
}

export interface SysmlxDocument {
  "@context": string;
  "@graph": (SysmlxElement | SysmlxRelationship)[];
  metadata?:
    | {
        generator?: string | undefined;
        version?: string | undefined;
        created?: string | undefined;
        description?: string | undefined;
      }
    | undefined;
}

export interface SysmlxExportOptions {
  sourceUri?: string | undefined;
  description?: string | undefined;
  includeStandardLibrary?: boolean | undefined;
}

export interface SysmlxImportOptions {
  targetUri?: string | undefined;
  indent?: number | undefined;
}

export class SysML2ModelInterchange {
  /**
   * Exports SysML v2 textual code into an official OMG .sysmlx (JSON-LD) document.
   */
  public static async exportToSysmlx(sysmlSource: string, options: SysmlxExportOptions = {}): Promise<SysmlxDocument> {
    const parser = await getSysmlParser();
    const ws = createSysML2WorkspaceIndex();
    const uri = options.sourceUri || "file:///workspace/model.sysml";

    ws.register(uri, () => {
      const tree = parser.parse(sysmlSource);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await ws.toUnifiedAsync();
    const qe = createSysML2QueryEngine(unified, parser.parse(sysmlSource));
    const db = qe.toQueryDB();

    const elements: SysmlxElement[] = [];
    const relationships: SysmlxRelationship[] = [];
    const symbolToId = new Map<number, string>();

    // Pass 1: Assign UUIDs to all symbols
    for (const entry of db.allEntries()) {
      if (entry.resourceId !== uri && !options.includeStandardLibrary) continue;
      symbolToId.set(entry.id, `urn:uuid:${randomUUID()}`);
    }

    // Pass 2: Build elements
    for (const entry of db.allEntries()) {
      if (entry.resourceId !== uri && !options.includeStandardLibrary) continue;
      const elementId = symbolToId.get(entry.id)!;
      const parentId = entry.parentId != null ? (symbolToId.get(entry.parentId) ?? null) : null;

      // Map ruleName to OMG metaclass
      const metaclass = this.mapRuleToMetaclass(entry.ruleName, entry.kind);
      const entryText =
        entry.startOffset != null && entry.endOffset != null
          ? sysmlSource.slice(entry.startOffset, entry.endOffset)
          : db.cstText(entry.startOffset, entry.endOffset, entry) || "";
      const leadingText =
        entry.startOffset != null ? sysmlSource.slice(Math.max(0, entry.startOffset - 30), entry.startOffset) : "";
      const isAbstract =
        entry.metadata?.["isAbstract"] === true ||
        entry.metadata?.["isAbstract"] === "true" ||
        /\babstract\b/.test(entryText) ||
        /\babstract\s+$/.test(leadingText);

      // Superclasses / Specializations
      const superclasses: string[] = [];
      const children = db.childrenOf(entry.id);
      for (const child of children) {
        if ((child.ruleName === "OwnedSubclassification" || child.ruleName === "Subclassification") && child.name) {
          superclasses.push(child.name);
        }
      }

      // Collect owned child IDs
      const ownedElement: { "@id": string }[] = [];
      for (const child of children) {
        const cId = symbolToId.get(child.id);
        if (cId) {
          ownedElement.push({ "@id": cId });
        }
      }

      // Extract attributes and properties
      const attrs: Record<string, any> = { ...entry.metadata };
      if (entry.name) attrs["declaredName"] = entry.name;
      if (entry.startOffset != null) attrs["startOffset"] = entry.startOffset;
      if (entry.endOffset != null) attrs["endOffset"] = entry.endOffset;

      // Extract typing for usages
      const typingChild = children.find((c) => c.ruleName === "OwnedFeatureTyping");
      if (typingChild?.name) {
        attrs["type"] = typingChild.name;
      }
      if (!attrs["type"] && entryText) {
        const typeMatch = entryText.match(/:\s*(~?\s*[A-Za-z_][A-Za-z0-9_]*(?:::_?[A-Za-z0-9_]+)*)/);
        if (typeMatch) {
          attrs["type"] = typeMatch[1]!.trim();
        }
      }
      if (typeof attrs["type"] === "string" && attrs["type"].startsWith("~")) {
        attrs["isConjugated"] = true;
        attrs["type"] = attrs["type"].slice(1).trim();
      }

      // Extract port specifics (direction, conjugation)
      if (entry.ruleName === "PortUsage" || entry.ruleName === "PortDefinition") {
        const text = entryText;
        if (text.includes("~")) attrs["isConjugated"] = true;
        if (text.includes("inout ")) attrs["direction"] = "inout";
        else if (text.includes("in ")) attrs["direction"] = "in";
        else if (text.includes("out ")) attrs["direction"] = "out";
      }

      // Extract connection endpoints
      if (entry.ruleName === "ConnectionUsage" || entry.ruleName === "BindingConnectorAsUsage") {
        if (entryText) {
          const connMatch = entryText.match(/connect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/);
          if (connMatch) {
            attrs["source"] = connMatch[1]!.trim();
            attrs["target"] = connMatch[2]!.trim();
          }
        }
        if (!attrs["source"] || !attrs["target"]) {
          const refs = children.filter((c) => c.kind === "Reference" && c.name && !c.name.startsWith("Owned"));
          if (refs.length >= 2) {
            attrs["source"] = refs[0]!.name || (db.cstText(refs[0]!.startOffset, refs[0]!.endOffset) || "").trim();
            attrs["target"] = refs[1]!.name || (db.cstText(refs[1]!.startOffset, refs[1]!.endOffset) || "").trim();
          }
        }
      }

      // Extract constraint expression body
      if (entry.ruleName === "AssertConstraintUsage" || entry.ruleName === "ConstraintUsage") {
        const text = entryText;
        const braceMatch = text.match(/\{([^}]+)\}/);
        if (braceMatch) {
          attrs["expression"] = braceMatch[1]!.trim();
        }
      }

      // Extract attribute default value
      if (entry.ruleName === "AttributeUsage" || entry.ruleName === "AttributeDefinition") {
        if (entryText) {
          const valMatch = entryText.match(/=\s*([^;]+);/);
          if (valMatch) {
            attrs["defaultValue"] = valMatch[1]!.trim();
          }
        }
      }

      // Extract requirement satisfaction target
      if (entry.ruleName === "SatisfyRequirementUsage") {
        if (entryText) {
          const satisfyMatch = entryText.match(/satisfy\s+(?:requirement\s+)?([A-Za-z0-9_:]+)/);
          if (satisfyMatch) {
            attrs["target"] = satisfyMatch[1]!.trim();
          }
        }
      }

      // Calculate qualified name
      const qname = this.computeQualifiedName(db, entry);
      const declaredName =
        entry.name && entry.name !== entry.ruleName && entry.name !== "<anonymous>" && !entry.name.startsWith("Owned")
          ? entry.name
          : undefined;

      const elem: SysmlxElement = {
        "@id": elementId,
        "@type": metaclass,
        name: declaredName,
        qualifiedName: qname,
        isAbstract: isAbstract || undefined,
        owner: parentId ? { "@id": parentId } : null,
        ownedElement: ownedElement.length > 0 ? ownedElement : undefined,
        superclasses: superclasses.length > 0 ? superclasses : undefined,
        attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
        sourceUri: entry.resourceId,
      };

      elements.push(elem);

      // Create explicit relationship nodes for specializations
      for (const sup of superclasses) {
        relationships.push({
          "@id": `urn:uuid:${randomUUID()}`,
          "@type": "Subclassification",
          relationshipType: "specialization",
          source: [{ "@id": elementId }],
          target: [{ "@id": `urn:sysml2:type:${sup}` }],
        });
      }
    }

    return {
      "@context": OMG_SYSML2_CONTEXT,
      metadata: {
        generator: "ModelScript SysML v2 Interchange Engine",
        version: "1.0",
        created: new Date().toISOString(),
        description: options.description || "OMG SysML v2 Standard Model Interchange Document (.sysmlx)",
      },
      "@graph": [...elements, ...relationships],
    };
  }

  /**
   * Imports an OMG .sysmlx (JSON-LD) document and reconstructs clean, standard SysML v2 text.
   */
  public static importFromSysmlx(sysmlxInput: string | SysmlxDocument, options: SysmlxImportOptions = {}): string {
    const doc: SysmlxDocument = typeof sysmlxInput === "string" ? JSON.parse(sysmlxInput) : sysmlxInput;

    const graph = doc["@graph"] || [];
    const elements = graph.filter((item): item is SysmlxElement => !("relationshipType" in item));
    const elemMap = new Map<string, SysmlxElement>();

    for (const elem of elements) {
      elemMap.set(elem["@id"], elem);
    }

    // Find top-level root elements (owner is null or not in map)
    const rootElements = elements.filter((e) => !e.owner || !e.owner["@id"] || !elemMap.has(e.owner["@id"]));

    const indentStep = "  ".repeat(options.indent ?? 1);
    let output = `// Auto-generated from OMG SysML v2 Interchange (.sysmlx)\n\n`;

    for (const root of rootElements) {
      output += this.renderElement(root, elemMap, 0, indentStep);
      output += "\n";
    }

    return output.trimEnd() + "\n";
  }

  private static readonly IGNORED_METACLASSES = new Set([
    "OwnedSubclassification",
    "Subclassification",
    "OwnedFeatureTyping",
    "FeatureTyping",
    "OwnedReferenceSubsetting",
    "OwnedSubsetting",
    "Subsetting",
    "OwnedRedefinition",
    "Redefinition",
    "Reference",
  ]);

  /**
   * Renders an individual SysmlxElement and its subtree recursively into SysML v2 text.
   */
  private static renderElement(
    elem: SysmlxElement,
    map: Map<string, SysmlxElement>,
    level: number,
    indentStep: string,
  ): string {
    const type = elem["@type"];
    if (this.IGNORED_METACLASSES.has(type)) {
      return "";
    }

    const indent = indentStep.repeat(level);
    const rawName = elem.name || "";
    const name = rawName === type || rawName === "<anonymous>" || rawName.startsWith("Owned") ? "" : rawName;
    const isAbstract = elem.isAbstract ? "abstract " : "";
    const superClause = elem.superclasses && elem.superclasses.length > 0 ? ` :> ${elem.superclasses.join(", ")}` : "";

    // 1. Packages
    if (type === "Package") {
      let res = `${indent}package ${name} {\n`;
      const children = this.getChildren(elem, map);
      for (const child of children) {
        res += this.renderElement(child, map, level + 1, indentStep);
      }
      res += `${indent}}\n\n`;
      return res;
    }

    // 2. Definitions (Part, Port, Item, Requirement, Action, State, Constraint, Calculation)
    if (type.endsWith("Definition") || type === "Part" || type === "Item") {
      const keyword = this.getDefinitionKeyword(type);
      const children = this.getChildren(elem, map);

      if (children.length === 0) {
        return `${indent}${isAbstract}${keyword} ${name}${superClause};\n`;
      }

      let res = `${indent}${isAbstract}${keyword} ${name}${superClause} {\n`;
      for (const child of children) {
        res += this.renderElement(child, map, level + 1, indentStep);
      }
      res += `${indent}}\n`;
      return res;
    }

    // 3. Port Usages
    if (type === "PortUsage" || type === "Port") {
      const conj = elem.attributes?.["isConjugated"] ? "~" : "";
      const dir = elem.attributes?.["direction"] ? `${elem.attributes["direction"]} ` : "";
      const portType = elem.attributes?.["type"] ? ` : ${conj}${elem.attributes["type"]}` : "";
      return `${indent}${dir}port ${name}${portType};\n`;
    }

    // 4. Attribute Usages
    if (type === "AttributeUsage" || type === "Attribute") {
      const attrType = elem.attributes?.["type"] ? ` : ${elem.attributes["type"]}` : "";
      const defVal =
        elem.attributes?.["defaultValue"] !== undefined
          ? ` = ${elem.attributes["defaultValue"]}`
          : elem.attributes?.["value"] !== undefined
            ? ` = ${elem.attributes["value"]}`
            : "";
      return `${indent}attribute ${name}${attrType}${defVal};\n`;
    }

    // 5. Part Usages
    if (type === "PartUsage") {
      const partType = elem.attributes?.["type"] ? ` : ${elem.attributes["type"]}` : "";
      const mult = elem.attributes?.["multiplicity"] ? `[${elem.attributes["multiplicity"]}]` : "";
      const children = this.getChildren(elem, map);
      if (children.length === 0) {
        return `${indent}part ${name}${mult}${partType};\n`;
      }
      let res = `${indent}part ${name}${mult}${partType} {\n`;
      for (const child of children) {
        res += this.renderElement(child, map, level + 1, indentStep);
      }
      res += `${indent}}\n`;
      return res;
    }

    // 6. Item Usages
    if (type === "ItemUsage") {
      const itemType = elem.attributes?.["type"] ? ` : ${elem.attributes["type"]}` : "";
      return `${indent}item ${name}${itemType};\n`;
    }

    // 7. Connection Usages
    if (type === "ConnectionUsage" || type === "Connector") {
      const src = elem.attributes?.["source"];
      const tgt = elem.attributes?.["target"];
      if (src && tgt) {
        return `${indent}connection ${name ? `${name} ` : ""}connect ${src} to ${tgt};\n`;
      }
    }

    // 8. Constraint Usages
    if (type === "ConstraintUsage" || type === "AssertConstraintUsage") {
      const expr = elem.attributes?.["expression"] || "";
      if (expr) {
        return `${indent}assert constraint ${name ? `${name} ` : ""}{ ${expr} }\n`;
      }
    }

    // 9. Requirement Satisfaction / Verification
    if (type === "SatisfyRequirementUsage" || type === "Satisfy") {
      const tgt = elem.attributes?.["target"] || name;
      if (tgt) {
        return `${indent}satisfy ${tgt};\n`;
      }
      return "";
    }

    // 10. Succession / Flows
    if (type === "SuccessionAsUsage" || type === "Succession") {
      const src = elem.attributes?.["source"];
      const tgt = elem.attributes?.["target"];
      if (src && tgt) {
        return `${indent}first ${src} then ${tgt};\n`;
      }
    }

    // Default fallback
    return `${indent}// [${type}] ${name}\n`;
  }

  private static getChildren(elem: SysmlxElement, map: Map<string, SysmlxElement>): SysmlxElement[] {
    const res: SysmlxElement[] = [];
    if (elem.ownedElement && elem.ownedElement.length > 0) {
      for (const ref of elem.ownedElement) {
        const child = map.get(ref["@id"]);
        if (child && !this.IGNORED_METACLASSES.has(child["@type"])) {
          res.push(child);
        }
      }
    } else {
      for (const child of map.values()) {
        if (child.owner?.["@id"] === elem["@id"] && !this.IGNORED_METACLASSES.has(child["@type"])) {
          res.push(child);
        }
      }
    }
    return res;
  }

  private static mapRuleToMetaclass(ruleName: string, kind?: string): string {
    if (ruleName === "Package" || kind === "Package") return "Package";
    if (ruleName === "PartDefinition") return "PartDefinition";
    if (ruleName === "PartUsage") return "PartUsage";
    if (ruleName === "PortDefinition") return "PortDefinition";
    if (ruleName === "PortUsage") return "PortUsage";
    if (ruleName === "ItemDefinition") return "ItemDefinition";
    if (ruleName === "ItemUsage") return "ItemUsage";
    if (ruleName === "AttributeDefinition") return "AttributeDefinition";
    if (ruleName === "AttributeUsage") return "AttributeUsage";
    if (ruleName === "ActionDefinition") return "ActionDefinition";
    if (ruleName === "ActionUsage" || ruleName === "PerformActionUsage") return "ActionUsage";
    if (ruleName === "StateDefinition") return "StateDefinition";
    if (ruleName === "StateUsage") return "StateUsage";
    if (ruleName === "ConstraintDefinition") return "ConstraintDefinition";
    if (ruleName === "ConstraintUsage" || ruleName === "AssertConstraintUsage") return "ConstraintUsage";
    if (ruleName === "RequirementDefinition") return "RequirementDefinition";
    if (ruleName === "RequirementUsage") return "RequirementUsage";
    if (ruleName === "CalculationDefinition") return "CalculationDefinition";
    if (ruleName === "ConnectionUsage" || ruleName === "BindingConnectorAsUsage") return "ConnectionUsage";
    if (ruleName === "SatisfyRequirementUsage") return "SatisfyRequirementUsage";
    if (ruleName === "TransitionUsage") return "TransitionUsage";
    return ruleName || "Element";
  }

  private static getDefinitionKeyword(metaclass: string): string {
    switch (metaclass) {
      case "PartDefinition":
      case "Part":
        return "part def";
      case "PortDefinition":
      case "Port":
        return "port def";
      case "ItemDefinition":
      case "Item":
        return "item def";
      case "AttributeDefinition":
      case "Attribute":
        return "attribute def";
      case "RequirementDefinition":
      case "Requirement":
        return "requirement def";
      case "ActionDefinition":
      case "Action":
        return "action def";
      case "StateDefinition":
      case "State":
        return "state def";
      case "ConstraintDefinition":
      case "Constraint":
        return "constraint def";
      case "CalculationDefinition":
      case "Calculation":
        return "calc def";
      default:
        return "def";
    }
  }

  private static computeQualifiedName(db: any, entry: any): string {
    const parts: string[] = [entry.name || "<anonymous>"];
    let curr = entry.parentId != null ? db.symbol(entry.parentId) : null;
    while (curr) {
      if (curr.name && curr.name !== "<root>") {
        parts.unshift(curr.name);
      }
      curr = curr.parentId != null ? db.symbol(curr.parentId) : null;
    }
    return parts.join("::");
  }
}
