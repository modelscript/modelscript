// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CellmlErrorCode, lintCellmlDocument } from "../src/lints/index.js";
import { parseCellml } from "../src/parser/index.js";

describe("CellML Static Verification & Biophysical Linter (M9301–M9310)", () => {
  it("produces zero diagnostics on a valid multi-component CellML model", () => {
    const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<model name="valid_cardiac_cell" xmlns="http://www.cellml.org/cellml/1.0#">
  <component name="env">
    <variable name="t" units="millisecond" public_interface="out"/>
  </component>
  <component name="cell">
    <variable name="t" units="millisecond" public_interface="in"/>
    <variable name="V" units="millivolt" initial_value="-80.0" public_interface="out"/>
    <variable name="tau" units="millisecond" initial_value="10.0"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
        <apply><divide/><apply><minus/><ci>V</ci></apply><ci>tau</ci></apply>
      </apply>
    </math>
  </component>
  <connection>
    <map_components component_1="env" component_2="cell"/>
    <map_variables variable_1="t" variable_2="t"/>
  </connection>
</model>`;

    const diags = lintCellmlDocument(parseCellml(validXml));
    assert.equal(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects M9301 (cellml-missing-model-name) and M9302 (cellml-unresolved-units)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model name="">
  <component name="c1">
    <variable name="x" units="furlong_per_fortnight" initial_value="1.0"/>
  </component>
</model>`;

    const diags = lintCellmlDocument(parseCellml(xml));
    assert.ok(
      diags.some((d) => d.code === CellmlErrorCode.MISSING_MODEL_NAME.code && d.rule === "cellml-missing-model-name"),
    );
    assert.ok(
      diags.some((d) => d.code === CellmlErrorCode.UNRESOLVED_UNITS.code && d.rule === "cellml-unresolved-units"),
    );
  });

  it("detects M9303 (cellml-interface-direction-conflict) and M9304 (cellml-unit-dimensional-mismatch)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model name="conflict_model">
  <component name="c1">
    <variable name="v_out1" units="millivolt" initial_value="-70.0" public_interface="out"/>
    <variable name="curr" units="ampere" initial_value="1.0" public_interface="out"/>
  </component>
  <component name="c2">
    <variable name="v_out2" units="millivolt" initial_value="-70.0" public_interface="out"/>
    <variable name="voltage_in" units="volt" public_interface="in"/>
  </component>
  <connection>
    <map_components component_1="c1" component_2="c2"/>
    <map_variables variable_1="v_out1" variable_2="v_out2"/>
    <map_variables variable_1="curr" variable_2="voltage_in"/>
  </connection>
</model>`;

    const diags = lintCellmlDocument(parseCellml(xml));
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.INTERFACE_DIRECTION_CONFLICT.code &&
          d.rule === "cellml-interface-direction-conflict",
      ),
    );
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.UNIT_DIMENSIONAL_MISMATCH.code && d.rule === "cellml-unit-dimensional-mismatch",
      ),
    );
  });

  it("detects M9305 (cellml-uninitialized-state-variable) and M9306 (cellml-encapsulation-hierarchy-cycle)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model name="state_and_cycle_model">
  <component name="compA">
    <variable name="t" units="second" initial_value="0.0"/>
    <variable name="V" units="millivolt"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
        <apply><minus/><ci>V</ci></apply>
      </apply>
    </math>
  </component>
  <component name="compB">
    <variable name="x" units="dimensionless" initial_value="1.0"/>
  </component>
  <group>
    <relationship_ref relationship="encapsulation"/>
    <component_ref component="compA">
      <component_ref component="compB">
        <component_ref component="compA"/>
      </component_ref>
    </component_ref>
  </group>
</model>`;

    const diags = lintCellmlDocument(parseCellml(xml));
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.UNINITIALIZED_STATE_VARIABLE.code &&
          d.rule === "cellml-uninitialized-state-variable",
      ),
    );
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.ENCAPSULATION_HIERARCHY_CYCLE.code &&
          d.rule === "cellml-encapsulation-hierarchy-cycle",
      ),
    );
  });

  it("detects M9307 (cellml-unresolved-connection-member), M9308 (cellml-overconstrained-variable), M9309 (cellml-undefined-math-ci), and M9310 (cellml-duplicate-variable-or-component)", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model name="structural_errors_model">
  <component name="channel">
    <variable name="V" units="millivolt" public_interface="in"/>
    <variable name="V" units="millivolt" initial_value="-70.0"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply>
        <eq/>
        <ci>V</ci>
        <apply><plus/><ci>ghost_var</ci><cn>1.0</cn></apply>
      </apply>
    </math>
  </component>
  <component name="channel">
    <variable name="y" units="dimensionless" initial_value="0.0"/>
  </component>
  <connection>
    <map_components component_1="channel" component_2="missing_comp"/>
    <map_variables variable_1="V" variable_2="V"/>
  </connection>
</model>`;

    const diags = lintCellmlDocument(parseCellml(xml));
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.UNRESOLVED_CONNECTION_MEMBER.code &&
          d.rule === "cellml-unresolved-connection-member",
      ),
    );
    assert.ok(
      diags.some(
        (d) => d.code === CellmlErrorCode.OVERCONSTRAINED_VARIABLE.code && d.rule === "cellml-overconstrained-variable",
      ),
    );
    assert.ok(
      diags.some((d) => d.code === CellmlErrorCode.UNDEFINED_MATH_CI.code && d.rule === "cellml-undefined-math-ci"),
    );
    assert.ok(
      diags.some(
        (d) =>
          d.code === CellmlErrorCode.DUPLICATE_VARIABLE_OR_COMPONENT.code &&
          d.rule === "cellml-duplicate-variable-or-component",
      ),
    );
  });
});
