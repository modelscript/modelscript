// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "@modelscript/modelica/ast";
export * from "@modelscript/symbolics";
export * from "@modelscript/utils";
export * from "./compiler/context.js";
export * from "./compiler/modelica/annotation.js";
export * from "./compiler/modelica/factory.js";
export * from "./compiler/modelica/flattener.js";
export * from "./compiler/modelica/i18n.js";
export * from "./compiler/modelica/interpreter.js";
export * from "./compiler/modelica/linter.js";

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
} from "./compiler/modelica/factory.js";

export * from "./compiler/modelica/svg.js";
export * from "./compiler/modelica/types.js";
export * from "./compiler/modelica/units.js";
export * from "./compiler/modelica/visitor.js";
export * from "./compiler/sysml2/sysml2-bridge.js";

export * from "./compiler/scope.js";
