// SPDX-License-Identifier: AGPL-3.0-or-later

import { assertSemanticEnvelopeCompliance } from "@modelscript/runtime";
import { describe, it } from "node:test";
import { csvPolyglotConfig } from "../src/tgg/index.js";

describe("CSV L0 Semantic Envelope Compliance", () => {
  it("satisfies CPA confluence, zero information leak, and GetPut/PutGet lens laws", () => {
    assertSemanticEnvelopeCompliance({
      language: "csv",
      level: "L0",
      config: csvPolyglotConfig,
      samples: [
        {
          ruleName: "CsvDocumentToModelicaPackage",
          sourceLang: "csv",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "SourceFile",
            name: `Dataset_${i}`,
            properties: {
              rows: `Dataset_${i}`,
            },
          }),
        },
        {
          ruleName: "CsvVirtualComponentToModelicaComponent",
          sourceLang: "csv",
          targetLang: "modelica",
          makeSource: (i) => ({
            kind: "CSVVirtualComponent",
            name: `col_${i}`,
            properties: {
              name: `col_${i}`,
              typeSpecifier: "Real",
            },
          }),
        },
      ],
    });
  });
});
