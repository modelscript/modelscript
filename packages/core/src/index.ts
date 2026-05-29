// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "@modelscript/modelica/annotation";
export * from "@modelscript/modelica/ast";
export * from "@modelscript/modelica/diagram";
export * from "@modelscript/modelica/factory";
export * from "@modelscript/modelica/geometry";
export * from "@modelscript/modelica/multibody-generator";
export * from "@modelscript/symbolics";
export * from "@modelscript/utils";
export * from "./compiler/context.js";
export * from "./compiler/modelica/interpreter.js";

export {
  ModelicaArrayClassInstance as ModelicaArrayClassInstance,
  ModelicaBooleanClassInstance as ModelicaBooleanClassInstance,
  ModelicaClassInstance as ModelicaClassInstance,
  ModelicaClockClassInstance as ModelicaClockClassInstance,
  ModelicaComponentInstance as ModelicaComponentInstance,
  ModelicaElement as ModelicaElement,
  ModelicaElementModification as ModelicaElementModification,
  ModelicaElement as ModelicaEntity,
  ModelicaEnumerationClassInstance as ModelicaEnumerationClassInstance,
  ModelicaExpressionClassInstance as ModelicaExpressionClassInstance,
  ModelicaExtendsClassInstance as ModelicaExtendsClassInstance,
  ModelicaIntegerClassInstance as ModelicaIntegerClassInstance,
  ModelicaModification as ModelicaModification,
  ModelicaElement as ModelicaNamedElement,
  ModelicaPredefinedClassInstance as ModelicaPredefinedClassInstance,
  ModelicaRealClassInstance as ModelicaRealClassInstance,
  ModelicaShortClassInstance as ModelicaShortClassInstance,
  ModelicaStringClassInstance as ModelicaStringClassInstance,
} from "@modelscript/modelica/factory";

export * from "@modelscript/modelica/diagram";
export * from "@modelscript/modelica/types";
export * from "@modelscript/modelica/units";
export * from "@modelscript/sysml2/factory";
export * from "./compiler/modelica/visitor.js";

export { parseCsvMeasurements, type CsvData, type CsvParseOptions } from "@modelscript/csv/csv-parser";
export * from "./compiler/scope.js";
