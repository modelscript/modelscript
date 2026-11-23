// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EdifErrorCode, lintEdif } from "../src/index.js";

describe("@modelscript/edif Linter Suite (EDIF1001–EDIF5006)", () => {
  it("passes cleanly with zero diagnostics on a valid EDIF 2.0.0 netlist", () => {
    const valid = `(edif clean_inv
      (edifVersion 2 0 0)
      (edifLevel 0)
      (external STD
        (cell INV (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port A (direction INPUT)) (port Y (direction OUTPUT))))))
      (library WORK
        (cell TOP (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port IN1 (direction INPUT)) (port OUT1 (direction OUTPUT)))
            (contents
              (instance U1 (viewRef netlist (cellRef INV (libraryRef STD))))
              (net N1 (joined (portRef IN1) (portRef A (instanceRef U1))))
              (net N2 (joined (portRef Y (instanceRef U1)) (portRef OUT1)))))))
      (design TopDesign (cellRef TOP (libraryRef WORK))))`;

    const diags = lintEdif(valid);
    assert.strictEqual(diags.length, 0, `Expected 0 diagnostics, got: ${JSON.stringify(diags)}`);
  });

  it("detects syntax errors (EDIF1001), invalid edifVersion (EDIF1002), and missing design (EDIF5001)", () => {
    const src = `(edif bad_ver
      (edifVersion 1 0 0)
      (library WORK (cell A (cellType GENERIC) (view v (viewType NETLIST))))`;

    const diags = lintEdif(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(EdifErrorCode.SYNTAX_ERROR.id), "Expected EDIF1001");
    assert.ok(ids.has(EdifErrorCode.INVALID_EDIF_VERSION.id), "Expected EDIF1002");
    assert.ok(ids.has(EdifErrorCode.MISSING_DESIGN.id), "Expected EDIF5001");
  });

  it("detects duplicate library, cell, instance, and net declarations (EDIF2001–EDIF2004)", () => {
    const src = `(edif dups
      (edifVersion 2 0 0)
      (library WORK
        (cell C1 (cellType GENERIC)
          (view v (viewType NETLIST)
            (interface (port A (direction INPUT)) (port B (direction OUTPUT)))
            (contents
              (instance U1 (viewRef v (cellRef C2)))
              (instance U1 (viewRef v (cellRef C2)))
              (net N1 (joined (portRef A) (portRef B)))
              (net N1 (joined (portRef A) (portRef B))))))
        (cell C1 (cellType GENERIC) (view v (viewType NETLIST)))
        (cell C2 (cellType GENERIC) (view v (viewType NETLIST))))
      (library WORK)
      (design D (cellRef C1 (libraryRef WORK))))`;

    const diags = lintEdif(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(EdifErrorCode.DUPLICATE_LIBRARY.id), "Expected EDIF2001");
    assert.ok(ids.has(EdifErrorCode.DUPLICATE_CELL.id), "Expected EDIF2002");
    assert.ok(ids.has(EdifErrorCode.DUPLICATE_INSTANCE.id), "Expected EDIF2003");
    assert.ok(ids.has(EdifErrorCode.DUPLICATE_NET.id), "Expected EDIF2004");
  });

  it("detects unresolved libraryRef, cellRef, instanceRef, and portRef (EDIF3001–EDIF3005)", () => {
    const src = `(edif refs
      (edifVersion 2 0 0)
      (external STD
        (cell INV (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port A (direction INPUT)) (port Y (direction OUTPUT))))))
      (library WORK
        (cell TOP (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port IN1 (direction INPUT)))
            (contents
              (instance U_BADLIB (viewRef netlist (cellRef INV (libraryRef NO_SUCH_LIB))))
              (instance U_BADCELL (viewRef netlist (cellRef NO_SUCH_CELL (libraryRef STD))))
              (instance U_OK (viewRef netlist (cellRef INV (libraryRef STD))))
              (net N1 (joined (portRef IN1) (portRef NO_SUCH_PORT (instanceRef U_OK))))
              (net N2 (joined (portRef IN1) (portRef A (instanceRef NO_SUCH_INST))))))))
      (design D (cellRef TOP (libraryRef WORK))))`;

    const diags = lintEdif(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(EdifErrorCode.UNRESOLVED_LIBRARY_REF.id), "Expected EDIF3001");
    assert.ok(ids.has(EdifErrorCode.UNRESOLVED_CELL_REF.id), "Expected EDIF3002");
    assert.ok(ids.has(EdifErrorCode.UNRESOLVED_INSTANCE_REF.id), "Expected EDIF3004");
    assert.ok(ids.has(EdifErrorCode.UNRESOLVED_PORT_REF.id), "Expected EDIF3005");
  });

  it("detects floating nets (EDIF4001), shorted output drivers (EDIF4002), and hierarchy cycles (EDIF5006)", () => {
    const src = `(edif electrical_checks
      (edifVersion 2 0 0)
      (external STD
        (cell INV (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port A (direction INPUT)) (port Y (direction OUTPUT))))))
      (library WORK
        (cell CYC_A (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (contents (instance B1 (viewRef netlist (cellRef CYC_B (libraryRef WORK)))))))
        (cell CYC_B (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (contents (instance A1 (viewRef netlist (cellRef CYC_A (libraryRef WORK)))))))
        (cell TOP (cellType GENERIC)
          (view netlist (viewType NETLIST)
            (interface (port IN1 (direction INPUT)) (port OUT1 (direction OUTPUT)))
            (contents
              (instance U1 (viewRef netlist (cellRef INV (libraryRef STD))))
              (instance U2 (viewRef netlist (cellRef INV (libraryRef STD))))
              (net N_FLOAT (joined (portRef IN1)))
              (net N_SHORT (joined (portRef Y (instanceRef U1)) (portRef Y (instanceRef U2)) (portRef OUT1)))))))
      (design D (cellRef TOP (libraryRef WORK))))`;

    const diags = lintEdif(src);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has(EdifErrorCode.FLOATING_NET.id), "Expected EDIF4001");
    assert.ok(ids.has(EdifErrorCode.SHORTED_OUTPUT_DRIVERS.id), "Expected EDIF4002");
    assert.ok(ids.has(EdifErrorCode.HIERARCHY_CYCLE.id), "Expected EDIF5006");
  });
});
