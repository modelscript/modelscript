// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Simulation Experiment Description Markup Language (SED-ML L1V3/L1V4) AST & Data Types.
 *
 * Conforms to the COMBINE SED-ML Level 1 Version 3 and Version 4 specifications for
 * reproducible simulation experiments, KiSAO algorithm parameterization, model pre-processing
 * changes, repeated parameter sweeps, MathML post-processing data generators, and outputs.
 */

export interface SedmlRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface SedmlAlgorithmParameter {
  kisaoID: string;
  name?: string | undefined;
  value: string;
  range?: SedmlRange | undefined;
}

export interface SedmlAlgorithm {
  kisaoID: string;
  name?: string | undefined;
  parameters: SedmlAlgorithmParameter[];
  range?: SedmlRange | undefined;
}

export type SedmlSimulationType = "uniformTimeCourse" | "oneStep" | "steadyState";

export interface SedmlSimulation {
  id: string;
  name?: string | undefined;
  type: SedmlSimulationType;
  initialTime?: number | undefined;
  outputStartTime?: number | undefined;
  outputEndTime?: number | undefined;
  numberOfSteps?: number | undefined;
  step?: number | undefined;
  algorithm?: SedmlAlgorithm | undefined;
  range?: SedmlRange | undefined;
}

export type SedmlChangeType = "changeAttribute" | "computeChange" | "addXML" | "changeXML" | "removeXML";

export interface SedmlParameter {
  id: string;
  name?: string | undefined;
  value: number;
  range?: SedmlRange | undefined;
}

export interface SedmlVariable {
  id: string;
  name?: string | undefined;
  target?: string | undefined;
  symbol?: string | undefined;
  taskReference?: string | undefined;
  modelReference?: string | undefined;
  range?: SedmlRange | undefined;
}

export interface SedmlChange {
  type: SedmlChangeType;
  target: string;
  newValue?: string | undefined;
  math?: string | undefined;
  variables?: SedmlVariable[] | undefined;
  parameters?: SedmlParameter[] | undefined;
  range?: SedmlRange | undefined;
}

export interface SedmlModel {
  id: string;
  name?: string | undefined;
  language: string;
  source: string;
  changes: SedmlChange[];
  range?: SedmlRange | undefined;
}

export type SedmlTaskType = "task" | "repeatedTask";

export interface SedmlRangeSpec {
  id: string;
  type: "uniformRange" | "vectorRange" | "functionalRange";
  start?: number | undefined;
  end?: number | undefined;
  numberOfSteps?: number | undefined;
  scale?: "linear" | "log" | undefined;
  values?: number[] | undefined;
  math?: string | undefined;
  range?: SedmlRange | undefined;
}

export interface SedmlSetValue {
  modelReference: string;
  target: string;
  rangeReference?: string | undefined;
  symbol?: string | undefined;
  math: string;
  range?: SedmlRange | undefined;
}

export interface SedmlSubTask {
  task: string;
  order: number;
  range?: SedmlRange | undefined;
}

export interface SedmlTask {
  id: string;
  name?: string | undefined;
  type: SedmlTaskType;
  modelReference?: string | undefined;
  simulationReference?: string | undefined;
  rangeId?: string | undefined;
  resetModel?: boolean | undefined;
  ranges?: SedmlRangeSpec[] | undefined;
  taskChanges?: SedmlSetValue[] | undefined;
  subTasks?: SedmlSubTask[] | undefined;
  range?: SedmlRange | undefined;
}

export interface SedmlDataGenerator {
  id: string;
  name?: string | undefined;
  variables: SedmlVariable[];
  parameters: SedmlParameter[];
  math: string;
  range?: SedmlRange | undefined;
}

export interface SedmlCurve {
  id: string;
  name?: string | undefined;
  logX: boolean;
  logY: boolean;
  logZ?: boolean | undefined;
  xDataReference: string;
  yDataReference: string;
  zDataReference?: string | undefined;
  style?: string | undefined;
  range?: SedmlRange | undefined;
}

export interface SedmlDataSet {
  id: string;
  name?: string | undefined;
  label: string;
  dataReference: string;
  range?: SedmlRange | undefined;
}

export type SedmlOutputType = "plot2D" | "plot3D" | "report";

export interface SedmlOutput {
  id: string;
  name?: string | undefined;
  type: SedmlOutputType;
  curves: SedmlCurve[];
  dataSets: SedmlDataSet[];
  range?: SedmlRange | undefined;
}

export interface SedmlDocument {
  level: number;
  version: number;
  simulations: SedmlSimulation[];
  models: SedmlModel[];
  tasks: SedmlTask[];
  dataGenerators: SedmlDataGenerator[];
  outputs: SedmlOutput[];
  sourceFile?: string | undefined;
  range?: SedmlRange | undefined;
}
