// SPDX-License-Identifier: AGPL-3.0-or-later

export interface MlArenaRouteSpec {
  readonly to: string;
  readonly label: string;
  readonly iconKey: "arena" | "datasets" | "models" | "runs" | "memory" | "leaderboards";
  readonly matchPrefixes: readonly string[];
}

export const ML_ARENA_ROUTE_SPECS: readonly MlArenaRouteSpec[] = [
  { to: "/arena", label: "RLHF Arena", iconKey: "arena", matchPrefixes: ["/arena", "/annotate"] },
  { to: "/datasets", label: "Datasets & Recipes", iconKey: "datasets", matchPrefixes: ["/datasets", "/recipes"] },
  { to: "/models", label: "Model Hub", iconKey: "models", matchPrefixes: ["/models"] },
  { to: "/runs", label: "Training Runs", iconKey: "runs", matchPrefixes: ["/runs"] },
  { to: "/memory", label: "Vector Memory", iconKey: "memory", matchPrefixes: ["/memory"] },
  { to: "/leaderboards", label: "Leaderboards", iconKey: "leaderboards", matchPrefixes: ["/leaderboards"] },
];

export function isMlArenaPathname(pathname: string): boolean {
  return ML_ARENA_ROUTE_SPECS.some((spec) =>
    spec.matchPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}
