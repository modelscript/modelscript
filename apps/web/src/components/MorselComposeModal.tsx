// SPDX-License-Identifier: AGPL-3.0-or-later

import { LinkExternalIcon, ScreenFullIcon, ScreenNormalIcon, ZapIcon } from "@primer/octicons-react";
import { Button, Dialog, IconButton, Text } from "@primer/react";
import React, { useState } from "react";
import styled from "styled-components";
import { createArtifactView } from "../api";
import { HERO_EXAMPLES } from "../pages/playground/constants";
import { getLanguageInfo, useVisibleMorselLanguages } from "./morsel/constants";
import MorselEditor from "./morsel/Morsel";
import { compressMorselPayload } from "./morsel/util/permalink";

const ModalBody = styled.div<{ $isFullScreen: boolean }>`
  flex: 1;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "76vh" : "62vh")};
  min-height: 420px;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--ms-border-subtle, var(--color-border-default));
  border-radius: 8px;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.12);
  color: var(--color-accent-cyan, #06b6d4);
  border: 1px solid rgba(6, 182, 212, 0.25);
  font-weight: 600;
`;

const DialectSelect = styled.select`
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  border-radius: 6px;
  border: 1px solid var(--color-border-default, #30363d);
  background: var(--color-canvas-default, #0d1117);
  color: var(--color-fg-default, #f0f6fc);
  outline: none;
  cursor: pointer;
`;

interface MorselComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttach: (artifact: { id?: number | undefined; code: string; title: string; dialect: string }) => void;
  initialCode?: string | undefined;
  initialDialect?: string | undefined;
}

export const MorselComposeModal: React.FC<MorselComposeModalProps> = ({
  isOpen,
  onClose,
  onAttach,
  initialCode = `model MySystem "Interactive Physical System"
  parameter Real k = 100.0 "Spring constant [N/m]";
  parameter Real m = 1.0 "Mass [kg]";
  parameter Real d = 1.5 "Damping [N.s/m]";
  
  Real x(start = 1.0, fixed = true) "Displacement";
  Real v(start = 0.0, fixed = true) "Velocity";
equation
  der(x) = v;
  m * der(v) = -k * x - d * v;
  
  annotation(experiment(StopTime = 5.0, StepSize = 0.01));
end MySystem;`,
  initialDialect = "modelica",
}) => {
  const visibleMorselLanguages = useVisibleMorselLanguages();
  const [code, setCode] = useState(initialCode);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [dialect, setDialect] = useState<string>(initialDialect);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [modelTitle, setModelTitle] = useState(() => {
    const match = initialCode.match(
      /(?:model|package|class|block|part\s+def|module|program|subroutine|Ontology|robot|System|Task)\s+([A-Za-z0-9_]+)/i,
    );
    return match ? match[1]! : "MySystem";
  });

  if (!isOpen) return null;

  const handleDialectChange = (nextDialect: string) => {
    const prevLangInfo = getLanguageInfo(dialect);
    const nextLangInfo = getLanguageInfo(nextDialect);
    const trimmedCode = code.trim();
    const isDefaultTemplate =
      !trimmedCode ||
      trimmedCode === initialCode.trim() ||
      trimmedCode === prevLangInfo.defaultCode.trim() ||
      visibleMorselLanguages.some((lang) => lang.defaultCode.trim() === trimmedCode);

    setDialect(nextDialect);
    setAttachError(null);
    if (isDefaultTemplate && nextLangInfo.defaultCode) {
      setCode(nextLangInfo.defaultCode);
      const match = nextLangInfo.defaultCode.match(
        /(?:model|package|class|block|part\s+def|module|program|subroutine|Ontology|robot|System|Task)\s+([A-Za-z0-9_]+)/i,
      );
      if (match) setModelTitle(match[1]!);
    }
  };

  const handleAttach = async () => {
    const langInfo = getLanguageInfo(dialect);
    const finalTitle = modelTitle.trim() || `${langInfo.label || langInfo.name} Model`;
    setAttaching(true);
    setAttachError(null);
    try {
      const created = await createArtifactView({
        artifact_type: dialect === "modelica" ? "modelica-diagram" : dialect,
        dialect,
        title: finalTitle,
        view_config: JSON.stringify({ code, title: finalTitle, dialect }),
      });
      if (!created?.id) {
        throw new Error("Failed to create model artifact: missing artifact ID.");
      }
      onAttach({
        id: created.id,
        code,
        title: finalTitle,
        dialect,
      });
      onClose();
    } catch (err: any) {
      console.error("Failed to create model artifact view:", err);
      const errMsg =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save model artifact. Please check your connection and try again.";
      setAttachError(errMsg);
    } finally {
      setAttaching(false);
    }
  };

  const handleOpenInFullMorsel = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: dialect,
      code,
      title: modelTitle.trim() || "Model",
    });
    window.open(`/morsel#m=${hash}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog
      title={
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Badge>⚡ Morsel</Badge>
          <span>Interactive Model Workbench</span>
        </div>
      }
      width="xlarge"
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <input
              type="text"
              value={modelTitle}
              onChange={(e) => setModelTitle(e.target.value)}
              placeholder="Model title…"
              aria-label="Model title"
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--color-fg-default, #f0f6fc)",
                background: "var(--ms-surface-subtle, var(--color-canvas-default, #0d1117))",
                border: "1px solid var(--ms-border-default, var(--color-border-default, #30363d))",
                borderRadius: "6px",
                padding: "4px 8px",
                minWidth: "140px",
                maxWidth: "200px",
                outline: "none",
              }}
            />
            <DialectSelect
              value={dialect}
              onChange={(e) => handleDialectChange(e.target.value)}
              aria-label="Engineering language"
            >
              {visibleMorselLanguages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label || lang.name} (.{lang.ext})
                </option>
              ))}
            </DialectSelect>
            <DialectSelect
              defaultValue=""
              onChange={(e) => {
                const ex = HERO_EXAMPLES.find((x) => x.id === e.target.value);
                if (ex) {
                  setCode(ex.code);
                  setModelTitle(ex.title);
                  if (ex.lang && ex.lang !== dialect) {
                    setDialect(ex.lang);
                  }
                }
              }}
              aria-label="Starter template"
            >
              <option value="" disabled>
                Template…
              </option>
              {HERO_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} ({ex.category})
                </option>
              ))}
            </DialectSelect>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <IconButton
              aria-label="Open in full Morsel workbench"
              icon={LinkExternalIcon}
              size="small"
              onClick={handleOpenInFullMorsel}
              title="Open in full Morsel workbench"
            />
            <IconButton
              aria-label={isFullScreen ? "Exit Full Screen" : "Full Screen"}
              icon={isFullScreen ? ScreenNormalIcon : ScreenFullIcon}
              size="small"
              onClick={() => setIsFullScreen((prev) => !prev)}
            />
          </div>
        </div>

        <ModalBody $isFullScreen={isFullScreen}>
          <MorselEditor
            dataUrl={null}
            initialCode={code}
            initialDialect={dialect}
            onDialectChange={handleDialectChange}
            embed={false}
            hideFloatingDock={true}
            onCodeChange={(newCode: string) => {
              setCode(newCode);
            }}
          />
        </ModalBody>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: "8px",
            borderTop: "1px solid var(--ms-border-subtle, var(--color-border-default))",
          }}
        >
          {attachError ? (
            <Text role="alert" style={{ fontSize: "12px", color: "var(--color-danger-fg, #f85149)", fontWeight: 600 }}>
              {attachError}
            </Text>
          ) : (
            <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
              Live WASM compiling • Synchronized diagram & equations
            </Text>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="small" variant="default" onClick={onClose} disabled={attaching}>
              Cancel
            </Button>
            <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handleAttach} disabled={attaching}>
              {attaching ? "Attaching..." : "Attach to Post"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default MorselComposeModal;
