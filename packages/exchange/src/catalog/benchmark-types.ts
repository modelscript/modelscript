// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StdlibDomain } from "./types.js";

export type BenchmarkTier = "preview-to-beta" | "beta-to-stable" | "stable-hardening";

export type BenchmarkCategory =
  | "conformance"
  | "numerical-trajectory"
  | "syntax-corpus"
  | "stress-scale"
  | "component-library";

export interface BenchmarkUpstream {
  url: string;
  fallbackUrl?: string | undefined;
  mirrorUrls?: string[] | undefined;
  sha256?: string | undefined;
  archiveType?: "zip" | "tar.gz" | "directory" | "single-file" | undefined;
  extractSubpath?: string | undefined;
  sizeBytes?: number | undefined;
}

export interface BenchmarkParityMetric {
  targetMetric: "rmse" | "max-relative-error" | "ast-pass-rate" | "dae-parity";
  threshold: number;
  description: string;
}

export interface BenchmarkEntry {
  id: string;
  language: string;
  name: string;
  version: string;
  description: string;
  license: string;
  tier: BenchmarkTier;
  domain: StdlibDomain;
  category: BenchmarkCategory;
  filename: string;
  referenceTool: string;
  parityMetric: BenchmarkParityMetric;
  localSourcePath?: string | undefined;
  upstream?: BenchmarkUpstream | undefined;
  minExpectedCases?: number | undefined;
}

export interface BenchmarkCatalog {
  version: string;
  benchmarks: BenchmarkEntry[];
}
