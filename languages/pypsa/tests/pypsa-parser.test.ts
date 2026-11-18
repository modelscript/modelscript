// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePypsa } from "../src/parser/pypsa-parser.js";
import { projectPypsaToAmpl } from "../src/projections/pypsa-to-ampl.js";

const SAMPLE_PYPSA = `
network EU_Grid baseMva=100
bus North v_nom=380 carrier=AC
bus South v_nom=380 carrier=AC
generator Wind_North bus=North carrier=wind p_nom=500 marginal_cost=0 capital_cost=1200
generator Gas_South bus=South carrier=gas p_nom=400 marginal_cost=45 capital_cost=600
load Load_South bus=South p_set=600
line L_NS bus0=North bus1=South r=2.5 x=25.0 s_nom=800
link HVDC_NS bus0=North bus1=South p_nom=200 efficiency=0.97
storage_unit BESS_South bus=South p_nom=100 max_hours=4 efficiency_store=0.92 efficiency_dispatch=0.92 standing_loss=0.001
`;

describe("PyPSA Parser & AMPL Projection", () => {
  it("parses declarative and JSON PyPSA networks and projects to AMPL", () => {
    const net = parsePypsa(SAMPLE_PYPSA);
    assert.equal(net.name, "EU_Grid");
    assert.equal(net.buses.length, 2);
    assert.equal(net.generators.length, 2);
    assert.equal(net.lines.length, 1);
    assert.equal(net.links.length, 1);
    assert.equal(net.storageUnits.length, 1);

    const ampl = projectPypsaToAmpl(net);
    assert.ok(ampl.includes("set BUSES := North South;"));
    assert.ok(ampl.includes("minimize TotalCost:"));

    const jsonNet = parsePypsa(
      JSON.stringify({
        name: "JSON_Net",
        buses: [{ name: "B1", v_nom: 220 }],
        generators: [],
        loads: [],
        lines: [],
      }),
    );
    assert.equal(jsonNet.buses.length, 1);
  });
});
