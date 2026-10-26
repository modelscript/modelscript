// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CpuIcon,
  DatabaseIcon,
  FileCodeIcon,
  GlobeIcon,
  PackageIcon as OcticonPackageIcon,
  WorkflowIcon,
} from "@primer/octicons-react";
import React from "react";

export interface DomainOption {
  id: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number | undefined }>;
}

export const DOMAIN_OPTIONS: DomainOption[] = [
  { id: "all", label: "All Domains", color: "#06b6d4", icon: GlobeIcon },
  { id: "modelica", label: "Modelica", color: "#eab308", icon: FileCodeIcon },
  { id: "sysml2", label: "SysML v2", color: "#a855f7", icon: WorkflowIcon },
  { id: "cad", label: "3D CAD", color: "#06b6d4", icon: OcticonPackageIcon },
  { id: "fmu", label: "FMU", color: "#f43f5e", icon: CpuIcon },
  { id: "dataset", label: "Datasets", color: "#3b82f6", icon: DatabaseIcon },
];

export function formatDomainLabel(domain: string): string {
  switch (domain) {
    case "modelica":
      return "Modelica";
    case "sysml2":
      return "SysML v2";
    case "cad":
      return "3D CAD";
    case "fmu":
      return "FMU";
    case "dataset":
      return "Dataset";
    default:
      return domain;
  }
}

export function formatTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return "updated today";
    if (days === 1) return "updated yesterday";
    if (days < 30) return `updated ${days}d ago`;
    if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`;
    return `updated ${Math.floor(days / 365)}y ago`;
  } catch {
    return "";
  }
}
