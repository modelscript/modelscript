// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClusterStatus } from "../../api";

export type { ClusterStatus };

export interface ScriptTemplate {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
}

export interface ScriptTemplateConfig {
  solver?: string | undefined;
  estimatedDuration?: string | undefined;
  steps?: unknown[] | undefined;
  computeProfile?: string | undefined;
  partitions?: string[] | undefined;
}

export interface UnifiedJobItem {
  id: string | number;
  name: string;
  status: "RUNNING" | "QUEUED" | "SUCCESS" | "FAILED" | "CANCELLED" | string;
  domain: string;
  solver: string;
  profile: string;
  progress: number;
  costCredits?: number | undefined;
  started_at: string;
  completed_at?: string | null | undefined;
  metadata?: string | null | undefined;
}
