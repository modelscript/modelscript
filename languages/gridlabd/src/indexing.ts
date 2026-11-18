// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative Workspace Indexing for GridLAB-D (.glm) Models.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseGridlabd } from "./parser/gridlabd-parser.js";
import type { GlmModel } from "./types.js";

export interface GridlabdWorkspaceSummary {
  uri: string;
  moduleCount: number;
  objectCount: number;
  modules: string[];
  hasClock: boolean;
}

export function canIndexGridlabd(uri: string): boolean {
  return uri.toLowerCase().endsWith(".glm");
}

export function buildGridlabdWorkspaceSummary(uri: string, model: GlmModel): GridlabdWorkspaceSummary {
  return {
    uri,
    moduleCount: model.modules.length,
    objectCount: model.allObjects.length,
    modules: model.modules.map((m) => m.name),
    hasClock: Boolean(model.clock),
  };
}

export function indexGridlabdDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  const model = parseGridlabd(text);
  const summary = buildGridlabdWorkspaceSummary(uri, model);

  ctx.setParsedModel(summary);
  ctx.setParsedModel(model, "glm");

  const rootName =
    uri
      .split("/")
      .pop()
      ?.replace(/\.glm$/i, "") || "GridlabdModel";
  const rootId = ctx.addSymbol(
    rootName,
    "Package",
    null,
    0,
    text.length,
    {
      moduleCount: model.modules.length,
      objectCount: model.allObjects.length,
    },
    {
      ruleName: "GlmFile",
      namePath: rootName,
    },
  );

  for (const mod of model.modules) {
    ctx.addSymbol(mod.name, "Module", rootId, mod.span.startOffset, mod.span.endOffset, mod.properties, {
      ruleName: "ModuleBlock",
      namePath: `${rootName}.${mod.name}`,
    });
  }

  for (const obj of model.allObjects) {
    const objName = obj.name ?? (obj.id ? `${obj.className}:${obj.id}` : obj.className);
    ctx.addSymbol(
      objName,
      "Component",
      rootId,
      obj.span.startOffset,
      obj.span.endOffset,
      {
        className: obj.className,
        parent: obj.parent,
        ...obj.properties,
      },
      {
        ruleName: "ObjectBlock",
        namePath: `${rootName}.${objName}`,
      },
    );
  }
}
