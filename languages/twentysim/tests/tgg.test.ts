// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupTwentySimBlock, TWENTYSIM_BLOCK_CATALOG } from "../src/catalog/index.js";
import { twentySimToDae } from "../src/dae/index.js";
import { parseEmx } from "../src/parser/index.js";
import { modelicaToTwentySim, twentySimToModelica } from "../src/tgg/index.js";

describe("20-sim Catalog, Extended .emx Dialect, and Bidirectional Modelica TGG", () => {
  it("resolves canonical Bond Graph and Signal/Control blocks from catalog", () => {
    assert.ok(TWENTYSIM_BLOCK_CATALOG.length >= 16);
    assert.strictEqual(lookupTwentySimBlock("ZeroJunction")?.id, "0");
    assert.strictEqual(lookupTwentySimBlock("Gain")?.ports.length, 2);
    assert.strictEqual(lookupTwentySimBlock("PlusMinus")?.ports.length, 3);
    assert.strictEqual(lookupTwentySimBlock("Integrate")?.elementKind, "Signal");
  });

  it("parses .emx InitialValues, GlobalVariables, multi-bond dimension, waypoints, and lowers catalog Signal blocks", () => {
    const xml = `<?xml version="1.0"?>
<Document version="5.1">
  <GlobalVariables>
    <Variable name="g"/>
  </GlobalVariables>
  <Model name="ControlLoop">
    <InitialValues>
      <InitialValue name="x" value="2.5"/>
    </InitialValues>
    <Submodels>
      <Submodel name="ref" type="Constant"><Parameters><Parameter name="C" value="1.0"/></Parameters></Submodel>
      <Submodel name="k" type="Gain"><Parameters><Parameter name="K" value="3.0"/></Parameters></Submodel>
      <Submodel name="integ" type="Integrate"><Parameters><Parameter name="initial" value="0.0"/></Parameters></Submodel>
      <Submodel name="mb" type="R">
        <Ports><Port name="p" type="power" dimension="3"/></Ports>
      </Submodel>
    </Submodels>
    <Connections>
      <Connection id="c1" type="signal" from="ref.output" to="k.input">
        <Waypoints><Point x="100" y="50"/><Point x="150" y="50"/></Waypoints>
      </Connection>
      <Connection id="c2" type="signal" from="k.output" to="integ.input"/>
    </Connections>
  </Model>
</Document>`;

    const model = parseEmx(xml);
    assert.deepStrictEqual(model.globalVariables, ["g"]);
    assert.strictEqual(model.root.initialValues?.["x"], 2.5);
    assert.strictEqual(model.root.submodels.find((s) => s.name === "mb")?.ports[0]?.dimension, 3);
    assert.strictEqual(model.root.connections[0]?.waypoints?.length, 2);

    const dae = twentySimToDae(model);
    assert.ok(dae.eqCount >= 5, `Expected >=5 equations from signal loop + R, got ${dae.eqCount}`);
  });

  it("round-trips 20-sim -> Modelica -> 20-sim via bidirectional TGG", () => {
    const sid = `
model Oscillator
  parameters
    real omega = 2.0;
  variables
    real x = 1.0;
    real v = 0.0;
  equations
    ddt(x) = v;
    ddt(v) = -omega^2 * x;
end Oscillator;
`;
    const mo = twentySimToModelica(sid);
    assert.ok(mo.includes("der(x) = v;"));

    const back = modelicaToTwentySim(mo);
    assert.strictEqual(back.model.name, "Oscillator");
    assert.strictEqual(back.model.root.parameters.length, 1);
    assert.strictEqual(back.model.root.variables.length, 2);
    assert.strictEqual(back.model.root.equations.length, 2);
    assert.ok(back.sidops.includes("ddt(x) = v;"));
  });
});
