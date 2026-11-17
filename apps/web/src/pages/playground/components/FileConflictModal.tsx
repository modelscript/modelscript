// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, FileIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export interface FileConflictModalProps {
  isOpen: boolean;
  templateTitle: string;
  existingFiles: Record<string, string>;
  incomingFiles: Record<string, string>;
  incomingActiveFile: string;
  onCancel: () => void;
  onConfirm: (renamedFiles: Record<string, string>, resolvedActiveFile: string) => void;
}

function normalizeFilePath(raw: string): string {
  return raw.trim().replace(/^\/+/, "");
}

function suggestUniqueFileName(originalName: string, occupied: Set<string>): string {
  const slashIdx = originalName.lastIndexOf("/");
  const dir = slashIdx >= 0 ? originalName.slice(0, slashIdx + 1) : "";
  const base = slashIdx >= 0 ? originalName.slice(slashIdx + 1) : originalName;
  const dotIdx = base.lastIndexOf(".");
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  const ext = dotIdx > 0 ? base.slice(dotIdx) : "";

  let counter = 2;
  while (true) {
    const candidate = `${dir}${stem}_${counter}${ext}`;
    if (!occupied.has(candidate)) {
      return candidate;
    }
    counter += 1;
  }
}

export const FileConflictModal: React.FC<FileConflictModalProps> = ({
  isOpen,
  templateTitle,
  existingFiles,
  incomingFiles,
  incomingActiveFile,
  onCancel,
  onConfirm,
}) => {
  const incomingEntries = useMemo(() => Object.entries(incomingFiles), [incomingFiles]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    const initial: Record<string, string> = {};
    for (const [fileName] of incomingEntries) {
      initial[fileName] = fileName;
    }
    setNameMap(initial);
  }, [isOpen, incomingEntries]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onCancel]);

  const validation = useMemo(() => {
    const normalizedByOrig: Record<string, string> = {};
    const counts = new Map<string, number>();

    for (const [origName] of incomingEntries) {
      const normalized = normalizeFilePath(nameMap[origName] ?? origName);
      normalizedByOrig[origName] = normalized;
      if (normalized) {
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    const errors: Record<string, string> = {};
    for (const [origName] of incomingEntries) {
      const normalized = normalizedByOrig[origName] ?? "";
      if (!normalized) {
        errors[origName] = "File name cannot be empty.";
      } else if (normalized in existingFiles) {
        errors[origName] = "Already exists in workspace.";
      } else if ((counts.get(normalized) ?? 0) > 1) {
        errors[origName] = "Duplicate name among added files.";
      }
    }

    const isValid = Object.keys(errors).length === 0 && incomingEntries.length > 0;
    return { normalizedByOrig, errors, isValid };
  }, [incomingEntries, nameMap, existingFiles]);

  if (!isOpen || typeof document === "undefined") return null;

  const handleAutoRename = () => {
    const occupied = new Set<string>(Object.keys(existingFiles));
    const nextMap: Record<string, string> = {};
    for (const [origName] of incomingEntries) {
      const current = normalizeFilePath(nameMap[origName] ?? origName);
      if (current && !occupied.has(current)) {
        nextMap[origName] = current;
        occupied.add(current);
      } else {
        const suggested = suggestUniqueFileName(origName, occupied);
        nextMap[origName] = suggested;
        occupied.add(suggested);
      }
    }
    setNameMap(nextMap);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.isValid) return;

    const renamedFiles: Record<string, string> = {};
    for (const [origName, content] of incomingEntries) {
      const finalName = validation.normalizedByOrig[origName] || origName;
      renamedFiles[finalName] = content;
    }
    const resolvedActive =
      validation.normalizedByOrig[incomingActiveFile] || Object.keys(renamedFiles)[0] || incomingActiveFile;

    onConfirm(renamedFiles, resolvedActive);
  };

  const conflictCount = Object.keys(validation.errors).length;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-conflict-modal-title"
      data-testid="file-conflict-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10010,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 12,
          backgroundColor: "var(--color-canvas-overlay, var(--color-canvas-default))",
          border: "1px solid var(--color-border-default)",
          boxShadow: "0 16px 48px rgba(0, 0, 0, 0.4)",
          color: "var(--color-fg-default)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-border-default)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--color-attention-subtle, rgba(187, 128, 9, 0.15))",
                color: "var(--color-attention-fg, #d29922)",
              }}
            >
              <AlertIcon size={15} />
            </span>
            <div>
              <h3 id="file-conflict-modal-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                File Name Conflict
              </h3>
              <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Adding &ldquo;{templateTitle}&rdquo;</div>
            </div>
          </div>
          <IconButton
            icon={XIcon}
            size="small"
            variant="invisible"
            aria-label="Cancel adding model"
            onClick={onCancel}
          />
        </div>

        {/* Body */}
        <div style={{ padding: "16px 18px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-fg-muted)", lineHeight: 1.5 }}>
            One or more files from <strong>{templateTitle}</strong> conflict with existing files in your workspace.
            Rename the newly added files below before adding them.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {incomingEntries.map(([origName]) => {
              const currentValue = nameMap[origName] ?? origName;
              const error = validation.errors[origName];
              return (
                <div
                  key={origName}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${
                      error ? "var(--color-danger-emphasis, #cf222e)" : "var(--color-border-default)"
                    }`,
                    backgroundColor: "var(--color-canvas-subtle, rgba(128, 128, 128, 0.05))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        color: "var(--color-fg-muted)",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    >
                      <FileIcon size={12} />
                      <span>Original: {origName}</span>
                    </span>
                    {error && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--color-danger-fg, #cf222e)",
                        }}
                      >
                        {error}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={currentValue}
                    onChange={(e) =>
                      setNameMap((prev) => ({
                        ...prev,
                        [origName]: e.target.value,
                      }))
                    }
                    aria-label={`New file name for ${origName}`}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12.5,
                      boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderTop: "1px solid var(--color-border-default)",
            gap: 8,
          }}
        >
          <Button
            type="button"
            size="small"
            variant="default"
            onClick={handleAutoRename}
            disabled={conflictCount === 0}
          >
            Auto-rename Conflicts
          </Button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Button type="button" size="small" variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="small" variant="primary" disabled={!validation.isValid}>
              Add to Workspace
            </Button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
};
