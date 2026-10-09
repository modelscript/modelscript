// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import type { SpatialPin } from "./artifacts/spatial-pin";

export interface ComposeInitialState {
  content?: string;
  artifactId?: number | null;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin;
  forkedFromArtifactId?: number | null;
  morselPayload?: {
    code: string;
    title?: string;
    dialect?: string;
  };
  packagePayload?: {
    name: string;
    version?: string;
    description?: string;
    license?: string;
    dialect?: string;
  };
  repoPayload?: {
    namespace: string;
    project: string;
    provider?: string;
    description?: string;
    defaultBranch?: string;
  };
}

export interface ComposeContextType {
  openCompose: (initial?: string | ComposeInitialState) => void;
}

export const ComposeContext = React.createContext<ComposeContextType>({
  openCompose: () => {},
});
