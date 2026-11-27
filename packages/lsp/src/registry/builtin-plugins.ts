// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ParserService } from "../services/parser-service.js";
import type { WorkspaceManager } from "../services/workspace-manager.js";
import { registerAerospaceControlsPlugins } from "./clusters/aerospace-controls-plugins.js";
import { registerBioChemMedicalPlugins } from "./clusters/bio-chem-medical-plugins.js";
import { registerCadContinuumPlugins } from "./clusters/cad-continuum-plugins.js";
import { registerFluidProcessNuclearPlugins } from "./clusters/fluid-process-nuclear-plugins.js";
import { registerMultibodyRoboticsPlugins } from "./clusters/multibody-robotics-plugins.js";
import { registerPowerElectronicsPlugins } from "./clusters/power-electronics-plugins.js";
import { registerSystemsScientificPlugins } from "./clusters/systems-scientific-plugins.js";
import { registerCoreLanguagePlugins } from "./core-plugins.js";
import { globalLanguageRegistry } from "./LanguageRegistry.js";
import { registerStandardPlugin } from "./standard-plugin.js";

export interface BuiltinPluginsOptions {
  workspaceManager: WorkspaceManager;
  parserService?: ParserService | undefined;
  connection?:
    | {
        console: {
          info: (msg: string) => void;
          warn: (msg: string) => void;
          error?: (msg: string) => void;
        };
      }
    | undefined;
}

const registeredDomainWorkspaces = new WeakSet<WorkspaceManager>();
const registeredHeritageWorkspaces = new WeakSet<WorkspaceManager>();

/**
 * Registers all built-in core and domain (non-heritage) language plugins and their
 * associated workspace indexes in `workspaceManager` and `globalLanguageRegistry`.
 *
 * Delegates to the 9 core plugins plus the 7 modular domain-cluster modules under
 * `./clusters/` so `builtin-plugins.ts` stays free of direct language package imports.
 *
 * Idempotent per `workspaceManager`: subsequent calls are a fast no-op because
 * registered plugins resolve `parser`, `facade`, and `queryEngine` via live getters.
 */
export function registerDomainLanguagePlugins(options: BuiltinPluginsOptions): void {
  const { workspaceManager, connection } = options;

  if (registeredDomainWorkspaces.has(workspaceManager)) {
    // Keep core workspaceIndex references in sync if initialized lazily after first registration
    for (const [id, wsKey] of [
      ["modelica", "modelica"],
      ["sysml2", "sysml2"],
      ["sysml", "sysml2"],
      ["owl2", "owl2"],
    ] as const) {
      const ws = workspaceManager.getWorkspaceIndex(wsKey);
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (ws && plugin && !plugin.workspaceIndex) {
        plugin.workspaceIndex = ws;
      }
    }
    return;
  }
  registeredDomainWorkspaces.add(workspaceManager);

  registerCoreLanguagePlugins(options);
  registerPowerElectronicsPlugins(workspaceManager);
  registerFluidProcessNuclearPlugins(workspaceManager);
  registerMultibodyRoboticsPlugins(workspaceManager);
  registerAerospaceControlsPlugins(workspaceManager);
  registerCadContinuumPlugins(workspaceManager);
  registerBioChemMedicalPlugins(workspaceManager);
  registerSystemsScientificPlugins(workspaceManager);

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const plugin of globalLanguageRegistry.getAllPlugins()) {
      if (plugin.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }

  if (connection) {
    connection.console.info("[lsp] All built-in domain language plugins registered successfully.");
  }
}

/**
 * Registers all built-in domain language plugins synchronously and dynamically loads
 * the 63 heritage 1960s–1980s engineering language & data-format plugins without
 * pulling `heritage-plugins.ts` into the static import graph of `builtin-plugins.ts`.
 *
 * Kept backward-compatible for `nodeServerMain.ts` and existing callers.
 */
export function registerBuiltinLanguagePlugins(options: BuiltinPluginsOptions): void {
  registerDomainLanguagePlugins(options);

  const { workspaceManager, connection } = options;
  if (registeredHeritageWorkspaces.has(workspaceManager)) {
    return;
  }
  registeredHeritageWorkspaces.add(workspaceManager);

  void import("./heritage-plugins.js")
    .then(({ registerHeritageLanguagePlugins }) => {
      registerHeritageLanguagePlugins(registerStandardPlugin, workspaceManager);
      if (connection) {
        connection.console.info("[lsp] Heritage language plugins registered successfully.");
      }
    })
    .catch((err: unknown) => {
      registeredHeritageWorkspaces.delete(workspaceManager);
      if (connection) {
        connection.console.warn(
          `[lsp] Failed to load heritage language plugins: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
}
