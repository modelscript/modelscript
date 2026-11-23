// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import { IucrCifErrorCode, lintIucrCif } from "../src/lints/index.js";

describe("IUCr CIF Lints (ICIF1001-ICIF5006)", () => {
  it("reports zero diagnostics on all canonical crystal templates", () => {
    for (const [name, src] of Object.entries(CANONICAL_CIF_TEMPLATES)) {
      const diags = lintIucrCif(src);
      assert.equal(diags.length, 0, `Expected 0 diagnostics for ${name}, got: ${JSON.stringify(diags)}`);
    }
  });

  it("detects syntax errors (ICIF1001), duplicate blocks (ICIF2001), and duplicate tags (ICIF2002)", () => {
    const src = `
data_dup
_cell_length_a 5.0
_cell_length_a 6.0
_title 'unterminated string

data_dup
_cell_length_a 5.0
`;
    const codes = new Set(lintIucrCif(src).map((d) => d.code));
    assert.ok(codes.has(IucrCifErrorCode.SYNTAX_ERROR.code));
    assert.ok(codes.has(IucrCifErrorCode.DUPLICATE_DATA_BLOCK.code));
    assert.ok(codes.has(IucrCifErrorCode.DUPLICATE_TAG.code));
  });

  it("detects loop column mismatch (ICIF3001) and empty loop (ICIF3002)", () => {
    const src = `
data_loop_test
loop_
_atom_site_label
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Si1 0.0 0.0

loop_
_symmetry_equiv_pos_as_xyz
`;
    const codes = new Set(lintIucrCif(src).map((d) => d.code));
    assert.ok(codes.has(IucrCifErrorCode.LOOP_COLUMN_MISMATCH.code));
    assert.ok(codes.has(IucrCifErrorCode.EMPTY_LOOP.code));
  });

  it("detects non-positive cell length (ICIF4001), invalid angle (ICIF4002), and degenerate metric tensor (ICIF4003)", () => {
    const badLenAng = `
data_bad_cell
_cell_length_a -1.5
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 185.0
_cell_angle_beta 90.0
_cell_angle_gamma 90.0
`;
    const c1 = new Set(lintIucrCif(badLenAng).map((d) => d.code));
    assert.ok(c1.has(IucrCifErrorCode.NON_POSITIVE_CELL_LENGTH.code));
    assert.ok(c1.has(IucrCifErrorCode.INVALID_CELL_ANGLE.code));

    const degenerate = `
data_degen
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 130.0
_cell_angle_beta 130.0
_cell_angle_gamma 130.0
`;
    const c2 = new Set(lintIucrCif(degenerate).map((d) => d.code));
    assert.ok(c2.has(IucrCifErrorCode.DEGENERATE_METRIC_TENSOR.code));
  });

  it("detects missing fract coords (ICIF5001), invalid occupancy (ICIF5002), overlapping atoms (ICIF5003), invalid symop (ICIF5005), and unknown element (ICIF5006)", () => {
    const missingCoords = `
data_missing_coords
loop_
_atom_site_label
_atom_site_fract_x
Si1 0.0
`;
    assert.ok(lintIucrCif(missingCoords).some((d) => d.code === IucrCifErrorCode.MISSING_ATOM_FRACT_COORDS.code));

    const badAtoms = `
data_bad_atoms
_cell_length_a 5.0
_cell_length_b 5.0
_cell_length_c 5.0
_cell_angle_alpha 90.0
_cell_angle_beta 90.0
_cell_angle_gamma 90.0

loop_
_symmetry_equiv_pos_as_xyz
'x, y, z'
'not_a_symop'

loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
Si1 Si 0.00 0.00 0.00 1.5
Si2 Xx 0.02 0.00 0.00 1.0
`;
    const codes = new Set(lintIucrCif(badAtoms).map((d) => d.code));
    assert.ok(codes.has(IucrCifErrorCode.INVALID_OCCUPANCY.code));
    assert.ok(codes.has(IucrCifErrorCode.OVERLAPPING_ATOMS.code));
    assert.ok(codes.has(IucrCifErrorCode.INVALID_SYMMETRY_OP.code));
    assert.ok(codes.has(IucrCifErrorCode.UNKNOWN_ELEMENT_SYMBOL.code));
  });
});
