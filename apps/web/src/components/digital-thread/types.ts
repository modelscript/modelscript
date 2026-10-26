// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArtifactViewerInfo, ClassDetail, ClassSummary } from "../../api";
import type { DigitalThreadMetrics, DigitalThreadTwin, DomainType } from "../../util/digitalThread";

export type { DigitalThreadMetrics, DigitalThreadTwin, DomainType };

export interface DigitalThreadExplorerProps {
  packageName: string;
  packageVersion: string;
  classes?: ClassSummary[] | undefined;
  rootClass?: ClassDetail | null | undefined;
  artifactViewers?: ArtifactViewerInfo[] | undefined;
  onNavigateToArtifact?: ((artifactPath: string) => void) | undefined;
  onNavigateToClass?: ((className: string) => void) | undefined;
}
