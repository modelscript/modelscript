// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseSdl } from "../parser/sdl-parser.js";
import type { SdlSystemModel } from "../types.js";
import { lowerSdlToDae, type SdlDaeLoweringResult } from "./lowering.js";

export interface SdlToDaeResult {
  builder: DAEBuilder;
  model: SdlSystemModel;
  lowering: SdlDaeLoweringResult;
}

/**
 * Parses an SDL-88 source string (or accepts a pre-parsed `SdlSystemModel`) and lowers it
 * directly into a freshly instantiated linear-memory `DAEBuilder`.
 */
export function sdlToDae(input: string | SdlSystemModel): SdlToDaeResult {
  const model = typeof input === "string" ? parseSdl(input) : input;
  const builder = new DAEBuilder();
  const lowering = lowerSdlToDae(builder, model);
  return { builder, model, lowering };
}
