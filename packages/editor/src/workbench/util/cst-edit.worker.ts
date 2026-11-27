// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CstIncrementalParser } from "@modelscript/dsl/unparser";
import { getXmlWasmParser, initXmlParserFromBytes } from "@modelscript/dsl/xml";
import { createPsseWasmParser } from "@modelscript/psse";
import { CstEditWorkerCore, type CstEditWorkerRequest } from "./cst-edit-worker-core";

const core = new CstEditWorkerCore();
let psseLoaderStarted = false;

function ensurePsseParserLoaded(): void {
  if (psseLoaderStarted) return;
  psseLoaderStarted = true;
  void (async () => {
    try {
      const origin =
        typeof self !== "undefined" && self.location?.origin && self.location.origin !== "null"
          ? self.location.origin
          : "";
      if (!origin) return;
      const resp = await fetch(`${origin}/lsp/server/dist/psse.wasm`);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      const { parser } = await createPsseWasmParser(new Uint8Array(buf));
      core.setLanguageParser("psse", parser as unknown as CstIncrementalParser);
    } catch {
      // Fallback to LSP backend if psse.wasm cannot be fetched
    }
  })();
}

// Lazily load the single shared xml/parser.wasm (~850KB, ~250KB gzipped) for all XML-family languages.
// While initializing, CstDocumentSession transparently uses the streaming XML CST fallback and
// seamlessly upgrades live sessions to the incremental WASM GLR tree once ready.
void (async () => {
  try {
    const origin =
      typeof self !== "undefined" && self.location?.origin && self.location.origin !== "null"
        ? self.location.origin
        : "";
    if (!origin) return;
    const candidates = [
      `${origin}/lsp/server/dist/xml.wasm`,
      `${origin}/lsp/server/dist/pscad.wasm`,
      `${origin}/lsp/xml/parser.wasm`,
      `${origin}/wasm/xml-parser.wasm`,
    ];
    for (const url of candidates) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        initXmlParserFromBytes(new Uint8Array(buf));
        const parser = getXmlWasmParser() as unknown as CstIncrementalParser | null;
        if (parser) {
          core.setXmlParser(parser);
          return;
        }
      } catch {
        // Try next candidate URL
      }
    }
  } catch {
    // Streaming XML CST fallback remains active
  }
})();

self.onmessage = (event: MessageEvent<CstEditWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if ("langId" in msg && typeof msg.langId === "string" && msg.langId.toLowerCase() === "psse") {
    ensurePsseParserLoaded();
  }
  const response = core.handleMessage(msg);
  if (response) {
    self.postMessage(response);
  }
};
