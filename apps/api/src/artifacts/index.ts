// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Artifact System — barrel export and initialization.
 *
 * Registers all built-in artifact handlers with the global ArtifactRegistry.
 * Import this module once at API startup to initialize the handler plugins.
 */

export { DatasetArtifactHandler } from "./dataset-handler.js";
export type { DatasetColumn, DatasetDetails } from "./dataset-handler.js";
export { FmuArtifactHandler } from "./fmu-handler.js";
export type { FmuDetails, FmuScalarVariable } from "./fmu-handler.js";
export { ArtifactRegistry, getArtifactRegistry } from "./registry.js";
export type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

import { DatasetArtifactHandler } from "./dataset-handler.js";
import { FmuArtifactHandler } from "./fmu-handler.js";
import { getArtifactRegistry } from "./registry.js";

/**
 * Initialize the artifact system by registering all built-in handlers.
 * Call this once during API startup.
 */
export function initializeArtifactSystem(): void {
  const registry = getArtifactRegistry();

  registry.register(new FmuArtifactHandler());
  registry.register(new DatasetArtifactHandler());

  console.log(
    `[ArtifactSystem] Initialized with ${registry.getRegisteredTypes().length} handlers: ${registry.getRegisteredTypes().join(", ")}`,
  );
}
