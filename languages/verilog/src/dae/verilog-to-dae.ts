// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import type { VerilogDesign, VerilogModule } from "../types.js";
import { lowerVerilogToDae, type VerilogDaeLoweringResult } from "./lowering.js";

export { lowerVerilogToDae, type VerilogDaeLoweringResult };

export interface VerilogToDaeOptions {
  modelName?: string | undefined;
  topModule?: string | undefined;
}

/**
 * Lowers an IEEE 1364 Verilog design or module into a linear-memory `DAEBuilder` arena.
 */
export function verilogToDae(designOrModule: VerilogDesign | VerilogModule, options?: VerilogToDaeOptions): DAEBuilder {
  const defaultName =
    "modules" in designOrModule
      ? (options?.topModule ?? designOrModule.modules[designOrModule.modules.length - 1]?.name ?? "VerilogDesign")
      : designOrModule.name;
  const modelName = (options?.modelName ?? defaultName).replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerVerilogToDae(builder, designOrModule, options?.topModule);
  return builder;
}
