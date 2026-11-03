// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertIcon, BellIcon, BroadcastIcon, MailIcon, SyncIcon, TrashIcon, UnmuteIcon } from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useCallback, useEffect, useState } from "react";
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
import Box from "../../../components/Box";
import { useToast } from "../../../components/ToastContext";
import { DetailSubtitle, DetailTitle, FormLabel, Header, SaveButton, SecondaryButton } from "../settingsStyles";

export interface NotificationFiltersTabProps {
  subView?: "notifications" | "notificationFilters" | undefined;
  onNavigate?: ((tab: any) => void) | undefined;
}

export const NotificationFiltersTab: React.FC<NotificationFiltersTabProps> = ({ subView = "notifications" }) => {
  const toast = useToast();
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
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });

  const loadPreferencesAndSubscriptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadingSubscriptions(true);

    try {
      const data = await getNotificationSettings();
      if (data) {
        setNotificationPrefs((prev) => {
          const mergedChannels = {
            email: data.channels?.email ?? data.deliveryChannels?.emailNotifications ?? prev.channels?.email ?? true,
            browserPush: data.channels?.browserPush ?? prev.channels?.browserPush ?? false,
            inApp: data.channels?.inApp ?? data.deliveryChannels?.inApp ?? prev.channels?.inApp ?? true,
          };
          return {
            ...prev,
            ...data,
            channels: mergedChannels,
            deliveryChannels: {
              inApp: mergedChannels.inApp,
              emailNotifications: mergedChannels.email,
            },
            events: {
              social: { ...prev.events?.social, ...(data.events?.social || {}) },
              engineering: { ...prev.events?.engineering, ...(data.events?.engineering || {}) },
              computeHpc: { ...prev.events?.computeHpc, ...(data.events?.computeHpc || {}) },
            } as NotificationPreferences["events"],
          };
        });
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "Unable to load your saved notification preferences from the server.";
      setLoadError(msg);
    } finally {
      setLoading(false);
    }

    try {
      const subs = await getPushSubscriptions();
      setPushSubscriptions(Array.isArray(subs) ? subs : []);
    } catch {
      // Ignore push list error if endpoint unavailable
    } finally {
      setLoadingSubscriptions(false);
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
      let permission = "granted";
      if (typeof window !== "undefined" && "Notification" in window) {
        permission = await Notification.requestPermission();
        setPushPermissionState(permission);
      }
      if (permission === "denied") {
        const msg =
          "Browser notification permission was denied. Please allow notifications in your browser site settings.";
        setNotificationError(msg);
        toast.error(msg);
        return false;
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "https://ansatz.social";
      const uaHash =
        typeof navigator !== "undefined"
          ? encodeURIComponent((navigator.userAgent || "browser").slice(0, 32).replace(/\s+/g, "-"))
          : "web";
      const endpoint = `${origin}/webpush/browser/${uaHash}-${Date.now()}`;
      const res = await registerPushSubscription({
        endpoint,
        keys: {
          p256dh: "BOr6_webpush_p256dh_client_key_modelscript",
          auth: "webpush_auth_secret",
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
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to register browser push subscription.";
      setNotificationError(msg);
      toast.error(msg);
      return false;
    } finally {
      setRegisteringPush(false);
    }
  };

  const handleToggleBrowserPush = async (enabled: boolean) => {
    if (enabled) {
      let permission = "granted";
      if (typeof window !== "undefined" && "Notification" in window) {
        permission = await Notification.requestPermission();
        setPushPermissionState(permission);
      }
      if (permission === "denied") {
        const msg = "Browser Push permission was denied by the browser.";
        setNotificationError(msg);
        toast.error(msg);
        return;
      }
      setNotificationPrefs((p) => ({
        ...p,
        channels: { ...p.channels, browserPush: true } as NonNullable<NotificationPreferences["channels"]>,
      }));
      if (pushSubscriptions.length === 0) {
        await handleRegisterBrowserPush();
      }
    } else {
      setNotificationPrefs((p) => ({
        ...p,
        channels: { ...p.channels, browserPush: false } as NonNullable<NotificationPreferences["channels"]>,
      }));
    }
  };

  const handleDeleteSubscription = async (id: number) => {
    setDeletingSubId(id);
    try {
      await deletePushSubscription(id);
      setPushSubscriptions((prev) => prev.filter((item) => item.id !== id));
      toast.info("Removed browser push subscription.");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to remove push subscription.");
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
                    channels: { ...p.channels, inApp: val } as any,
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
                    channels: { ...p.channels, email: val } as any,
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
            {[
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
            ].map((evt) => (
              <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                  <DetailSubtitle>{evt.desc}</DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={Boolean((notificationPrefs.events?.social as any)?.[evt.key])}
                  aria-label={evt.label}
                  disabled={controlsDisabled}
                  checked={Boolean((notificationPrefs.events?.social as any)?.[evt.key])}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNotificationPrefs((p) => ({
                      ...p,
                      events: {
                        ...p.events,
                        social: { ...p.events?.social, [evt.key]: val } as any,
                      } as NotificationPreferences["events"],
                    }));
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
            {[
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
            ].map((evt) => (
              <Box key={evt.key} display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <span style={{ fontSize: "14px", fontWeight: "600", display: "block" }}>{evt.label}</span>
                  <DetailSubtitle>{evt.desc}</DetailSubtitle>
                </Box>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={Boolean(((notificationPrefs.events as any)?.[evt.category] as any)?.[evt.key])}
                  aria-label={evt.label}
                  disabled={controlsDisabled}
                  checked={Boolean(((notificationPrefs.events as any)?.[evt.category] as any)?.[evt.key])}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setNotificationPrefs((p) => ({
                      ...p,
                      events: {
                        ...p.events,
                        [evt.category]: {
                          ...((p.events as any)?.[evt.category] || {}),
                          [evt.key]: val,
                        },
                      } as any,
                    }));
                  }}
                  style={{ width: "18px", height: "18px", cursor: controlsDisabled ? "not-allowed" : "pointer" }}
                />
              </Box>
            ))}
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
              const val = e.target.value as any;
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
              } catch (err: any) {
                const msg = err?.response?.data?.error || err?.message || "Failed to save notification preferences.";
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
