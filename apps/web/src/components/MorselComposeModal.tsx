// SPDX-License-Identifier: AGPL-3.0-or-later

import { ScreenFullIcon, ScreenNormalIcon, XIcon, ZapIcon } from "@primer/octicons-react";
import { Button, IconButton, Text } from "@primer/react";
import React, { useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { createArtifactView } from "../api";
import { MORSEL_LANGUAGES, getLanguageInfo } from "./morsel/constants";
import MorselEditor from "./morsel/Morsel";

const ModalBackdrop = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
`;

const ModalContent = styled.div<{ $isFullScreen: boolean }>`
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "12px")};
  width: ${(props) => (props.$isFullScreen ? "100vw" : "90vw")};
  height: ${(props) => (props.$isFullScreen ? "100vh" : "85vh")};
  max-width: ${(props) => (props.$isFullScreen ? "100vw" : "1400px")};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  transition: all 0.2s ease-in-out;
`;

const ModalHeader = styled.div`
  height: 48px;
  min-height: 48px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ModalBody = styled.div`
  flex: 1;
  width: 100%;
  position: relative;
  overflow: hidden;
`;

const ModalFooter = styled.div`
  height: 52px;
  min-height: 52px;
  background: var(--color-canvas-subtle, #161b22);
  border-top: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
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
  const [code, setCode] = useState(initialCode);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [dialect, setDialect] = useState<string>(initialDialect);

  if (!isOpen) return null;

  const handleDialectChange = (nextDialect: string) => {
    const prevLangInfo = getLanguageInfo(dialect);
    const nextLangInfo = getLanguageInfo(nextDialect);
    const trimmedCode = code.trim();
    const isDefaultTemplate =
      !trimmedCode ||
      trimmedCode === initialCode.trim() ||
      trimmedCode === prevLangInfo.defaultCode.trim() ||
      MORSEL_LANGUAGES.some((lang) => lang.defaultCode.trim() === trimmedCode);

    setDialect(nextDialect);
    if (isDefaultTemplate && nextLangInfo.defaultCode) {
      setCode(nextLangInfo.defaultCode);
    }
  };

  const handleAttach = async () => {
    const langInfo = getLanguageInfo(dialect);
    const defaultTitle = `${langInfo.label || langInfo.name} Model`;
    // Extract model / class / package / module name from code if possible
    const match = code.match(
      /(?:model|package|class|block|part\s+def|module|program|subroutine|Ontology|robot|System|Task)\s+([A-Za-z0-9_]+)/i,
    );
    const title = match ? match[1]! : defaultTitle;
    setAttaching(true);
    try {
      const created = await createArtifactView({
        artifact_type: dialect === "modelica" ? "modelica-diagram" : dialect,
        dialect,
        title: title || defaultTitle,
        view_config: JSON.stringify({ code, title, dialect }),
      });
      onAttach({
        id: created?.id,
        code,
        title,
        dialect,
      });
    } catch (err) {
      console.error("Failed to create Morsel artifact view:", err);
      onAttach({
        code,
        title,
        dialect,
      });
    } finally {
      setAttaching(false);
      onClose();
    }
  };

  const modal = (
    <ModalBackdrop onClick={onClose}>
      <ModalContent $isFullScreen={isFullScreen} onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <HeaderLeft>
            <Badge>⚡ Morsel Editor</Badge>
            <Text style={{ fontSize: "13px", fontWeight: "bold", color: "var(--color-fg-default)" }}>
              Construct Diagram & Simulation
            </Text>
            <DialectSelect
              value={dialect}
              onChange={(e) => handleDialectChange(e.target.value)}
              aria-label="Engineering language"
            >
              {MORSEL_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label || lang.name} (.{lang.ext})
                </option>
              ))}
            </DialectSelect>
          </HeaderLeft>

          <HeaderRight>
            <IconButton
              aria-label={isFullScreen ? "Exit Full Screen" : "Full Screen"}
              icon={isFullScreen ? ScreenNormalIcon : ScreenFullIcon}
              size="small"
              onClick={() => setIsFullScreen((prev) => !prev)}
            />
            <IconButton aria-label="Close Modal" icon={XIcon} size="small" onClick={onClose} />
          </HeaderRight>
        </ModalHeader>

        <ModalBody>
          <MorselEditor
            dataUrl={null}
            initialCode={code}
            initialDialect={dialect}
            onDialectChange={handleDialectChange}
            embed={true}
            onCodeChange={(newCode: string) => {
              setCode(newCode);
            }}
          />
        </ModalBody>

        <ModalFooter>
          <Text style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
            Live WASM compiling • Synchronized diagram & equations
          </Text>

          <div style={{ display: "flex", gap: "8px" }}>
            <Button size="small" variant="default" onClick={onClose} disabled={attaching}>
              Cancel
            </Button>
            <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handleAttach} disabled={attaching}>
              {attaching ? "Attaching..." : "Attach to Post"}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </ModalBackdrop>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
};

export default MorselComposeModal;
