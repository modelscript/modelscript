// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Multi-file Workspace Indexer for AMPL Models & Data.
 */

import { BaseWorkspaceIndex, type SymbolIndex } from "@modelscript/runtime";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplData, AmplModel } from "./types.js";

export class AmplWorkspaceIndex extends BaseWorkspaceIndex<AmplModel> {
  public readonly languageName = "ampl";
  private fileData = new Map<string, AmplData>();

  public getData(uri: string): AmplData | undefined {
    return this.fileData.get(uri);
  }

  public override indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol, symbols, byName, childrenOf } = this.createIndexContext(uri);

    const isDat = uri.toLowerCase().endsWith(".dat") || /^\s*(?:set|param)\s+\w+\s*:?=/m.test(text);

    if (isDat) {
      try {
        const data = parseAmplData(text);
        this.fileData.set(uri, data);
        const rootId = addSymbol("AMPL_Data", "package", null, 0, text.length);

        for (const [setName, elements] of data.sets) {
          addSymbol(setName, "array", rootId, 0, 50, { size: elements.length });
        }
        for (const [paramName, values] of data.params) {
          addSymbol(paramName, "constant", rootId, 0, 50, { size: values.size });
        }
      } catch {
        // Fallback to empty symbols on parse error
      }
    } else {
      try {
        const model = parseAmplModel(text);
        this.fileDecks.set(uri, model);
        const rootId = addSymbol("AMPL_Model", "package", null, 0, text.length);

        for (const [name, decl] of model.sets) {
          addSymbol(name, "array", rootId, 0, 50, { dimen: decl.dimen });
        }
        for (const [name, decl] of model.params) {
          addSymbol(name, "constant", rootId, 0, 50, { type: decl.type });
        }
        for (const [name, decl] of model.vars) {
          addSymbol(name, "variable", rootId, 0, 50, { type: decl.type });
        }
        for (const [name, decl] of model.objectives) {
          addSymbol(name, "function", rootId, 0, 50, { direction: decl.direction });
        }
        for (const [name, decl] of model.constraints) {
          addSymbol(name, "property", rootId, 0, 50, { operator: decl.operator });
        }
      } catch {
        // Fallback to empty symbols on parse error
      }
    }

    return { symbols, byName, childrenOf };
  }
}
