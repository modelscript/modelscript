// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface ComposeContextType {
  openCompose: (initialContent?: string) => void;
}

export const ComposeContext = React.createContext<ComposeContextType>({
  openCompose: () => {},
});
