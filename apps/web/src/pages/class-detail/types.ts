// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClassDetail, ClassSummary, JobStatus } from "../../api";
import type { ClassDomain, EnrichedComponent } from "../../components/classTreeUtils";

export type { ClassDetail, ClassDomain, ClassSummary, EnrichedComponent, JobStatus };

export type ClassTabId = "overview" | "parameters" | "equations" | "source";

export interface DigitalThreadTwinInfo {
  twinTarget: string | null;
  cadTarget: string | null;
}
