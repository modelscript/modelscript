// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelscript";
import { PlusIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";
import type { Translations } from "~/util/i18n";
import { ModelPreview } from "./preview";

export interface ModelData {
  id: string;
  name: string;
  content: string;
  lastModified?: number;
}

interface SplashProps {
  onClose: () => void;
  onSelect: (model: ModelData) => void;
  onClearRecent: () => void;
  recentModels: ModelData[];
  exampleModels: ModelData[];
  context: Context | null;
  colorMode?: string;
  translations: Translations;
}

export const Splash: React.FC<SplashProps> = ({
  onClose,
  onSelect,
  onClearRecent,
  recentModels,
  exampleModels,
  context,
  colorMode = "light",
  translations,
}) => {
  const isDark = colorMode.includes("night") || colorMode.includes("dark");
  const bgColor = isDark ? "rgba(13, 17, 23, 0.5)" : "rgba(255, 255, 255, 0.5)";
  const textColor = isDark ? "#e6edf3" : "#1f2328";
  const secondaryColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)";
  const hoverColor = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: bgColor,
        backdropFilter: "blur(12px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "40px 20px",
        overflowY: "auto",
        color: textColor,
      }}
    >
      <div style={{ position: "absolute", top: 20, right: 20 }}>
        <IconButton
          icon={XIcon}
          variant="invisible"
          aria-label={translations.close}
          onClick={onClose}
          style={{ color: textColor }}
        />
      </div>

      <div style={{ maxWidth: 1000, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 32, marginBottom: 40, fontWeight: 700 }}>{translations.newModelTitle}</h1>

        <section style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, margin: 0, opacity: 0.6, fontWeight: 600 }}>{translations.recentModels}</h2>
            {recentModels.length > 0 && (
              <IconButton
                icon={TrashIcon}
                size="small"
                variant="invisible"
                aria-label={translations.clearRecent}
                onClick={onClearRecent}
                style={{ color: textColor, opacity: 0.5 }}
                title={translations.clearRecent}
              />
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 20,
            }}
          >
            <div
              onClick={() => onSelect({ id: "new", name: "New Model", content: "model Example\n\nend Example;" })}
              style={{
                backgroundColor: secondaryColor,
                borderRadius: 12,
                padding: 16,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                transition: "background-color 0.2s, transform 0.2s",
                border: `1px dashed ${borderColor}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = hoverColor;
                e.currentTarget.style.transform = "translateY(-4px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = secondaryColor;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 120,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: secondaryColor,
                  borderRadius: 8,
                }}
              >
                <span style={{ opacity: 0.5, display: "flex", color: textColor }}>
                  <PlusIcon size={32} />
                </span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{translations.createNew}</span>
            </div>

            {recentModels.map((model: ModelData) => (
              <ModelGridItem key={model.id} model={model} onSelect={onSelect} context={context} colorMode={colorMode} />
            ))}
          </div>
        </section>

        <div style={{ height: 2, backgroundColor: borderColor, marginBottom: 48, opacity: 0.5 }} />

        <section>
          <h2 style={{ fontSize: 20, marginBottom: 20, opacity: 0.6, fontWeight: 600 }}>
            {translations.exampleModels}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 20,
            }}
          >
            {exampleModels.map((model: ModelData) => (
              <ModelGridItem key={model.id} model={model} onSelect={onSelect} context={context} colorMode={colorMode} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

const ModelGridItem: React.FC<{
  model: ModelData;
  onSelect: (model: ModelData) => void;
  context: Context | null;
  colorMode: string;
}> = ({ model, onSelect, context, colorMode }) => {
  const isDark = colorMode.includes("night") || colorMode.includes("dark");
  const textColor = isDark ? "#e6edf3" : "#1f2328";
  const secondaryColor = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.03)";
  const hoverColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)";
  const borderColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.05)";

  return (
    <div
      onClick={() => onSelect(model)}
      style={{
        backgroundColor: secondaryColor,
        borderRadius: 12,
        padding: 16,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        transition: "background-color 0.2s, transform 0.2s",
        border: `1px solid ${borderColor}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoverColor;
        e.currentTarget.style.transform = "translateY(-4px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = secondaryColor;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <ModelPreview content={model.content} context={context} />
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width: "100%",
          color: textColor,
        }}
        title={model.name}
      >
        {model.name}
      </span>
    </div>
  );
};
