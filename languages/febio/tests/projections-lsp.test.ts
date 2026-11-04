// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { febioLanguage } from "../src/language.js";
import {
  executeFebioAction,
  getFebioCompletions,
  getFebioDefinition,
  getFebioDocumentSymbols,
  getFebioHover,
  validateFebio,
} from "../src/lsp.js";
import { parseFebio } from "../src/parser/index.js";
import { febioToCalculixInp, febioToModelica } from "../src/projections/index.js";

describe("FEBio Projections (CalculiX .inp & Modelica .mo) and LSP Services", () => {
  const sampleFeb = `<?xml version="1.0"?>
<febio_spec version="4.0">
  <Module type="solid"/>
  <Control>
    <analysis>STATIC</analysis>
    <time_steps>10</time_steps>
    <step_size>0.1</step_size>
  </Control>
  <Material>
    <material id="1" name="CorneaTissue" type="Mooney-Rivlin">
      <c1>5.0</c1>
      <c2>1.0</c2>
      <k>200.0</k>
    </material>
  </Material>
  <Mesh>
    <Nodes name="CorneaMesh">
      <node id="1">0, 0, 0</node>
      <node id="2">1, 0, 0</node>
      <node id="3">0, 1, 0</node>
      <node id="4">0, 0, 1</node>
    </Nodes>
    <Elements type="tet4" mat="1" name="Stroma">
      <elem id="1">1, 2, 3, 4</elem>
    </Elements>
    <NodeSet name="Limbus">
      <node id="1"/>
      <node id="2"/>
      <node id="3"/>
    </NodeSet>
  </Mesh>
  <Boundary>
    <bc name="FixLimbus" type="zero displacement" node_set="Limbus">
      <x_dof>1</x_dof>
      <y_dof>1</y_dof>
      <z_dof>1</z_dof>
    </bc>
  </Boundary>
</febio_spec>`;

  it("projects FEBio model to CalculiX (.inp) and Modelica 3.x (.mo)", () => {
    const doc = parseFebio(sampleFeb);
    const inp = febioToCalculixInp(doc);
    assert(inp.includes("*ELEMENT, TYPE=C3D4"));
    assert(inp.includes("*HYPERELASTIC, MOONEY-RIVLIN"));
    assert(inp.includes("*BOUNDARY"));

    const mo = febioToModelica(doc);
    assert(mo.includes("model SoftTissueMechanics"));
    assert(mo.includes("CorneaTissue_W = CorneaTissue_C1 * (CorneaTissue_I1 - 3.0)"));
  });

  it("provides LSP diagnostics, symbols, hover, completions, definition, and actions", async () => {
    assert(febioLanguage.fileExtensions.includes(".feb"));
    assert(febioLanguage.fileExtensions.includes(".scn"));

    const diags = validateFebio(sampleFeb);
    assert.strictEqual(diags.length, 0);

    const symbols = getFebioDocumentSymbols(sampleFeb);
    assert(symbols.length >= 3);

    const matOffset = sampleFeb.indexOf("CorneaTissue");
    const hover = getFebioHover(sampleFeb, matOffset);
    assert(hover !== null);
    assert(hover.contents.value.includes("CorneaTissue"));

    const completions = getFebioCompletions(sampleFeb);
    assert(completions.some((c) => c.label === "CorneaTissue"));
    assert(completions.some((c) => c.label === "Limbus"));

    const refOffset = sampleFeb.indexOf('node_set="Limbus"') + 12;
    const def = getFebioDefinition(sampleFeb, refOffset, "file:///cornea.feb");
    assert(def !== null);
    assert.strictEqual(def.uri, "file:///cornea.feb");

    const daeRes = await executeFebioAction("febio_to_dae", sampleFeb);
    assert(daeRes.variableCount >= 6);
  });
});
