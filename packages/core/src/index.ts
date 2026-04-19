// SPDX-License-Identifier: AGPL-3.0-or-later

export * from "@modelscript/modelica-polyglot/ast";
export * from "@modelscript/symbolics";
export * from "@modelscript/utils";
export * from "./compiler/context.js";
export * from "./compiler/modelica/annotation.js";
export * from "./compiler/modelica/flattener.js";
export * from "./compiler/modelica/i18n.js";
export * from "./compiler/modelica/interpreter.js";
export * from "./compiler/modelica/linter.js";
export * from "./compiler/modelica/metascript-bridge.js";

export {
  QueryBackedArrayClassInstance as ModelicaArrayClassInstance,
  QueryBackedBooleanClassInstance as ModelicaBooleanClassInstance,
  QueryBackedClassInstance as ModelicaClassInstance,
  QueryBackedClockClassInstance as ModelicaClockClassInstance,
  QueryBackedComponentInstance as ModelicaComponentInstance,
  QueryBackedElement as ModelicaElement,
  QueryBackedElementModification as ModelicaElementModification,
  QueryBackedElement as ModelicaEntity,
  QueryBackedEnumerationClassInstance as ModelicaEnumerationClassInstance,
  QueryBackedExpressionClassInstance as ModelicaExpressionClassInstance,
  QueryBackedExtendsClassInstance as ModelicaExtendsClassInstance,
  QueryBackedIntegerClassInstance as ModelicaIntegerClassInstance,
  QueryBackedModification as ModelicaModification,
  QueryBackedElement as ModelicaNamedElement,
  QueryBackedPredefinedClassInstance as ModelicaPredefinedClassInstance,
  QueryBackedRealClassInstance as ModelicaRealClassInstance,
  QueryBackedShortClassInstance as ModelicaShortClassInstance,
  QueryBackedStringClassInstance as ModelicaStringClassInstance,
} from "./compiler/modelica/metascript-bridge.js";

export * from "./compiler/modelica/svg.js";
export * from "./compiler/modelica/types.js";
export * from "./compiler/modelica/units.js";
export * from "./compiler/modelica/visitor.js";
export * from "./compiler/sysml2/sysml2-bridge.js";

export * from "./compiler/scope.js";
