// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, BellIcon, BroadcastIcon, MailIcon, SyncIcon, TrashIcon, UnmuteIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  deletePushSubscription,
  getNotificationSettings,
  getPushSubscriptions,
  registerPushSubscription,
  updateNotificationSettings,
  type NotificationPreferences,
  type PushSubscriptionRecord,
} from "../../../api/account";
import { api } from "../../../api/client";
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { getApiErrorMessage } from "../../../util/error";
import type { TabType } from "../../SettingsPage";
import { DetailSubtitle, DetailTitle, FormLabel, Header, SaveButton, SecondaryButton } from "../settingsStyles";

export interface NotificationFiltersTabProps {
  subView?: "notifications" | "notificationFilters" | undefined;
  onNavigate?: ((tab: TabType) => void) | undefined;
}

/**
 * Converts a URL-safe base64 VAPID public key string into a Uint8Array
 * suitable for `PushManager.subscribe({ applicationServerKey })`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64String.trim();
  const padding = "=".repeat((4 - (trimmed.length % 4)) % 4);
  const base64 = (trimmed + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = typeof atob === "function" ? atob(base64) : Buffer.from(base64, "base64").toString("binary");
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export const NotificationFiltersTab: React.FC<NotificationFiltersTabProps> = ({ subView = "notifications" }) => {
  const toast = useToast();
  const mountedRef = useRef(true);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  // Web Push Subscriptions state
  const [pushSubscriptions, setPushSubscriptions] = useState<PushSubscriptionRecord[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [registeringPush, setRegisteringPush] = useState(false);
  const [deletingSubId, setDeletingSubId] = useState<number | null>(null);
  const [pushPermissionState, setPushPermissionState] = useState<string>(() => {
    if (!isWebPushSupported()) {
      return "unsupported";
    }
    return Notification.permission;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPreferencesAndSubscriptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadingSubscriptions(true);

    try {
      const data = await getNotificationSettings();
      if (!mountedRef.current) return;
      if (data) {
        const defaults = DEFAULT_NOTIFICATION_PREFERENCES;
        const mergedChannels = {
          email: data.channels?.email ?? data.deliveryChannels?.emailNotifications ?? defaults.channels?.email ?? true,
          browserPush: data.channels?.browserPush ?? defaults.channels?.browserPush ?? false,
          inApp: data.channels?.inApp ?? data.deliveryChannels?.inApp ?? defaults.channels?.inApp ?? true,
        };
        setNotificationPrefs({
          ...defaults,
          ...data,
          channels: mergedChannels,
          deliveryChannels: {
            inApp: mergedChannels.inApp,
            emailNotifications: mergedChannels.email,
          },
          events: {
            social: { ...defaults.events!.social, ...(data.events?.social || {}) },
            engineering: { ...defaults.events!.engineering, ...(data.events?.engineering || {}) },
            computeHpc: { ...defaults.events!.computeHpc, ...(data.events?.computeHpc || {}) },
          },
        });
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = getApiErrorMessage(err, "Unable to load your saved notification preferences from the server.");
      setLoadError(msg);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }

    try {
      const subs = await getPushSubscriptions();
      if (!mountedRef.current) return;
      setPushSubscriptions(Array.isArray(subs) ? subs : []);
    } catch {
      // Ignore push list error if endpoint unavailable
    } finally {
      if (mountedRef.current) {
        setLoadingSubscriptions(false);
      }
    }
  }, []);

  useEffect(() => {
    if (subView === "notifications" || subView === "notificationFilters") {
      void loadPreferencesAndSubscriptions();
    }
  }, [subView, loadPreferencesAndSubscriptions]);

  const handleRegisterBrowserPush = async (): Promise<boolean> => {
    setRegisteringPush(true);
    setNotificationError(null);
    try {
      if (!isWebPushSupported()) {
        setPushPermissionState("unsupported");
        const msg =
          "Browser Web Push is not supported in this browser or context (requires Notifications, Service Worker, and PushManager APIs).";
        setNotificationError(msg);
        toast.error(msg);
        return false;
      }

      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPushPermissionState(permission);
      if (permission !== "granted") {
        const msg =
          permission === "denied"
            ? "Browser notification permission was denied. Please allow notifications in your browser site settings."
            : "Browser notification permission was dismissed. Please allow notifications to register Web Push.";
        setNotificationError(msg);
        toast.error(msg);
        return false;
      }

      const vapidResponse = await api.get<{ publicKey?: string }>("/push/vapid-key");
      const publicKey = vapidResponse.data?.publicKey?.trim();
      if (!publicKey) {
        const msg = "Web Push is not configured on this instance.";
        setNotificationError(msg);
        toast.error(msg);
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const subJson = subscription.toJSON();
      const endpoint = subJson.endpoint || subscription.endpoint;
      const p256dh = subJson.keys?.["p256dh"];
      const auth = subJson.keys?.["auth"];
      if (!endpoint || !p256dh || !auth) {
        const msg = "Browser PushManager did not return a valid subscription endpoint and encryption keys.";
        setNotificationError(msg);
        toast.error(msg);
        return false;
      }

      const res = await registerPushSubscription({
        endpoint,
        keys: {
          p256dh,
          auth,
        },
        alerts: {
          mentions: Boolean(notificationPrefs.events?.social?.mentions),
          replies: Boolean(notificationPrefs.events?.social?.replies),
          jobCompleted: Boolean(notificationPrefs.events?.computeHpc?.jobCompleted),
          jobFailed: Boolean(notificationPrefs.events?.computeHpc?.jobFailed),
        },
      });
      if (res?.subscription) {
        setPushSubscriptions((prev) => [res.subscription, ...prev.filter((item) => item.id !== res.subscription.id)]);
      } else {
        const refreshed = await getPushSubscriptions().catch(() => []);
        setPushSubscriptions(refreshed);
      }
      toast.success("Browser Web Push endpoint registered.");
      return true;
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to register browser push subscription.");
      setNotificationError(msg);
      toast.error(msg);
      return false;
    } finally {
      setRegisteringPush(false);
    }
  };

  const handleToggleBrowserPush = async (enabled: boolean) => {
    const rollbackBrowserPush = () => {
      setNotificationPrefs((p) => ({
        ...p,
        channels: {
          email: p.channels?.email ?? true,
          inApp: p.channels?.inApp ?? true,
          browserPush: false,
        },
      }));
    };

    if (enabled) {
      setNotificationPrefs((p) => ({
        ...p,
        channels: {
          email: p.channels?.email ?? true,
          inApp: p.channels?.inApp ?? true,
          browserPush: true,
        },
      }));
      if (pushSubscriptions.length === 0) {
        const registered = await handleRegisterBrowserPush();
        if (!registered) {
          rollbackBrowserPush();
        }
      } else {
        if (!isWebPushSupported()) {
          setPushPermissionState("unsupported");
          const msg =
            "Browser Web Push is not supported in this browser or context (requires Notifications, Service Worker, and PushManager APIs).";
          setNotificationError(msg);
          toast.error(msg);
          rollbackBrowserPush();
          return;
        }
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        setPushPermissionState(permission);
        if (permission !== "granted") {
          const msg =
            permission === "denied"
              ? "Browser notification permission was denied. Please allow notifications in your browser site settings."
              : "Browser notification permission was dismissed. Please allow notifications to enable Web Push.";
          setNotificationError(msg);
          toast.error(msg);
          rollbackBrowserPush();
        }
      }
    } else {
      rollbackBrowserPush();
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    setDeletingSubId(id);
    try {
      await deletePushSubscription(id);
      setPushSubscriptions((prev) => prev.filter((item) => item.id !== id));
      toast.info("Removed browser push subscription.");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, "Failed to remove push subscription."));
    } finally {
      setDeletingSubId(null);
    }
  };

  const controlsDisabled = loading || Boolean(loadError);

  return (
    <>
      <Header>Notification Preferences</Header>
      <Box p={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
          Configure delivery channels, email digest frequency, and granular event filters for engineering models, social
          mentions, and high-performance computing solver jobs.
        </DetailSubtitle>

        {loading && (
          <Box
            mb={3}
            p={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "8px",
              background: "var(--color-canvas-subtle)",
              fontSize: "13px",
              color: "var(--color-text-muted)",
            }}
          >
            Loading your saved notification preferences...
          </Box>
        )}

        {loadError && (
          <Box
            mb={4}
            p={3}
            style={{
              background: "var(--color-danger-subtle)",
              color: "var(--color-danger-fg)",
              borderRadius: "8px",
              border: "1px solid var(--color-danger-fg, #cf222e)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <AlertIcon size={18} />
              <Box>
                <Text fontWeight="bold" fontSize="14px" display="block">
                  Failed to load server preferences
                </Text>
                <Text fontSize="13px">{loadError} Editing is disabled to prevent overwriting your saved settings.</Text>
              </Box>
            </Box>
            <SecondaryButton
              type="button"
              onClick={() => void loadPreferencesAndSubscriptions()}
              style={{ padding: "6px 14px", fontSize: "12.5px" }}
            >
              <SyncIcon size={14} />
              Retry Loading
            </SecondaryButton>
          </Box>
        )}

        {notificationSuccess && (
          <Box mb={3} p={3} bg="var(--color-success-subtle)" color="var(--color-success-fg)" borderRadius="6px">
            <Text fontSize="14px">{notificationSuccess}</Text>
          </Box>
        )}

        {notificationError && (
          <Box
            mb={3}
            p={3}
            style={{
              background: "var(--color-danger-subtle)",
              color: "var(--color-danger-fg)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <AlertIcon size={16} />
            <Text fontSize="14px">{notificationError}</Text>
          </Box>
        )}

        {/* Quality Filter Card */}
        <Box
          p={3}
          mb={4}
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "10px",
            background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
          }}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <FormLabel style={{ display: "block", margin: 0 }}>Quality filter</FormLabel>
            <DetailSubtitle style={{ display: "block", marginTop: "4px" }}>
              Filter out lower-quality content and suspected bot interactions from your notifications stream.
            </DetailSubtitle>
          </Box>
          <input
            type="checkbox"
            role="switch"
            aria-checked={Boolean(notificationPrefs.qualityFilter)}
            aria-label="Quality filter"
            disabled={controlsDisabled}
            checked={Boolean(notificationPrefs.qualityFilter)}
            onChange={(e) => {
              const val = e.target.checked;
              setNotificationPrefs((p) => ({ ...p, qualityFilter: val }));
            }}
            style={{ width: "20px", height: "20px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
          />
        </Box>

        {/* Delivery Channels */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Delivery Channels
          </DetailTitle>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap={3}>
            {/* In-App Notifications Toggle */}
            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2}>
                  <BellIcon size={16} />
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>In-App Notifications</span>
                </Box>
                <DetailSubtitle style={{ display: "block", fontSize: "12px", marginTop: "2px" }}>
                  In-App Notification Center &amp; Toast Badges
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={Boolean(notificationPrefs.channels?.inApp ?? true)}
                aria-label="In-App Notification Center & Toast Badges"
                disabled={controlsDisabled}
                checked={Boolean(notificationPrefs.channels?.inApp ?? true)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({
                    ...p,
                    channels: {
                      email: p.channels?.email ?? true,
                      browserPush: p.channels?.browserPush ?? false,
                      inApp: val,
                    },
                    deliveryChannels: {
                      inApp: val,
                      emailNotifications: Boolean(p.channels?.email ?? true),
                    },
                  }));
                }}
                style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
              />
            </Box>

            {/* Email Notifications Toggle */}
            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2}>
                  <MailIcon size={16} />
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Email Notifications</span>
                </Box>
                <DetailSubtitle style={{ display: "block", fontSize: "12px", marginTop: "2px" }}>
                  Direct alerts &amp; scheduled digests
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={Boolean(notificationPrefs.channels?.email)}
                aria-label="Email Notifications"
                disabled={controlsDisabled}
                checked={Boolean(notificationPrefs.channels?.email)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({
                    ...p,
                    channels: {
                      email: val,
                      browserPush: p.channels?.browserPush ?? false,
                      inApp: p.channels?.inApp ?? true,
                    },
                    deliveryChannels: {
                      inApp: Boolean(p.channels?.inApp ?? true),
                      emailNotifications: val,
                    },
                  }));
                }}
                style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
              />
            </Box>

            {/* Browser Push Notifications Toggle */}
            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2}>
                  <BroadcastIcon size={16} />
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>Browser Push Notifications</span>
                </Box>
                <DetailSubtitle style={{ display: "block", fontSize: "12px", marginTop: "2px" }}>
                  Web Push API ({pushPermissionState})
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={Boolean(notificationPrefs.channels?.browserPush)}
                aria-label="Browser Push Notifications"
                disabled={controlsDisabled || registeringPush}
                checked={Boolean(notificationPrefs.channels?.browserPush)}
                onChange={(e) => {
                  void handleToggleBrowserPush(e.target.checked);
                }}
                style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
              />
            </Box>

            {/* In-App Audio Alerts Toggle */}
            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              gap={2}
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2}>
                  <UnmuteIcon size={16} />
                  <span style={{ fontSize: "14px", fontWeight: "600" }}>In-App Audio Alerts</span>
                </Box>
                <DetailSubtitle style={{ display: "block", fontSize: "12px", marginTop: "2px" }}>
                  Subtle chime on solver completion
                </DetailSubtitle>
              </Box>
              <input
                type="checkbox"
                role="switch"
                aria-checked={Boolean(notificationPrefs.inAppSounds)}
                aria-label="In-App Audio Alerts"
                disabled={controlsDisabled}
                checked={Boolean(notificationPrefs.inAppSounds)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({ ...p, inAppSounds: val }));
                }}
                style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
              />
            </Box>
          </Box>

          {/* Registered Web Push Subscriptions Panel */}
          <Box
            mt={3}
            p={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              background: "var(--color-canvas-subtle, rgba(255,255,255,0.02))",
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
              <Box>
                <span style={{ fontSize: "14px", fontWeight: 600, display: "block" }}>
                  Registered Browser Push Endpoints ({pushSubscriptions.length})
                </span>
                <DetailSubtitle style={{ fontSize: "12px" }}>
                  Active VAPID Web Push device subscriptions receiving background notifications.
                </DetailSubtitle>
              </Box>
              <SecondaryButton
                type="button"
                disabled={controlsDisabled || registeringPush}
                onClick={() => void handleRegisterBrowserPush()}
                style={{ padding: "5px 12px", fontSize: "12px" }}
              >
                <BroadcastIcon size={14} />
                {registeringPush ? "Registering..." : "Register This Browser"}
              </SecondaryButton>
            </Box>

            {loadingSubscriptions ? (
              <DetailSubtitle style={{ fontSize: "12px" }}>Loading push subscriptions...</DetailSubtitle>
            ) : pushSubscriptions.length === 0 ? (
              <DetailSubtitle style={{ fontSize: "12px" }}>
                No browser push endpoints registered yet. Enable Browser Push or click &ldquo;Register This
                Browser&rdquo; to subscribe this device.
              </DetailSubtitle>
            ) : (
              <Box display="flex" flexDirection="column" gap={2} mt={2}>
                {pushSubscriptions.map((sub) => (
                  <Box
                    key={sub.id}
                    p={2}
                    style={{
                      background: "var(--color-canvas-default)",
                      border: "1px solid var(--color-border-subtle)",
                      borderRadius: "6px",
                    }}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    gap={2}
                  >
                    <Box style={{ overflow: "hidden" }}>
                      <code
                        style={{
                          fontSize: "12px",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sub.endpoint}
                      </code>
                      <DetailSubtitle style={{ fontSize: "11px" }}>
                        Subscribed #{sub.id} • {sub.created_at}
                      </DetailSubtitle>
                    </Box>
                    <SecondaryButton
                      type="button"
                      disabled={deletingSubId === sub.id}
                      onClick={() => void handleDeleteSubscription(sub.id)}
                      style={{ padding: "4px 10px", fontSize: "11.5px", flexShrink: 0 }}
                    >
                      <TrashIcon size={12} />
                      {deletingSubId === sub.id ? "Removing..." : "Remove"}
                    </SecondaryButton>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* Social Events */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>Social Events</DetailTitle>
          <Box
            p={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {(
              [
                {
                  key: "mentions",
                  label: "Mentions",
                  desc: "Notify when someone @mentions you in a post or reply",
                },
                {
                  key: "replies",
                  label: "Replies",
                  desc: "Notify when someone replies to your authored models or posts",
                },
                { key: "follows", label: "Followers", desc: "Notify when a new engineer follows your profile" },
                { key: "reposts", label: "Reposts", desc: "Notify when someone reposts or quotes your model" },
              ] as const
            ).map((evt) => (
              <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                  <DetailSubtitle>{evt.desc}</DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={Boolean(notificationPrefs.events?.social?.[evt.key])}
                  aria-label={evt.label}
                  disabled={controlsDisabled}
                  checked={Boolean(notificationPrefs.events?.social?.[evt.key])}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNotificationPrefs((p) => {
                      const prevEvents = p.events ?? DEFAULT_NOTIFICATION_PREFERENCES.events!;
                      return {
                        ...p,
                        events: {
                          ...prevEvents,
                          social: { ...prevEvents.social, [evt.key]: val },
                        },
                      };
                    });
                  }}
                  style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
                />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Engineering Artifacts & HPC Events */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Engineering Packages &amp; HPC Solver Alerts
          </DetailTitle>
          <Box
            p={3}
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "10px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {(
              [
                {
                  key: "packageUpdates",
                  category: "engineering",
                  label: "Package Releases",
                  desc: "Notify when subscribed @modelscript packages publish new versions",
                },
                {
                  key: "starredRepoCommits",
                  category: "engineering",
                  label: "Repository Activity",
                  desc: "Notify on new git commits and releases in starred repositories",
                },
                {
                  key: "federatedMentions",
                  category: "engineering",
                  label: "Fediverse Mentions",
                  desc: "Notify when remote ActivityPub actors mention your handle",
                },
                {
                  key: "jobCompleted",
                  category: "computeHpc",
                  label: "HPC Job Finished",
                  desc: "Alert when cloud SLURM / Local solver simulations finish execution",
                },
                {
                  key: "jobFailed",
                  category: "computeHpc",
                  label: "Solver Failure / Divergence",
                  desc: "Immediate alert if a differential-algebraic solver step fails",
                },
                {
                  key: "quotaThresholdAlert",
                  category: "computeHpc",
                  label: "Low Balance Warning",
                  desc: "Alert when compute wallet balance falls below 20 credits",
                },
              ] as const
            ).map((evt) => {
              const isChecked =
                evt.category === "engineering"
                  ? Boolean(notificationPrefs.events?.engineering?.[evt.key])
                  : Boolean(notificationPrefs.events?.computeHpc?.[evt.key]);
              return (
                <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                  <Box>
                    <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                    <DetailSubtitle>{evt.desc}</DetailSubtitle>
                  </Box>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={isChecked}
                    aria-label={evt.label}
                    disabled={controlsDisabled}
                    checked={isChecked}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setNotificationPrefs((p) => {
                        const prevEvents = p.events ?? DEFAULT_NOTIFICATION_PREFERENCES.events!;
                        return {
                          ...p,
                          events:
                            evt.category === "engineering"
                              ? {
                                  ...prevEvents,
                                  engineering: { ...prevEvents.engineering, [evt.key]: val },
                                }
                              : {
                                  ...prevEvents,
                                  computeHpc: { ...prevEvents.computeHpc, [evt.key]: val },
                                },
                        };
                      });
                    }}
                    style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Email Digest Frequency */}
        <Box mb={4}>
          <FormLabel style={{ display: "block", marginBottom: "6px" }}>Email Digest Frequency</FormLabel>
          <select
            aria-label="Email Digest Frequency"
            disabled={controlsDisabled}
            value={notificationPrefs.emailDigestFrequency || "daily"}
            onChange={(e) => {
              const val = e.target.value as NonNullable<NotificationPreferences["emailDigestFrequency"]>;
              setNotificationPrefs((p) => ({ ...p, emailDigestFrequency: val }));
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-text-primary)",
              fontSize: "14px",
              width: "100%",
              maxWidth: "320px",
            }}
          >
            <option value="instant">Instant Delivery (As events occur)</option>
            <option value="daily">Daily Digest (Morning rollup)</option>
            <option value="weekly">Weekly Summary (Mondays)</option>
            <option value="never">Never (Mute email notifications)</option>
          </select>
        </Box>

        <Box display="flex" justifyContent="flex-end" mt={4}>
          <SaveButton
            disabled={controlsDisabled || isSavingNotifications}
            onClick={async () => {
              setIsSavingNotifications(true);
              setNotificationSuccess(null);
              setNotificationError(null);
              try {
                await updateNotificationSettings(notificationPrefs);
                setNotificationSuccess("Notification preferences saved successfully!");
                toast.success("Notification preferences saved successfully.");
              } catch (err: unknown) {
                const msg = getApiErrorMessage(err, "Failed to save notification preferences.");
                setNotificationError(msg);
                toast.error(msg, "Save Failed");
              } finally {
                setIsSavingNotifications(false);
              }
            }}
          >
            {isSavingNotifications ? "Saving..." : "Save Preferences"}
          </SaveButton>
        </Box>
      </Box>
    </>
  );
};
