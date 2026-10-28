// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import type { Express, RequestHandler, Router } from "express";
import { requireEnterpriseFeature } from "../license/middleware.js";

export interface EnterpriseTwinsRouters {
  optionalAuthMiddleware: RequestHandler;
  cosimFeatureGuard: RequestHandler;
  twinsFeatureGuard: RequestHandler;
  historianRouter: Router;
  instancesRouter: Router;
  twinsRouter: Router;
  cosimRouter?: Router | undefined;
  mqttParticipantsRouter?: Router | undefined;
}

/**
 * Mounts Enterprise Operational Digital Twins (`/api/v1/twins`), Hardware Asset Birth
 * Certificates (`/api/v1/instances`), Distributed MQTT/FMU Co-Simulation (`/api/v1/cosim`,
 * `/api/v1/mqtt/participants`), and the TimescaleDB Telemetry Historian (`/api/v1/historian`)
 * gated by the `digital_twins` license feature.
 */
export function mountEnterpriseTwinsAndHistorian(app: Express, routers: EnterpriseTwinsRouters): void {
  if (routers.cosimRouter) {
    app.use(
      "/api/v1/cosim",
      requireEnterpriseFeature("digital_twins"),
      routers.optionalAuthMiddleware,
      routers.cosimFeatureGuard,
      routers.cosimRouter,
    );
  }

  if (routers.mqttParticipantsRouter) {
    app.use(
      "/api/v1/mqtt/participants",
      requireEnterpriseFeature("digital_twins"),
      routers.optionalAuthMiddleware,
      routers.cosimFeatureGuard,
      routers.mqttParticipantsRouter,
    );
  }

  app.use(
    "/api/v1/historian",
    requireEnterpriseFeature("digital_twins"),
    routers.optionalAuthMiddleware,
    routers.cosimFeatureGuard,
    routers.historianRouter,
  );

  app.use(
    "/api/v1/instances",
    requireEnterpriseFeature("digital_twins"),
    routers.optionalAuthMiddleware,
    routers.twinsFeatureGuard,
    routers.instancesRouter,
  );

  app.use(
    "/api/v1/twins",
    requireEnterpriseFeature("digital_twins"),
    routers.optionalAuthMiddleware,
    routers.twinsFeatureGuard,
    routers.twinsRouter,
  );
}
