// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Declarative Workspace Indexing.
 *
 * Indexes IEC 62714 AutomationML (`.aml`, `.caex`) InstanceHierarchies, InternalElements,
 * ExternalInterfaces, Attributes, SystemUnitClasses, RoleClasses, and InterfaceClasses.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseAutomationML } from "./parser/index.js";
import type { AmlDocument, AmlInternalElement } from "./types.js";

/**
 * Declarative per-file indexer for IEC 62714 AutomationML documents.
 */
export function indexAutomationMLDocument(ctx: DslIndexFileContext): void {
  const doc = parseAutomationML(ctx.text, ctx.uri);
  ctx.setParsedModel<AmlDocument>(doc);

  // 1. Index SystemUnitClassLibs
  for (const lib of doc.systemUnitClassLibs) {
    for (const cls of lib.classes) {
      const fullPath = `${lib.name}/${cls.name}`;
      ctx.addSymbol(
        cls.name,
        "Class",
        null,
        cls.range.startOffset,
        cls.range.endOffset,
        {
          library: lib.name,
          refBaseClassPath: cls.refBaseClassPath,
        },
        {
          ruleName: "aml_system_unit_class",
          namePath: fullPath,
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          aliases: [fullPath],
        },
      );
    }
  }

  // 2. Index RoleClassLibs
  for (const lib of doc.roleClassLibs) {
    for (const cls of lib.classes) {
      const fullPath = `${lib.name}/${cls.name}`;
      ctx.addSymbol(
        cls.name,
        "Class",
        null,
        cls.range.startOffset,
        cls.range.endOffset,
        {
          library: lib.name,
          pprCategory: cls.pprCategory,
          refBaseClassPath: cls.refBaseClassPath,
        },
        {
          ruleName: "aml_role_class",
          namePath: fullPath,
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          aliases: [fullPath],
        },
      );
    }
  }

  // 3. Index InterfaceClassLibs
  for (const lib of doc.interfaceClassLibs) {
    for (const cls of lib.classes) {
      const fullPath = `${lib.name}/${cls.name}`;
      ctx.addSymbol(
        cls.name,
        "Interface",
        null,
        cls.range.startOffset,
        cls.range.endOffset,
        {
          library: lib.name,
          category: cls.category,
          refBaseClassPath: cls.refBaseClassPath,
        },
        {
          ruleName: "aml_interface_class",
          namePath: fullPath,
          inherits: cls.refBaseClassPath ? [cls.refBaseClassPath] : [],
          aliases: [fullPath],
        },
      );
    }
  }

  // 4. Index InstanceHierarchies and InternalElements recursively
  const indexElement = (el: AmlInternalElement, parentSymId: number, parentPath: string): void => {
    const elPath = `${parentPath}.${el.name}`;
    const elSymId = ctx.addSymbol(
      el.name,
      "Component",
      parentSymId,
      el.range.startOffset,
      el.range.endOffset,
      {
        elementId: el.id,
        pprCategory: el.pprCategory,
        refBaseSystemUnitPath: el.refBaseSystemUnitPath,
        frame: el.frame,
      },
      {
        ruleName: "aml_internal_element",
        namePath: elPath,
        inherits: el.refBaseSystemUnitPath ? [el.refBaseSystemUnitPath] : [],
        aliases: el.id ? [el.id] : [],
      },
    );

    for (const attr of el.attributes) {
      ctx.addSymbol(
        attr.name,
        "Variable",
        elSymId,
        attr.range.startOffset,
        attr.range.endOffset,
        {
          dataType: attr.dataType,
          unit: attr.unit,
          value: attr.value,
        },
        {
          ruleName: "aml_attribute",
          namePath: `${elPath}.${attr.name}`,
        },
      );
    }

    for (const iface of el.interfaces) {
      ctx.addSymbol(
        iface.name,
        "Component",
        elSymId,
        iface.range.startOffset,
        iface.range.endOffset,
        {
          interfaceId: iface.id,
          direction: iface.direction,
          category: iface.category,
          dataType: iface.dataType,
          refUri: iface.refUri,
        },
        {
          ruleName: "aml_external_interface",
          namePath: `${elPath}.${iface.name}`,
          inherits: iface.refBaseClassPath ? [iface.refBaseClassPath] : [],
          aliases: [`${el.id}:${iface.name}`, `${el.name}:${iface.name}`],
        },
      );
    }

    for (const childEl of el.children) {
      indexElement(childEl, elSymId, elPath);
    }
  };

  for (const ih of doc.instanceHierarchies) {
    const ihId = ctx.addSymbol(
      ih.name,
      "Package",
      null,
      ih.range.startOffset,
      ih.range.endOffset,
      {
        version: ih.version,
        elementCount: ih.elements.length,
      },
      {
        ruleName: "aml_instance_hierarchy",
        namePath: ih.name,
      },
    );

    for (const el of ih.elements) {
      indexElement(el, ihId, ih.name);
    }
  }
}

/**
 * Retrieves a parsed `AmlDocument` from `UnifiedWorkspace` for `uri`.
 */
export function getAutomationMLDocument(workspace: UnifiedWorkspace, uri: string): AmlDocument | undefined {
  return workspace.getParsedModel<AmlDocument>(uri);
}

/**
 * Resolves a symbol `name` within `scopeId` (in `uri`) or across `workspace`.
 */
export function resolveAutomationMLInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const fileIdx = workspace.getFileIndex(uri);
  if (fileIdx && scopeId !== null) {
    const children = fileIdx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = fileIdx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  const idx = workspace.getIndex();
  if (scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  const matches = workspace.findSymbolsByName(name);
  return matches[0] ?? null;
}
