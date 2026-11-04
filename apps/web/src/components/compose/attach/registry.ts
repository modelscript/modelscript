// SPDX-License-Identifier: AGPL-3.0-or-later

import { fileExtension } from "./engine";
import type { AnyAttachProfile, AttachEditableView } from "./types";

const profiles = new Map<string, AnyAttachProfile>();

/** Register (or replace) a profile. Returns an unregister function, useful in tests. */
export function registerAttachProfile(profile: AnyAttachProfile): () => void {
  profiles.set(profile.id, profile);
  return () => {
    if (profiles.get(profile.id) === profile) profiles.delete(profile.id);
  };
}

export function getAttachProfile(id: string): AnyAttachProfile | undefined {
  return profiles.get(id);
}

export function listAttachProfiles(): AnyAttachProfile[] {
  return [...profiles.values()];
}

/**
 * Pick the profile for a file. Specific profiles win over the fallback; among specific
 * profiles an extension match must also pass `sniff` (when provided and a head is available).
 */
export function resolveAttachProfile(fileName: string, head?: string): AnyAttachProfile | undefined {
  const ext = fileExtension(fileName);
  let fallback: AnyAttachProfile | undefined;
  for (const profile of profiles.values()) {
    if (profile.fallback) {
      fallback = profile;
      continue;
    }
    if (!profile.match.extensions.includes(ext)) continue;
    if (head !== undefined && profile.match.sniff && !profile.match.sniff(head)) continue;
    return profile;
  }
  return fallback;
}

/** The file picker `accept` filter, derived from every registered profile (no duplicated lists). */
export function getAttachAcceptList(): string {
  const tokens = new Set<string>();
  for (const profile of profiles.values()) {
    for (const ext of profile.match.extensions) tokens.add(ext);
    for (const extra of profile.match.accept ?? []) tokens.add(extra);
  }
  return [...tokens].join(",");
}

/** The profile (if any) that can reopen the wizard on this existing artifact. */
export function findEditProfile(view: AttachEditableView): AnyAttachProfile | undefined {
  for (const profile of profiles.values()) {
    if (profile.edit?.matches(view)) return profile;
  }
  return undefined;
}

/** The profile (if any) that can derive a new artifact from this existing one. */
export function findDeriveProfile(view: AttachEditableView): AnyAttachProfile | undefined {
  for (const profile of profiles.values()) {
    if (profile.derive?.matches(view)) return profile;
  }
  return undefined;
}

/** Normalize a raw `getArtifactView` response into the shape profiles expect, or undefined if unusable. */
export function toEditableView(raw: unknown): AttachEditableView | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const view = (record["artifactView"] ?? record["artifact_view"] ?? record) as Record<string, unknown>;
  const type = String(view["view_type"] ?? view["artifact_type"] ?? "");
  let config = view["view_config"];
  if (typeof config === "string") {
    try {
      config = JSON.parse(config);
    } catch {
      return undefined;
    }
  }
  if (!type || !config || typeof config !== "object") return undefined;
  return {
    artifact_type: type,
    ...(typeof view["title"] === "string" ? { title: view["title"] } : {}),
    view_config: config as Record<string, unknown>,
  };
}
