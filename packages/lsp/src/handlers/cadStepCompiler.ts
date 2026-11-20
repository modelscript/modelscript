// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StepPmiSpec } from "@modelscript/cad";
import { parseQif } from "@modelscript/qif/parser";
import {
  buildStepPmiFromParsedQif,
  compileScadStepFromSources,
  parseScadSpoolDirectives,
  type CompileStepFromSourcesParams,
  type CompileStepFromSourcesResult,
  type SpoolKinematicsSpec,
} from "@modelscript/scad";

export {
  parseScadSpoolDirectives,
  type CompileStepFromSourcesParams,
  type CompileStepFromSourcesResult,
  type SpoolKinematicsSpec,
};

export function buildStepPmiFromQif(qifText: string): StepPmiSpec {
  if (!qifText.trim()) return { datums: [], tolerances: [] };
  return buildStepPmiFromParsedQif(parseQif(qifText));
}

export function compileStepFromSources(params: CompileStepFromSourcesParams): CompileStepFromSourcesResult {
  return compileScadStepFromSources({ ...params, parseQif });
}
