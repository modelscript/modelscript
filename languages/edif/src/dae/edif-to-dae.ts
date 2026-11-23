// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseEdif } from "../parser/edif-parser.js";
import type { EdifDocument, FlattenedEdifNetlist } from "../types.js";
import { lowerEdifToDae, type EdifDaeLoweringOptions, type EdifDaeLoweringResult } from "./lowering.js";

export { lowerEdifToDae, type EdifDaeLoweringOptions, type EdifDaeLoweringResult };

export interface EdifToDaeOptions extends EdifDaeLoweringOptions {
  modelName?: string;
}

/**
 * Lowers an EDIF 2.0.0 source string, `EdifDocument`, or `FlattenedEdifNetlist`
 * directly into a linear-memory `DAEBuilder` arena.
 */
export function edifToDae(input: string | EdifDocument | FlattenedEdifNetlist, options?: EdifToDaeOptions): DAEBuilder {
  const docOrFlat = typeof input === "string" ? parseEdif(input) : input;
  const rawName =
    options?.modelName ??
    ("libraries" in docOrFlat ? (docOrFlat.design?.name ?? docOrFlat.name) : docOrFlat.designName) ??
    "EdifNetlist";
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerEdifToDae(builder, docOrFlat, options);
  return builder;
}
