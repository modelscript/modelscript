// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module tgg
 *
 * Declarative Triple Graph Grammar (TGG) rules projecting PSS/E `.raw` / `.dyr`
 * cases and `PSSEDynamics` blocks into Modelica, SysML v2, and PSCAD
 * representations for live correspondence validation and black-box wrapper synthesis.
 */

import { tggComplement, tggDefaultVal, tggEq, tggRule, tggTypeMap, type PolyglotConfig } from "@modelscript/dsl";

/**
 * Declarative TGG configuration for PSS/E (`psse`) polyglot synchronization
 * with Modelica, SysML v2, and PSCAD.
 */
export const pssePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2", "pscad"],
  typeMaps: {
    modelica: {
      Real: "Real",
      Integer: "Integer",
      Boolean: "Boolean",
      String: "String",
      SignalInput: "Modelica.Blocks.Interfaces.RealInput",
      SignalOutput: "Modelica.Blocks.Interfaces.RealOutput",
    },
    sysml2: {
      Real: "ISQ::Real",
      Integer: "KerML::Integer",
      Boolean: "KerML::Boolean",
      String: "KerML::String",
      SignalInput: "SignalInput",
      SignalOutput: "SignalOutput",
    },
    pscad: {
      Real: "Real",
      Integer: "Integer",
      Boolean: "Logical",
      SignalInput: "Real",
      SignalOutput: "Real",
    },
  },
  rules: [
    // Map a PSS/E dynamic block definition (`psse_model`) to a Modelica black-box wrapper class
    tggRule({
      name: "PsseModelToModelicaClass",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 15,
      source: ($, v) =>
        $["psse_model"]?.({
          name: v("className"),
          psseModel: v("psseModel"),
          psseCategory: v("category"),
        }),
      target: ($, v) =>
        $["ClassDefinition"]?.({
          name: v("className"),
        }),
      where: (v) => [
        tggEq(v("className"), v("className")),
        tggDefaultVal(v("wrapperKind"), "psse-blackbox"),
        tggComplement(["psseModel", "psseCategory", "lowerComponentToDae"]),
      ],
    }),

    // Map a PSS/E dynamic block definition (`psse_model`) to a SysML v2 PartDefinition
    tggRule({
      name: "PsseModelToSysmlPartDef",
      sourceLang: "psse",
      targetLang: "sysml2",
      priority: 10,
      source: ($, v) =>
        $["psse_model"]?.({
          name: v("className"),
          psseModel: v("psseModel"),
        }),
      target: ($, v) =>
        $["PartDefinition"]?.({
          declaredName: v("className"),
        }),
      where: (v) => [tggEq(v("className"), v("className")), tggComplement(["psseModel", "lowerComponentToDae"])],
    }),

    // Map a PSS/E .raw case to a Modelica system wrapper class
    tggRule({
      name: "PsseCaseToModelicaClass",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 10,
      source: ($, v) =>
        $["psse_case"]?.({
          name: v("caseName"),
          sbase: v("sbase"),
          basfrq: v("basfrq"),
        }),
      target: ($, v) =>
        $["ClassDefinition"]?.({
          name: v("caseName"),
        }),
      where: (v) => [
        tggEq(v("caseName"), v("caseName")),
        tggComplement(["sbase", "basfrq", "rev", "nBuses", "nBranches", "nGenerators", "nLoads"]),
      ],
    }),

    // Map a PSS/E .dyr case to a Modelica dynamic case class
    tggRule({
      name: "PsseDyrCaseToModelicaClass",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 5,
      source: ($, v) =>
        $["psse_dyr_case"]?.({
          name: v("caseName"),
          recordCount: v("recordCount"),
        }),
      target: ($, v) =>
        $["ClassDefinition"]?.({
          name: v("caseName"),
        }),
      where: (v) => [tggEq(v("caseName"), v("caseName")), tggComplement(["recordCount"])],
    }),

    // Map a PSS/E .raw case to a SysML v2 PartDefinition
    tggRule({
      name: "PsseCaseToSysmlPartDef",
      sourceLang: "psse",
      targetLang: "sysml2",
      priority: 0,
      source: ($, v) =>
        $["psse_case"]?.({
          name: v("caseName"),
        }),
      target: ($, v) =>
        $["PartDefinition"]?.({
          declaredName: v("caseName"),
        }),
      where: (v) => [tggEq(v("caseName"), v("caseName")), tggComplement(["sbase", "basfrq", "rev"])],
    }),

    // Map a PSS/E DYR record (`psse_dyr_record`) to a Modelica component usage
    tggRule({
      name: "PsseDyrRecordToModelicaComponent",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 10,
      context: ($, v) => ({
        source: $["psse_dyr_case"]?.({ name: v("caseName") }),
        target: $["ClassDefinition"]?.({ name: v("caseName") }),
      }),
      source: ($, v) =>
        $["psse_dyr_record"]?.({
          name: v("compName"),
          typeSpecifier: v("typeName"),
        }),
      target: ($, v) =>
        $["ComponentClause"]?.({
          name: v("compName"),
          typeSpecifier: v("typeName"),
        }),
      where: (v) => [
        tggEq(v("compName"), v("compName")),
        tggTypeMap(v("typeName"), v("typeName"), "modelica"),
        tggComplement(["busNumber", "model", "machineId", "category", "namedParams"]),
      ],
    }),

    // Map a PSS/E port (`psse_port`) to a Modelica connector component
    tggRule({
      name: "PssePortToModelicaComponent",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 15,
      context: ($, v) => ({
        source: $["psse_model"]?.({ name: v("parentName") }),
        target: $["ClassDefinition"]?.({ name: v("parentName") }),
      }),
      source: ($, v) =>
        $["psse_port"]?.({
          name: v("portName"),
          typeSpecifier: v("typeName"),
          causality: v("dir"),
        }),
      target: ($, v) =>
        $["ComponentClause"]?.({
          name: v("portName"),
          typeSpecifier: v("typeName"),
        }),
      where: (v) => [
        tggEq(v("portName"), v("portName")),
        tggTypeMap(v("typeName"), v("typeName"), "modelica"),
        tggComplement(["causality", "unit", "isConnectorPort"]),
      ],
    }),

    // Map a PSS/E parameter (`psse_parameter`) to a Modelica parameter component
    tggRule({
      name: "PsseParamToModelicaComponent",
      sourceLang: "psse",
      targetLang: "modelica",
      priority: 5,
      context: ($, v) => ({
        source: $["psse_model"]?.({ name: v("parentName") }),
        target: $["ClassDefinition"]?.({ name: v("parentName") }),
      }),
      source: ($, v) =>
        $["psse_parameter"]?.({
          name: v("paramName"),
          typeSpecifier: v("typeName"),
          defaultValue: v("val"),
        }),
      target: ($, v) =>
        $["ComponentClause"]?.({
          name: v("paramName"),
          typeSpecifier: v("typeName"),
          binding: v("val"),
        }),
      where: (v) => [
        tggEq(v("paramName"), v("paramName")),
        tggTypeMap(v("typeName"), v("typeName"), "modelica"),
        tggEq(v("val"), v("val")),
        tggComplement(["unit", "variability"]),
      ],
    }),
  ],
};
