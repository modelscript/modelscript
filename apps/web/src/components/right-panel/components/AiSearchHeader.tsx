// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { AiSearchBar, SearchContainer } from "../styles";

export interface AiSearchHeaderProps {
  onOpenCommandPalette?: (() => void) | undefined;
}

export const AiSearchHeader: React.FC<AiSearchHeaderProps> = ({ onOpenCommandPalette }) => {
  const handleClick = () => {
    if (onOpenCommandPalette) {
      onOpenCommandPalette();
    } else {
      window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"));
    }
  };

  return (
    <SearchContainer>
      <AiSearchBar onClick={handleClick} title="Ask AI Copilot, search models, or run CVODE solver (⌘K)">
        <span className="sparkle">⚡</span>
        <span className="text">Ask AI Copilot, search models...</span>
        <kbd>⌘ K</kbd>
      </AiSearchBar>
    </SearchContainer>
  );
};
