// SPDX-License-Identifier: AGPL-3.0-or-later

import { XIcon } from "@primer/octicons-react";
import React, { useRef } from "react";
import styled from "styled-components";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import Box from "./Box";
import { CircleIconButton } from "./SharedStyles";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  padding: 16px;
`;

const ModalContent = styled.div`
  width: 100%;
  max-width: 640px;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--surface-overlay, rgba(18, 18, 28, 0.95));
  border: 1px solid var(--color-border-glass, rgba(255, 255, 255, 0.12));
  border-radius: 16px;
  box-shadow:
    0 20px 48px rgba(0, 0, 0, 0.5),
    0 0 24px rgba(139, 92, 246, 0.2);
  display: flex;
  flex-direction: column;
`;

const Kbd = styled.kbd`
  display: inline-block;
  padding: 3px 6px;
  font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace);
  font-size: 11px;
  line-height: 1;
  color: var(--color-text-primary, #ffffff);
  background-color: var(--ms-surface-hover, rgba(148, 163, 184, 0.12));
  border: 1px solid var(--color-border-default, rgba(148, 163, 184, 0.28));
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
      { keys: ["g", "p"], description: "Go to Playground" },
      { keys: ["g", "k"], description: "Go to Packages" },
      { keys: ["g", "r"], description: "Go to Repositories" },
      { keys: ["g", "i"], description: "Go to Web IDE" },
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
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });

  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <ModalContent
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <Box
          p={3}
          px={4}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          borderBottom="1px solid var(--color-border-subtle, rgba(255,255,255,0.08))"
        >
          <Box display="flex" alignItems="center" gap={2}>
            <span style={{ fontSize: "18px" }}>⌨️</span>
            <span style={{ fontSize: "16px", fontWeight: "700", color: "var(--color-text-primary)" }}>
              Keyboard Shortcuts
            </span>
          </Box>
          <CircleIconButton onClick={onClose} aria-label="Close dialog">
            <XIcon size={16} />
          </CircleIconButton>
        </Box>

        <Box p={4} display="flex" flexDirection="column" gap={4} style={{ overflowY: "auto" }}>
          {SHORTCUTS.map((category) => (
            <Box key={category.title}>
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: "700",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--color-accent-purple, #a855f7)",
                  marginBottom: "10px",
                }}
              >
                {category.title}
              </span>
              <Box display="flex" flexDirection="column" gap={2}>
                {category.items.map((item, idx) => {
                  const isSequentialChord = item.keys.length === 2 && item.keys[0] === "g";
                  return (
                    <Box
                      key={idx}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      py={1}
                      style={{ borderBottom: "1px solid var(--color-border-subtle, rgba(148, 163, 184, 0.12))" }}
                    >
                      <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{item.description}</span>
                      <Box display="flex" alignItems="center" gap={1}>
                        {item.keys.map((k, kIdx) => (
                          <React.Fragment key={kIdx}>
                            <Kbd>{k}</Kbd>
                            {kIdx < item.keys.length - 1 && (
                              <span style={{ fontSize: "11px", color: "var(--color-text-muted)", padding: "0 2px" }}>
                                {isSequentialChord ? "then" : "+"}
                              </span>
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
      </ModalContent>
    </Overlay>
  );
};

export default KeyboardShortcutsModal;
