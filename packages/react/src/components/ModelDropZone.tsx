// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useState } from "react";

export interface ModelDropZoneProps {
  accept?: string[];
  onDrop: (file: File, content: string | ArrayBuffer) => void;
  className?: string;
  children?: React.ReactNode;
}

export function ModelDropZone({
  accept = [".slx", ".mdl", ".mo", ".raw", ".pscx"],
  onDrop,
  className,
  children,
}: ModelDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const processFile = useCallback(
    (file: File) => {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (accept.length > 0 && !accept.includes(ext)) {
        console.warn(`File extension ${ext} not accepted. Expected: ${accept.join(", ")}`);
      }

      const reader = new FileReader();
      // Binary files vs text files
      const isBinary = [".slx", ".fmu", ".zip", ".stp", ".step"].includes(ext);
      if (isBinary) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }

      reader.onload = () => {
        if (reader.result) {
          onDrop(file, reader.result);
        }
      };
    },
    [accept, onDrop],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]!);
      }
    },
    [processFile],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFile(e.target.files[0]!);
      }
    },
    [processFile],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={className}
      style={{
        border: `2px dashed ${isDragOver ? "var(--color-accent-emphasis, #8b5cf6)" : "var(--color-border-default, #334155)"}`,
        borderRadius: "12px",
        padding: "32px 24px",
        textAlign: "center",
        backgroundColor: isDragOver
          ? "rgba(139, 92, 246, 0.08)"
          : "var(--color-canvas-subtle, rgba(255, 255, 255, 0.02))",
        transition: "all 0.2s ease",
        cursor: "pointer",
        position: "relative",
      }}
    >
      <input
        type="file"
        accept={accept.join(",")}
        onChange={handleFileInput}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
        }}
      />
      {children || (
        <div>
          <div
            style={{
              fontSize: "28px",
              marginBottom: "12px",
              color: "var(--color-accent-emphasis, #8b5cf6)",
            }}
          >
            📂
          </div>
          <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>
            Drop your engineering model here, or click to browse
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--color-fg-muted, #94a3b8)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            Supported: {accept.join("  ")}
          </div>
        </div>
      )}
    </div>
  );
}
