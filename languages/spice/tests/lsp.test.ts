// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSpiceDocumentSymbols, getSpiceHover, validateSpice } from "../src/index.js";

const VALID_SPICE = `* Low-Pass RC Filter Benchmark
R1 in out 1k
C1 out 0 1u
V1 in 0 DC 5 AC 1
.TRAN 1u 10m
.AC DEC 10 1 100k
.END
`;

const SPICE_WITH_SUBCKT = `* Subcircuit Inverter
.SUBCKT INV IN OUT VDD GND
M1 OUT IN VDD VDD PMOS W=1u L=0.18u
M2 OUT IN GND GND NMOS W=0.5u L=0.18u
.ENDS INV

X1 SIG_IN SIG_OUT PWR 0 INV
`;

describe("SPICE LSP Services (Diagnostics, DocumentSymbols, Hover)", () => {
  it("should validate clean SPICE netlist without errors", () => {
    const diags = validateSpice(VALID_SPICE);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("should emit diagnostic for floating nodes or syntax issues", () => {
    // Floating node netlist: R1 connects to node 'floating' which has no other connections
    const floating = `* Floating Node Netlist
R1 1 floating 1k
V1 1 0 5
.END
`;
    const diags = validateSpice(floating);
    assert.ok(diags.length > 0);
    const floatDiag = diags.find((d) => d.code === "M7101" || d.message.includes("Floating node"));
    assert.ok(floatDiag, "Should flag floating node");
    assert.equal(floatDiag.severity, 1); // error
  });

  it("should extract document symbol hierarchy including components and directives", () => {
    const symbols = getSpiceDocumentSymbols(VALID_SPICE);
    assert.equal(symbols.length, 1);

    const rootSymbol = symbols[0]!;
    assert.ok(rootSymbol.name.includes("Low-Pass RC Filter") || rootSymbol.name.includes("SPICE Circuit"));
    assert.ok(rootSymbol.children && rootSymbol.children.length > 0);

    const childNames = rootSymbol.children.map((c) => c.name);
    assert.ok(childNames.some((n) => n.startsWith("R1")));
    assert.ok(childNames.some((n) => n.startsWith("C1")));
    assert.ok(childNames.some((n) => n.startsWith("V1")));
  });

  it("should extract subcircuit document symbols", () => {
    const symbols = getSpiceDocumentSymbols(SPICE_WITH_SUBCKT);
    assert.equal(symbols.length, 1);

    const rootSymbol = symbols[0]!;
    assert.ok(rootSymbol.children && rootSymbol.children.length > 0);
    const subcktSymbol = rootSymbol.children.find((c) => c.name.includes(".SUBCKT INV"));
    assert.ok(subcktSymbol, "Should find .SUBCKT INV symbol");
    assert.ok(subcktSymbol.children && subcktSymbol.children.length === 2);
  });

  it("should generate markdown hover for component under cursor", () => {
    const lines = VALID_SPICE.split("\n");
    const r1Line = lines.findIndex((l) => l.startsWith("R1"));
    assert.ok(r1Line >= 0);

    const hover = getSpiceHover(VALID_SPICE, r1Line, 2);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("R1"));
    assert.ok(hover.contents.value.includes("(R)"));
    assert.ok(hover.contents.value.includes("in, out"));
  });
});
