// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Establishes declarative bijective and symmetric transformation rules mapping
 * OMG ReqIF 1.2 specification objects, contracts, and relations to KerML / SysML v2
 * requirement definitions, constraints, and Modelica verification monitors.
 */

import {
  tggComplement,
  tggDefaultVal,
  tggEq,
  tggReconcile,
  tggReconcilePhysics,
  tggRule,
  type PolyglotConfig,
} from "@modelscript/dsl";

export const reqifTggRules = [
  // 1. ReqIF SpecObject <-> SysML v2 RequirementDefinition
  tggRule({
    name: "ReqIfSpecObjectToSysmlRequirementDef",
    sourceLang: "reqif",
    targetLang: "sysml2",
    source: ($, v) =>
      $.SpecObject({
        identifier: v("reqId"),
        text: v("reqText"),
        asilLevel: v("asil"),
      }),
    target: ($, v) =>
      $.RequirementDefinition({
        name: v("defName"),
        doc: v("reqText"),
        reqId: v("reqId"),
        asilLevel: v("asil"),
      }),
    where: (v) => [
      tggEq(v("reqId"), v("reqId")),
      tggEq(v("reqText"), v("reqText")),
      tggReconcile(v("reqText"), v("reqText"), "target-wins"),
      tggReconcile(v("asil"), v("asil"), "target-wins"),
      tggComplement(["longName", "lastChange", "typeRef", "attributes", "span", "status"]),
    ],
  }),

  // 2. ReqIF Formal Contract <-> SysML v2 Require Constraint (with physical feasibility envelope)
  tggRule({
    name: "ReqIfContractToSysmlConstraint",
    sourceLang: "reqif",
    targetLang: "sysml2",
    source: ($, v) =>
      $.Contract({
        variable: v("varName"),
        comparator: v("op"),
        limitValue: v("limit"),
      }),
    target: ($, v) =>
      $.RequireConstraint({
        variable: v("varName"),
        operator: v("op"),
        rhs: v("limit"),
      }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("op"), v("op")),
      tggEq(v("limit"), v("limit")),
      tggReconcile(v("limit"), v("limit"), "target-wins"),
      tggReconcilePhysics(v("limit"), v("limit"), { min: 1e-6, max: 1000.0 }),
      tggComplement(["unit", "expression"]),
    ],
  }),

  // 3. ReqIF SpecRelation (satisfies) <-> SysML v2 SatisfyRequirementUsage
  tggRule({
    name: "ReqIfRelationToSysmlSatisfy",
    sourceLang: "reqif",
    targetLang: "sysml2",
    source: ($, v) =>
      $.SpecRelation({
        relationType: "satisfies",
        sourceId: v("byElem"),
        targetId: v("reqRef"),
      }),
    target: ($, v) =>
      $.SatisfyRequirementUsage({
        requirement: v("reqRef"),
        by: v("byElem"),
      }),
    where: (v) => [
      tggEq(v("reqRef"), v("reqRef")),
      tggEq(v("byElem"), v("byElem")),
      tggComplement(["identifier", "longName", "typeRef", "span"]),
    ],
  }),

  // 4. ReqIF Formal Contract <-> Modelica Verification Monitor Block
  tggRule({
    name: "ReqIfContractToModelicaVerifier",
    sourceLang: "reqif",
    targetLang: "modelica",
    source: ($, v) =>
      $.SpecObject({
        identifier: v("reqId"),
        variable: v("varName"),
        limitValue: v("limit"),
      }),
    target: ($, v) =>
      $.VerificationBlock({
        name: v("reqId"),
        monitoredInput: v("varName"),
        threshold: v("limit"),
      }),
    where: (v) => [
      tggEq(v("reqId"), v("reqId")),
      tggEq(v("varName"), v("varName")),
      tggEq(v("limit"), v("limit")),
      tggDefaultVal(v("violated"), false),
      tggComplement(["longName", "text", "asilLevel", "attributes"]),
    ],
  }),
];

export const reqifPolyglotConfig: PolyglotConfig = {
  languages: ["reqif", "sysml2", "modelica"],
  typeMaps: {
    sysml2: {
      STRING: "String",
      REAL: "Real",
      INTEGER: "Integer",
      BOOLEAN: "Boolean",
    },
    modelica: {
      STRING: "String",
      REAL: "Real",
      INTEGER: "Integer",
      BOOLEAN: "Boolean",
    },
  },
  rules: reqifTggRules,
};
