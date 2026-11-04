// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9151 - M9160).
 */

import type { SedmlRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: SedmlRange | undefined;
}

export const SedmlErrorCode = {
  INVALID_TIME_COURSE_BOUNDS: {
    code: 9151,
    rule: "invalid-time-course-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (simId: string, details: string) =>
      `UniformTimeCourse simulation '${simId}' defines invalid time course bounds ('${details}').`,
  },
  INVALID_KISAO_ID: {
    code: 9152,
    rule: "invalid-kisao-id",
    severity: "error" as DiagnosticSeverity,
    message: (simId: string, kisaoId: string) =>
      `Simulation '${simId}' specifies missing or malformed algorithm KiSAO identifier '${kisaoId}'; expected 'KISAO:xxxxxxx'.`,
  },
  UNRESOLVED_MODEL_REFERENCE: {
    code: 9153,
    rule: "unresolved-model-reference",
    severity: "error" as DiagnosticSeverity,
    message: (ownerId: string, modelRef: string) =>
      `SED-ML element '${ownerId}' references undefined model '${modelRef}'.`,
  },
  UNRESOLVED_SIMULATION_REFERENCE: {
    code: 9154,
    rule: "unresolved-simulation-reference",
    severity: "error" as DiagnosticSeverity,
    message: (taskId: string, simRef: string) => `Task '${taskId}' references undefined simulation '${simRef}'.`,
  },
  UNRESOLVED_TASK_REFERENCE: {
    code: 9155,
    rule: "unresolved-task-reference",
    severity: "error" as DiagnosticSeverity,
    message: (ownerId: string, taskRef: string) =>
      `SED-ML variable or subTask in '${ownerId}' references undefined task '${taskRef}'.`,
  },
  UNRESOLVED_DATA_GENERATOR_REFERENCE: {
    code: 9156,
    rule: "unresolved-data-generator-reference",
    severity: "error" as DiagnosticSeverity,
    message: (outputId: string, itemId: string, dataGenRef: string) =>
      `Output '${outputId}' element '${itemId}' references undefined dataGenerator '${dataGenRef}'.`,
  },
  CIRCULAR_MODEL_SOURCE: {
    code: 9157,
    rule: "circular-model-source",
    severity: "error" as DiagnosticSeverity,
    message: (modelId: string, chain: string) =>
      `Model '${modelId}' source reference chain '${chain}' forms a circular dependency.`,
  },
  UNDEFINED_DATA_GENERATOR_MATH_VARIABLE: {
    code: 9158,
    rule: "undefined-data-generator-math-variable",
    severity: "warning" as DiagnosticSeverity,
    message: (dataGenId: string, symbolName: string) =>
      `DataGenerator '${dataGenId}' math expression references identifier '${symbolName}' not declared in listOfVariables or listOfParameters.`,
  },
  EMPTY_SEDML_EXPERIMENT: {
    code: 9159,
    rule: "empty-sedml-experiment",
    severity: "warning" as DiagnosticSeverity,
    message: () => `SED-ML document defines an empty experiment with no simulations or tasks.`,
  },
  DUPLICATE_SEDML_ID: {
    code: 9160,
    rule: "duplicate-sedml-id",
    severity: "error" as DiagnosticSeverity,
    message: (id: string, elementKind: string) =>
      `SED-ML identifier '${id}' on '${elementKind}' is declared multiple times within the document.`,
  },
} as const;
