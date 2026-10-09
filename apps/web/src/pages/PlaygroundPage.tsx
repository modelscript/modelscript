// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, CopyIcon, DownloadIcon, FileIcon, SearchIcon, ShareIcon, ZapIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Dialog, IconButton } from "@primer/react";
import React, { useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { ComposeContext } from "../components/ComposeContext";
import MorselEditor from "../components/morsel/Morsel";
import { compressMorselPayload, decompressMorselPayload } from "../components/morsel/util/permalink";
import { useToast } from "../components/ToastContext";
import { useTheme } from "../theme";
import { usePageTitle } from "../util/title";

const PlaygroundContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background-color: var(--color-canvas-default, #0d1117);
  overflow: hidden;
  position: relative;
`;

const PlaygroundNavbar = styled.header`
  height: 48px;
  min-height: 48px;
  background-color: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 12px;
  z-index: 20;
  box-sizing: border-box;
`;

const NavLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const NavRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const BrandLink = styled(Link)`
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--color-fg-default);
  font-weight: 600;
  font-size: 14px;

  &:hover {
    text-decoration: none;
  }
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

const EditorArea = styled.main`
  flex: 1;
  width: 100%;
  height: calc(100vh - 48px);
  position: relative;
  overflow: hidden;
`;

const HERO_EXAMPLES: { id: string; name: string; lang: "modelica" | "sysml2" | "owl2"; code: string }[] = [
  {
    id: "bouncing-ball",
    name: "Bouncing Ball (Physics / Hybrid DAE)",
    lang: "modelica",
    code: `model BouncingBall "Classic hybrid physics simulation with impact restitution"
  parameter Real g = 9.81 "Gravity acceleration";
  parameter Real c = 0.85 "Restitution coefficient";
  parameter Real radius = 0.1 "Ball radius";
  Real h(start = 1.0, fixed = true) "Height of ball center";
  Real v(start = 0.0, fixed = true) "Velocity";
equation
  der(h) = v;
  der(v) = -g;

  when h <= radius and v < 0 then
    reinit(v, -c * v);
  end when;
  
  annotation(experiment(StopTime = 3.0, StepSize = 0.005));
end BouncingBall;`,
  },
  {
    id: "rlc-filter",
    name: "RLC Low-Pass Filter (Analog Electronics)",
    lang: "modelica",
    code: `model RLCFilter "Second-order resonant circuit"
  parameter Real R = 10.0 "Resistor [Ohm]";
  parameter Real L = 0.01 "Inductor [H]";
  parameter Real C = 0.001 "Capacitor [F]";
  parameter Real V_in = 5.0 "Step input voltage [V]";
  
  Real v_c(start = 0.0, fixed = true) "Capacitor voltage";
  Real i_l(start = 0.0, fixed = true) "Inductor current";
equation
  der(v_c) = i_l / C;
  der(i_l) = (V_in - v_c - R * i_l) / L;
  
  annotation(experiment(StopTime = 0.1, StepSize = 0.0001));
end RLCFilter;`,
  },
  {
    id: "chua-circuit",
    name: "Chua Chaotic Oscillator (Nonlinear Dynamics)",
    lang: "modelica",
    code: `model ChuaCircuit "Double-scroll chaotic attractor circuit"
  parameter Real a = 15.6;
  parameter Real b = 28.0;
  parameter Real m0 = -1.143;
  parameter Real m1 = -0.714;
  
  Real x(start = 0.1, fixed = true);
  Real y(start = 0.0, fixed = true);
  Real z(start = 0.0, fixed = true);
  Real g;
equation
  g = m1 * x + 0.5 * (m0 - m1) * (abs(x + 1) - abs(x - 1));
  der(x) = a * (y - x - g);
  der(y) = x - y + z;
  der(z) = -b * y;

  annotation(experiment(StopTime = 50.0, StepSize = 0.01));
end ChuaCircuit;`,
  },
  {
    id: "sysml2-powertrain",
    name: "SysML v2 Electric Vehicle Powertrain",
    lang: "sysml2",
    code: `package ElectricVehicleArchitecture {
  part def BatterySubsystem {
    port powerOut: HighVoltagePort;
  }

  part def InverterSubsystem {
    port dcIn: HighVoltagePort;
    port acOut: ThreePhasePort;
  }

  part def TractionMotor {
    port acIn: ThreePhasePort;
    port torqueOut: MechanicalShaftPort;
  }

  part evPowertrain {
    part battery: BatterySubsystem;
    part inverter: InverterSubsystem;
    part motor: TractionMotor;

    connection b2i connect battery.powerOut to inverter.dcIn;
    connection i2m connect inverter.acOut to motor.acIn;
  }
}`,
  },
];

export const PlaygroundPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme } = useTheme();
  const { openCompose } = useContext(ComposeContext);
  const toast = useToast();

  const modelParam = searchParams.get("model");
  const sourceParam = searchParams.get("source");
  const fromArtifactParam = searchParams.get("fromArtifact");

  const [currentCode, setCurrentCode] = useState<string>(HERO_EXAMPLES[0].code);
  const [currentTitle, setCurrentTitle] = useState<string>(HERO_EXAMPLES[0].name);
  usePageTitle(currentTitle ? `${currentTitle} — Playground` : "Playground");
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  // Initialize from URL hash or query params on load
  useEffect(() => {
    if (location.hash && location.hash.length > 1) {
      const payload = decompressMorselPayload(location.hash);
      if (payload && payload.code) {
        setCurrentCode(payload.code);
        if (payload.title) setCurrentTitle(payload.title);
      }
    } else if (sourceParam) {
      const decodedSource = decodeURIComponent(sourceParam);
      const title = searchParams.get("title") ? decodeURIComponent(searchParams.get("title")!) : "Custom Model";
      setCurrentCode(decodedSource);
      setCurrentTitle(title);
      const hash = compressMorselPayload({
        v: 1,
        lang: "modelica",
        code: decodedSource,
        title,
      });
      window.history.replaceState(null, "", `#m=${hash}`);
    } else if (modelParam) {
      const match = HERO_EXAMPLES.find(
        (ex) =>
          ex.id.toLowerCase() === modelParam.toLowerCase() || ex.name.toLowerCase().includes(modelParam.toLowerCase()),
      );
      if (match) {
        setCurrentCode(match.code);
        setCurrentTitle(match.name);
        const hash = compressMorselPayload({
          v: 1,
          lang: match.lang,
          code: match.code,
          title: match.name,
        });
        window.history.replaceState(null, "", `#m=${hash}`);
      } else {
        const sanitized = modelParam.split(".").pop() || modelParam;
        const code = `// Parameterized model handoff: ${modelParam}\nmodel ${sanitized} "${modelParam} simulation"\n  Real x(start = 1.0) "State variable";\n  Real y(start = 0.0) "Coupled variable";\nequation\n  der(x) = -y;\n  der(y) = x;\nend ${sanitized};\n`;
        setCurrentCode(code);
        setCurrentTitle(sanitized);
        const hash = compressMorselPayload({
          v: 1,
          lang: "modelica",
          code,
          title: sanitized,
        });
        window.history.replaceState(null, "", `#m=${hash}`);
      }
    }
  }, [location.hash, modelParam, sourceParam, searchParams]);

  useEffect(() => {
    const handleOpenShare = () => setShareModalOpen(true);
    window.addEventListener("modelscript:open-share-modal", handleOpenShare);
    return () => window.removeEventListener("modelscript:open-share-modal", handleOpenShare);
  }, []);

  const handleSelectExample = (ex: (typeof HERO_EXAMPLES)[number]) => {
    setCurrentCode(ex.code);
    setCurrentTitle(ex.name);
    const hash = compressMorselPayload({
      v: 1,
      lang: ex.lang,
      code: ex.code,
      title: ex.name,
    });
    window.history.replaceState(null, "", `#m=${hash}`);
  };

  const getShareUrl = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "modelica",
      code: currentCode,
      title: currentTitle,
    });
    return `${window.location.origin}/playground#m=${hash}`;
  };

  const getEmbedCode = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "modelica",
      code: currentCode,
      title: currentTitle,
    });
    return `<iframe src="${window.location.origin}/embed/playground#m=${hash}" width="100%" height="600" frameborder="0" allow="clipboard-write"></iframe>`;
  };

  const getMarkdownBadge = () => {
    const url = getShareUrl();
    return `[![Open in ModelScript Playground](https://img.shields.io/badge/ModelScript-Playground-06b6d4?style=flat&logo=atom)](${url})`;
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
      toast.success(`${label} copied to clipboard!`);
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      toast.error(`Failed to copy ${label}`);
    }
  };

  const handlePublishToFeed = () => {
    const fromArtifactId = fromArtifactParam ? Number(fromArtifactParam) : null;
    if (openCompose) {
      openCompose({
        content: `Check out my simulation model: **${currentTitle}**! 🚀`,
        morselPayload: {
          code: currentCode,
          title: currentTitle,
          dialect: "modelica",
        },
        forkedFromArtifactId: fromArtifactId,
      });
    } else {
      navigate("/home");
    }
  };

  const handleDownloadModel = () => {
    const blob = new Blob([currentCode], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentTitle.replace(/[^a-zA-Z0-9_-]/g, "_") || "model"}.mo`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PlaygroundContainer>
      <PlaygroundNavbar>
        <NavLeft>
          <BrandLink to={user ? "/home" : "/explore"}>
            <img
              src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
              alt="ModelScript"
              width="24"
              height="24"
            />
            <span>ModelScript</span>
          </BrandLink>
          <Badge>⚡ Playground</Badge>

          {fromArtifactParam && (
            <Link
              to={`/feed?artifact=${fromArtifactParam}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                fontFamily: "var(--font-mono, monospace)",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(245, 158, 11, 0.15)",
                color: "#f59e0b",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                textDecoration: "none",
                fontWeight: 600,
              }}
              title={`Forked from Artifact #${fromArtifactParam}`}
            >
              ⚡ Fork of #{fromArtifactParam}
            </Link>
          )}

          {/* Preset Example Picker */}
          <ActionMenu>
            <ActionMenu.Button size="small">
              <span>{currentTitle}</span>
            </ActionMenu.Button>
            <ActionMenu.Overlay width="large">
              <ActionList>
                <ActionList.Group title="Curated Starter Models">
                  {HERO_EXAMPLES.map((ex) => (
                    <ActionList.Item key={ex.id} onSelect={() => handleSelectExample(ex)}>
                      <ActionList.LeadingVisual>
                        <FileIcon />
                      </ActionList.LeadingVisual>
                      {ex.name}
                    </ActionList.Item>
                  ))}
                </ActionList.Group>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </NavLeft>

        <NavRight>
          {/* Global Search / Command Palette */}
          <Button
            size="small"
            variant="invisible"
            leadingVisual={SearchIcon}
            onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-command-palette"))}
            title="Search models, packages & commands (Cmd+K)"
          >
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
              ⌘K
            </span>
          </Button>

          {/* Export Menu */}
          <ActionMenu>
            <ActionMenu.Button size="small" leadingVisual={DownloadIcon}>
              Export
            </ActionMenu.Button>
            <ActionMenu.Overlay>
              <ActionList>
                <ActionList.Item onSelect={handleDownloadModel}>
                  <ActionList.LeadingVisual>
                    <DownloadIcon />
                  </ActionList.LeadingVisual>
                  Download Model (.mo)
                </ActionList.Item>
                <ActionList.Item
                  onSelect={() => {
                    handleCopy(getEmbedCode(), "Embed Code");
                  }}
                >
                  <ActionList.LeadingVisual>
                    <CodeIcon />
                  </ActionList.LeadingVisual>
                  Copy Embed Widget (HTML)
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>

          {/* Share Button */}
          <Button size="small" variant="default" leadingVisual={ShareIcon} onClick={() => setShareModalOpen(true)}>
            Share
          </Button>

          {/* Publish / Open in IDE */}
          {user ? (
            <Button size="small" variant="primary" leadingVisual={ZapIcon} onClick={handlePublishToFeed}>
              Post to Feed
            </Button>
          ) : (
            <div style={{ display: "flex", gap: "6px" }}>
              <Link to="/login" style={{ textDecoration: "none" }}>
                <Button size="small" variant="default">
                  Sign In
                </Button>
              </Link>
              <Link to="/signup" style={{ textDecoration: "none" }}>
                <Button size="small" variant="primary">
                  Sign Up
                </Button>
              </Link>
            </div>
          )}
        </NavRight>
      </PlaygroundNavbar>

      <EditorArea>
        <MorselEditor
          dataUrl={null}
          initialCode={currentCode}
          embed={false}
          onCodeChange={(code: string) => {
            setCurrentCode(code);
          }}
        />
      </EditorArea>

      {/* Share & Embed Modal */}
      {isShareModalOpen && (
        <Dialog
          title="Share Interactive Model"
          onClose={() => setShareModalOpen(false)}
          footerButtons={[
            {
              buttonType: "primary",
              content: copyStatus ? `✓ Copied ${copyStatus}!` : "Copy Direct Link",
              onClick: () => handleCopy(getShareUrl(), "Link"),
            },
            {
              buttonType: "normal",
              content: "Done",
              onClick: () => setShareModalOpen(false),
            },
          ]}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--color-fg-muted)", margin: 0, lineHeight: 1.5 }}>
              Share this self-contained cyber-physical model. The entire code, diagram layout, and simulation settings
              are encoded directly into the URL—anyone with the link can run and edit it immediately without creating an
              account.
            </p>

            <div>
              <p
                style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}
              >
                Direct Shareable Link
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  background: "var(--color-canvas-subtle)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {getShareUrl()}
                </div>
                <IconButton
                  aria-label="Copy Link"
                  icon={CopyIcon}
                  size="small"
                  onClick={() => handleCopy(getShareUrl(), "Link")}
                />
              </div>
            </div>

            <div>
              <p
                style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}
              >
                Embed Widget (for Substack, Notion, blogs, docs)
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  background: "var(--color-canvas-subtle)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {getEmbedCode()}
                </div>
                <IconButton
                  aria-label="Copy Embed Code"
                  icon={CopyIcon}
                  size="small"
                  onClick={() => handleCopy(getEmbedCode(), "Embed Code")}
                />
              </div>
            </div>

            <div>
              <p
                style={{ fontSize: "12px", fontWeight: "bold", margin: "0 0 6px 0", color: "var(--color-fg-default)" }}
              >
                Markdown Badge (for GitHub READMEs)
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  background: "var(--color-canvas-subtle)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "12px",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {getMarkdownBadge()}
                </div>
                <IconButton
                  aria-label="Copy Markdown Badge"
                  icon={CopyIcon}
                  size="small"
                  onClick={() => handleCopy(getMarkdownBadge(), "Markdown Badge")}
                />
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </PlaygroundContainer>
  );
};

export default PlaygroundPage;
