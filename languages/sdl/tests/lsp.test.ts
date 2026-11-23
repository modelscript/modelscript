// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LspSymbolKind, getSdlCompletions, getSdlDocumentSymbols, getSdlHover, validateSdl } from "../src/index.js";

const LSP_SAMPLE = `SYSTEM DemoNet;
  SIGNAL Req, Resp;
  BLOCK Core;
    PROCESS Server;
      DCL count Integer := 0;
      TIMER T_wait;
      START;
        SET(NOW + 1.0, T_wait);
        NEXTSTATE Ready;
      STATE Ready;
        INPUT Req;
          TASK count := count + 1;
          OUTPUT Resp TO ENV;
          NEXTSTATE Ready;
        INPUT T_wait;
          NEXTSTATE Ready;
      ENDSTATE Ready;
    ENDPROCESS Server;
  ENDBLOCK Core;
ENDSYSTEM DemoNet;
`;

describe("SDL-88 LSP Services (Diagnostics, Symbols, Hover, Completions)", () => {
  it("validates SDL-88 documents and reports LSP diagnostics", () => {
    const cleanDiags = validateSdl(LSP_SAMPLE);
    const errors = cleanDiags.filter((d) => d.severity === 1);
    assert.strictEqual(errors.length, 0);

    const broken = `SYSTEM Bad; BLOCK B; PROCESS P; STATE S; INPUT MissingSig; NEXTSTATE Nowhere; ENDSTATE S; ENDPROCESS P; ENDBLOCK B; ENDSYSTEM Bad;`;
    const badDiags = validateSdl(broken);
    assert.ok(badDiags.some((d) => d.code === "SDL5002"));
    assert.ok(badDiags.some((d) => d.code === "SDL3001"));
    assert.ok(badDiags.some((d) => d.code === "SDL3003"));
  });

  it("extracts hierarchical DocumentSymbols (SYSTEM -> BLOCK -> PROCESS -> STATE)", () => {
    const symbols = getSdlDocumentSymbols(LSP_SAMPLE);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "DemoNet");
    assert.strictEqual(symbols[0]?.kind, LspSymbolKind.Package);

    const coreBlock = symbols[0]?.children?.find((c) => c.name === "Core");
    assert.ok(coreBlock);
    assert.strictEqual(coreBlock.kind, LspSymbolKind.Module);

    const serverProc = coreBlock.children?.find((c) => c.name === "Server");
    assert.ok(serverProc);
    assert.strictEqual(serverProc.kind, LspSymbolKind.Class);
    assert.ok(serverProc.children?.some((c) => c.name === "Ready" && c.kind === LspSymbolKind.EnumMember));
  });

  it("provides hover documentation for keywords, predefined sorts, processes, and states", () => {
    const kwHover = getSdlHover(LSP_SAMPLE, { line: 0, character: 2 }); // SYSTEM
    assert.ok(kwHover?.contents.value.includes("SYSTEM"));

    const sortHover = getSdlHover(LSP_SAMPLE, { line: 4, character: 18 }); // Integer
    assert.ok(sortHover?.contents.value.includes("Integer"));

    const procHover = getSdlHover(LSP_SAMPLE, { line: 3, character: 14 }); // Server
    assert.ok(procHover?.contents.value.includes("Server"));
    assert.ok(procHover?.contents.value.includes("Deadlock-free"));
  });

  it("returns SDL-88 keyword and standard-library completions", () => {
    const items = getSdlCompletions();
    assert.ok(items.some((i) => i.label === "SYSTEM"));
    assert.ok(items.some((i) => i.label === "NEXTSTATE"));
    assert.ok(items.some((i) => i.label === "Duration"));
    assert.ok(items.some((i) => i.label === "AlternatingBitSender"));
  });
});
