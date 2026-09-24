// SPDX-License-Identifier: AGPL-3.0-or-later
//
// General-Purpose SysML v2 Element Table Extraction and Attribute Rewriting Engine.
// Powers editable spreadsheet views for Parts, Actions, States, Ports, and Attributes.

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";

export interface TableColumnDefinition {
  id: string;
  title: string;
  type: "string" | "number" | "boolean" | "select";
  editable: boolean;
  options?: string[];
  description?: string;
}

export interface ElementsTablePayload {
  metaclass: string;
  columns: TableColumnDefinition[];
  rows: Record<string, any>[];
  totalCount: number;
}

export interface TextEditLike {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

export interface TableCellCompletionItem {
  label: string;
  kind: "type" | "port" | "property" | "unit" | "keyword";
  detail?: string;
}

export class ElementTableEngine {
  /**
   * Column schemas for standard SysML v2 element metaclasses.
   */
  static getColumnDefinitions(metaclass: string): TableColumnDefinition[] {
    const meta = metaclass.toLowerCase();

    if (meta === "part") {
      return [
        { id: "name", title: "Name", type: "string", editable: false },
        { id: "type", title: "Type Definition", type: "string", editable: true },
        { id: "multiplicity", title: "Multiplicity", type: "string", editable: true },
        { id: "isComposite", title: "Composite", type: "boolean", editable: true },
        { id: "mass", title: "Mass", type: "string", editable: true },
        { id: "power", title: "Power", type: "string", editable: true },
        { id: "cost", title: "Cost", type: "string", editable: true },
        { id: "doc", title: "Documentation", type: "string", editable: true },
      ];
    }

    if (meta === "action") {
      return [
        { id: "name", title: "Action Name", type: "string", editable: false },
        { id: "behaviorType", title: "Behavior Type", type: "string", editable: true },
        { id: "parameters", title: "Parameters", type: "string", editable: true },
        { id: "doc", title: "Documentation", type: "string", editable: true },
      ];
    }

    if (meta === "port") {
      return [
        { id: "name", title: "Port Name", type: "string", editable: false },
        { id: "portType", title: "Port Type", type: "string", editable: true },
        {
          id: "direction",
          title: "Direction",
          type: "select",
          editable: true,
          options: ["in", "out", "inout", "symmetric"],
        },
        { id: "isConjugated", title: "Conjugated (~)", type: "boolean", editable: true },
        { id: "doc", title: "Documentation", type: "string", editable: true },
      ];
    }

    if (meta === "state") {
      return [
        { id: "name", title: "State Name", type: "string", editable: false },
        { id: "isParallel", title: "Parallel", type: "boolean", editable: true },
        { id: "entryAction", title: "Entry Action", type: "string", editable: true },
        { id: "exitAction", title: "Exit Action", type: "string", editable: true },
        { id: "doc", title: "Documentation", type: "string", editable: true },
      ];
    }

    // Default generic attribute schema
    return [
      { id: "name", title: "Element Name", type: "string", editable: false },
      { id: "type", title: "Type", type: "string", editable: true },
      { id: "defaultValue", title: "Value", type: "string", editable: true },
      { id: "unit", title: "Unit", type: "string", editable: true },
      { id: "doc", title: "Documentation", type: "string", editable: true },
    ];
  }

  /**
   * Determines if a SymbolEntry matches the requested metaclass.
   */
  static matchesMetaclass(entry: SymbolEntry, metaclass: string): boolean {
    const rule = entry.ruleName ?? "";
    const meta = metaclass.toLowerCase();

    if (meta === "part") {
      return rule === "PartDefinition" || rule === "PartUsage" || rule === "ItemDefinition" || rule === "ItemUsage";
    }
    if (meta === "action") {
      return (
        rule === "ActionDefinition" ||
        rule === "ActionUsage" ||
        rule === "PerformActionUsage" ||
        rule === "ActivityDefinition" ||
        rule === "CalculationDefinition"
      );
    }
    if (meta === "port") {
      return rule === "PortDefinition" || rule === "PortUsage";
    }
    if (meta === "state") {
      return rule === "StateDefinition" || rule === "StateUsage";
    }
    if (meta === "attribute") {
      return rule === "AttributeDefinition" || rule === "AttributeUsage";
    }

    return rule.toLowerCase().includes(meta);
  }

  /**
   * Extracts all matching rows for the given metaclass from the SymbolIndex.
   */
  static buildElementsTable(index: SymbolIndex, metaclass: string, uriFilter?: string): ElementsTablePayload {
    const columns = this.getColumnDefinitions(metaclass);
    const rows: Record<string, any>[] = [];

    for (const entry of index.symbols.values()) {
      if (uriFilter && entry.resourceId && entry.resourceId !== uriFilter) continue;
      if (!this.matchesMetaclass(entry, metaclass)) continue;

      const qName = entry.name ?? "unnamed";
      const shortName = qName.split(".").pop() ?? qName;
      const meta = entry.metadata ?? {};

      const row: Record<string, any> = {
        id: entry.id,
        name: shortName,
        qualifiedName: qName,
        uri: entry.resourceId ?? "",
        startByte: entry.startByte,
        endByte: entry.endByte,
        type: meta.typeName || meta.type || "",
        multiplicity: meta.multiplicity || "1",
        isComposite: meta.isComposite ?? true,
        doc: meta.doc || "",
        mass: meta.mass || "",
        power: meta.power || "",
        cost: meta.cost || "",
        parameters: meta.parameters || "",
        behaviorType: meta.behaviorType || "",
        portType: meta.portType || meta.typeName || "",
        direction: meta.direction || "inout",
        isConjugated: meta.isConjugated ?? false,
        isParallel: meta.isParallel ?? false,
        entryAction: meta.entryAction || "",
        exitAction: meta.exitAction || "",
        defaultValue: meta.defaultValue || meta.val || "",
        unit: meta.unit || "",
      };

      rows.push(row);
    }

    // Sort rows alphabetically by qualifiedName
    rows.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

    return {
      metaclass,
      columns,
      rows,
      totalCount: rows.length,
    };
  }

  /**
   * Synthesizes a text edit updating an element's attribute in the document text.
   */
  static updateElementAttribute(
    documentText: string,
    qualifiedName: string,
    attributeName: string,
    newValue: string,
  ): TextEditLike[] {
    const lines = documentText.split(/\r?\n/);
    const shortName = qualifiedName.split(".").pop() ?? qualifiedName;

    // 1. Locate the declaration line for this element
    let declLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        (line.includes(`part ${shortName}`) ||
          line.includes(`action ${shortName}`) ||
          line.includes(`port ${shortName}`) ||
          line.includes(`state ${shortName}`) ||
          line.includes(`def ${shortName}`) ||
          line.includes(`${shortName} :`)) &&
        !line.trim().startsWith("//")
      ) {
        declLineIndex = i;
        break;
      }
    }

    if (declLineIndex === -1) {
      return [];
    }

    // 2. If editing type directly on a single-line usage: e.g. "part p : OldType;"
    if (attributeName === "type" && lines[declLineIndex].includes(":")) {
      const line = lines[declLineIndex];
      const match = line.match(/(:\s*)([A-Za-z0-9_:]+)/);
      if (match && match.index !== undefined) {
        const startChar = match.index + match[1].length;
        const endChar = startChar + match[2].length;
        return [
          {
            range: {
              start: { line: declLineIndex, character: startChar },
              end: { line: declLineIndex, character: endChar },
            },
            newText: newValue,
          },
        ];
      }
    }

    // 3. Look for existing attribute clause inside element block
    let blockEndIndex = -1;
    let braceDepth = 0;
    let foundOpenBrace = false;

    for (let i = declLineIndex; i < lines.length; i++) {
      const line = lines[i];
      for (let ch = 0; ch < line.length; ch++) {
        if (line[ch] === "{") {
          braceDepth++;
          foundOpenBrace = true;
        } else if (line[ch] === "}") {
          braceDepth--;
          if (foundOpenBrace && braceDepth === 0) {
            blockEndIndex = i;
            break;
          }
        }
      }
      if (blockEndIndex !== -1) break;

      // Check if this line defines the target attribute
      if (foundOpenBrace && (line.includes(`attribute ${attributeName}`) || line.includes(`${attributeName} =`))) {
        // Replace existing attribute line
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : "    ";
        return [
          {
            range: {
              start: { line: i, character: 0 },
              end: { line: i, character: line.length },
            },
            newText: `${indent}attribute ${attributeName} = ${newValue};`,
          },
        ];
      }
    }

    // 4. If element has an open block `{ ... }`, insert before closing brace
    if (blockEndIndex !== -1) {
      const indentMatch = lines[blockEndIndex].match(/^(\s*)/);
      const baseIndent = indentMatch ? indentMatch[1] : "";
      const childIndent = baseIndent + "    ";

      return [
        {
          range: {
            start: { line: blockEndIndex, character: 0 },
            end: { line: blockEndIndex, character: 0 },
          },
          newText: `${childIndent}attribute ${attributeName} = ${newValue};\n`,
        },
      ];
    }

    // 5. If element was single-line declaration ending with ';', convert to block
    const declLine = lines[declLineIndex];
    if (declLine.trim().endsWith(";")) {
      const semiIndex = declLine.lastIndexOf(";");
      const beforeSemi = declLine.substring(0, semiIndex);
      return [
        {
          range: {
            start: { line: declLineIndex, character: 0 },
            end: { line: declLineIndex, character: declLine.length },
          },
          newText: `${beforeSemi} {\n        attribute ${attributeName} = ${newValue};\n    }`,
        },
      ];
    }

    return [];
  }

  /**
   * Provides intelligent completions for table cell editing.
   */
  static getTableCellCompletions(
    index: SymbolIndex,
    metaclass: string,
    attributeName: string,
    prefix = "",
  ): TableCellCompletionItem[] {
    const completions: TableCellCompletionItem[] = [];
    const lowerPrefix = prefix.toLowerCase();

    if (attributeName === "type" || attributeName === "portType" || attributeName === "behaviorType") {
      // Return standard scalar and QUDV types
      const standardTypes = [
        "Real",
        "Integer",
        "Boolean",
        "String",
        "ISQ::Length",
        "ISQ::Mass",
        "ISQ::Time",
        "ISQ::ElectricCurrent",
        "ISQ::Power",
        "ISQ::Pressure",
        "ISQ::Velocity",
      ];

      for (const st of standardTypes) {
        if (!prefix || st.toLowerCase().includes(lowerPrefix)) {
          completions.push({ label: st, kind: "type", detail: "Standard KerML/QUDV Type" });
        }
      }

      // Return user-defined types in index
      for (const entry of index.symbols.values()) {
        const rule = entry.ruleName ?? "";
        if (rule.endsWith("Definition") && (entry.name?.toLowerCase().includes(lowerPrefix) || !prefix)) {
          completions.push({
            label: entry.name ?? "",
            kind: "type",
            detail: `User ${rule}`,
          });
        }
      }
    } else if (attributeName === "direction") {
      const directions = ["in", "out", "inout", "symmetric"];
      for (const d of directions) {
        if (!prefix || d.startsWith(lowerPrefix)) {
          completions.push({ label: d, kind: "keyword", detail: "Port Direction" });
        }
      }
    } else if (attributeName === "unit") {
      const standardUnits = ["m", "kg", "s", "A", "K", "mol", "cd", "W", "kW", "MW", "Pa", "bar", "V", "Hz", "rad"];
      for (const u of standardUnits) {
        if (!prefix || u.toLowerCase().startsWith(lowerPrefix)) {
          completions.push({ label: `[${u}]`, kind: "unit", detail: "SI Unit" });
        }
      }
    }

    return completions;
  }

  /**
   * Validates a cell value against basic syntax and unit rules.
   */
  static validateTableCell(attributeName: string, value: string): { valid: boolean; error?: string } {
    if (!value || value.trim() === "") {
      return { valid: true };
    }

    const trimmed = value.trim();

    // Check balanced unit brackets e.g. "25.4 [kg]"
    if (trimmed.includes("[") || trimmed.includes("]")) {
      const openCount = (trimmed.match(/\[/g) || []).length;
      const closeCount = (trimmed.match(/\]/g) || []).length;
      if (openCount !== closeCount) {
        return { valid: false, error: "Unbalanced unit brackets '[' and ']'" };
      }
    }

    // Check boolean fields
    if (attributeName === "isComposite" || attributeName === "isConjugated" || attributeName === "isParallel") {
      if (trimmed !== "true" && trimmed !== "false" && trimmed !== "1" && trimmed !== "0") {
        return { valid: false, error: "Value must be 'true' or 'false'" };
      }
    }

    return { valid: true };
  }
}
