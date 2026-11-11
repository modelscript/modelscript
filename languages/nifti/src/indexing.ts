// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseNifti } from "./parser/index.js";

export function indexNiftiFile(ctx: DslIndexFileContext): void {
  const doc = parseNifti(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  // 1. Index Volume Header as Root Class Symbol
  const volSymId = ctx.addSymbol(
    doc.title,
    "Class",
    null,
    doc.range.startOffset,
    doc.range.endOffset,
    {
      format: doc.format,
      datatype: doc.header.datatypeName,
      dim: doc.header.dim.slice(0, 4),
      pixdim: doc.header.pixdim.slice(0, 4),
    },
    {
      ruleName: "nifti_volume",
      namePath: doc.title,
    },
  );

  // 2. Index Anatomical Segmentation Labels
  for (const lbl of doc.labels) {
    ctx.addSymbol(
      lbl.name,
      "Constant",
      volSymId,
      lbl.range.startOffset,
      lbl.range.endOffset,
      {
        labelId: lbl.id,
        color: lbl.color,
      },
      {
        ruleName: "nifti_label",
        namePath: `${doc.title}.${lbl.name}`,
        aliases: [String(lbl.id)],
      },
    );
  }

  // 3. Index Compartmental ROIs
  for (const roi of doc.rois) {
    ctx.addSymbol(
      roi.name,
      "Component",
      volSymId,
      roi.range.startOffset,
      roi.range.endOffset,
      {
        roiId: roi.id,
        labelId: roi.labelId,
        diffusionCoeffD: roi.diffusionCoeffD,
        clearanceRateK: roi.clearanceRateK,
      },
      {
        ruleName: "nifti_roi",
        namePath: `${doc.title}.${roi.name}`,
        aliases: [roi.id],
      },
    );
  }
}

export function resolveNiftiInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri?: string,
): SymbolEntry | null {
  const fileIdx = uri ? workspace.getFileIndex(uri) : undefined;
  const idx = fileIdx ?? workspace.getIndex();

  if (scopeId !== null) {
    const children = idx.childrenOf.get(scopeId) ?? workspace.getIndex().childrenOf.get(scopeId);
    if (children) {
      const merged = workspace.getIndex();
      for (const cid of children) {
        const sym = idx.symbols.get(cid) ?? merged.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  const found = workspace.findSymbolsByName(name);
  return found[0] ?? null;
}
