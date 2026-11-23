// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderAsn1DiagramSvg, renderBerTlvSvg } from "../src/diagram/index.js";
import { getAsn1Completions, getAsn1DocumentSymbols, getAsn1Hover, validateAsn1 } from "../src/lsp.js";
import { parseAsn1 } from "../src/parser/asn1-parser.js";
import { decodeBer, encodeDer } from "../src/parser/ber-der.js";
import { Asn1Panel } from "../src/ui/Asn1Panel.js";

const X509_SAMPLE = `
X509Subset DEFINITIONS EXPLICIT TAGS ::= BEGIN

AlgorithmIdentifier ::= SEQUENCE {
  algorithm OBJECT IDENTIFIER,
  parameters NULL OPTIONAL
}

Validity ::= SEQUENCE {
  notBefore UTCTime,
  notAfter UTCTime
}

CertInfo ::= SEQUENCE {
  signature AlgorithmIdentifier,
  validity Validity
}

END
`;

describe("ASN.1 LSP, SVG Diagrams & Interactive React Panel", () => {
  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateAsn1(X509_SAMPLE);
    assert.equal(diags.length, 0);

    const symbols = getAsn1DocumentSymbols(X509_SAMPLE);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "X509Subset");
    assert.equal(symbols[0]!.children?.length, 3);

    const hover = getAsn1Hover(X509_SAMPLE, { line: 3, character: 4 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("AlgorithmIdentifier"));
    assert.ok(hover.contents.value.includes("BER/DER Wire Size"));

    const completions = getAsn1Completions(X509_SAMPLE);
    assert.ok(completions.some((c) => c.label === "SEQUENCE"));
    assert.ok(completions.some((c) => c.label === "AlgorithmIdentifier"));
    assert.ok(completions.some((c) => c.label === "SNMPv1PDU"));
  });

  it("renders pure SVG type-dependency graph and BER/DER TLV byte-layout diagrams", () => {
    const mod = parseAsn1(X509_SAMPLE);
    const der = encodeDer({
      kind: "sequence",
      items: [{ kind: "oid", value: "1.2.840.113549.1.1.1" }, { kind: "null" }],
    });
    const decoded = decodeBer(der);
    assert.ok(decoded.root);

    const graphSvg = renderAsn1DiagramSvg(mod, decoded.root);
    assert.ok(graphSvg.startsWith("<svg"));
    assert.ok(graphSvg.includes("X509Subset"));
    assert.ok(graphSvg.includes("AlgorithmIdentifier"));
    assert.ok(graphSvg.includes("CertInfo"));

    const tlvSvg = renderBerTlvSvg(decoded.root);
    assert.ok(tlvSvg.startsWith("<svg"));
    assert.ok(tlvSvg.includes("1.2.840.113549.1.1.1"));
    assert.ok(tlvSvg.includes("30"));
  });

  it("exports React Asn1Panel component", () => {
    assert.equal(typeof Asn1Panel, "function");
  });
});
