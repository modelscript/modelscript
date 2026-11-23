// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { indexMolfileFile } from "../src/indexing.js";
import {
  executeMolfileAction,
  getMolfileDocumentSymbols,
  getMolfileHover,
  provideMolfileCompletions,
  validateMolfile,
} from "../src/lsp.js";

describe("Molfile Workspace Indexing & LSP Services", () => {
  it("indexes Molfile/SDF documents into symbol entries", () => {
    const sdf = `${CANONICAL_MOLFILES.Aspirin}\n> <CAS_RN>\n50-78-2\n\n$$$$\n${CANONICAL_MOLFILES.Benzene}\n$$$$`;
    const added: Array<{ name: string; kind: string }> = [];
    let parsedModel: unknown;

    indexMolfileFile({
      uri: "file:///bench.sdf",
      text: sdf,
      addSymbol: (name: string, kind: string) => {
        added.push({ name, kind });
        return added.length;
      },
      setParsedModel: (m: unknown) => {
        parsedModel = m;
      },
    } as never);

    assert.ok(parsedModel);
    assert.ok(added.some((s) => s.name === "MolfileLibrary" && s.kind === "package"));
    assert.ok(added.some((s) => s.name === "Aspirin" && s.kind === "struct"));
    assert.ok(added.some((s) => s.name === "Aspirin_CAS_RN" && s.kind === "property"));
    assert.ok(added.some((s) => s.name === "Benzene" && s.kind === "struct"));
  });

  it("validates documents and surfaces LSP diagnostics, symbols, hover, and completions", () => {
    const cleanDiags = validateMolfile(CANONICAL_MOLFILES.Aspirin, "aspirin.mol");
    assert.strictEqual(cleanDiags.length, 0);

    const symbols = getMolfileDocumentSymbols(CANONICAL_MOLFILES.Aspirin, "aspirin.mol");
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.children?.length, 1);
    assert.strictEqual(symbols[0]!.children![0]!.name, "Aspirin");
    assert.ok(symbols[0]!.children![0]!.detail?.includes("C9H8O4"));

    const hover = getMolfileHover(CANONICAL_MOLFILES.Aspirin, { line: 4, character: 2 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("C9H8O4"));
    assert.ok(hover.contents.value.includes("180.157"));

    const completions = provideMolfileCompletions();
    assert.ok(completions.some((c) => c.label === "M  END"));
    assert.ok(completions.some((c) => c.label === "M  V30 BEGIN CTAB"));
  });

  it("executes all Molfile LSP actions", async () => {
    const lintRes = await executeMolfileAction("lint_molfile", CANONICAL_MOLFILES.Benzene);
    assert.strictEqual(lintRes.length, 0);

    const analyzeRes = await executeMolfileAction("molfile_analyze", CANONICAL_MOLFILES.Benzene);
    assert.strictEqual(analyzeRes[0]!.formula, "C6H6");

    const daeRes = await executeMolfileAction("molfile_to_dae", CANONICAL_MOLFILES.Benzene);
    assert.strictEqual(daeRes.modelName, "Benzene");
    assert.ok(daeRes.equationCount > 0);

    const smiRes = await executeMolfileAction("molfile_to_smiles", CANONICAL_MOLFILES.Benzene);
    assert.ok(smiRes.startsWith("c1ccccc1"));

    const pdbRes = await executeMolfileAction("molfile_to_pdb", CANONICAL_MOLFILES.Benzene);
    assert.ok(pdbRes.includes("HETATM"));
  });
});
