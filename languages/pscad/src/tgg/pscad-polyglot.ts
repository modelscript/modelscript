// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module tgg/pscad-polyglot
 *
 * Declarative Triple Graph Grammar (TGG) rules projecting PSCAD projects,
 * component definitions (`UserCmpDefn` / `pscad_component`), ports, and
 * parameters into Modelica, SysML v2, PSS/E, and IEEE 2800-2022 models.
 */

import { tggComplement, tggDefaultVal, tggEq, tggRule, tggTypeMap, type PolyglotConfig } from "@modelscript/dsl";
import { pscadIeeeTggRules } from "./pscad-ieee-rules.js";

/**
 * Unified declarative TGG configuration for `@modelscript/pscad`.
 */
export const pscadPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2", "psse", "ieee2800"],
  typeMaps: {
    modelica: {
      Real: "Real",
      Integer: "Integer",
      Logical: "Boolean",
      Boolean: "Boolean",
      String: "String",
      Electrical: "Modelica.Electrical.Analog.Interfaces.Pin",
      SignalInput: "Modelica.Blocks.Interfaces.RealInput",
      SignalOutput: "Modelica.Blocks.Interfaces.RealOutput",
    },
    sysml2: {
      Real: "ISQ::Real",
      Integer: "KerML::Integer",
      Logical: "KerML::Boolean",
      Boolean: "KerML::Boolean",
      String: "KerML::String",
    },
    psse: {
      Real: "Real",
      Integer: "Integer",
      Logical: "Boolean",
    },
    ieee2800: {
      IEEE2800_Standard: "No trip or cessation",
      Legacy_Trip: "Trip or momentary cessation",
    },
  },
  rules: [
    // Map a PSCAD user component definition to a Modelica black-box wrapper class
    tggRule({
      name: "PscadComponentToModelicaClass",
      sourceLang: "pscad",
      targetLang: "modelica",
      source: ($, v) =>
        $.pscad_component({
          name: v("className"),
        }),
      target: ($, v) =>
        $.ClassDefinition({
          name: v("className"),
        }),
      where: (v) => [
        tggEq(v("className"), v("className")),
        tggDefaultVal(v("wrapperKind"), "pscad-emt-blackbox"),
        tggComplement(["classPrefixes", "iconSvg", "flyBy"]),
      ],
    }),

    // Map a PSCAD catalog UserCmpDefn symbol to a Modelica class
    tggRule({
      name: "PscadUserCmpDefnToModelicaClass",
      sourceLang: "pscad",
      targetLang: "modelica",
      source: ($, v) =>
        $.UserCmpDefn({
          name: v("className"),
        }),
      target: ($, v) =>
        $.ClassDefinition({
          name: v("className"),
        }),
      where: (v) => [tggEq(v("className"), v("className")), tggComplement(["iconSvg", "flyBy"])],
    }),

    // Map a PSCAD project case to a Modelica system class
    tggRule({
      name: "PscadProjectToModelicaClass",
      sourceLang: "pscad",
      targetLang: "modelica",
      source: ($, v) =>
        $.pscad_project({
          name: v("className"),
        }),
      target: ($, v) =>
        $.ClassDefinition({
          name: v("className"),
        }),
      where: (v) => [tggEq(v("className"), v("className")), tggComplement(["projectType"])],
    }),

    // Map a PSCAD library (.pslx) to a Modelica package
    tggRule({
      name: "PscadLibraryToModelicaPackage",
      sourceLang: "pscad",
      targetLang: "modelica",
      source: ($, v) =>
        $.pscad_library({
          name: v("pkgName"),
        }),
      target: ($, v) =>
        $.ClassDefinition({
          name: v("pkgName"),
        }),
      where: (v) => [tggEq(v("pkgName"), v("pkgName")), tggComplement(["projectType"])],
    }),

    // Map a PSCAD component definition to a SysML v2 PartDefinition
    tggRule({
      name: "PscadComponentToSysmlPartDef",
      sourceLang: "pscad",
      targetLang: "sysml2",
      source: ($, v) =>
        $.pscad_component({
          name: v("className"),
        }),
      target: ($, v) =>
        $.PartDefinition({
          declaredName: v("className"),
        }),
      where: (v) => [tggEq(v("className"), v("className")), tggComplement(["iconSvg", "flyBy"])],
    }),

    // Map a PSCAD project case to a SysML v2 PartDefinition
    tggRule({
      name: "PscadProjectToSysmlPartDef",
      sourceLang: "pscad",
      targetLang: "sysml2",
      source: ($, v) =>
        $.pscad_project({
          name: v("className"),
        }),
      target: ($, v) =>
        $.PartDefinition({
          declaredName: v("className"),
        }),
      where: (v) => [tggEq(v("className"), v("className")), tggComplement(["projectType"])],
    }),

    // Map a PSCAD port node to a Modelica connector component
    tggRule({
      name: "PscadPortToModelicaComponent",
      sourceLang: "pscad",
      targetLang: "modelica",
      priority: 15,
      source: ($, v) =>
        $.pscad_port({
          name: v("portName"),
          typeSpecifier: v("typeName"),
        }),
      target: ($, v) =>
        $.ComponentClause({
          name: v("portName"),
          typeSpecifier: v("typeName"),
        }),
      where: (v) => [
        tggEq(v("portName"), v("portName")),
        tggTypeMap(v("typeName"), v("typeName"), "modelica"),
        tggComplement(["direction", "dimension"]),
      ],
    }),

    // Map a PSCAD parameter to a Modelica parameter component
    tggRule({
      name: "PscadParamToModelicaComponent",
      sourceLang: "pscad",
      targetLang: "modelica",
      source: ($, v) =>
        $.pscad_parameter({
          name: v("paramName"),
          typeSpecifier: v("typeName"),
          defaultValue: v("val"),
        }),
      target: ($, v) =>
        $.ComponentClause({
          name: v("paramName"),
          typeSpecifier: v("typeName"),
          binding: v("val"),
        }),
      where: (v) => [
        tggEq(v("paramName"), v("paramName")),
        tggTypeMap(v("typeName"), v("typeName"), "modelica"),
        tggEq(v("val"), v("val")),
      ],
    }),

    ...pscadIeeeTggRules,
  ],
};
