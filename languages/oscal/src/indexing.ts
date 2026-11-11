// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/oscal — Declarative Multi-File Indexing.
 *
 * Indexes NIST OSCAL 1.1.x documents (.oscal.json, .oscal.yaml, .oscal.xml)
 * including catalogs, groups, controls, parameters, profiles, components,
 * implemented-requirements, findings, and POA&M items into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseOscal } from "./parser/index.js";
import type { OscalControl, OscalDocument, OscalGroup } from "./types.js";

export function indexOscalFile(ctx: DslIndexFileContext): void {
  const doc = parseOscal(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  const docName = doc.metadata.title || doc.uuid;
  const docId = ctx.addSymbol(
    docName,
    "Package",
    null,
    doc.range.startOffset,
    doc.range.endOffset,
    {
      kind: doc.kind,
      uuid: doc.uuid,
      version: doc.metadata.version,
    },
    {
      ruleName: `oscal_${doc.kind.replace(/-/g, "_")}`,
      namePath: docName,
      aliases: doc.uuid ? [doc.uuid] : undefined,
    },
  );

  const indexControl = (ctrl: OscalControl, parentId: number, parentPath: string) => {
    const ctrlPath = `${parentPath}.${ctrl.id}`;
    const ctrlId = ctx.addSymbol(
      ctrl.id,
      "Class",
      parentId,
      ctrl.range?.startOffset ?? 0,
      ctrl.range?.endOffset ?? 0,
      {
        title: ctrl.title,
        class: ctrl.class,
      },
      {
        ruleName: "oscal_control",
        namePath: ctrlPath,
        aliases: ctrl.title ? [ctrl.title] : undefined,
      },
    );

    for (const param of ctrl.params ?? []) {
      ctx.addSymbol(
        param.id,
        "Property",
        ctrlId,
        param.range?.startOffset ?? 0,
        param.range?.endOffset ?? 0,
        {
          label: param.label,
          values: param.values,
        },
        {
          ruleName: "oscal_parameter",
          namePath: `${ctrlPath}.${param.id}`,
        },
      );
    }

    for (const subCtrl of ctrl.controls ?? []) {
      indexControl(subCtrl, ctrlId, ctrlPath);
    }
  };

  const indexGroup = (group: OscalGroup, parentId: number, parentPath: string) => {
    const grpPath = `${parentPath}.${group.id}`;
    const grpId = ctx.addSymbol(
      group.id,
      "Package",
      parentId,
      group.range?.startOffset ?? 0,
      group.range?.endOffset ?? 0,
      {
        title: group.title,
      },
      {
        ruleName: "oscal_group",
        namePath: grpPath,
      },
    );

    for (const ctrl of group.controls ?? []) {
      indexControl(ctrl, grpId, grpPath);
    }
    for (const subGrp of group.groups ?? []) {
      indexGroup(subGrp, grpId, grpPath);
    }
  };

  for (const grp of doc.groups ?? []) {
    indexGroup(grp, docId, docName);
  }
  for (const ctrl of doc.controls ?? []) {
    indexControl(ctrl, docId, docName);
  }

  const allComponents = [...(doc.components ?? []), ...(doc.systemImplementation?.components ?? [])];
  for (const comp of allComponents) {
    ctx.addSymbol(
      comp.title,
      "Component",
      docId,
      comp.range?.startOffset ?? 0,
      comp.range?.endOffset ?? 0,
      {
        uuid: comp.uuid,
        type: comp.type,
        status: comp.status,
      },
      {
        ruleName: "oscal_component",
        namePath: `${docName}.${comp.title}`,
        aliases: comp.uuid ? [comp.uuid] : undefined,
      },
    );
  }

  for (const ir of doc.controlImplementation?.implementedRequirements ?? []) {
    ctx.addSymbol(
      ir.controlId,
      "Interface",
      docId,
      ir.range?.startOffset ?? 0,
      ir.range?.endOffset ?? 0,
      {
        uuid: ir.uuid,
        controlId: ir.controlId,
        description: ir.description,
      },
      {
        ruleName: "oscal_implemented_requirement",
        namePath: `${docName}.${ir.controlId}`,
        aliases: ir.uuid ? [ir.uuid] : undefined,
      },
    );
  }

  for (const finding of doc.findings ?? []) {
    ctx.addSymbol(
      finding.title,
      "Event",
      docId,
      finding.range?.startOffset ?? 0,
      finding.range?.endOffset ?? 0,
      {
        uuid: finding.uuid,
        targetControlId: finding.targetControlId,
        severity: finding.severity,
        status: finding.status,
      },
      {
        ruleName: "oscal_finding",
        namePath: `${docName}.${finding.title}`,
        aliases: finding.uuid ? [finding.uuid] : undefined,
      },
    );
  }

  for (const poam of doc.poamItems ?? []) {
    ctx.addSymbol(
      poam.title,
      "Variable",
      docId,
      poam.range?.startOffset ?? 0,
      poam.range?.endOffset ?? 0,
      {
        uuid: poam.uuid,
        relatedFindingUuid: poam.relatedFindingUuid,
        targetControlId: poam.targetControlId,
        status: poam.status,
      },
      {
        ruleName: "oscal_poam_item",
        namePath: `${docName}.${poam.title}`,
        aliases: poam.uuid ? [poam.uuid] : undefined,
      },
    );
  }
}

export function getOscalDocument(workspace: UnifiedWorkspace, uri: string): OscalDocument | undefined {
  return workspace.getParsedModel<OscalDocument>(uri);
}

export function resolveOscalInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const idx = workspace.getFileIndex(uri);
  if (idx && scopeId !== null) {
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

  const exact = workspace.findSymbolsByName(name);
  if (exact.length > 0) return exact[0]!;

  for (const sym of workspace.getSymbolsForUri()) {
    if (sym.name.toLowerCase() === name.toLowerCase()) {
      return sym;
    }
  }
  return null;
}
