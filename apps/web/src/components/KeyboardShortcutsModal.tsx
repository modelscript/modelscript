// SPDX-License-Identifier: AGPL-3.0-or-later

import { Dialog, Text } from "@primer/react";
import React from "react";
import styled from "styled-components";
import { useFeatureFlag } from "../FeatureFlagContext.js";
import Box from "./Box";

const Kbd = styled.kbd`
  display: inline-block;
  padding: 3px 6px;
  font-family: var(--ms-font-mono, "SFMono-Regular", Consolas, monospace);
  font-size: 11px;
  line-height: 1;
  color: var(--ms-text-1, var(--color-text-primary));
  background-color: var(--ms-surface-hover);
  border: 1px solid var(--ms-border, var(--color-border-default));
  border-radius: 4px;
  box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.15);
  min-width: 18px;
  text-align: center;
`;

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUTS: ShortcutCategory[] = [
  {
    title: "Global Navigation",
    items: [
      { keys: ["Cmd / Ctrl", "K"], description: "Open Command Palette & quick switcher" },
      { keys: ["Cmd / Ctrl", "Shift", "D"], description: "Toggle Developer Mode toolbar / pill" },
      { keys: ["/"], description: "Focus search bar" },
      { keys: ["?"], description: "Open keyboard shortcuts help" },
      { keys: ["g", "h"], description: "Go to Home Feed" },
      { keys: ["g", "e"], description: "Go to Explore & Trending" },
      { keys: ["g", "n"], description: "Go to Notifications" },
      { keys: ["g", "b"], description: "Go to Bookmarks" },
      { keys: ["g", "f"], description: "Go to RSS Feeds" },
      { keys: ["g", "m"], description: "Go to Ansatz" },
      { keys: ["g", "p"], description: "Go to Ansatz (alias)" },
      { keys: ["g", "k"], description: "Go to Packages" },
      { keys: ["g", "r"], description: "Go to Repositories" },
      { keys: ["g", "i"], description: "Go to Studio" },
      { keys: ["g", "j"], description: "Go to Cloud Jobs & HPC Queue" },
      { keys: ["g", "s"], description: "Go to Settings" },
    ],
  },
  {
    title: "Social & Post Composer",
    items: [
      { keys: ["c"], description: "Open new post composer modal" },
      { keys: ["Ctrl", "Enter"], description: "Publish post (or Cmd+Enter on Mac)" },
      { keys: ["Esc"], description: "Close modal / active popup" },
    ],
  },
  {
    title: "Code Editor & Simulation",
    items: [
      { keys: ["Ctrl", "S"], description: "Save & verify model" },
      { keys: ["Ctrl", "F5"], description: "Execute numerical simulation" },
      { keys: ["F1"], description: "Open Monaco command palette" },
      { keys: ["Alt", "Shift", "F"], description: "Format Modelica code" },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  const hasCae = useFeatureFlag("cae_cloud_solver");
  const hasFeeds = useFeatureFlag(["feeds_page", "rss_feeds"]);
  const hasRepos = useFeatureFlag(["git_repositories", "repositories"]);

  const filteredShortcuts = React.useMemo(() => {
    return SHORTCUTS.map((category) => {
      if (category.title !== "Global Navigation") return category;
      return {
        ...category,
        items: category.items.filter(
          (item) =>
            (hasCae || !item.keys.includes("j")) &&
            (hasFeeds || !item.keys.includes("f")) &&
            (hasRepos || !item.keys.includes("r")),
        ),
      };
    });
  }, [hasCae, hasFeeds, hasRepos]);

  if (!isOpen) return null;

  return (
    <Dialog title="Keyboard Shortcuts" width="large" onClose={onClose}>
      <Box display="flex" flexDirection="column" gap={4} style={{ maxHeight: "70vh", overflowY: "auto" }}>
        {filteredShortcuts.map((category) => (
          <Box key={category.title}>
            <Text
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ms-brand)",
                marginBottom: "8px",
              }}
            >
              {category.title}
            </Text>
            <Box display="flex" flexDirection="column" gap={1}>
              {category.items.map((item, idx) => {
                const isSequentialChord = item.keys.length === 2 && item.keys[0] === "g";
                return (
                  <Box
                    key={idx}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    py={2}
                    style={{ borderBottom: "1px solid var(--ms-divider, var(--color-border))" }}
                  >
                    <Text style={{ fontSize: "13px", color: "var(--ms-text-1, var(--color-text-primary))" }}>
                      {item.description}
                    </Text>
                    <Box display="flex" alignItems="center" gap={1}>
                      {item.keys.map((k, kIdx) => (
                        <React.Fragment key={kIdx}>
                          <Kbd>{k}</Kbd>
                          {kIdx < item.keys.length - 1 && (
                            <Text
                              style={{
                                fontSize: "11px",
                                color: "var(--ms-text-3, var(--color-text-muted))",
                                padding: "0 2px",
                              }}
                            >
                              {isSequentialChord ? "then" : "+"}
                            </Text>
                          )}
                        </React.Fragment>
                      ))}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>
    </Dialog>
  );
};

export default KeyboardShortcutsModal;
