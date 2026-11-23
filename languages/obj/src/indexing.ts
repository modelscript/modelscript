// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Wavefront OBJ (.obj) objects, groups, and material usages as well as
 * Wavefront MTL (.mtl) material definitions into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseMtl } from "./parser/mtl-parser.js";
import { parseObj } from "./parser/obj-parser.js";

export const objIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".obj") || lower.endsWith(".mtl")) {
      return true;
    }
    if (!text) return false;
    return /^(?:v\s+[+-]?\d|f\s+[+-]?\d|newmtl\s+\S)/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const lower = ctx.uri.toLowerCase();
    const isMtl = lower.endsWith(".mtl") || (/^\s*newmtl\s+/m.test(ctx.text) && !/^\s*v\s+/m.test(ctx.text));

    if (isMtl) {
      const mtl = parseMtl(ctx.text);
      ctx.setParsedModel(mtl);

      const rootId = ctx.addSymbol(
        "MTL_Library",
        "Package",
        null,
        0,
        ctx.text.length,
        {
          materialCount: mtl.materials.size,
        },
        {
          ruleName: "mtlLibrary",
          namePath: "name",
        },
      );

      for (const mat of mtl.materials.values()) {
        ctx.addSymbol(
          mat.name,
          "Class",
          rootId,
          mat.startOffset,
          mat.endOffset,
          {
            Kd: mat.Kd,
            Ka: mat.Ka,
            Ks: mat.Ks,
            Ns: mat.Ns,
            d: mat.d,
            Ni: mat.Ni,
            illum: mat.illum,
          },
          {
            ruleName: "mtlMaterial",
            namePath: "name",
          },
        );
      }
      return;
    }

    const doc = parseObj(ctx.text);
    ctx.setParsedModel(doc);

    const modelName = doc.objects[0]?.name || "OBJ_Mesh";
    const rootId = ctx.addSymbol(
      modelName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        vertexCount: doc.vertices.length,
        faceCount: doc.faces.length,
        objectCount: doc.objects.length,
        groupCount: doc.groups.length,
      },
      {
        ruleName: "objModel",
        namePath: "name",
      },
    );

    for (const obj of doc.objects) {
      ctx.addSymbol(
        obj.name,
        "Class",
        rootId,
        obj.startOffset,
        obj.endOffset,
        {
          faceCount: obj.faceIndices.length,
          line: obj.line,
        },
        {
          ruleName: "objObject",
          namePath: "name",
        },
      );
    }

    for (const grp of doc.groups) {
      ctx.addSymbol(
        grp.name,
        "Component",
        rootId,
        grp.startOffset,
        grp.endOffset,
        {
          faceCount: grp.faceIndices.length,
          line: grp.line,
        },
        {
          ruleName: "objGroup",
          namePath: "name",
        },
      );
    }
  },
};
