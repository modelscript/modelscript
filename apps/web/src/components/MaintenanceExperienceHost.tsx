// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  ClockIcon,
  CodeIcon,
  LockIcon,
  ShieldLockIcon,
  SyncIcon,
  ToolsIcon,
} from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { patchAdminInstanceSettings } from "../api";
import { useAuth } from "../AuthContext";
import { notifyInstanceBrandingUpdated, useInstanceBranding } from "../InstanceBrandingContext";
import AnsatzMark from "./AnsatzLogo";

/**
 * Formats an ISO timestamp or duration into a live human-readable countdown/elapsed string.
 */
export function formatRelativeCountdown(isoTarget: string, nowMs: number): string | null {
  if (!isoTarget) return null;
  const targetMs = Date.parse(isoTarget);
  if (Number.isNaN(targetMs)) return isoTarget;
  const diffSec = Math.round((targetMs - nowMs) / 1000);
  if (diffSec <= 0) return "Completing shortly…";
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatElapsed(isoStart: string, nowMs: number): string | null {
  if (!isoStart) return null;
  const startMs = Date.parse(isoStart);
  if (Number.isNaN(startMs)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m elapsed`;
  if (mins > 0) return `${mins}m elapsed`;
  return `${diffSec}s elapsed`;
}

/**
 * Plays a gentle harmonic chime when the platform transitions back online from maintenance.
 */
function playRecoveryChime(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.18); // G5
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.48);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

/**
 * Full-screen Maintenance Command & Live Status Portal rendered when the instance is in
 * `lockdown` maintenance mode (for non-admin visitors, or admins in Public Preview mode),
 * plus a floating Admin Bypass HUD pill for administrators when maintenance is active.
 */
export const MaintenanceExperienceHost: React.FC = () => {
  const branding = useInstanceBranding();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checkingNow, setCheckingNow] = useState(false);
  const [endingMaint, setEndingMaint] = useState(false);
  const [noticeBanner, setNoticeBanner] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const isAdmin = user?.account_type === "admin" || user?.role === "admin";
  const isMaintenanceActive =
    branding.maintenanceMode || branding.maintenanceLevel === "read_only" || branding.maintenanceLevel === "lockdown";

  // Tick every second when maintenance or scheduled countdown is active
  useEffect(() => {
    if (!isMaintenanceActive && branding.maintenanceLevel !== "scheduled") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isMaintenanceActive, branding.maintenanceLevel]);

  // Listen for 503 API interceptor events and show an actionable notice
  useEffect(() => {
    const handle503 = (e: Event) => {
      const detail = (e as CustomEvent<{ error?: string; maintenanceLevel?: string; retryAfterSeconds?: number }>)
        .detail;
      const msg =
        detail?.error ||
        "Instance is currently in read-only maintenance mode. Any local edits remain safely in your browser.";
      setNoticeBanner(msg);
      setTimeout(() => setNoticeBanner(null), 6000);
    };
    window.addEventListener("modelscript:maintenance-503", handle503);
    return () => window.removeEventListener("modelscript:maintenance-503", handle503);
  }, []);

  // Auto-poll `/api/v1/instance/banner` every 15s while maintenance is active so recovery is automatic
  useEffect(() => {
    if (!isMaintenanceActive) return;
    let wasActive = true;
    const poll = setInterval(() => {
      void branding.refreshBranding().then(() => {
        if (wasActive && !branding.maintenanceMode && branding.maintenanceLevel === "off") {
          wasActive = false;
          playRecoveryChime();
          setNoticeBanner("Scheduled maintenance is complete. All cloud services are back online!");
          setTimeout(() => setNoticeBanner(null), 5000);
        }
      });
    }, 15000);
    return () => clearInterval(poll);
  }, [isMaintenanceActive, branding]);

  const handleManualCheck = async () => {
    setCheckingNow(true);
    try {
      await branding.refreshBranding();
    } finally {
      setTimeout(() => setCheckingNow(false), 400);
    }
  };

  const handleQuickEndMaintenance = async () => {
    setEndingMaint(true);
    try {
      const res = await patchAdminInstanceSettings({
        maintenanceMode: false,
        maintenanceLevel: "off",
        maintenanceEta: "",
      });
      const updated =
        res.settings ??
        (res as unknown as {
          maintenanceMode?: boolean;
          maintenanceLevel?: "off" | "scheduled" | "read_only" | "lockdown";
          maintenanceEta?: string;
        });
      notifyInstanceBrandingUpdated({
        maintenanceMode: Boolean(updated.maintenanceMode),
        maintenanceLevel: updated.maintenanceLevel ?? "off",
        maintenanceEta: updated.maintenanceEta ?? "",
      });
      branding.setPreviewPublicMaintenance(false);
    } catch {
      setNoticeBanner("Failed to disable maintenance mode.");
    } finally {
      setEndingMaint(false);
    }
  };

  // Exempt routes where the full-screen lockdown overlay should not block access:
  // - /login (so admins can sign in during lockdown)
  // - /admin (so admins can manage the instance)
  // - /playground & /ide (client-side WASM sandbox escape hatch!)
  // - /setup
  const pathname = location.pathname || "/";
  const isExemptRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/playground") ||
    pathname.startsWith("/ide") ||
    pathname.startsWith("/setup");

  const showLockdownPortal =
    branding.maintenanceLevel === "lockdown" && (!isAdmin || branding.previewPublicMaintenance) && !isExemptRoute;

  const etaCountdown = formatRelativeCountdown(branding.maintenanceEta, nowMs);
  const elapsedText = formatElapsed(branding.maintenanceStartedAt, nowMs);

  return (
    <>
      {/* ── LIVE CLIENT VERSION-MISMATCH UPGRADE BANNER ── */}
      {branding.updateAvailable && !updateDismissed && (
        <div
          role="status"
          data-testid="version-mismatch-upgrade-banner"
          style={{
            position: "fixed",
            bottom: isAdmin && (isMaintenanceActive || branding.maintenanceLevel === "scheduled") ? "76px" : "20px",
            right: "20px",
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "999px",
            background: "rgba(15, 23, 42, 0.94)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(6, 182, 212, 0.55)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            color: "#f8fafc",
            fontSize: "12.5px",
            fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "999px",
              backgroundColor: "#06b6d4",
              boxShadow: "0 0 10px #06b6d4",
              flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 600 }}>A new version of Ansatz is available</span>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            }}
            style={{
              padding: "4px 12px",
              borderRadius: "999px",
              border: "1px solid rgba(6, 182, 212, 0.6)",
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              color: "#ffffff",
              fontSize: "11.5px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <button
            type="button"
            aria-label="Dismiss update notification"
            onClick={() => {
              setUpdateDismissed(true);
              branding.dismissUpdateAvailable();
            }}
            style={{
              padding: "2px 6px",
              borderRadius: "999px",
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {noticeBanner && (
        <div
          role="alert"
          data-testid="maintenance-503-toast"
          style={{
            position: "fixed",
            bottom: isAdmin ? "76px" : "20px",
            right: "20px",
            zIndex: 10000,
            maxWidth: "380px",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid rgba(245, 158, 11, 0.55)",
            color: "#fbbf24",
            fontSize: "12.5px",
            fontWeight: 600,
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)",
          }}
        >
          {noticeBanner}
        </div>
      )}

      {/* ── FLOATING ADMIN BYPASS HUD PILL ── */}
      {isAdmin && (isMaintenanceActive || branding.maintenanceLevel === "scheduled") && (
        <div
          data-testid="admin-maintenance-bypass-hud"
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "rgba(15, 23, 42, 0.92)",
            backdropFilter: "blur(12px)",
            border:
              branding.maintenanceLevel === "lockdown"
                ? "1px solid rgba(239, 68, 68, 0.55)"
                : "1px solid rgba(245, 158, 11, 0.55)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
            color: "#f8fafc",
            fontSize: "12px",
            fontFamily: "var(--ms-font-sans, system-ui, sans-serif)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "999px",
              backgroundColor: branding.maintenanceLevel === "lockdown" ? "#ef4444" : "#f59e0b",
              boxShadow: branding.maintenanceLevel === "lockdown" ? "0 0 10px #ef4444" : "0 0 10px #f59e0b",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <ShieldLockIcon size={13} />
              <span>
                {branding.maintenanceLevel === "lockdown"
                  ? "Lockdown Active (Admin Bypass)"
                  : branding.maintenanceLevel === "scheduled"
                    ? "Maintenance Scheduled"
                    : "Read-Only Maintenance (Admin Bypass)"}
              </span>
            </div>
            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
              {elapsedText ? `${elapsedText} • ` : ""}
              {etaCountdown ? `ETA: ${etaCountdown}` : "Admin writes permitted"}
            </div>
          </div>

          {branding.maintenanceLevel === "lockdown" && (
            <button
              type="button"
              onClick={() => branding.setPreviewPublicMaintenance(!branding.previewPublicMaintenance)}
              style={{
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                background: branding.previewPublicMaintenance
                  ? "rgba(59, 130, 246, 0.25)"
                  : "rgba(255, 255, 255, 0.06)",
                color: "#e2e8f0",
                fontSize: "11px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {branding.previewPublicMaintenance ? "Exit Public Preview" : "Preview Portal"}
            </button>
          )}

          <button
            type="button"
            disabled={endingMaint}
            onClick={() => void handleQuickEndMaintenance()}
            style={{
              padding: "5px 10px",
              borderRadius: "6px",
              border: "1px solid rgba(16, 185, 129, 0.45)",
              background: "rgba(16, 185, 129, 0.18)",
              color: "#34d399",
              fontSize: "11px",
              fontWeight: 700,
              cursor: endingMaint ? "wait" : "pointer",
            }}
          >
            {endingMaint ? "Restoring…" : "End Maintenance"}
          </button>
        </div>
      )}

      {/* ── FULL-SCREEN LOCKDOWN MAINTENANCE & STATUS PORTAL ── */}
      {showLockdownPortal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scheduled Maintenance Status Portal"
          data-testid="lockdown-maintenance-portal"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9500,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            background:
              "radial-gradient(circle at 50% 0%, rgba(6, 182, 212, 0.14) 0%, rgba(15, 23, 42, 0.98) 65%), #090d16",
            color: "#f8fafc",
            fontFamily: "var(--ms-font-sans, system-ui, -apple-system, sans-serif)",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              maxWidth: "660px",
              width: "100%",
              borderRadius: "16px",
              border: "1px solid rgba(148, 163, 184, 0.18)",
              background: "rgba(15, 23, 42, 0.82)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 24px 64px rgba(0, 0, 0, 0.55)",
              padding: "36px 32px",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            {/* Header & Brand Identity */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <AnsatzMark
                  size={42}
                  logoUrl={branding.brandLogoDarkUrl || branding.brandLogoUrl}
                  alt={branding.instanceName}
                  accentColor={branding.brandAccentColor || "#06b6d4"}
                />
                <div>
                  <div style={{ fontSize: "19px", fontWeight: 800, letterSpacing: "-0.03em" }}>
                    {branding.instanceName}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>{branding.instanceTagline}</div>
                </div>
              </div>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "999px",
                  background: "rgba(245, 158, 11, 0.14)",
                  border: "1px solid rgba(245, 158, 11, 0.4)",
                  color: "#fbbf24",
                  fontSize: "12px",
                  fontWeight: 700,
                }}
              >
                <ToolsIcon size={13} />
                <span>Scheduled Maintenance</span>
              </span>
            </div>

            {/* Primary Message & Live Countdown */}
            <div>
              <h1 style={{ fontSize: "24px", fontWeight: 800, margin: "0 0 10px 0", letterSpacing: "-0.02em" }}>
                We’re upgrading {branding.instanceName} infrastructure
              </h1>
              <p style={{ fontSize: "14.5px", lineHeight: 1.6, color: "#cbd5e1", margin: 0 }}>
                {branding.announcementBanner ||
                  "Our engineering team is currently performing scheduled database, solver cluster, and storage maintenance. Your models, packages, and repositories are safe."}
              </p>

              {(etaCountdown || elapsedText) && (
                <div
                  style={{
                    marginTop: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    flexWrap: "wrap",
                    padding: "12px 16px",
                    borderRadius: "10px",
                    background: "rgba(6, 182, 212, 0.08)",
                    border: "1px solid rgba(6, 182, 212, 0.25)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "#22d3ee",
                      fontWeight: 700,
                      fontSize: "13px",
                    }}
                  >
                    <ClockIcon size={15} />
                    <span>{etaCountdown ? `Estimated completion: ${etaCountdown}` : "Maintenance in progress"}</span>
                  </div>
                  {elapsedText && (
                    <span style={{ fontSize: "12px", color: "#94a3b8", fontFamily: "monospace" }}>({elapsedText})</span>
                  )}
                </div>
              )}
            </div>

            {/* Live Subsystem Telemetry Matrix */}
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.14)",
                background: "rgba(9, 13, 22, 0.65)",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#94a3b8",
                }}
              >
                Subsystem Telemetry Status
              </div>

              {[
                {
                  label: "Client-Side WASM Compiler & Local DAE Solver",
                  status: "Operational (Offline-Ready)",
                  color: "#10b981",
                  icon: <CheckCircleIcon size={14} />,
                },
                {
                  label: "Core REST / GraphQL / SPARQL API",
                  status: branding.subsystems.coreApi === "maintenance" ? "Upgrading" : "Read-Only",
                  color: "#f59e0b",
                  icon: <ToolsIcon size={14} />,
                },
                {
                  label: "Package Registry & Content-Addressable Storage",
                  status: branding.subsystems.packageRegistry === "maintenance" ? "Locked" : "Read-Only",
                  color: "#f59e0b",
                  icon: <LockIcon size={14} />,
                },
                {
                  label: "Cloud CAE / HPC Solver Cluster",
                  status: "Drained & Paused",
                  color: "#94a3b8",
                  icon: <ClockIcon size={14} />,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: "13px",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
                  }}
                >
                  <span style={{ color: "#e2e8f0" }}>{item.label}</span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      color: item.color,
                      fontWeight: 600,
                      fontSize: "12px",
                    }}
                  >
                    {item.icon}
                    <span>{item.status}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Action Bar: Offline WASM Playground Escape Hatch + Manual Status Check + Admin Sign-In */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  data-testid="launch-offline-wasm-playground"
                  onClick={() => navigate("/playground")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: "1px solid rgba(6, 182, 212, 0.5)",
                    background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(6, 182, 212, 0.25)",
                  }}
                >
                  <CodeIcon size={15} />
                  <span>Open Offline WASM Playground</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleManualCheck()}
                  disabled={checkingNow}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                    background: "rgba(255, 255, 255, 0.05)",
                    color: "#e2e8f0",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: checkingNow ? "wait" : "pointer",
                  }}
                >
                  <SyncIcon size={14} />
                  <span>{checkingNow ? "Checking…" : "Check Status Now"}</span>
                </button>
              </div>

              {!isAdmin ? (
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Administrator Sign In →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => branding.setPreviewPublicMaintenance(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#38bdf8",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Return to Admin View →
                </button>
              )}
            </div>

            <div style={{ fontSize: "11.5px", color: "#64748b", textAlign: "center" }}>
              This page automatically checks status every 15 seconds and will resume your session as soon as maintenance
              completes.
              {branding.contactEmail ? ` Contact: ${branding.contactEmail}` : ""}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MaintenanceExperienceHost;
