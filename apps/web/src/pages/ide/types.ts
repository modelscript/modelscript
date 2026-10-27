// SPDX-License-Identifier: AGPL-3.0-or-later

export interface IdeArtifactMetadata {
  id: string | number;
  title: string;
  viewType: string;

  viewConfig: any;
}

export interface LspStatusState {
  status: string;
  message?: string | undefined;
}

export interface IdeWorkbenchInfo {
  folderHash: string;
  displayTitle: string;
  backUrl: string;
  branchName?: string | undefined;
  isDeprecated: boolean;
}
