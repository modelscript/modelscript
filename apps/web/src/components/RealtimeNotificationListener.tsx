// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getNotifications } from "../api";
import { getCachedNotificationPreferences, getNotificationSettings } from "../api/account";
import { useAuth } from "../AuthContext";
import { groupNotifications } from "../pages/notifications/types";
import { useToast } from "./ToastContext";

/**
 * Synthesizes a soft, pleasant harmonic chime using the Web Audio API.
 * Zero external audio assets required.
 */
function playNotificationChime(): void {
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
    osc2.onended = () => {
      void ctx.close().catch(() => {});
    };
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
  const { token, setUnreadCount } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const seenIdsRef = useRef<Set<number | string>>(new Set());
  const initialFetchDoneRef = useRef(false);
  const prefsSyncedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      seenIdsRef.current.clear();
      initialFetchDoneRef.current = false;
      prefsSyncedRef.current = false;
      return;
    }

    if (!prefsSyncedRef.current) {
      prefsSyncedRef.current = true;
      void getNotificationSettings().catch(() => {});
    }

    let isMounted = true;

    async function checkNewNotifications() {
      try {
        const data = await getNotifications();
        if (!isMounted) return;

        const notifs = data.notifications || [];
        const isViewingNotifications = typeof window !== "undefined" && window.location?.pathname === "/notifications";
        if (isViewingNotifications) {
          setUnreadCount(0);
        } else if (typeof data.unreadCount === "number") {
          setUnreadCount(data.unreadCount);
        }

        // On first load, seed seen IDs without firing toasts for historical items
        if (!initialFetchDoneRef.current) {
          notifs.forEach((n: { id: number | string }) => seenIdsRef.current.add(n.id));
          initialFetchDoneRef.current = true;
          return;
        }

        const unseenUnread = notifs.filter(
          (notif: { id: number | string; read?: number | boolean }) => !seenIdsRef.current.has(notif.id) && !notif.read,
        );
        for (const notif of unseenUnread) {
          seenIdsRef.current.add(notif.id);
        }
        if (unseenUnread.length === 0) return;

        const prefs = getCachedNotificationPreferences();
        const inAppEnabled = prefs.channels?.inApp ?? prefs.deliveryChannels?.inApp ?? true;
        if (!inAppEnabled) return;

        const soundEnabled = prefs.inAppSounds !== false;
        if (soundEnabled) {
          playNotificationChime();
        }

        // Group unseen notifications so multiple likes/reposts on the same post fire a single toast
        const groupedUnseen = groupNotifications(unseenUnread);

        for (const notif of groupedUnseen) {
          const meta = notif.metadata || {};
          const type = notif.type;
          const actors = notif.actors || [];
          const primaryHandle = actors[0]?.username
            ? `@${actors[0].username}`
            : notif.actor_username
              ? `@${notif.actor_username}`
              : "Someone";
          const actorSummary =
            actors.length > 2
              ? `${primaryHandle} and ${actors.length - 1} others`
              : actors.length === 2
                ? `${primaryHandle} and @${actors[1]?.username || "someone"}`
                : primaryHandle;

          if (type === "simulation_completed" || type === "simulation") {
            const modelName = meta.name || "Simulation";
            const dur = meta.duration ? ` in ${meta.duration}s` : "";
            toast.success(`Simulation of ${modelName} completed${dur}.`, "Simulation Ready");
          } else if (type === "simulation_failed") {
            const modelName = meta.name || "Simulation";
            const err = meta.error ? `: ${meta.error}` : "";
            toast.error(`Simulation of ${modelName} failed${err}.`, "Simulation Failed");
          } else if (type === "package_published" || type === "package") {
            const pkgName = meta.packageName || "Package";
            const ver = meta.packageVersion ? ` v${meta.packageVersion}` : "";
            toast.info(`Release ${pkgName}${ver} has been published successfully.`, "Package Published");
          } else if (type === "package_yanked") {
            const pkgName = meta.packageName || "Package";
            const ver = meta.packageVersion ? ` v${meta.packageVersion}` : "";
            toast.warning(`Release ${pkgName}${ver} was yanked from the registry.`, "Package Yanked");
          } else if (type === "security_alert") {
            const pkgName = meta.packageName || "Package";
            const reason = meta.reason ? `: ${meta.reason}` : "";
            toast.error(`Security alert for ${pkgName}${reason}.`, "Security Warning");
          } else if (type === "credit_warning") {
            const bal = meta.balance !== undefined ? ` (Balance: ${meta.balance} credits)` : "";
            toast.warning(`Compute wallet balance threshold warning${bal}.`, "Compute Quota");
          } else if (type === "like") {
            toast.info(`${actorSummary} liked your post.`, "New Like");
          } else if (type === "reply") {
            toast.info(`${primaryHandle} replied to your post.`, "New Reply");
          } else if (type === "repost") {
            toast.info(`${actorSummary} reposted your post.`, "New Repost");
          } else if (type === "follow") {
            toast.info(`${primaryHandle} started following you.`, "New Follower");
          } else if (type === "follow_request") {
            toast.info(`${primaryHandle} requested to follow you.`, "Follow Request");
          } else if (type === "follow_accepted") {
            toast.success(`${primaryHandle} accepted your follow request.`, "Follow Accepted");
          } else if (type === "mention") {
            toast.info(`${primaryHandle} mentioned you in a post.`, "New Mention");
          } else if (type === "quote") {
            toast.info(`${primaryHandle} quoted your post.`, "New Quote");
          }
        }
      } catch {
        // Silently handle polling errors
      }
    }

    void checkNewNotifications();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkNewNotifications();
      }
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token, setUnreadCount, toast, navigate]);

  return null;
};
