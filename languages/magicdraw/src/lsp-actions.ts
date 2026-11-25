// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — IDE & Ansatz Action Handlers.
 */

import { lowerMagicDrawParametricsToDae } from "./dae/parametric-to-dae.js";
import { renderMagicDrawDiagramSvg } from "./diagram.js";
import { lintMagicDrawDocument } from "./lints/index.js";
import { parseMagicDraw } from "./parser/index.js";
import { magicDrawToModelica, magicDrawToReqif, magicDrawToSysml2 } from "./projections/index.js";

export interface MagicDrawActionContext {
  text: string;
  uri?: string | undefined;
}

export const magicDrawActionHandlers: Record<string, (ctx: MagicDrawActionContext) => unknown> = {
  magicdraw_to_sysml2(ctx) {
    const doc = parseMagicDraw(ctx.text);
    return {
      language: "sysml2",
      extension: ".sysml",
      content: magicDrawToSysml2(doc),
    };
  },
  magicdraw_to_reqif(ctx) {
    const doc = parseMagicDraw(ctx.text);
    return {
      language: "reqif",
      extension: ".reqif",
      content: magicDrawToReqif(doc),
    };
  },
  magicdraw_to_modelica(ctx) {
    const doc = parseMagicDraw(ctx.text);
    return {
      language: "modelica",
      extension: ".mo",
      content: magicDrawToModelica(doc),
    };
  },
  magicdraw_to_dae(ctx) {
    const doc = parseMagicDraw(ctx.text);
    const arena = lowerMagicDrawParametricsToDae(doc);
    return {
      modelName: doc.metadata.projectName ?? "MagicDraw_Parametric",
      variableCount: arena.varCount,
      equationCount: arena.eqCount,
    };
  },
  magicdraw_render_svg(ctx) {
    const doc = parseMagicDraw(ctx.text);
    return {
      svg: renderMagicDrawDiagramSvg(doc),
      diagramCount: doc.diagrams.length,
    };
  },
  magicdraw_lint(ctx) {
    const doc = parseMagicDraw(ctx.text);
    const diagnostics = lintMagicDrawDocument(doc);
    return {
      count: diagnostics.length,
      diagnostics,
    };
  },
};
