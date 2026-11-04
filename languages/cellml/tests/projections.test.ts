// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCellml } from "../src/parser/index.js";
import { cellmlToModelica, cellmlToSbml } from "../src/projections/index.js";
import { HODGKIN_HUXLEY_FULL_CELLML } from "./solver-dae.test.js";

describe("CellML Cross-Language Projections (Modelica 3.x & SBML Level 3)", () => {
  it("projects CellML components, connections, and ODEs into a Modelica 3.x model", () => {
    const doc = parseCellml(HODGKIN_HUXLEY_FULL_CELLML);
    const mo = cellmlToModelica(doc);

    assert.ok(mo.includes("model hodgkin_huxley_squid_axon_1952"));
    assert.ok(mo.includes("parameter Real membrane_Cm"));
    assert.ok(mo.includes('Real membrane_V(unit = "millivolt", start = -65, fixed = true)'));
    assert.ok(mo.includes("membrane_i_Na = sodium_channel_i_Na;"));
    assert.ok(mo.includes("der(membrane_V) ="));
    assert.ok(mo.includes("der(sodium_channel_m) ="));
    assert.ok(mo.includes("end hodgkin_huxley_squid_axon_1952;"));
  });

  it("projects CellML ODEs, algebraic rules, and variables into SBML Level 3 Version 2 XML", () => {
    const doc = parseCellml(HODGKIN_HUXLEY_FULL_CELLML);
    const sbml = cellmlToSbml(doc);

    assert.ok(sbml.includes('<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">'));
    assert.ok(sbml.includes('<model id="hodgkin_huxley_squid_axon_1952"'));
    assert.ok(sbml.includes("<listOfCompartments>"));
    assert.ok(sbml.includes('<compartment id="membrane"'));
    assert.ok(sbml.includes("<listOfSpecies>"));
    assert.ok(sbml.includes('<species id="membrane_V"'));
    assert.ok(sbml.includes('<species id="sodium_channel_m"'));
    assert.ok(sbml.includes("<listOfParameters>"));
    assert.ok(sbml.includes('<parameter id="membrane_Cm"'));
    assert.ok(sbml.includes("<listOfRules>"));
    assert.ok(sbml.includes('<rateRule variable="membrane_V"'));
    assert.ok(sbml.includes('<assignmentRule variable="sodium_channel_i_Na"'));
  });
});
