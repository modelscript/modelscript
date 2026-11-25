// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as vscode from "vscode";

export interface RemoteFileEntry {
  path: string;
  url: string;
  size?: number | undefined;
}

export interface IMemoryFileSystemProvider {
  writeFile(uri: vscode.Uri, content: Uint8Array): void;
  writeFiles?(entries: [vscode.Uri, Uint8Array][]): void;
  registerRemoteFiles?(workspaceUri: vscode.Uri, entries: RemoteFileEntry[]): void;
  clearDirectory?(workspaceUri: vscode.Uri): void;
  readDirectory?(uri: vscode.Uri): [string, vscode.FileType][] | Promise<[string, vscode.FileType][]>;
  delete?(uri: vscode.Uri, options?: { recursive?: boolean }): void | Promise<void>;
}

export interface ArtifactWorkspaceDescriptor {
  artifactId: string | number;
  title?: string | undefined;
  viewType?: string | undefined;
  viewConfig?: Record<string, unknown> | undefined;
  files?: Record<string, string> | undefined;
  remoteFiles?: RemoteFileEntry[] | undefined;
  primaryFile?: string | undefined;
  dependencies?: Array<{ name: string; version: string; [key: string]: unknown }> | undefined;
}

export interface GeneratedWorkspace {
  files: Record<string, string>;
  primaryFile: string;
}

export type CatalogTone = "teal" | "indigo" | "amber" | "emerald" | "rose" | "sky";

export interface LanguageGroupDescriptor {
  id: string;
  label: string;
  tone: CatalogTone;
}

export type LanguageMaturityTier = "beta" | "alpha" | "pre-alpha";

export interface LanguageTileDescriptor {
  id: string;
  name: string;
  badge: string;
  ext: string;
  group: string;
  tone: CatalogTone;
  tier: LanguageMaturityTier;
  role: string;
  summary: string;
  capabilities: string[];
  docsUrl: string;
  defaultTemplateId: string;
}

export interface ExampleWorkspaceDescriptor {
  id: string;
  languageId: string;
  title: string;
  summary: string;
  badge: string;
  tone: CatalogTone;
  ext: string;
  primaryFile: string;
  capabilities: string[];
  files: Record<string, string>;
}

// ── 15 Domain Categories (Matching Docs Site) ──────────────────────────────

export const LANGUAGE_GROUPS: LanguageGroupDescriptor[] = [
  { id: "core", label: "Core Systems & Architecture", tone: "teal" },
  { id: "geometry", label: "3D Geometry, FEA & CFD", tone: "indigo" },
  { id: "integration", label: "Embedded & Telemetry", tone: "sky" },
  { id: "aerospace", label: "Aerospace & Space Systems", tone: "amber" },
  { id: "automotive", label: "Automotive & Autonomy", tone: "emerald" },
  { id: "rail", label: "Rail & Multibody Dynamics", tone: "rose" },
  { id: "power", label: "Power Grids & Energy", tone: "amber" },
  { id: "oil-gas", label: "Oil, Gas & Subsurface", tone: "teal" },
  { id: "nuclear", label: "Nuclear Thermal-Hydraulics", tone: "rose" },
  { id: "marine", label: "Marine & Offshore", tone: "sky" },
  { id: "electronics", label: "Electronics, RF & Semiconductors", tone: "indigo" },
  { id: "robotics", label: "Robotics & Industrial Automation", tone: "emerald" },
  { id: "buildings", label: "Buildings, Water & Civil", tone: "teal" },
  { id: "process", label: "Chemical & Process Engineering", tone: "amber" },
  { id: "life-sciences", label: "Life Sciences, Healthcare & Medical", tone: "rose" },
];

export const STANDARD_CAPABILITIES = [
  "Syntax & Semantic Tokens",
  "WASM GLR Lints",
  "CodeLens",
  "Interactive Diagram",
  "Verification & Simulation",
];
