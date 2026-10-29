// SPDX-License-Identifier: AGPL-3.0-or-later

import { SearchIcon } from "@primer/octicons-react";
import React from "react";
import { AiSearchBar, SearchContainer } from "../styles";

export interface AiSearchHeaderProps {
  onOpenCommandPalette?: (() => void) | undefined;
}

export const AiSearchHeader: React.FC<AiSearchHeaderProps> = ({ onOpenCommandPalette }) => {
  const [isScrolled, setIsScrolled] = React.useState(() => typeof window !== "undefined" && window.scrollY > 4);

  React.useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 4;
      setIsScrolled((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || "");

  const handleClick = () => {
    if (onOpenCommandPalette) {
      onOpenCommandPalette();
    } else {
      window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"));
    }
  };

  return (
    <SearchContainer $scrolled={isScrolled}>
      <AiSearchBar
        role="button"
        tabIndex={0}
        aria-label="Ask AI Copilot, search models, or run CVODE solver"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        title={`Ask AI Copilot, search models, or run CVODE solver (${isMac ? "⌘K" : "Ctrl+K"})`}
      >
        <span className="sparkle">
          <SearchIcon size={14} />
        </span>
        <span className="text">Ask AI Copilot, search models...</span>
        <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>
      </AiSearchBar>
    </SearchContainer>
  );
};
