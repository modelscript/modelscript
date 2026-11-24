// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from "express";
import { optionalAuth } from "../middleware/auth-middleware.js";
import { buildDiagramForUri, validateDiagramUri } from "../services/diagram-synthesis.js";

export {
  buildDiagramForUri,
  parseModelicaSourceToDiagram,
  validateDiagramUri,
  type DiagramDataPayload,
  type DiagramEdgeLabelSpec,
  type DiagramEdgeSpec,
  type DiagramMarkupSpec,
  type DiagramNodeSpec,
  type DiagramPortalMetadata,
  type DiagramPortSpec,
  type EmbeddedPortalKind,
  type UriValidationResult,
} from "../services/diagram-synthesis.js";

export interface DiagramRouterOptions {
  /** Optional root directory for resolving safe workspace `.mo` source files. */
  workspaceRoot?: string | undefined;
}

/**
 * REST API for polyglot schematic diagram hydration (`/api/v1/diagram`).
 * Hydrates `SpatialCanvasPage`, `SpaceCanvasTab`, and `LiveUnifiedSchematicTile`
 * with domain `DiagramData` (`nodes` & `edges`) and embedded 3D portal metadata.
 */
export function diagramRouter(options?: DiagramRouterOptions): Router {
  const router = Router();
  router.use(optionalAuth);

  /** Hydrate schematic `DiagramData` for a workspace or canonical polyglot artifact URI */
  router.get("/", (req, res) => {
    const rawUri = req.query["uri"];
    const validation = validateDiagramUri(rawUri);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const diagramData = buildDiagramForUri(validation.uri, options?.workspaceRoot);
    res.json({
      uri: validation.uri,
      diagramData,
    });
  });

  return router;
}
