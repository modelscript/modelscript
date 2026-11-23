// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeFilletedOrthogonalPath,
  computeJumpoverPath,
  computeSmoothBezierPath,
  portOrthogonalRouter,
  type JumpoverOptions,
  type JumpoverSegment,
  type PointLike,
} from "./port-router.js";

export interface RegisterableGraphClass {
  registerRouter?: ((name: string, router: unknown, force?: boolean) => void) | undefined;
  registerConnector?:
    | ((
        name: string,
        connector: (
          sourcePoint: PointLike,
          targetPoint: PointLike,
          routePoints: PointLike[],
          args: Record<string, unknown>,
          edgeView?: JumpoverEdgeViewLike,
        ) => string,
        force?: boolean,
      ) => void)
    | undefined;
}

export interface JumpoverEdgeLike {
  id?: string | undefined;
  findView?: ((graph: unknown) => { routePoints?: PointLike[] } | null | undefined) | undefined;
  getVertices?: (() => PointLike[]) | undefined;
  getSourcePoint?: (() => PointLike) | undefined;
  source?: PointLike | undefined;
  getTargetPoint?: (() => PointLike) | undefined;
  target?: PointLike | undefined;
  getConnector?: (() => string | { name?: string }) | undefined;
  connector?: string | { name?: string } | undefined;
}

export interface JumpoverNodeLike {
  id?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  getPosition?: (() => PointLike | undefined) | undefined;
  getSize?: (() => { width?: number; height?: number } | undefined) | undefined;
}

export interface JumpoverEdgeViewLike {
  graph?:
    | {
        getEdges?: (() => JumpoverEdgeLike[]) | undefined;
        getNodes?: (() => JumpoverNodeLike[]) | undefined;
      }
    | undefined;
  cell?: { id?: string | undefined } | undefined;
}

/**
 * Registers ModelScript's built-in schematic router (`port-orthogonal-astar`) and
 * connectors (`jumpover`, `smooth`, `bezier`, `fillet`) on the active `UnifiedGraph` class.
 */
export function registerDefaultDiagramConnectorsAndRouters(graphClass: RegisterableGraphClass): void {
  if (typeof graphClass.registerRouter === "function") {
    try {
      graphClass.registerRouter("port-orthogonal-astar", portOrthogonalRouter, true);
    } catch {
      // Already registered in HMR
    }
  }

  if (typeof graphClass.registerConnector !== "function") return;

  try {
    graphClass.registerConnector(
      "jumpover",
      (
        sourcePoint: PointLike,
        targetPoint: PointLike,
        routePoints: PointLike[] = [],
        args: Record<string, unknown> = {},
        edgeView?: JumpoverEdgeViewLike,
      ) => {
        const jArgs = args as JumpoverOptions;
        const points = [sourcePoint, ...routePoints, targetPoint];
        const obstacles: JumpoverSegment[] = [];
        const solderDots: PointLike[] = [];

        if (edgeView?.graph && typeof edgeView.graph.getEdges === "function") {
          const currentEdgeId = edgeView.cell?.id;
          const allEdges = edgeView.graph.getEdges();

          if (typeof edgeView.graph.getNodes === "function") {
            for (const n of edgeView.graph.getNodes()) {
              if (typeof n.id === "string" && n.id.startsWith("solder_dot_")) {
                const pos = typeof n.getPosition === "function" ? n.getPosition() : { x: n.x, y: n.y };
                const size = typeof n.getSize === "function" ? n.getSize() : { width: 3, height: 3 };
                if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
                  solderDots.push({
                    x: pos.x + (size?.width ?? 3) / 2,
                    y: pos.y + (size?.height ?? 3) / 2,
                  });
                }
              }
            }
          }

          for (const edge of allEdges) {
            if (edge.id === currentEdgeId) continue;

            const otherView = typeof edge.findView === "function" ? edge.findView(edgeView.graph) : null;
            const otherRoute = otherView?.routePoints;
            const otherVertices =
              otherRoute && otherRoute.length > 0
                ? otherRoute
                : typeof edge.getVertices === "function"
                  ? edge.getVertices()
                  : [];
            const otherSrc = typeof edge.getSourcePoint === "function" ? edge.getSourcePoint() : edge.source;
            const otherTgt = typeof edge.getTargetPoint === "function" ? edge.getTargetPoint() : edge.target;

            if (otherSrc && otherTgt && typeof otherSrc.x === "number" && typeof otherTgt.x === "number") {
              const otherConnector = typeof edge.getConnector === "function" ? edge.getConnector() : edge.connector;
              const otherConnectorName = typeof otherConnector === "string" ? otherConnector : otherConnector?.name;
              const hasJumpover = otherConnectorName === "jumpover";

              const otherPoints: PointLike[] = [otherSrc, ...otherVertices, otherTgt];
              for (let j = 0; j < otherPoints.length - 1; j++) {
                obstacles.push({
                  p1: otherPoints[j]!,
                  p2: otherPoints[j + 1]!,
                  edgeId: edge.id,
                  hasJumpover,
                });
              }
            }
          }
        }

        return computeJumpoverPath(points, obstacles, {
          radius: jArgs.radius ?? 5,
          axis: jArgs.axis ?? "both",
          horizontalHop: jArgs.horizontalHop ?? "up",
          verticalHop: jArgs.verticalHop ?? "right",
          edgeId: edgeView?.cell?.id,
          solderDots,
        });
      },
      true,
    );
  } catch {
    // Already registered in HMR
  }

  try {
    graphClass.registerConnector(
      "smooth",
      (sourcePoint: PointLike, targetPoint: PointLike, routePoints: PointLike[] = []) =>
        computeSmoothBezierPath([sourcePoint, ...routePoints, targetPoint]),
      true,
    );
  } catch {
    // Already registered in HMR
  }

  try {
    graphClass.registerConnector(
      "bezier",
      (sourcePoint: PointLike, targetPoint: PointLike, routePoints: PointLike[] = []) =>
        computeSmoothBezierPath([sourcePoint, ...routePoints, targetPoint]),
      true,
    );
  } catch {
    // Already registered in HMR
  }

  try {
    graphClass.registerConnector(
      "fillet",
      (
        sourcePoint: PointLike,
        targetPoint: PointLike,
        routePoints: PointLike[] = [],
        args: Record<string, unknown> = {},
      ) =>
        computeFilletedOrthogonalPath(
          [sourcePoint, ...routePoints, targetPoint],
          typeof args["radius"] === "number" ? args["radius"] : 5,
        ),
      true,
    );
  } catch {
    // Already registered in HMR
  }
}
