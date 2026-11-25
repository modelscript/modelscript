// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import type { ExtractedCompilerOptions, FlattenerCstNode, FlattenOptions } from "../types.js";

export function extractCompilerOptions(
  classCst: FlattenerCstNode | null | undefined,
  options?: FlattenOptions & { scodeinstMode?: boolean | undefined },
  db?: (QueryDB & { source?(resourceId: string): string | undefined }) | null,
  rootSym?: SymbolEntry | null,
): ExtractedCompilerOptions {
  let cmdOptions = "";
  if (classCst) {
    try {
      const evaluator = new AnnotationEvaluator(db ?? null);
      const evaluated = evaluator.evaluate(classCst, "__OpenModelica_commandLineOptions");
      if (typeof evaluated === "string") {
        cmdOptions = evaluated;
      }
    } catch {
      // fallback
    }
  }

  let fileSrc = "";
  if (rootSym?.resourceId && db) {
    const s = db.source?.(rootSym.resourceId);
    if (typeof s === "string") fileSrc = s;
  }

  const cstText = classCst?.text ?? "";
  const rootText = classCst?.tree?.rootNode?.text ?? "";
  const combined = `${cmdOptions} ${cstText} ${rootText} ${fileSrc}`;

  const hasOldInstAnnotation = Boolean(cmdOptions.includes("-d=-newInst") || combined.includes("-d=-newInst"));

  const isOldFrontend = Boolean(options?.isOldFrontend || options?.scodeinstMode || hasOldInstAnnotation);

  const isGen = Boolean(cmdOptions.includes("-d=gen") || combined.includes("-d=gen"));

  const ignoreCycles = Boolean(cmdOptions.includes("-d=ignoreCycles") || combined.includes("-d=ignoreCycles"));

  const ignoreReplaceable = Boolean(
    cmdOptions.includes("--ignoreReplaceable") || combined.includes("--ignoreReplaceable"),
  );

  const scalarizeBindings = Boolean(
    options?.scalarizeBindings || cmdOptions.includes("+scalarizeBindings") || combined.includes("+scalarizeBindings"),
  );

  const scalarizeMinMax = Boolean(
    options?.scalarizeMinMax || cmdOptions.includes("+scalarizeMinMax") || combined.includes("+scalarizeMinMax"),
  );

  let flowThreshold = options?.flowThreshold;
  if (flowThreshold === undefined) {
    const parseFlowThreshold = (src: string): number | undefined => {
      const flag = "--flowThreshold=";
      const idx = src.indexOf(flag);
      if (idx < 0) return undefined;
      let end = idx + flag.length;
      while (end < src.length) {
        const ch = src[end]!;
        if ((ch >= "0" && ch <= "9") || ch === "." || ch === "e" || ch === "E" || ch === "+" || ch === "-") {
          end++;
        } else {
          break;
        }
      }
      if (end === idx + flag.length) return undefined;
      const val = parseFloat(src.slice(idx + flag.length, end));
      return Number.isNaN(val) ? undefined : val;
    };
    flowThreshold = parseFlowThreshold(cmdOptions) ?? parseFlowThreshold(combined);
  }

  return {
    isOldFrontend,
    hasOldInstAnnotation,
    isGen,
    ignoreCycles,
    ignoreReplaceable,
    scalarizeBindings,
    scalarizeMinMax,
    flowThreshold,
  };
}
