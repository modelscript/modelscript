// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adamsLanguage,
  createAdamsActionHandlers,
  getAdamsDocumentSymbols,
  getAdamsHover,
  validateAdams,
} from "@modelscript/adams";
import {
  autosarActionHandlers,
  autosarLanguage,
  getAutosarDocumentSymbols,
  getAutosarHover,
  validateAutosar,
} from "@modelscript/autosar";
import {
  createGensysActionHandlers,
  gensysLanguage,
  getGensysDocumentSymbols,
  getGensysHover,
  validateGensys,
} from "@modelscript/gensys";
import { getGtfsDocumentSymbols, getGtfsHover, gtfsLanguage, validateGtfs } from "@modelscript/gtfs";
import {
  getGtsuiteDocumentSymbols,
  getGtsuiteHover,
  gtsuiteActionHandlers,
  gtsuiteLanguage,
  validateGtsuite,
} from "@modelscript/gtsuite";
import {
  getOpenDriveDocumentSymbols,
  getOpenDriveHover,
  opendriveActionHandlers,
  opendriveLanguage,
  validateOpenDrive,
} from "@modelscript/opendrive";
import {
  getOpenScenarioDocumentSymbols,
  getOpenScenarioHover,
  openscenarioActionHandlers,
  openScenarioLanguage,
  validateOpenScenario,
} from "@modelscript/openscenario";
import {
  getSimaDocumentSymbols,
  getSimaHover,
  simaActionHandlers,
  simaLanguage,
  validateSima,
} from "@modelscript/sima";
import {
  createSimpackActionHandlers,
  getSimpackDocumentSymbols,
  getSimpackHover,
  simpackLanguage,
  validateSimpack,
} from "@modelscript/simpack";
import {
  extractUrdfTheoryConstraints,
  getUrdfDocumentSymbols,
  getUrdfHover,
  urdfActionHandlers,
  urdfLanguage,
  validateUrdf,
} from "@modelscript/urdf";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry } from "../LanguageRegistry.js";
import { type DocInput, docText, registerStandardPlugin } from "../standard-plugin.js";

type CadHandlerContext =
  | { documentManager?: { documents?: { get?: (uri: string) => { getText?: () => string } | undefined } } }
  | null
  | undefined;
type CadHandlerParams = { documentText?: string; text?: string; uri?: string } | null | undefined;

async function simulateDaeHelper(dae: unknown, opts: { startTime: number; stopTime: number; step: number }) {
  const [{ initBltWasm }, { simulateArena }] = await Promise.all([
    import("@modelscript/runtime"),
    import("@modelscript/simulate"),
  ]);
  await initBltWasm();
  return simulateArena(dae as Parameters<typeof simulateArena>[0], opts);
}

export const MULTIBODY_ROBOTICS_PLUGIN_IDS: readonly string[] = [
  "adams",
  "simpack",
  "gensys",
  "gtsuite",
  "sima",
  "urdf",
  "opendrive",
  "openscenario",
  "autosar",
  "gtfs",
];

/**
 * Registers the 10 multibody, automotive, robotics, marine, and rail language plugins.
 */
export function registerMultibodyRoboticsPlugins(workspaceManager?: WorkspaceManager): void {
  // 1. GENSYS
  registerStandardPlugin({
    id: "gensys",
    name: "GENSYS",
    extensions: [".calc", ".run", ".sub", ".geom", ".trax", ".wheel", ".ins"],
    languageDef: gensysLanguage,
    symbols: getGensysDocumentSymbols,
    hoverOffset: getGensysHover,
    validate: validateGensys,
    actionHandlers: createGensysActionHandlers({
      exportFmu: async (model, options) => {
        const { exportGensysFmu } = await import("@modelscript/exchange");
        return exportGensysFmu(
          model as Parameters<typeof exportGensysFmu>[0],
          options as Parameters<typeof exportGensysFmu>[1],
        );
      },
      simulateDae: simulateDaeHelper,
    }),
  });

  // 2. SIMPACK
  registerStandardPlugin({
    id: "simpack",
    name: "SIMPACK",
    extensions: [".spck", ".sim", ".mbs"],
    languageDef: simpackLanguage,
    symbols: getSimpackDocumentSymbols,
    hoverOffset: getSimpackHover,
    validate: validateSimpack,
    actionHandlers: createSimpackActionHandlers({
      exportFmu: async (model, options) => {
        const { exportSimpackFmu } = await import("@modelscript/exchange");
        return exportSimpackFmu(
          model as Parameters<typeof exportSimpackFmu>[0],
          options as Parameters<typeof exportSimpackFmu>[1],
        );
      },
      simulateDae: simulateDaeHelper,
    }),
  });

  // 3. Adams
  registerStandardPlugin({
    id: "adams",
    name: "MSC Adams",
    extensions: [".adm", ".cmd", ".acf"],
    languageDef: adamsLanguage,
    symbols: getAdamsDocumentSymbols,
    hoverOffset: getAdamsHover,
    validate: validateAdams,
    actionHandlers: createAdamsActionHandlers({ simulateDae: simulateDaeHelper }),
  });

  // 4. URDF
  registerStandardPlugin({
    id: "urdf",
    name: "ROS URDF & SDFormat",
    extensions: [".urdf", ".sdf", ".xacro"],
    languageDef: urdfLanguage,
    extractTheoryConstraints: extractUrdfTheoryConstraints,
    symbols: getUrdfDocumentSymbols,
    hoverOffset: getUrdfHover,
    validateWithTree: validateUrdf,
    actionHandlers: urdfActionHandlers,
    handlers: {
      "modelscript/getCadComponents": async (context: CadHandlerContext, params: CadHandlerParams) => {
        const text =
          params?.documentText ??
          params?.text ??
          context?.documentManager?.documents?.get?.(params?.uri ?? "")?.getText?.() ??
          "";
        if (typeof text !== "string" || !text.trim()) return [];
        const [{ parseUrdf, urdfToCadShapes }, cad] = await Promise.all([
          import("@modelscript/urdf"),
          import("@modelscript/cad"),
        ]);
        const shapes = urdfToCadShapes(parseUrdf(text));
        return shapes.map((s) => {
          const solid =
            s.type === "cylinder"
              ? cad.cylinder({ radius: Math.max(1e-4, s.dimensions.x / 2), height: Math.max(1e-4, s.dimensions.z) })
              : s.type === "sphere"
                ? cad.sphere({ radius: Math.max(1e-4, s.dimensions.x / 2) })
                : cad.box({
                    width: Math.max(1e-4, s.dimensions.x),
                    height: Math.max(1e-4, s.dimensions.y),
                    depth: Math.max(1e-4, s.dimensions.z),
                  });
          const mesh = cad.ManifoldWorker.evaluateSolid(solid);
          return {
            name: s.linkName,
            shapeType: s.type,
            cad: {
              uri: params?.uri ?? "urdf://robot",
              position: [s.origin.x, s.origin.y, s.origin.z] as [number, number, number],
            },
            proceduralMesh: {
              vertices: Array.from(mesh.vertices),
              indices: Array.from(mesh.indices),
              normals: Array.from(mesh.normals),
              ...(s.color
                ? { color: [s.color.r, s.color.g, s.color.b, s.color.a] as [number, number, number, number] }
                : {}),
            },
          };
        });
      },
    },
  });

  // 5. OpenDRIVE
  registerStandardPlugin({
    id: "opendrive",
    name: "ASAM OpenDRIVE",
    extensions: [".xodr", ".xml"],
    languageDef: opendriveLanguage,
    symbols: getOpenDriveDocumentSymbols,
    hoverOffset: getOpenDriveHover,
    validateWithTree: validateOpenDrive,
    actionHandlers: opendriveActionHandlers,
  });

  // 6. OpenSCENARIO
  registerStandardPlugin({
    id: "openscenario",
    name: "OpenSCENARIO",
    extensions: [".xosc", ".osc"],
    languageDef: openScenarioLanguage,
    symbols: getOpenScenarioDocumentSymbols,
    hoverPos: getOpenScenarioHover,
    validateWithTree: validateOpenScenario,
    actionHandlers: openscenarioActionHandlers,
  });

  // 7. AUTOSAR
  registerStandardPlugin({
    id: "autosar",
    name: "AUTOSAR Classic & Adaptive",
    extensions: [".arxml"],
    languageDef: autosarLanguage,
    symbols: getAutosarDocumentSymbols,
    hoverPos: getAutosarHover,
    validateWithTree: validateAutosar,
    actionHandlers: autosarActionHandlers,
  });

  // 8. SIMA
  registerStandardPlugin({
    id: "sima",
    name: "SIMA",
    extensions: [".inp", ".sima", ".sys", ".hyd"],
    languageDef: simaLanguage,
    symbols: getSimaDocumentSymbols,
    hoverPos: getSimaHover,
    validate: validateSima,
    actionHandlers: simaActionHandlers,
  });

  // 9. GT-SUITE
  registerStandardPlugin({
    id: "gtsuite",
    name: "GT-SUITE",
    extensions: [".gtm", ".gtd", ".gtx", ".gt"],
    languageDef: gtsuiteLanguage,
    symbols: getGtsuiteDocumentSymbols,
    hoverPos: getGtsuiteHover,
    validate: validateGtsuite,
    actionHandlers: gtsuiteActionHandlers,
  });

  // 10. GTFS (Public Transit Electrification & Traction)
  registerStandardPlugin({
    id: "gtfs",
    name: "GTFS",
    extensions: [".gtfs", ".gtfs.txt", ".gtfs-rt"],
    languageDef: gtfsLanguage,
    symbols: getGtfsDocumentSymbols,
    hoverPos: getGtfsHover,
    customHandlers: {
      validate: (doc: DocInput) => validateGtfs(docText(doc)),
    },
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of MULTIBODY_ROBOTICS_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
