// SPDX-License-Identifier: AGPL-3.0-or-later

import { GlobeIcon, PaintbrushIcon } from "@primer/octicons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserTopics, updateUserTopic } from "../../../api";
import { useCapabilities } from "../../../CapabilitiesContext";
import Box from "../../../components/Box";
import { useLanguageEnabled } from "../../../FeatureFlagContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { useTheme } from "../../../theme";
import {
  DetailIcon,
  DetailItem,
  DetailSubtitle,
  DetailText,
  DetailTitle,
  FormLabel,
  Header,
  SecondaryButton,
} from "../settingsStyles";

export interface DisplayAndPreferencesTabProps {
  subView?: "display" | "contentPreferences" | "other" | undefined;
  onNavigate?: ((tab: string) => void) | undefined;
}

interface DisplayAccessibilityPrefs {
  fontScale: 90 | 100 | 110 | 120;
  compactDensity: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

const DISPLAY_STORAGE_KEY = "modelscript_display_accessibility";

const DEFAULT_DISPLAY_PREFS: DisplayAccessibilityPrefs = {
  fontScale: 100,
  compactDensity: false,
  reducedMotion: false,
  highContrast: false,
};

const FONT_SCALE_OPTIONS: { value: DisplayAccessibilityPrefs["fontScale"]; label: string }[] = [
  { value: 90, label: "90% (Compact)" },
  { value: 100, label: "100% (Default)" },
  { value: 110, label: "110% (Large)" },
  { value: 120, label: "120% (Extra Large)" },
];

function applyDisplayPreferencesToDom(prefs: DisplayAccessibilityPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.fontSize = `${prefs.fontScale}%`;
  root.style.setProperty("--ui-font-scale", String(prefs.fontScale / 100));

  if (prefs.compactDensity) {
    root.setAttribute("data-density", "compact");
  } else {
    root.removeAttribute("data-density");
  }

  if (prefs.reducedMotion) {
    root.setAttribute("data-reduced-motion", "true");
  } else {
    root.removeAttribute("data-reduced-motion");
  }

  if (prefs.highContrast) {
    root.setAttribute("data-high-contrast", "true");
  } else {
    root.removeAttribute("data-high-contrast");
  }
}

export const DisplayAndPreferencesTab: React.FC<DisplayAndPreferencesTabProps> = ({ subView = "display" }) => {
  const { theme, setTheme, isOverridden, clearThemeOverride } = useTheme();
  const navigate = useNavigate();
  const branding = useInstanceBranding();
  const { tier, edition, airgapEnforced, capabilities } = useCapabilities();
  const isModelScriptEnabled = useLanguageEnabled("modelscript");
  const brandName = branding.instanceName || "Ansatz";

  const [topics, setTopics] = useState<{ concept: string; is_active: boolean }[]>([]);

  const [displayPrefs, setDisplayPrefs] = useState<DisplayAccessibilityPrefs>(() => {
    try {
      const raw = localStorage.getItem(DISPLAY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DisplayAccessibilityPrefs>;
        return {
          fontScale:
            parsed.fontScale === 90 || parsed.fontScale === 100 || parsed.fontScale === 110 || parsed.fontScale === 120
              ? parsed.fontScale
              : 100,
          compactDensity: Boolean(parsed.compactDensity),
          reducedMotion: Boolean(parsed.reducedMotion),
          highContrast: Boolean(parsed.highContrast),
        };
      }
    } catch {
      // Ignore storage read errors
    }
    return DEFAULT_DISPLAY_PREFS;
  });

  useEffect(() => {
    applyDisplayPreferencesToDom(displayPrefs);
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(displayPrefs));
    } catch {
      // Ignore storage write errors
    }
  }, [displayPrefs]);

  useEffect(() => {
    if (subView === "contentPreferences") {
      getUserTopics()
        .then((data) => setTopics(data))
        .catch(() => {});
    }
  }, [subView]);

  const runtimeChecks = useMemo(() => {
    const hasWasm = typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    let hasWebGL2 = false;
    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        hasWebGL2 = Boolean(canvas.getContext("webgl2"));
      } catch {
        hasWebGL2 = false;
      }
    }
    return { hasWasm, hasWebGL2, hasSharedArrayBuffer };
  }, []);

  const updateDisplayPrefs = (patch: Partial<DisplayAccessibilityPrefs>) => {
    setDisplayPrefs((prev) => ({ ...prev, ...patch }));
  };

  const renderInstanceTelemetryCard = () => (
    <Box mb={4}>
      <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
        Instance Telemetry &amp; Runtime Capabilities
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
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Instance Name &amp; Tier</span>
          <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: "600" }}>
            {brandName} ({edition.toUpperCase()} • {tier})
          </span>
        </Box>
        <Box
          display="flex"
          justifyContent="space-between"
          py={1}
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>ActivityPub Federation</span>
          <span
            style={{
              fontSize: "13px",
              color:
                capabilities.activityPubFederation && branding.federationMode !== "disabled"
                  ? "var(--ms-success, #3fb950)"
                  : "var(--color-text-muted)",
              fontWeight: "600",
            }}
          >
            {capabilities.activityPubFederation && branding.federationMode !== "disabled"
              ? `Enabled (${branding.federationMode.toUpperCase()} • RFC 9421)`
              : "Disabled"}
          </span>
        </Box>
        <Box
          display="flex"
          justifyContent="space-between"
          py={1}
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Storage &amp; Ingress Driver</span>
          <span style={{ fontSize: "13px", fontWeight: "600" }}>
            {airgapEnforced ? "Airgapped Local Store" : `SQLite WAL + Git Vault (${branding.ingressMode})`}
          </span>
        </Box>
        <Box
          display="flex"
          justifyContent="space-between"
          py={1}
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Registration &amp; OAuth Policy</span>
          <span style={{ fontSize: "13px", fontWeight: "600" }}>
            {branding.registrationMode} {branding.academicFastTrackEnabled ? "• Academic Fast-Track" : ""}
          </span>
        </Box>
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
          pt={2}
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>Browser Runtime Acceleration</span>
          <Box display="flex" gap={2} flexWrap="wrap">
            {[
              { label: "WebAssembly", active: runtimeChecks.hasWasm },
              { label: "WebGL2", active: runtimeChecks.hasWebGL2 },
              { label: "SharedArrayBuffer", active: runtimeChecks.hasSharedArrayBuffer },
              { label: "Cloud Solvers", active: Boolean(capabilities.cloudSolvers) },
            ].map((badge) => (
              <span
                key={badge.label}
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "999px",
                  background: badge.active ? "rgba(46, 160, 67, 0.15)" : "rgba(148, 163, 184, 0.14)",
                  color: badge.active ? "var(--color-success-fg, #3fb950)" : "var(--color-text-muted)",
                }}
              >
                {badge.label}: {badge.active ? "Ready" : "Unavailable"}
              </span>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );

  if (subView === "contentPreferences") {
    return (
      <>
        <Header>Content preferences</Header>
        <Box px={4} pb={3}>
          <Box
            p={3}
            mb={4}
            style={{
              background: "var(--ms-surface-2, rgba(30, 41, 59, 0.45))",
              border: "1px solid var(--ms-border, rgba(148, 163, 184, 0.2))",
              borderRadius: "12px",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ display: "block", marginBottom: "2px" }}>Interactive Product Tour</FormLabel>
                <DetailSubtitle style={{ display: "block" }}>
                  Walk through {brandName}&apos;s timeline, discovery tools, and modeling workspace with visual
                  spotlights.
                </DetailSubtitle>
              </Box>
              <button
                type="button"
                onClick={() => navigate("/home?tour=1")}
                style={{
                  background: "transparent",
                  border: "1px solid var(--ms-border, rgba(148, 163, 184, 0.3))",
                  borderRadius: "8px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--ms-text-1)",
                  cursor: "pointer",
                }}
              >
                Replay Product Tour ↗
              </button>
            </Box>
          </Box>

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
                  role="switch"
                  aria-checked={t.is_active}
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
    const docsRoot = branding.docsBaseUrl || "https://modelscript.org";
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
              Engineering Documentation &amp; In-App Guides
            </DetailTitle>
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap={3}>
              {[
                {
                  title: "Platform Overview & User Guide",
                  desc: `Learn how ${brandName} unifies Modelica simulation, Git repositories, and scientific publishing.`,
                  link: "/about",
                  label: "Open Platform Guide →",
                  external: false,
                },
                {
                  title: "Federation & ActivityPub Network",
                  desc: "Inspect connected Fediverse instances, WebFinger resolution, and cryptographic HTTP signatures.",
                  link: "/federation",
                  label: "Explore Federation →",
                  external: false,
                },
                {
                  title: `${brandName} Package Registry`,
                  desc: isModelScriptEnabled
                    ? "Browse reusable .msx and .mo Modelica libraries, SysML v2 packages, and FMI 2.0/3.0 FMUs."
                    : "Browse reusable .mo Modelica libraries, SysML v2 packages, and FMI 2.0/3.0 FMUs.",
                  link: "/packages",
                  label: "Browse Packages →",
                  external: false,
                },
                {
                  title: "Modelica 3.5 & Language Reference",
                  desc: "Official language specification and reference portal for equation-based physical modeling.",
                  link: docsRoot,
                  label: "External Reference ↗",
                  external: true,
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
                    rel={doc.external ? "noreferrer" : undefined}
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
                    {doc.label}
                  </a>
                </Box>
              ))}
            </Box>
          </Box>

          {renderInstanceTelemetryCard()}
        </Box>
      </>
    );
  }

  return (
    <>
      <Header>Accessibility, display, and languages</Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4", display: "block", marginBottom: "16px" }}>
          Manage how {brandName} content is displayed to you, customize visual accessibility controls, and inspect
          browser runtime capabilities.
        </DetailSubtitle>

        {/* Theme & Language */}
        <Box
          mb={4}
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
            background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
            overflow: "hidden",
          }}
        >
          <DetailItem>
            <DetailIcon>
              <PaintbrushIcon size={20} />
            </DetailIcon>
            <DetailText>
              <DetailTitle>Color Theme</DetailTitle>
              <DetailSubtitle>Choose how {brandName} looks on this device.</DetailSubtitle>
            </DetailText>
            <Box display="flex" gap={1}>
              <button
                type="button"
                className="ms-chip"
                aria-pressed={!isOverridden}
                title="Match user agent / system preferred color scheme"
                onClick={() => {
                  if (isOverridden) clearThemeOverride();
                }}
              >
                Auto (System)
              </button>
              {(["light", "dark"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="ms-chip"
                  aria-pressed={isOverridden && theme === mode}
                  onClick={() => {
                    setTheme(mode);
                  }}
                >
                  {mode === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </Box>
          </DetailItem>

          <DetailItem style={{ borderTop: "1px solid var(--color-border-subtle)" }}>
            <DetailIcon>
              <GlobeIcon size={20} />
            </DetailIcon>
            <DetailText>
              <DetailTitle>Display Language</DetailTitle>
              <DetailSubtitle>English (Primary interface &amp; compiler diagnostics)</DetailSubtitle>
            </DetailText>
          </DetailItem>
        </Box>

        {/* Functional Accessibility & Display Controls */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Accessibility &amp; Interface Controls
          </DetailTitle>
          <Box
            p={4}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "12px",
              background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* UI Font Scale */}
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>UI Font Scale</FormLabel>
                <DetailSubtitle>Scale application typography across timelines, menus, and dialogs</DetailSubtitle>
              </Box>
              <Box display="flex" gap={2} flexWrap="wrap">
                {FONT_SCALE_OPTIONS.map((opt) => {
                  const active = displayPrefs.fontScale === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => updateDisplayPrefs({ fontScale: opt.value })}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "6px",
                        border: active
                          ? "2px solid var(--color-accent-purple, #a855f7)"
                          : "1px solid var(--color-border-default)",
                        background: active ? "rgba(139, 92, 246, 0.15)" : "var(--color-canvas-default)",
                        color: "var(--color-text-primary)",
                        fontWeight: active ? 700 : 500,
                        fontSize: "12.5px",
                        cursor: "pointer",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </Box>
            </Box>

            {/* Compact Density Mode */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Compact Density Mode</FormLabel>
                <DetailSubtitle>
                  Tighten spacing in feeds, tables, and repository trees (<code>data-density="compact"</code>)
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={displayPrefs.compactDensity}
                aria-label="Compact Density Mode"
                checked={displayPrefs.compactDensity}
                onChange={(e) => updateDisplayPrefs({ compactDensity: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            {/* Reduced Motion */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>Reduced Motion</FormLabel>
                <DetailSubtitle>
                  Suppress non-essential UI transitions and micro-animations (<code>data-reduced-motion="true"</code>)
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={displayPrefs.reducedMotion}
                aria-label="Reduced Motion"
                checked={displayPrefs.reducedMotion}
                onChange={(e) => updateDisplayPrefs({ reducedMotion: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            {/* High Contrast Borders */}
            <Box display="flex" justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <FormLabel style={{ margin: 0, display: "block" }}>High Contrast Borders</FormLabel>
                <DetailSubtitle>
                  Increase border luminance and focus ring contrast across cards and inputs (
                  <code>data-high-contrast="true"</code>)
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={displayPrefs.highContrast}
                aria-label="High Contrast Borders"
                checked={displayPrefs.highContrast}
                onChange={(e) => updateDisplayPrefs({ highContrast: e.target.checked })}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
            </Box>

            <Box display="flex" justifyContent="flex-end">
              <SecondaryButton
                type="button"
                onClick={() => setDisplayPrefs(DEFAULT_DISPLAY_PREFS)}
                style={{ padding: "6px 14px", fontSize: "12.5px" }}
              >
                Reset Display Defaults
              </SecondaryButton>
            </Box>
          </Box>
        </Box>

        {renderInstanceTelemetryCard()}
      </Box>
    </>
  );
};
