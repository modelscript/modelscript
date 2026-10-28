// SPDX-License-Identifier: AGPL-3.0-or-later

import { GlobeIcon, PaintbrushIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { getUserTopics, updateUserTopic } from "../../../api";
import Box from "../../../components/Box";
import { useTheme } from "../../../theme";
import { DetailIcon, DetailItem, DetailSubtitle, DetailText, DetailTitle, FormLabel, Header } from "../settingsStyles";

export interface DisplayAndPreferencesTabProps {
  subView: "display" | "contentPreferences" | "other";
  onNavigate?: (tab: any) => void;
}

export const DisplayAndPreferencesTab: React.FC<DisplayAndPreferencesTabProps> = ({ subView }) => {
  const { theme, toggleTheme } = useTheme();
  const [topics, setTopics] = useState<any[]>([]);

  useEffect(() => {
    if (subView === "contentPreferences") {
      getUserTopics()
        .then((data) => setTopics(data))
        .catch(() => {});
    }
  }, [subView]);

  if (subView === "contentPreferences") {
    return (
      <>
        <Header>Content preferences</Header>
        <Box px={3} pb={3}>
          <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
            We dynamically discover topics you might be interested in. Uncheck the ones you no longer want to see. This
            helps us personalize your feed.
          </DetailSubtitle>
        </Box>
        <Box p={4}>
          {topics.length === 0 ? (
            <DetailSubtitle>
              No topics discovered yet. Keep interacting with posts to get recommendations!
            </DetailSubtitle>
          ) : (
            topics.map((t) => (
              <Box key={t.concept} display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Box>
                  <FormLabel style={{ display: "block", textTransform: "capitalize" }}>{t.concept}</FormLabel>
                  <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
                    Derived from your interactions and network.
                  </DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  checked={t.is_active}
                  onChange={async (e) => {
                    const val = e.target.checked;
                    setTopics(topics.map((top) => (top.concept === t.concept ? { ...top, is_active: val } : top)));
                    try {
                      await updateUserTopic(t.concept, val);
                    } catch {}
                  }}
                  style={{ width: "20px", height: "20px", cursor: "pointer" }}
                />
              </Box>
            ))
          )}
        </Box>
      </>
    );
  }

  if (subView === "other") {
    return (
      <>
        <Header>Help &amp; Additional Resources</Header>
        <Box px={4} pb={4} style={{ overflowY: "auto" }}>
          <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
            Explore comprehensive documentation, learn editor keyboard shortcuts, check federation status, and view
            open-source licensing terms.
          </DetailSubtitle>

          {/* Shortcuts Banner */}
          <Box
            mb={4}
            p={4}
            style={{
              background: "var(--gradient-cta, linear-gradient(135deg, #8b5cf6, #06b6d4))",
              borderRadius: "12px",
              color: "white",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <Box>
              <span style={{ fontSize: "18px", fontWeight: "800", display: "block" }}>
                ⌨️ Boost Productivity with Keyboard Shortcuts
              </span>
              <span style={{ fontSize: "13px", opacity: 0.9, marginTop: "4px", display: "block" }}>
                Navigate feeds, publish simulations, and format code with speed. Press{" "}
                <kbd style={{ background: "rgba(0,0,0,0.3)", padding: "2px 6px", borderRadius: "4px" }}>?</kbd> anytime
                to open the cheat sheet.
              </span>
            </Box>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("modelscript:open-shortcuts-modal"))}
              style={{
                background: "white",
                color: "#6b21a8",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                fontWeight: "700",
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              }}
            >
              View Shortcuts (Press ?)
            </button>
          </Box>

          {/* Documentation & Specifications Grid */}
          <Box mb={4}>
            <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
              Engineering Documentation &amp; Standards
            </DetailTitle>
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
              {[
                {
                  title: "ModelScript Language Reference",
                  desc: "Complete syntax guide for .msx and .mo Modelica models, physical connectors, and equation systems.",
                  link: "/packages",
                },
                {
                  title: "Modelica 3.5 Specification",
                  desc: "Official language specification for multi-domain equation-based physical modeling.",
                  link: "https://modelica.org/documents/ModelicaSpec35.pdf",
                  external: true,
                },
                {
                  title: "KerML & SysML v2 Interoperability",
                  desc: "Systems engineering ontology querying, KerML snapshot library, and metamodel verification.",
                  link: "/packages",
                },
                {
                  title: "FMI 2.0 & 3.0 Co-Simulation Toolkit",
                  desc: "Functional Mock-up Interface export, master algorithm orchestration, and SSP container tooling.",
                  link: "/packages",
                },
              ].map((doc, idx) => (
                <Box
                  key={idx}
                  p={3}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "10px",
                    background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: "700",
                      display: "block",
                      color: "var(--color-accent-purple, #a855f7)",
                    }}
                  >
                    {doc.title}
                  </span>
                  <DetailSubtitle style={{ display: "block", margin: "6px 0 12px 0", lineHeight: "1.4" }}>
                    {doc.desc}
                  </DetailSubtitle>
                  <a
                    href={doc.link}
                    target={doc.external ? "_blank" : undefined}
                    rel="noreferrer"
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "var(--color-accent-cyan, #06b6d4)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    Read Documentation &rarr;
                  </a>
                </Box>
              ))}
            </Box>
          </Box>

          {/* System & Federation Status */}
          <Box mb={4}>
            <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
              Instance Telemetry &amp; Protocol Compliance
            </DetailTitle>
            <Box
              p={3}
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "10px",
                background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
              }}
              display="flex"
              flexDirection="column"
              gap={2}
            >
              <Box display="flex" justifyContent="space-between" py={1}>
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Hub Instance Node</span>
                <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: "600" }}>
                  hub.modelscript.org
                </span>
              </Box>
              <Box
                display="flex"
                justifyContent="space-between"
                py={1}
                style={{ borderTop: "1px solid var(--color-border-subtle)" }}
              >
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>ActivityPub Protocol</span>
                <span style={{ fontSize: "13px", color: "var(--ms-success)", fontWeight: "600" }}>
                  RFC 9421 &amp; FEP-521a Ed25519 Active
                </span>
              </Box>
              <Box
                display="flex"
                justifyContent="space-between"
                py={1}
                style={{ borderTop: "1px solid var(--color-border-subtle)" }}
              >
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>HPC / SLURM Gateway</span>
                <span style={{ fontSize: "13px", color: "var(--ms-success)", fontWeight: "600" }}>
                  Connected &amp; Metered
                </span>
              </Box>
              <Box
                display="flex"
                justifyContent="space-between"
                py={1}
                style={{ borderTop: "1px solid var(--color-border-subtle)" }}
              >
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Software License</span>
                <span style={{ fontSize: "13px", fontWeight: "600" }}>GNU AGPL-3.0 (Copyleft)</span>
              </Box>
            </Box>
          </Box>
        </Box>
      </>
    );
  }

  return (
    <>
      <Header>Accessibility, display, and languages</Header>
      <Box px={3} pb={3}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
          Manage how ModelScript content is displayed to you and select your preferred language.
        </DetailSubtitle>
      </Box>
      <DetailItem>
        <DetailIcon>
          <PaintbrushIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Theme</DetailTitle>
          <DetailSubtitle>Choose how ModelScript looks on this device.</DetailSubtitle>
        </DetailText>
        <Box display="flex" gap={1}>
          {(["light", "dark"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className="ms-chip"
              aria-pressed={theme === mode}
              onClick={() => {
                if (theme !== mode) toggleTheme();
              }}
            >
              {mode === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </Box>
      </DetailItem>
      <DetailItem>
        <DetailIcon>
          <GlobeIcon size={20} />
        </DetailIcon>
        <DetailText>
          <DetailTitle>Language</DetailTitle>
          <DetailSubtitle>English (more languages coming soon)</DetailSubtitle>
        </DetailText>
      </DetailItem>
    </>
  );
};
