// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getNotifications } from "../api";
import { useAuth } from "../AuthContext";
import { useToast } from "./ToastContext";

/**
 * Synthesizes a soft, pleasant harmonic chime using the Web Audio API.
 * Zero external audio assets required.
 */
export function playNotificationChime(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Harmonic dual-sine oscillator (D5 -> A5)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(1174.66, now); // D6 harmonic
    osc2.frequency.exponentialRampToValueAtTime(1760.0, now + 0.14);

    gainNode.gain.setValueAtTime(0.06, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  } catch {
    // Gracefully ignore audio context playback restrictions (e.g. before initial user click)
  }
}

/**
 * Global background listener that watches for incoming engineering events,
 * background cloud simulations, and package publish alerts, raising rich
 * actionable in-app Toast notifications.
 */
export const RealtimeNotificationListener: React.FC = () => {
  const { token, unreadCount } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const seenIdsRef = useRef<Set<number>>(new Set());
  const initialFetchDoneRef = useRef(false);

  useEffect(() => {
    if (!token) {
      seenIdsRef.current.clear();
      initialFetchDoneRef.current = false;
      return;
    }

    let isMounted = true;

    async function checkNewNotifications() {
      try {
        const data = await getNotifications();
        if (!isMounted) return;

        const notifs = data.notifications || [];

        // On first load, seed seen IDs without firing toasts for historical items
        if (!initialFetchDoneRef.current) {
          notifs.forEach((n: { id: number }) => seenIdsRef.current.add(n.id));
          initialFetchDoneRef.current = true;
          return;
        }

        // Process any unseen unread notifications
        for (const notif of notifs) {
          if (!seenIdsRef.current.has(notif.id) && !notif.read) {
            seenIdsRef.current.add(notif.id);

            const meta = notif.metadata || {};
            const type = notif.type;

            if (type === "simulation_completed") {
              const modelName = meta.name || "Simulation";
              const dur = meta.duration ? ` in ${meta.duration}s` : "";
              playNotificationChime();
              toast.success(`Simulation of ${modelName} completed${dur}.`, "Simulation Ready");
            } else if (type === "simulation_failed") {
              const modelName = meta.name || "Simulation";
              const err = meta.error ? `: ${meta.error}` : "";
              toast.error(`Simulation of ${modelName} failed${err}.`, "Simulation Failed");
            } else if (type === "package_published") {
              const pkgName = meta.packageName || "Package";
              const ver = meta.packageVersion ? ` v${meta.packageVersion}` : "";
              toast.info(`Release ${pkgName}${ver} has been published successfully.`, "Package Published");
            } else if (type === "security_alert") {
              const pkgName = meta.packageName || "Package";
              const reason = meta.reason ? `: ${meta.reason}` : "";
              toast.error(`Security alert for ${pkgName}${reason}.`, "Security Warning");
            } else if (type === "credit_warning") {
              const bal = meta.balance !== undefined ? ` (Balance: ${meta.balance} credits)` : "";
              toast.warning(`Compute wallet balance threshold warning${bal}.`, "Compute Quota");
            }
          }
        }
      } catch {
        // Silently handle polling errors
      }
    }

    void checkNewNotifications();
  }, [token, unreadCount, toast, navigate]);

  return null;
};
