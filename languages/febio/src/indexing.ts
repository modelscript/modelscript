// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Declarative Workspace Indexing.
 *
 * Indexes FEBio (.feb) and SOFA Framework (.scn) files including materials,
 * node sets, surfaces, boundary conditions, contacts, and SOFA scene nodes.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseFebio } from "./parser/index.js";
import type { FebioDocument } from "./types.js";

export function canIndexFebio(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".feb") || lower.endsWith(".scn")) return true;
  if (text && (text.includes("<febio_spec") || /^\s*FEBIO\s+/m.test(text))) return true;
  return false;
}

export function indexFebioDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const doc = parseFebio(text, uri);
  ctx.setParsedModel(doc);

  // 1. Index Materials
  for (const mat of doc.materials) {
    const aliases = mat.id && mat.id !== mat.name ? [mat.id] : undefined;
    ctx.addSymbol(
      mat.name,
      "Class",
      null,
      mat.range.startOffset,
      mat.range.endOffset,
      {
        materialId: mat.id,
        materialType: mat.type,
        E: mat.E,
        v: mat.v,
        c1: mat.c1,
        c2: mat.c2,
      },
      {
        ruleName: "febio_material",
        namePath: mat.name,
        aliases,
      },
    );
  }

  // 2. Index NodeSets
  for (const ns of doc.nodeSets) {
    ctx.addSymbol(
      ns.name,
      "Component",
      null,
      ns.range.startOffset,
      ns.range.endOffset,
      { nodeCount: ns.nodeIds.length },
      { ruleName: "febio_nodeset", namePath: ns.name },
    );
  }

  // 3. Index Surfaces
  for (const surf of doc.surfaces) {
    ctx.addSymbol(
      surf.name,
      "Interface",
      null,
      surf.range.startOffset,
      surf.range.endOffset,
      { facetCount: surf.facets.length },
      { ruleName: "febio_surface", namePath: surf.name },
    );
  }

  // 4. Index Boundary Conditions
  for (const bc of doc.boundaryConditions) {
    const aliases = bc.id && bc.id !== bc.name ? [bc.id] : undefined;
    ctx.addSymbol(
      bc.name,
      "Property",
      null,
      bc.range.startOffset,
      bc.range.endOffset,
      {
        bcType: bc.type,
        nodeSet: bc.nodeSet,
        dofs: bc.dofs,
      },
      {
        ruleName: "febio_bc",
        namePath: bc.name,
        aliases,
      },
    );
  }

  // 5. Index Contacts
  for (const c of doc.contacts) {
    const aliases = c.id && c.id !== c.name ? [c.id] : undefined;
    ctx.addSymbol(
      c.name,
      "Event",
      null,
      c.range.startOffset,
      c.range.endOffset,
      {
        contactType: c.type,
        primarySurface: c.primarySurface,
        secondarySurface: c.secondarySurface,
        penalty: c.penalty,
      },
      {
        ruleName: "febio_contact",
        namePath: c.name,
        aliases,
      },
    );
  }

  // 6. Index SOFA Scene Nodes & Child ForceFields
  for (const sn of doc.sofaNodes) {
    const snSymId = ctx.addSymbol(
      sn.name,
      "Module",
      null,
      sn.range.startOffset,
      sn.range.endOffset,
      {
        hasMechanicalObject: sn.hasMechanicalObject,
        hasFixedConstraint: sn.hasFixedConstraint,
      },
      { ruleName: "sofa_node", namePath: sn.name },
    );

    for (const ff of sn.forceFields) {
      ctx.addSymbol(
        ff.name,
        "Variable",
        snSymId,
        ff.range.startOffset,
        ff.range.endOffset,
        {
          forceFieldType: ff.type,
          youngModulus: ff.youngModulus,
          poissonRatio: ff.poissonRatio,
        },
        {
          ruleName: "sofa_forcefield",
          namePath: `${sn.name}.${ff.name}`,
        },
      );
    }
  }
}

export function getFebioDocument(workspace: UnifiedWorkspace, uri: string): FebioDocument | undefined {
  return workspace.getParsedModel<FebioDocument>(uri);
}

export function resolveFebioInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri?: string,
): SymbolEntry | null {
  const idx = uri ? workspace.getFileIndex(uri) : workspace.getIndex();
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
  const scopedMatches = workspace.findSymbolsByName(name, uri);
  if (scopedMatches.length > 0) return scopedMatches[0]!;
  const globalMatches = workspace.findSymbolsByName(name);
  return globalMatches[0] ?? null;
}
