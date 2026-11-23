// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import { parseAsn1 } from "../parser/asn1-parser.js";
import type { Asn1Module } from "../types.js";
import { lowerAsn1ToDae, type Asn1DaeLoweringOptions, type Asn1DaeLoweringResult } from "./lowering.js";

export interface Asn1ToDaeResult {
  builder: DAEBuilder;
  model: Asn1Module;
  lowering: Asn1DaeLoweringResult;
}

/**
 * Parses an ASN.1 source string (or accepts a pre-parsed `Asn1Module`) and lowers its
 * wire-size and bandwidth budget equations directly into a linear-memory `DAEBuilder`.
 */
export function asn1ToDae(input: string | Asn1Module, options?: Asn1DaeLoweringOptions): Asn1ToDaeResult {
  const model = typeof input === "string" ? parseAsn1(input) : input;
  const builder = new DAEBuilder();
  const lowering = lowerAsn1ToDae(builder, model, options);
  return { builder, model, lowering };
}
