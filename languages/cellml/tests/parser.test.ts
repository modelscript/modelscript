// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCellml } from "../src/parser/index.js";

const HODGKIN_HUXLEY_SNIPPET = `<?xml version="1.0" encoding="UTF-8"?>
<model name="hodgkin_huxley_1952" xmlns="http://www.cellml.org/cellml/1.1#">
  <units name="millisecond">
    <unit units="second" prefix="milli"/>
  </units>
  <units name="millivolt">
    <unit units="volt" prefix="milli"/>
  </units>
  <units name="microfarad_per_cmsq">
    <unit units="farad" prefix="micro"/>
    <unit units="metre" prefix="centi" exponent="-2"/>
  </units>
  <units name="microampere_per_cmsq">
    <unit units="ampere" prefix="micro"/>
    <unit units="metre" prefix="centi" exponent="-2"/>
  </units>
  <units name="custom_base" base_units="yes"/>

  <component name="environment">
    <variable name="time" units="millisecond" public_interface="out"/>
  </component>

  <component name="membrane">
    <variable name="time" units="millisecond" public_interface="in" private_interface="out"/>
    <variable name="V" units="millivolt" initial_value="-75.0" public_interface="out" private_interface="out"/>
    <variable name="Cm" units="microfarad_per_cmsq" initial_value="1.0"/>
    <variable name="i_Stim" units="microampere_per_cmsq"/>
    <variable name="i_L" units="microampere_per_cmsq" private_interface="in"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>i_Stim</ci>
        <piecewise>
          <piece>
            <cn>-20.0</cn>
            <apply>
              <and/>
              <apply><geq/><ci>time</ci><cn>1.0</cn></apply>
              <apply><leq/><ci>time</ci><cn>1.5</cn></apply>
            </apply>
          </piece>
          <otherwise>
            <cn>0.0</cn>
          </otherwise>
        </piecewise>
      </apply>
      <apply>
        <eq/>
        <apply>
          <diff/>
          <bvar><ci>time</ci></bvar>
          <ci>V</ci>
        </apply>
        <apply>
          <divide/>
          <apply>
            <minus/>
            <apply><plus/><ci>i_Stim</ci><ci>i_L</ci></apply>
          </apply>
          <ci>Cm</ci>
        </apply>
      </apply>
    </math>
  </component>

  <component name="leakage_current">
    <variable name="V" units="millivolt" public_interface="in"/>
    <variable name="g_L" units="millisiemens_per_cmsq" initial_value="0.3"/>
    <variable name="E_L" units="millivolt" initial_value="-64.387"/>
    <variable name="i_L" units="microampere_per_cmsq" public_interface="out"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>i_L</ci>
        <apply>
          <times/>
          <ci>g_L</ci>
          <apply><minus/><ci>V</ci><ci>E_L</ci></apply>
        </apply>
      </apply>
    </math>
  </component>

  <group>
    <relationship_ref relationship="encapsulation"/>
    <component_ref component="membrane">
      <component_ref component="leakage_current"/>
    </component_ref>
  </group>

  <connection>
    <map_components component_1="environment" component_2="membrane"/>
    <map_variables variable_1="time" variable_2="time"/>
  </connection>

  <connection>
    <map_components component_1="membrane" component_2="leakage_current"/>
    <map_variables variable_1="V" variable_2="V"/>
    <map_variables variable_1="i_L" variable_2="i_L"/>
  </connection>
</model>`;

describe("CellML Parser (1.0 / 1.1 / 2.0 & Content MathML)", () => {
  it("parses model metadata, custom SI unit dimension vectors, components, MathML ODEs, piecewise, connections, and encapsulation", () => {
    const doc = parseCellml(HODGKIN_HUXLEY_SNIPPET, "file:///hh.cellml");

    assert.equal(doc.name, "hodgkin_huxley_1952");
    assert.equal(doc.version, "1.1");
    assert.equal(doc.uri, "file:///hh.cellml");

    // Verify SI dimension vector calculations
    assert.equal(doc.units.size, 5);
    const msUnit = doc.units.get("millisecond")!;
    assert.equal(msUnit.dimensions.second, 1);
    assert.equal(msUnit.dimensions.multiplierScale, -3);

    const mvUnit = doc.units.get("millivolt")!;
    assert.equal(mvUnit.dimensions.kilogram, 1);
    assert.equal(mvUnit.dimensions.metre, 2);
    assert.equal(mvUnit.dimensions.second, -3);
    assert.equal(mvUnit.dimensions.ampere, -1);
    assert.equal(mvUnit.dimensions.multiplierScale, -3);

    const ufPerCmsq = doc.units.get("microfarad_per_cmsq")!;
    assert.equal(ufPerCmsq.dimensions.kilogram, -1);
    assert.equal(ufPerCmsq.dimensions.metre, -4);
    assert.equal(ufPerCmsq.dimensions.second, 4);
    assert.equal(ufPerCmsq.dimensions.ampere, 2);
    assert.equal(ufPerCmsq.dimensions.multiplierScale, -2);

    const customBase = doc.units.get("custom_base")!;
    assert.equal(customBase.isBaseUnits, true);

    // Verify components and variables
    assert.equal(doc.components.size, 3);
    const membrane = doc.components.get("membrane")!;
    assert.equal(membrane.variables.size, 5);
    const vVar = membrane.variables.get("V")!;
    assert.equal(vVar.units, "millivolt");
    assert.equal(vVar.initialValue, -75.0);
    assert.equal(vVar.publicInterface, "out");
    assert.equal(vVar.privateInterface, "out");

    // Verify Content MathML equations
    assert.equal(membrane.equations.length, 2);
    const stimEq = membrane.equations[0]!;
    assert.equal(stimEq.targetVariable, "i_Stim");
    assert.equal(stimEq.isOde, false);
    assert.ok(stimEq.rhsExpression.includes("piecewise"));
    assert.deepEqual(stimEq.referencedIdentifiers, ["time"]);

    const odeEq = membrane.equations[1]!;
    assert.equal(odeEq.targetVariable, "V");
    assert.equal(odeEq.isOde, true);
    assert.equal(odeEq.independentVariable, "time");
    assert.deepEqual(odeEq.referencedIdentifiers, ["i_Stim", "i_L", "Cm"]);

    // Verify encapsulation hierarchy
    assert.equal(doc.encapsulation.length, 1);
    assert.equal(doc.encapsulation[0]?.componentRef, "membrane");
    assert.equal(doc.encapsulation[0]?.children.length, 1);
    assert.equal(doc.encapsulation[0]?.children[0]?.componentRef, "leakage_current");

    // Verify connections
    assert.equal(doc.connections.length, 2);
    assert.equal(doc.connections[1]?.component1, "membrane");
    assert.equal(doc.connections[1]?.component2, "leakage_current");
    assert.equal(doc.connections[1]?.mappings.length, 2);
  });

  it("parses CellML 2.0 syntax, exp/ln/power MathML operators, and infix formula attributes", () => {
    const cellml2 = `<?xml version="1.0" encoding="UTF-8"?>
<model name="cellml2_gate" xmlns="http://www.cellml.org/cellml/2.0#">
  <component name="gate">
    <variable name="V" units="millivolt" initial_value="-65.0"/>
    <variable name="alpha" units="per_millisecond"/>
    <variable name="beta" units="per_millisecond"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>alpha</ci>
        <apply>
          <divide/>
          <apply><power/><ci>V</ci><cn>2</cn></apply>
          <apply><plus/><apply><exp/><ci>V</ci></apply><apply><ln/><cn>2.71828</cn></apply></apply>
        </apply>
      </apply>
    </math>
    <equation formula="beta = 0.125 * exp(-V / 80.0)"/>
  </component>
  <encapsulation>
    <component_ref component="gate"/>
  </encapsulation>
</model>`;

    const doc = parseCellml(cellml2);
    assert.equal(doc.version, "2.0");
    const gate = doc.components.get("gate")!;
    assert.equal(gate.equations.length, 2);
    assert.ok(gate.equations[0]?.rhsExpression.includes("^"));
    assert.ok(gate.equations[0]?.rhsExpression.includes("exp("));
    assert.ok(gate.equations[0]?.rhsExpression.includes("ln("));
    assert.equal(gate.equations[1]?.targetVariable, "beta");
    assert.deepEqual(gate.equations[1]?.referencedIdentifiers, ["V"]);
  });
});
