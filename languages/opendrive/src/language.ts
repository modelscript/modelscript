// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Language Definition.
 *
 * Registers ASAM OpenDRIVE (.xodr, .xml) file extensions, pre-flight linting,
 * analytical clothoid track sampling, DAE lowering, and GENSYS export.
 */

import { language, xmlRules, type ActionExecutionContext } from "@modelscript/dsl";
import { lowerOpenDriveToDae } from "./dae/opendrive-to-dae.js";
import { sampleRoadTrack } from "./geometry/clothoid.js";
import { indexOpenDriveFile } from "./indexing.js";
import { lintOpenDrive } from "./lints/rules.js";
import { parseOpenDrive } from "./parser/index.js";
import { opendriveToGensys } from "./projections/opendrive-to-gensys.js";
import { opendrivePolyglotConfig } from "./tgg/index.js";

export const opendriveLanguage = language({
  polyglot: opendrivePolyglotConfig,
  name: "opendrive",
  fileExtensions: [".xodr", ".xml"],
  maturity: "experimental",
  indexing: {
    indexFile: indexOpenDriveFile,
    canIndex: (uri, text) => uri.toLowerCase().endsWith(".xodr") || Boolean(text && text.includes("<OpenDRIVE")),
  },
  lsp: {
    fileExtensions: [".xodr", ".xml"],
  },
  diagram: {
    placement: {
      persistence: "sidecar",
    },
    mutations: {
      sections: { node: "OpenDRIVE", edge: "OpenDRIVE" },
      createNode: (className: string, name: string, x: number, y: number) =>
        `<road name="${name}" length="100.0" id="${name}" junction="-1"><planView><geometry s="0.0" x="${Math.round(x)}" y="${Math.round(y)}" hdg="0.0" length="100.0"><line/></geometry></planView><!-- ${className} --></road>`,
      createEdge: (source: string, target: string) =>
        `<junction id="${source}_to_${target}" name="${source}_to_${target}"><connection id="0" incomingRoad="${source}" connectingRoad="${target}" contactPoint="start"/></junction>`,
    },
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,

  actions: [
    {
      id: "opendrive_lint",
      title: "Lint OpenDRIVE Road Network",
      description: "Runs pre-flight tangency continuity, lane link, and clothoid convergence checks.",
      category: "verify",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        return lintOpenDrive(doc);
      },
    },
    {
      id: "opendrive_sample_track",
      title: "Sample 3D Road Trajectory",
      description:
        "Generates high-precision 3D spatial track coordinates via Fresnel clothoids and elevation profiles.",
      category: "simulate",
      execute: async (context: ActionExecutionContext, params?: { step?: number | undefined }) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const step = params?.step ?? 1.0;
        const tracks = doc.roads.map((r) => ({
          roadId: r.id,
          name: r.name,
          points: sampleRoadTrack(r, step),
        }));
        return { step, tracks };
      },
    },
    {
      id: "opendrive_to_dae",
      title: "Lower OpenDRIVE to DAE Arena",
      description: "Lowers road tracking dynamics into ModelScript's linear-memory DAEBuilder arena.",
      category: "transform",
      execute: async (context: ActionExecutionContext) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const arena = lowerOpenDriveToDae(doc);
        return {
          variableCount: arena.getVarCount(),
          equationCount: arena.getEqCount(),
        };
      },
    },
    {
      id: "opendrive_to_gensys",
      title: "Export to GENSYS Track (.geo)",
      description: "Translates OpenDRIVE 3D roadway trajectories to GENSYS track geometry format.",
      category: "export",
      execute: async (context: ActionExecutionContext, params?: { step?: number | undefined }) => {
        const text = context.documentText || "";
        const doc = parseOpenDrive(text);
        const step = params?.step ?? 1.0;
        return opendriveToGensys(doc, step);
      },
    },
  ],
});
