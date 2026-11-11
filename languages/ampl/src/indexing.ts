// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Declarative Workspace Indexing for AMPL Models & Data.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplData, AmplModel } from "./types.js";

/**
 * Disambiguates AMPL `.mod` and `.dat` files in polyglot `UnifiedWorkspace` instances.
 */
export function canIndexAmpl(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".ampl") || lower.endsWith(".run") || lower.endsWith(".mps")) {
    return true;
  }
  if (!text) return lower.endsWith(".mod") || lower.endsWith(".dat");
  return /(?:^|\s)(?:set|param|var|minimize|maximize|subject\s+to|data;|solve;)\b/m.test(text);
}

/**
 * Declarative per-file indexer for AMPL `.mod` and `.dat` documents.
 */
export function indexAmplDocument(ctx: DslIndexFileContext): void {
  const { text } = ctx;
  const isDat = ctx.extension === ".dat" || /^\s*(?:set|param)\s+\w+\s*:?=/m.test(text);

  if (isDat) {
    try {
      const data = parseAmplData(text);
      ctx.setParsedModel<AmplData>(data, "data");
      const rootId = ctx.addSymbol("AMPL_Data", "package", null, 0, text.length);

      for (const [setName, elements] of data.sets) {
        ctx.addSymbol(setName, "array", rootId, 0, Math.min(50, text.length), { size: elements.length });
      }
      for (const [paramName, values] of data.params) {
        ctx.addSymbol(paramName, "constant", rootId, 0, Math.min(50, text.length), { size: values.size });
      }
    } catch {
      // Fallback to empty symbols on parse error
    }
  } else {
    try {
      const model = parseAmplModel(text);
      ctx.setParsedModel<AmplModel>(model);
      const rootId = ctx.addSymbol("AMPL_Model", "package", null, 0, text.length);

      for (const [name, decl] of model.sets) {
        ctx.addSymbol(name, "array", rootId, 0, Math.min(50, text.length), { dimen: decl.dimen });
      }
      for (const [name, decl] of model.params) {
        ctx.addSymbol(name, "constant", rootId, 0, Math.min(50, text.length), { type: decl.type });
      }
      for (const [name, decl] of model.vars) {
        ctx.addSymbol(name, "variable", rootId, 0, Math.min(50, text.length), { type: decl.type });
      }
      for (const [name, decl] of model.objectives) {
        ctx.addSymbol(name, "function", rootId, 0, Math.min(50, text.length), { direction: decl.direction });
      }
      for (const [name, decl] of model.constraints) {
        ctx.addSymbol(name, "property", rootId, 0, Math.min(50, text.length), { operator: decl.operator });
      }
    } catch {
      // Fallback to empty symbols on parse error
    }
  }
}

/**
 * Retrieves a parsed `AmplModel` from `UnifiedWorkspace` for `uri`.
 */
export function getAmplModel(workspace: UnifiedWorkspace, uri: string): AmplModel | undefined {
  return workspace.getParsedModel<AmplModel>(uri);
}

/**
 * Retrieves a parsed `AmplData` from `UnifiedWorkspace` for `uri`.
 */
export function getAmplData(workspace: UnifiedWorkspace, uri: string): AmplData | undefined {
  return workspace.getParsedModel<AmplData>(uri, "data");
}
