// SPDX-License-Identifier: AGPL-3.0-or-later

export type StdlibTier = "tier1_core" | "tier2_domain" | "tier3_ondemand";

export type StdlibDomain =
  | "systems-physics"
  | "power-energy"
  | "mobility-auto"
  | "fluids-process"
  | "cad-structures"
  | "life-sciences"
  | "general";

export type StdlibPackId =
  | "core"
  | "power-energy"
  | "mobility-auto"
  | "fluids-process"
  | "cad-structures"
  | "life-sciences"
  | "all";

export interface StdlibUpstream {
  url: string;
  fallbackUrl?: string | undefined;
  mirrorUrls?: string[] | undefined;
  sha256?: string | undefined;
  archiveType?: "zip" | "tar.gz" | "directory" | undefined;
  extractSubpath?: string | undefined;
  repack?: "none" | "sysml-library-only" | undefined;
}

export interface StdlibEntry {
  id: string;
  language: string;
  packageName: string;
  version: string;
  description: string;
  license: string;
  tier: StdlibTier;
  domain: StdlibDomain;
  pack: StdlibPackId;
  filename: string;
  localSourcePath?: string | undefined;
  upstream?: StdlibUpstream | undefined;
  minExpectedClasses?: number | undefined;
}

export interface StdlibCatalog {
  version: string;
  libraries: StdlibEntry[];
}
