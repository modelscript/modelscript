// SPDX-License-Identifier: AGPL-3.0-or-later

import { WorkflowIcon, XIcon } from "@primer/octicons-react";
import type { editor } from "monaco-editor";
import React from "react";

export interface StarterGalleryViewProps {
  starterExamples: ReadonlyArray<Record<string, unknown>>;
  colorMode: "dark" | "light";
  onDismiss: () => void;
  onLoadStarterExample?:
    ((code: string, title?: string, files?: Record<string, string>, activeFile?: string) => void) | undefined;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
}

export const StarterGalleryView: React.FC<StarterGalleryViewProps> = ({
  starterExamples,
  colorMode,
  onDismiss,
  onLoadStarterExample,
  editorRef,
}) => {
  const handleSelectExample = (ex: Record<string, unknown>) => {
    onDismiss();
    const exFiles =
      ex["files"] && typeof ex["files"] === "object" ? (ex["files"] as Record<string, string>) : undefined;
    const exActiveFile = typeof ex["activeFile"] === "string" ? ex["activeFile"] : undefined;
    const exCode = typeof ex["code"] === "string" ? ex["code"] : "";
    const exTitle = typeof ex["title"] === "string" ? ex["title"] : undefined;
    if (onLoadStarterExample) {
      onLoadStarterExample(exCode, exTitle, exFiles, exActiveFile);
    } else if (editorRef.current) {
      editorRef.current.setValue(exCode);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Design your physical system"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        maxWidth: "460px",
        width: "calc(100% - 48px)",
        padding: "28px 24px 22px 24px",
        borderRadius: "16px",
        background: "var(--ms-surface-glass)",
        border: "1px solid var(--borderColor-default, var(--ms-border))",
        backdropFilter: "blur(20px)",
        boxShadow:
          colorMode === "dark"
            ? "0 20px 48px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)"
            : "0 20px 48px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
        pointerEvents: "auto",
        zIndex: 10,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Close Button */}
      <button
        type="button"
        aria-label="Close"
        title="Close (Esc)"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          width: 28,
          height: 28,
          borderRadius: "6px",
          border: "none",
          background: "transparent",
          color: "var(--color-fg-muted, #8b949e)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background 0.15s ease, color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colorMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)";
          e.currentTarget.style.color = "var(--color-fg-default, #c9d1d9)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--color-fg-muted, #8b949e)";
        }}
      >
        <XIcon size={16} />
      </button>

      {/* Icon Badge */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
          background:
            colorMode === "dark"
              ? "linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.15) 100%)"
              : "linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)",
          border: colorMode === "dark" ? "1px solid rgba(6, 182, 212, 0.3)" : "1px solid rgba(6, 182, 212, 0.25)",
          boxShadow: "0 4px 16px rgba(6, 182, 212, 0.15)",
          color: "var(--color-accent-cyan, #06b6d4)",
        }}
      >
        <WorkflowIcon size={24} />
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: "17px",
          fontWeight: 700,
          color: "var(--color-fg-default)",
          letterSpacing: "-0.01em",
          marginBottom: 8,
        }}
      >
        Design your physical system
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: "13px",
          color: "var(--color-fg-muted)",
          lineHeight: 1.5,
          marginBottom: 20,
          maxWidth: "380px",
        }}
      >
        Drag components from the library on the left, or kickstart with a curated multi-physics model:
      </div>

      {/* Curated Starters */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginBottom: 16 }}>
        {starterExamples.map((ex, idx) => (
          <button
            key={typeof ex.id === "string" || typeof ex.id === "number" ? ex.id : idx}
            type="button"
            onClick={() => handleSelectExample(ex)}
            onDoubleClick={() => handleSelectExample(ex)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid var(--borderColor-default, var(--ms-border))",
              background: "var(--bgColor-muted, var(--ms-bg-elv))",
              color: "var(--fgColor-default, var(--ms-text-1))",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s ease",
              width: "100%",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--ms-brand, var(--color-accent-fg))";
              e.currentTarget.style.background =
                colorMode === "dark" ? "rgba(33, 38, 45, 0.9)" : "rgba(255, 255, 255, 1)";
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow =
                colorMode === "dark" ? "0 4px 12px rgba(0, 0, 0, 0.3)" : "0 4px 12px rgba(0, 0, 0, 0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor =
                colorMode === "dark" ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.9)";
              e.currentTarget.style.background =
                colorMode === "dark" ? "var(--bgColor-muted, var(--ms-bg-elv))" : "rgba(246, 248, 250, 0.8)";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "16px", lineHeight: 1 }}>
                {ex.category === "Electrical"
                  ? "⚡"
                  : ex.category === "Mechanics"
                    ? "⚙️"
                    : ex.category === "Nonlinear Dynamics"
                      ? "🌀"
                      : ex.category === "SysML v2"
                        ? "📐"
                        : "🚀"}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{typeof ex.title === "string" ? ex.title : ""}</span>
            </div>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                padding: "2px 8px",
                borderRadius: "12px",
                background: "var(--ms-brand-soft, rgba(8, 145, 178, 0.12))",
                color: "var(--ms-brand, var(--color-accent-fg))",
              }}
            >
              {typeof ex.category === "string" ? ex.category : ""}
            </span>
          </button>
        ))}
      </div>

      {/* Footer Helper */}
      <div
        style={{
          fontSize: "11px",
          color: "var(--color-fg-muted)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          opacity: 0.85,
        }}
      >
        <span>
          Click canvas or press{" "}
          <kbd
            style={{
              padding: "1px 5px",
              fontSize: "10px",
              borderRadius: "4px",
              background: "var(--ms-surface-hover, var(--color-canvas-subtle))",
              border: "1px solid var(--ms-border, var(--color-border-default))",
              fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace",
            }}
          >
            Esc
          </kbd>{" "}
          to start with a blank canvas
        </span>
      </div>
    </div>
  );
};
