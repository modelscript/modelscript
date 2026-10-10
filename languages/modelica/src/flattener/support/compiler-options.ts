// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "@modelscript/runtime";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import type { ExtractedCompilerOptions, FlattenOptions } from "../types.js";

export function extractCompilerOptions(
  classCst: any,
  options?: FlattenOptions,
  db?: any,
  rootSym?: SymbolEntry | null,
): ExtractedCompilerOptions {
  let cmdOptions = "";
  if (classCst) {
    try {
      const evaluator = new AnnotationEvaluator(db ?? ({} as any));
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

  const isOldFrontend = Boolean(options?.isOldFrontend || (options as any)?.scodeinstMode || hasOldInstAnnotation);

  const isGen = Boolean(cmdOptions.includes("-d=gen") || combined.includes("-d=gen"));

  const ignoreCycles = Boolean(cmdOptions.includes("-d=ignoreCycles") || combined.includes("-d=ignoreCycles"));

  const scalarizeBindings = Boolean(
    options?.scalarizeBindings || cmdOptions.includes("+scalarizeBindings") || combined.includes("+scalarizeBindings"),
  );

  const scalarizeMinMax = Boolean(
    (options as any)?.scalarizeMinMax ||
    cmdOptions.includes("+scalarizeMinMax") ||
    combined.includes("+scalarizeMinMax"),
  );

  let flowThreshold = options?.flowThreshold;
  if (flowThreshold === undefined) {
    const match = cmdOptions.match(/--flowThreshold=([0-9.eE+-]+)/) || combined.match(/--flowThreshold=([0-9.eE+-]+)/);
    if (match) {
      flowThreshold = parseFloat(match[1]);
    }
  }

  return {
    isOldFrontend,
    hasOldInstAnnotation,
    isGen,
    ignoreCycles,
    scalarizeBindings,
    scalarizeMinMax,
    flowThreshold,
  };
}
