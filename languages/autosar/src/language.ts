// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, xmlRules } from "@modelscript/dsl";
import { indexAutosarDocument } from "./indexing.js";
import { autosarPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for AUTOSAR Classic and Adaptive XML files (.arxml).
 */
export const autosarLanguage = language({
  polyglot: autosarPolyglotConfig,
  name: "autosar",
  fileExtensions: [".arxml"],
  maturity: "experimental",
  indexing: {
    indexFile: indexAutosarDocument,
  },
  lsp: {
    fileExtensions: [".arxml"],
    folding: ["Element", { rule: "COMMENT", kind: "comment", defaultCollapsed: true }],
    outline: ["Element"],
  },
  diagram: {
    placement: {
      persistence: "sidecar",
    },
    mutations: {
      sections: { node: "ELEMENTS", edge: "CONNECTORS" },
      createNode: (className: string, name: string) =>
        `<APPLICATION-SW-COMPONENT-TYPE><SHORT-NAME>${name}</SHORT-NAME><!-- ${className} --><PORTS><P-PORT-PROTOTYPE><SHORT-NAME>out</SHORT-NAME></P-PORT-PROTOTYPE><R-PORT-PROTOTYPE><SHORT-NAME>in</SHORT-NAME></R-PORT-PROTOTYPE></PORTS></APPLICATION-SW-COMPONENT-TYPE>`,
      createEdge: (source: string, target: string, sourcePort?: string, targetPort?: string) =>
        `<ASSEMBLY-SW-CONNECTOR><SHORT-NAME>${source}_to_${target}</SHORT-NAME><PROVIDER-IREF><CONTEXT-COMPONENT-REF>${source}</CONTEXT-COMPONENT-REF><TARGET-P-PORT-REF>${sourcePort || "out"}</TARGET-P-PORT-REF></PROVIDER-IREF><REQUESTER-IREF><CONTEXT-COMPONENT-REF>${target}</CONTEXT-COMPONENT-REF><TARGET-R-PORT-REF>${targetPort || "in"}</TARGET-R-PORT-REF></REQUESTER-IREF></ASSEMBLY-SW-CONNECTOR>`,
    },
  },
  extras: ($) => [/[ \t\r\n]+/, $["COMMENT"]!, $["PROCESSING_INSTRUCTION"]!],
  rules: xmlRules,
});
