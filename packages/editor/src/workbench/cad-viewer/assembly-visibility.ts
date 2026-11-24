// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared Assembly Visibility, Subsystem Isolation, and Ghost-Shell state resolver.
 *
 * Used identically across Non-VR CAD viewers (`CadViewer`, `CadStepViewer`,
 * `InstancedCadAssembly`) and the VR Engineering Rotunda (`ShowcaseAssemblies`,
 * `OctopusShowcaseAssembly`, `FloatingToolWings`).
 */

import type { SubsystemDefinition } from "@modelscript/cad";

export interface SubsystemSummary extends SubsystemDefinition {
  readonly partCount: number;
}

export interface AssemblyVisibilityState {
  /** When non-null, solos the matching subsystem (dimming or hiding all other parts). */
  readonly isolatedSubsystemId: string | null;
  /** Explicitly hidden subsystem IDs. */
  readonly hiddenSubsystems: readonly string[];
  /** Explicitly ghosted subsystem IDs (rendered translucent for internal mechanism inspection). */
  readonly ghostedSubsystems: readonly string[];
  /** Convenience toggle that ghosts all subsystems marked `defaultGhostable: true` (e.g. outer mantle). */
  readonly ghostShellEnabled: boolean;
  /** Whether 3D callout labels (`CalloutLabels3D`) are displayed. */
  readonly showLabels: boolean;
  /** Whether turntable auto-rotation is enabled. */
  readonly autoTurntable: boolean;
  /** Normalized explode slider factor (`0..1`). */
  readonly explodeFactor: number;
  /** Radial centroid vs hierarchy/joint-axis explode mode. */
  readonly explodeMode: "radial" | "hierarchical";
}

export interface ResolvedPartPresentation {
  readonly visible: boolean;
  readonly ghosted: boolean;
  readonly opacity: number;
  readonly highlighted: boolean;
}

export function createDefaultAssemblyVisibility(overrides?: Partial<AssemblyVisibilityState>): AssemblyVisibilityState {
  return {
    isolatedSubsystemId: null,
    hiddenSubsystems: [],
    ghostedSubsystems: [],
    ghostShellEnabled: false,
    showLabels: false,
    autoTurntable: false,
    explodeFactor: 0,
    explodeMode: "hierarchical",
    ...overrides,
  };
}

/**
 * Pure presentation resolver for any part belonging to `subsystemId`.
 * Guarantees consistent isolate, hide, and ghost-shell semantics in both Desktop and VR.
 */
export function resolvePartPresentation(
  subsystemId: string,
  visibility: AssemblyVisibilityState,
  opts?: {
    isDefaultGhostable?: boolean | undefined;
    ghostNonIsolated?: boolean | undefined;
    ghostOpacity?: number | undefined;
  },
): ResolvedPartPresentation {
  const ghostOpacity = opts?.ghostOpacity ?? 0.16;

  if (visibility.hiddenSubsystems.includes(subsystemId)) {
    return { visible: false, ghosted: false, opacity: 0, highlighted: false };
  }

  if (visibility.isolatedSubsystemId !== null) {
    if (visibility.isolatedSubsystemId === subsystemId) {
      return { visible: true, ghosted: false, opacity: 1, highlighted: true };
    }
    if (opts?.ghostNonIsolated) {
      return { visible: true, ghosted: true, opacity: ghostOpacity * 0.75, highlighted: false };
    }
    return { visible: false, ghosted: false, opacity: 0, highlighted: false };
  }

  const isGhosted =
    visibility.ghostedSubsystems.includes(subsystemId) ||
    (visibility.ghostShellEnabled && Boolean(opts?.isDefaultGhostable));

  if (isGhosted) {
    return { visible: true, ghosted: true, opacity: ghostOpacity, highlighted: false };
  }

  return { visible: true, ghosted: false, opacity: 1, highlighted: false };
}

/**
 * Infers lightweight subsystem groupings for arbitrary CAD part lists that lack explicit
 * `subsystemId` metadata (e.g., STEP assemblies or Modelica annotations).
 */
export function inferSubsystemsFromPartNames(
  parts: readonly { readonly name: string; readonly subsystemId?: string | undefined }[],
): SubsystemSummary[] {
  const counts = new Map<string, number>();
  for (const p of parts) {
    let key = p.subsystemId;
    if (!key) {
      const lower = p.name.toLowerCase();
      if (/(optic|camera|eye|sensor|lidar)/.test(lower)) key = "optic";
      else if (/(mantle|shell|housing|nacelle|casing|cover|frame|chassis)/.test(lower)) key = "shell";
      else if (/(pump|motor|rotor|gear|piston|drive|actuator)/.test(lower)) key = "powertrain";
      else if (/(arm|link|joint|tentacle|wheel|sucker|finger|leg)/.test(lower)) key = "manipulators";
      else if (/(siphon|nozzle|jet|duct|valve|pipe|inlet|outlet)/.test(lower)) key = "fluidics";
      else {
        const prefix = p.name.split(/[._/-]/)[0];
        key = prefix && prefix.length > 1 ? prefix.toLowerCase() : "general";
      }
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const palette = ["#f97316", "#38bdf8", "#10b981", "#a855f7", "#eab308", "#ec4899"];
  const summaries: SubsystemSummary[] = [];
  let idx = 0;
  for (const [id, partCount] of counts) {
    summaries.push({
      id,
      code: String(idx + 1).padStart(2, "0"),
      label: id.replace(/[-_]+/g, " ").toUpperCase(),
      partCount,
      accentColor: palette[idx % palette.length],
      defaultGhostable: id === "shell" || id === "mantle",
    });
    idx++;
  }
  return summaries;
}
