// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostics, hierarchical document symbols, hover tooltips,
 * context-aware completions, go-to-definition, and custom engineering actions.
 */

import {
  type AmlVirtualCommissioningOptions,
  type AmlVirtualCommissioningResult,
  runAmlVirtualCommissioning,
} from "./cosim/index.js";
import { lowerAutomationMLToDae } from "./dae/index.js";
import { type AmlLintOptions, lintAutomationML } from "./lints/rules.js";
import { parseAutomationML } from "./parser/index.js";
import { amlToModelica, amlToSsp, amlToSysML2 } from "./projections/index.js";
import type { AmlDocument, AmlInternalElement, AmlSourceRange } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

function toLspRange(r: AmlSourceRange): LspRange {
  return {
    start: {
      line: Math.max(0, r.startLine - 1),
      character: Math.max(0, r.startColumn - 1),
    },
    end: {
      line: Math.max(0, r.endLine - 1),
      character: Math.max(0, r.endColumn - 1),
    },
  };
}

function resolveOffset(content: string, offsetOrPos: number | LspPosition): number {
  if (typeof offsetOrPos === "number") {
    return offsetOrPos;
  }
  const lines = content.split(/\r?\n/);
  let offset = 0;
  const targetLine = Math.max(0, Math.min(offsetOrPos.line, lines.length - 1));
  for (let i = 0; i < targetLine; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + Math.max(0, offsetOrPos.character);
}

function containsOffset(r: AmlSourceRange, offset: number): boolean {
  return offset >= r.startOffset && offset <= r.endOffset;
}

/**
 * Validates an AutomationML document and returns LSP diagnostics.
 */
export function validateAutomationML(content: string, options?: AmlLintOptions): LspDiagnostic[] {
  let doc: AmlDocument;
  try {
    doc = parseAutomationML(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8300",
        source: "automationml-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const diags = lintAutomationML(doc, options);
  return diags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "automationml-linter",
      message: d.message,
    };
  });
}

function buildElementSymbol(el: AmlInternalElement): LspDocumentSymbol {
  const elRange = toLspRange(el.range);
  const children: LspDocumentSymbol[] = [];

  for (const attr of el.attributes) {
    const r = toLspRange(attr.range);
    children.push({
      name: attr.name,
      detail: `${attr.dataType ?? "Attribute"}${attr.value !== undefined ? ` = ${String(attr.value)}` : ""}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const iface of el.interfaces) {
    const r = toLspRange(iface.range);
    children.push({
      name: iface.name,
      detail: `${iface.direction} ${iface.category}${iface.dataType ? ` (${iface.dataType})` : ""}`,
      kind: LspSymbolKind.Interface,
      range: r,
      selectionRange: r,
    });
  }

  for (const link of el.internalLinks) {
    const r = toLspRange(link.range);
    children.push({
      name: link.name,
      detail: `${link.refPartnerSideA} -> ${link.refPartnerSideB}`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  for (const child of el.children) {
    children.push(buildElementSymbol(child));
  }

  return {
    name: el.name,
    detail: `InternalElement [${el.id}]${el.pprCategory ? ` (${el.pprCategory})` : ""}`,
    kind: LspSymbolKind.Class,
    range: elRange,
    selectionRange: elRange,
    children: children.length > 0 ? children : undefined,
  };
}

/**
 * Extracts hierarchical LSP document symbols from an AutomationML document.
 */
export function getAutomationMLDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: AmlDocument;
  try {
    doc = parseAutomationML(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const ih of doc.instanceHierarchies) {
    const r = toLspRange(ih.range);
    symbols.push({
      name: ih.name,
      detail: "InstanceHierarchy",
      kind: LspSymbolKind.Package,
      range: r,
      selectionRange: r,
      children: ih.elements.map((e) => buildElementSymbol(e)),
    });
  }

  for (const lib of doc.systemUnitClassLibs) {
    const r = toLspRange(lib.range);
    symbols.push({
      name: lib.name,
      detail: "SystemUnitClassLib",
      kind: LspSymbolKind.Namespace,
      range: r,
      selectionRange: r,
      children: lib.classes.map((c) => {
        const cr = toLspRange(c.range);
        return {
          name: c.name,
          detail: c.refBaseClassPath ? `extends ${c.refBaseClassPath}` : "SystemUnitClass",
          kind: LspSymbolKind.Class,
          range: cr,
          selectionRange: cr,
        };
      }),
    });
  }

  for (const lib of doc.roleClassLibs) {
    const r = toLspRange(lib.range);
    symbols.push({
      name: lib.name,
      detail: "RoleClassLib",
      kind: LspSymbolKind.Namespace,
      range: r,
      selectionRange: r,
      children: lib.classes.map((c) => {
        const cr = toLspRange(c.range);
        return {
          name: c.name,
          detail: c.refBaseClassPath ? `extends ${c.refBaseClassPath}` : "RoleClass",
          kind: LspSymbolKind.Class,
          range: cr,
          selectionRange: cr,
        };
      }),
    });
  }

  for (const lib of doc.interfaceClassLibs) {
    const r = toLspRange(lib.range);
    symbols.push({
      name: lib.name,
      detail: "InterfaceClassLib",
      kind: LspSymbolKind.Namespace,
      range: r,
      selectionRange: r,
      children: lib.classes.map((c) => {
        const cr = toLspRange(c.range);
        return {
          name: c.name,
          detail: c.refBaseClassPath ? `extends ${c.refBaseClassPath}` : "InterfaceClass",
          kind: LspSymbolKind.Interface,
          range: cr,
          selectionRange: cr,
        };
      }),
    });
  }

  return symbols;
}

/**
 * Provides hover details for AutomationML elements, ports, attributes, links, and classes.
 */
export function getAutomationMLHover(content: string, offsetOrPosition: number | LspPosition): LspHover | null {
  let doc: AmlDocument;
  try {
    doc = parseAutomationML(content);
  } catch {
    return null;
  }

  const offset = resolveOffset(content, offsetOrPosition);

  const searchElement = (el: AmlInternalElement): LspHover | null => {
    if (!containsOffset(el.range, offset)) return null;

    for (const child of el.children) {
      const childHover = searchElement(child);
      if (childHover) return childHover;
    }

    for (const iface of el.interfaces) {
      if (containsOffset(iface.range, offset)) {
        const lines = [
          `### ExternalInterface: **${iface.name}** (\`${iface.direction}\`)`,
          `* **Category:** \`${iface.category}\``,
          `* **Base Class:** \`${iface.refBaseClassPath || "SignalInterface"}\``,
          iface.dataType ? `* **Data Type:** \`${iface.dataType}\`` : "",
          iface.refUri ? `* **Reference URI:** \`${iface.refUri}\`` : "",
        ].filter(Boolean);
        return {
          contents: { kind: "markdown", value: lines.join("\n") },
          range: toLspRange(iface.range),
        };
      }
    }

    for (const attr of el.attributes) {
      if (containsOffset(attr.range, offset)) {
        const lines = [
          `### Attribute: **${attr.name}**`,
          attr.dataType ? `* **Data Type:** \`${attr.dataType}\`` : "",
          attr.value !== undefined ? `* **Value:** \`${String(attr.value)}\`` : "",
          attr.unit ? `* **Unit:** \`${attr.unit}\`` : "",
        ].filter(Boolean);
        return {
          contents: { kind: "markdown", value: lines.join("\n") },
          range: toLspRange(attr.range),
        };
      }
    }

    for (const link of el.internalLinks) {
      if (containsOffset(link.range, offset)) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### InternalLink: **${link.name}**`,
              `* **Partner Side A:** \`${link.refPartnerSideA}\``,
              `* **Partner Side B:** \`${link.refPartnerSideB}\``,
            ].join("\n"),
          },
          range: toLspRange(link.range),
        };
      }
    }

    const lines = [
      `### InternalElement: **${el.name}** (\`${el.id}\`)`,
      el.pprCategory ? `* **PPR Category:** \`${el.pprCategory}\`` : "",
      el.refBaseSystemUnitPath ? `* **SystemUnitClass:** \`${el.refBaseSystemUnitPath}\`` : "",
      el.frame
        ? `* **6-DOF Frame:** \`(x=${el.frame.x}, y=${el.frame.y}, z=${el.frame.z}, rx=${el.frame.rx}, ry=${el.frame.ry}, rz=${el.frame.rz})\``
        : "",
      `* **Interfaces:** ${el.interfaces.length}, **Attributes:** ${el.attributes.length}`,
    ].filter(Boolean);

    return {
      contents: { kind: "markdown", value: lines.join("\n") },
      range: toLspRange(el.range),
    };
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      const found = searchElement(el);
      if (found) return found;
    }
  }

  for (const lib of doc.systemUnitClassLibs) {
    for (const cls of lib.classes) {
      if (containsOffset(cls.range, offset)) {
        return {
          contents: {
            kind: "markdown",
            value: `### SystemUnitClass: **${lib.name}/${cls.name}**\n* **Base Class:** \`${cls.refBaseClassPath ?? "none"}\``,
          },
          range: toLspRange(cls.range),
        };
      }
    }
  }

  for (const lib of doc.roleClassLibs) {
    for (const cls of lib.classes) {
      if (containsOffset(cls.range, offset)) {
        return {
          contents: {
            kind: "markdown",
            value: `### RoleClass: **${lib.name}/${cls.name}**\n* **PPR Category:** \`${cls.pprCategory ?? "Resource"}\``,
          },
          range: toLspRange(cls.range),
        };
      }
    }
  }

  return null;
}

/**
 * Provides context-aware completions for AutomationML standard libraries, declared classes, and partner ports.
 */
export function getAutomationMLCompletions(
  content: string,
  _offsetOrPosition?: number | LspPosition,
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource",
      kind: 7,
      detail: "IEC 62714 Base Resource Role",
      documentation: "Standard AutomationML PPR Resource role class (robots, conveyors, PLCs, sensors).",
    },
    {
      label: "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Product",
      kind: 7,
      detail: "IEC 62714 Base Product Role",
      documentation: "Standard AutomationML PPR Product role class (workpieces, parts, assemblies).",
    },
    {
      label: "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Process",
      kind: 7,
      detail: "IEC 62714 Base Process Role",
      documentation: "Standard AutomationML PPR Process role class (manufacturing steps, operations).",
    },
    {
      label: "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface",
      kind: 8,
      detail: "IEC 62714 Signal Interface",
      documentation: "Standard AutomationML discrete/analog I/O signal port.",
    },
    {
      label: "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/PLCopenXMLInterface",
      kind: 8,
      detail: "IEC 62714 PLCopen XML Logic Interface",
      documentation: "Links an InternalElement to an external IEC 61131-3 PLCopen XML or ST program.",
    },
    {
      label: "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/COLLADAInterface",
      kind: 8,
      detail: "IEC 62714 COLLADA 3D Geometry/Kinematics Interface",
      documentation: "Links an InternalElement to an external COLLADA (.dae) 3D mesh and kinematic model.",
    },
  ];

  try {
    const doc = parseAutomationML(content);
    for (const lib of doc.systemUnitClassLibs) {
      for (const cls of lib.classes) {
        const path = `${lib.name}/${cls.name}`;
        items.push({
          label: path,
          kind: 7,
          detail: "SystemUnitClass",
          insertText: path,
        });
      }
    }
    for (const lib of doc.roleClassLibs) {
      for (const cls of lib.classes) {
        const path = `${lib.name}/${cls.name}`;
        items.push({
          label: path,
          kind: 7,
          detail: "RoleClass",
          insertText: path,
        });
      }
    }
    const visitEl = (el: AmlInternalElement): void => {
      for (const iface of el.interfaces) {
        const endpoint = `${el.id}:${iface.name}`;
        items.push({
          label: endpoint,
          kind: 12,
          detail: `${iface.direction} ${iface.category} Port on ${el.name}`,
          insertText: endpoint,
        });
      }
      for (const child of el.children) {
        visitEl(child);
      }
    };
    for (const ih of doc.instanceHierarchies) {
      for (const el of ih.elements) {
        visitEl(el);
      }
    }
  } catch {
    // Return base library completions even when document is incomplete
  }

  return items;
}

/**
 * Resolves Go-to-Definition for InternalLink partner endpoints and class references.
 */
export function getAutomationMLDefinition(
  content: string,
  offsetOrPosition: number | LspPosition,
  uri: string = "plant.aml",
): LspLocation | null {
  let doc: AmlDocument;
  try {
    doc = parseAutomationML(content, uri);
  } catch {
    return null;
  }

  const offset = resolveOffset(content, offsetOrPosition);

  const classLocations = new Map<string, AmlSourceRange>();
  for (const lib of doc.systemUnitClassLibs) {
    for (const cls of lib.classes) {
      classLocations.set(`${lib.name}/${cls.name}`, cls.range);
      classLocations.set(cls.name, cls.range);
    }
  }
  for (const lib of doc.roleClassLibs) {
    for (const cls of lib.classes) {
      classLocations.set(`${lib.name}/${cls.name}`, cls.range);
      classLocations.set(cls.name, cls.range);
    }
  }
  for (const lib of doc.interfaceClassLibs) {
    for (const cls of lib.classes) {
      classLocations.set(`${lib.name}/${cls.name}`, cls.range);
      classLocations.set(cls.name, cls.range);
    }
  }

  const portLocations = new Map<string, AmlSourceRange>();
  const elementLocations = new Map<string, AmlSourceRange>();
  const allElements: AmlInternalElement[] = [];

  const collect = (el: AmlInternalElement): void => {
    allElements.push(el);
    elementLocations.set(el.id, el.range);
    elementLocations.set(el.name, el.range);
    for (const iface of el.interfaces) {
      portLocations.set(`${el.id}:${iface.name}`, iface.range);
      portLocations.set(`${el.name}:${iface.name}`, iface.range);
      portLocations.set(iface.id, iface.range);
    }
    for (const child of el.children) {
      collect(child);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    for (const el of ih.elements) {
      collect(el);
    }
  }

  for (const el of allElements) {
    for (const link of el.internalLinks) {
      if (containsOffset(link.range, offset)) {
        const targetRange =
          portLocations.get(link.refPartnerSideA) ??
          portLocations.get(link.refPartnerSideB) ??
          elementLocations.get(link.refPartnerSideA.split(":")[0] ?? "");
        if (targetRange) {
          return { uri, range: toLspRange(targetRange) };
        }
      }
    }

    for (const rr of el.roleRequirements) {
      if (containsOffset(rr.range, offset)) {
        const targetRange = classLocations.get(rr.refBaseRoleClassPath);
        if (targetRange) {
          return { uri, range: toLspRange(targetRange) };
        }
      }
    }

    for (const iface of el.interfaces) {
      if (containsOffset(iface.range, offset) && iface.refBaseClassPath) {
        const targetRange = classLocations.get(iface.refBaseClassPath);
        if (targetRange) {
          return { uri, range: toLspRange(targetRange) };
        }
      }
    }

    if (containsOffset(el.range, offset) && el.refBaseSystemUnitPath) {
      const targetRange = classLocations.get(el.refBaseSystemUnitPath);
      if (targetRange) {
        return { uri, range: toLspRange(targetRange) };
      }
    }
  }

  return null;
}

export async function executeAutomationMLAction(
  actionId: "aml_to_dae" | "automationml_to_dae",
  content: string,
  params?: AmlVirtualCommissioningOptions & AmlLintOptions,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeAutomationMLAction(
  actionId:
    | "aml_to_ssp"
    | "automationml_to_ssp"
    | "aml_to_sysml2"
    | "automationml_to_sysml2"
    | "aml_to_sysml"
    | "aml_to_modelica"
    | "automationml_to_modelica",
  content: string,
  params?: AmlVirtualCommissioningOptions & AmlLintOptions,
): Promise<string>;
export async function executeAutomationMLAction(
  actionId: "aml_virtual_commissioning" | "automationml_virtual_commissioning" | "aml_cosim",
  content: string,
  params?: AmlVirtualCommissioningOptions & AmlLintOptions,
): Promise<AmlVirtualCommissioningResult>;
export async function executeAutomationMLAction(
  actionId: string,
  content: string,
  params?: AmlVirtualCommissioningOptions & AmlLintOptions,
): Promise<unknown>;
export async function executeAutomationMLAction(
  actionId: string,
  content: string,
  params?: AmlVirtualCommissioningOptions & AmlLintOptions,
): Promise<unknown> {
  const doc = parseAutomationML(content);

  switch (actionId) {
    case "aml_lint":
    case "automationml_lint":
      return lintAutomationML(doc, params);

    case "aml_to_dae":
    case "automationml_to_dae": {
      const arena = lowerAutomationMLToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "aml_virtual_commissioning":
    case "automationml_virtual_commissioning":
    case "aml_cosim":
      return runAmlVirtualCommissioning(doc, params);

    case "aml_to_ssp":
    case "automationml_to_ssp":
      return amlToSsp(doc);

    case "aml_to_sysml2":
    case "automationml_to_sysml2":
    case "aml_to_sysml":
      return amlToSysML2(doc);

    case "aml_to_modelica":
    case "automationml_to_modelica":
      return amlToModelica(doc);

    default:
      throw new Error(`Unknown AutomationML action: ${actionId}`);
  }
}
