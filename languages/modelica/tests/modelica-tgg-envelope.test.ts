// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/modelica/parser";
import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { generateMultiBodyModelica } from "../src/extensions/multibody-generator.js";
import { modelicaPolyglotConfig } from "../src/tgg/index.js";

const require = createRequire(import.meta.url);

describe("Modelica L3 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "modelica",
      level: "L3",
      config: modelicaPolyglotConfig,
      samples: [
        {
          ruleName: "ModelicaModelToSysmlBlock",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ClassDefinition",
            name: `PlantModel_${i}`,
            properties: {
              name: `PlantModel_${i}`,
            },
          }),
        },
        {
          ruleName: "ModelicaConnectToSysmlConnection",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "ConnectClause",
            name: `conn_${i}`,
            properties: {
              name: `conn_${i}`,
            },
          }),
        },
        {
          ruleName: "ModelicaConnectEquationToSysmlConnection",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "connect_equation",
            name: `edge_${i}`,
            properties: {
              lhs: `r${i}.n`,
              rhs: `c${i}.p`,
            },
          }),
        },
        {
          ruleName: "ModelicaSimpleEquationToSysmlConstraint",
          sourceLang: "modelica",
          targetLang: "sysml2",
          makeSource: (i) => ({
            kind: "simple_equation",
            name: `eq_${i}`,
            properties: {
              lhs: `v_${i}`,
              rhs: `i_${i} * R`,
            },
          }),
        },
        {
          ruleName: "ModelicaModelToOwl2Class",
          sourceLang: "modelica",
          targetLang: "owl2",
          makeSource: (i) => ({ kind: "ClassDefinition", name: `Onto_${i}`, properties: { name: `Onto_${i}` } }),
        },
        {
          ruleName: "ModelicaModelToStepProduct",
          sourceLang: "modelica",
          targetLang: "step",
          makeSource: (i) => ({ kind: "ClassDefinition", name: `Part_${i}`, properties: { name: `Part_${i}` } }),
        },
        {
          ruleName: "ModelicaModelToScadModule",
          sourceLang: "modelica",
          targetLang: "scad",
          makeSource: (i) => ({ kind: "ClassDefinition", name: `Geom_${i}`, properties: { name: `Geom_${i}` } }),
        },
        {
          ruleName: "ModelicaAssertToReqifSpec",
          sourceLang: "modelica",
          targetLang: "reqif",
          makeSource: (i) => ({
            kind: "AssertStatement",
            name: `REQ_${i}`,
            properties: { message: `REQ_${i}`, condition: `v_${i} > 0` },
          }),
        },
        {
          ruleName: "ModelicaComponentToQifCharacteristic",
          sourceLang: "modelica",
          targetLang: "qif",
          makeSource: (i) => ({
            kind: "ComponentClause",
            name: `dim_${i}`,
            properties: { name: `dim_${i}`, defaultValue: 10 + i },
          }),
        },
        {
          ruleName: "ModelicaComponentToPscadComponent",
          sourceLang: "modelica",
          targetLang: "pscad",
          makeSource: (i) => ({
            kind: "ComponentClause",
            name: `bus_${i}`,
            properties: { name: `bus_${i}`, typeSpecifier: "Pin" },
          }),
        },
        {
          ruleName: "ModelicaComponentToPsseComponent",
          sourceLang: "modelica",
          targetLang: "psse",
          makeSource: (i) => ({
            kind: "ComponentClause",
            name: `gen_${i}`,
            properties: { name: `gen_${i}`, typeSpecifier: "Generator" },
          }),
        },
        {
          ruleName: "ModelicaComponentToCsvColumn",
          sourceLang: "modelica",
          targetLang: "csv",
          makeSource: (i) => ({
            kind: "ComponentClause",
            name: `col_${i}`,
            properties: { name: `col_${i}`, typeSpecifier: "Real" },
          }),
        },
      ],
    });
  });
});

describe("MultiBody Modelica Generator", () => {
  it("emits deterministic 2D Placement and Line annotations and parses cleanly", async () => {
    const mo = generateMultiBodyModelica(
      {
        name: "TwoLinkArm",
        bodies: [
          {
            name: "baseLink",
            mass: 2.5,
            inertia: { I_11: 0.1, I_22: 0.2, I_33: 0.3, I_21: 0, I_31: 0, I_32: 0 },
            r_CM: [0.1, 0, 0],
            shapeRef: "BaseSolid",
          },
          {
            name: "armLink",
            mass: 1.2,
            inertia: { I_11: 0.05, I_22: 0.08, I_33: 0.09, I_21: 0, I_31: 0, I_32: 0 },
            r_CM: [0.25, 0, 0],
          },
        ],
        fixedTranslations: [{ name: "shoulderOffset", r: [0.2, 0, 0], partA: "baseLink", partB: "armLink" }],
        joints: [{ name: "shoulderJoint", type: "Revolute", n: [0, 0, 1], partA: "baseLink", partB: "armLink" }],
      },
      "cad://arm.step",
    );

    assert.match(
      mo,
      /inner World world\([^\n]+\) annotation\(Placement\(transformation\(extent=\{\{-90, -10\}, \{-70, 10\}\}\)\)\);/,
    );
    assert.match(mo, /\) annotation\(Placement\(transformation\(extent=/);
    assert.match(mo, /CAD\(uri = "cad:\/\/arm\.step"/);
    assert.match(mo, /Joints\.Revolute shoulderJoint[\s\S]*?annotation\(Placement\(/);
    assert.match(mo, /Parts\.FixedTranslation shoulderOffset[\s\S]*?annotation\(Placement\(/);
    assert.match(mo, /connect\(world\.frame_b, baseLink\.frame_a\) annotation\(Line\(points=/);
    assert.match(mo, /connect\(baseLink\.frame_a, shoulderOffset\.frame_a\) annotation\(Line\(points=/);
    assert.match(mo, /connect\(shoulderJoint\.frame_b, armLink\.frame_a\) annotation\(Line\(points=/);

    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { parser } = await createWasmParser(wasmPath);
    const tree = parser.parse(mo);
    assert.strictEqual(
      tree.rootNode.hasError,
      false,
      "Generated MultiBody Modelica should parse without syntax errors",
    );
  });
});
