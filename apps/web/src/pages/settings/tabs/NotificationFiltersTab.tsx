// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  BroadcastIcon,
  ChevronRightIcon,
  FilterIcon,
  MailIcon,
  UnmuteIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationPreferences,
} from "../../../api";
import Box from "../../../components/Box";
import {
  DetailIcon,
  DetailItem,
  DetailSubtitle,
  DetailText,
  DetailTitle,
  FormLabel,
  Header,
  SaveButton,
} from "../settingsStyles";

export interface NotificationFiltersTabProps {
  subView: "notifications" | "notificationFilters";
  onNavigate: (tab: any) => void;
}

export const NotificationFiltersTab: React.FC<NotificationFiltersTabProps> = ({ subView, onNavigate }) => {
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (subView === "notificationFilters") {
      getNotificationSettings()
        .then((data) => {
          if (data) {
            setNotificationPrefs((prev) => ({
              ...prev,
              ...data,
              channels: { ...prev.channels, ...(data.channels || {}) } as NotificationPreferences["channels"],
              events: {
                social: { ...prev.events?.social, ...(data.events?.social || {}) },
                engineering: { ...prev.events?.engineering, ...(data.events?.engineering || {}) },
                computeHpc: { ...prev.events?.computeHpc, ...(data.events?.computeHpc || {}) },
              } as NotificationPreferences["events"],
            }));
          }
        })
        .catch(() => {});
    }
  }, [subView]);

  if (subView === "notifications") {
    return (
      <>
        <Header>Notifications</Header>
        <Box px={3} pb={3}>
          <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.4" }}>
            Select the kinds of notifications you get about your activities, interests, and recommendations.
          </DetailSubtitle>
        </Box>
        <DetailItem $clickable onClick={() => onNavigate("notificationFilters")}>
          <DetailIcon>
            <FilterIcon size={20} />
          </DetailIcon>
          <DetailText>
            <DetailTitle>Filters</DetailTitle>
            <DetailSubtitle>Choose the notifications you'd like to see — and those you don't.</DetailSubtitle>
          </DetailText>
          <ChevronRightIcon size={16} fill="var(--color-text-muted)" />
        </DetailItem>
      </>
    );
  }

  return (
    <>
      <Header>
        <Box
          display="flex"
          alignItems="center"
          gap={3}
          sx={{ cursor: "pointer" }}
          onClick={() => onNavigate("notifications")}
        >
          <ArrowLeftIcon size={20} />
          <span>Notification Preferences</span>
        </Box>
      </Header>
      <Box p={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
          Configure delivery channels, email digest frequency, and granular event filters for engineering models, social
          mentions, and high-performance computing solver jobs.
        </DetailSubtitle>

        {notificationSuccess && (
          <Box mb={3} p={3} bg="var(--color-success-subtle)" color="var(--color-success-fg)" borderRadius="6px">
            <Text fontSize="14px">{notificationSuccess}</Text>
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
            checked={Boolean(notificationPrefs.qualityFilter)}
            onChange={(e) => {
              const val = e.target.checked;
              setNotificationPrefs((p) => ({ ...p, qualityFilter: val }));
            }}
            style={{ width: "20px", height: "20px", cursor: "pointer" }}
          />
        </Box>

        {/* Delivery Channels */}
        <Box mb={4}>
          <DetailTitle style={{ fontWeight: "700", display: "block", marginBottom: "12px" }}>
            Delivery Channels
          </DetailTitle>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={3}>
            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box display="flex" alignItems="center" gap={2}>
                <MailIcon size={16} />
                <span style={{ fontSize: "14px", fontWeight: "600" }}>Email Notifications</span>
              </Box>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.channels?.email)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({
                    ...p,
                    channels: { ...p.channels, email: val } as any,
                  }));
                }}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
            </Box>

            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box display="flex" alignItems="center" gap={2}>
                <BroadcastIcon size={16} />
                <span style={{ fontSize: "14px", fontWeight: "600" }}>Browser Push</span>
              </Box>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.channels?.browserPush)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({
                    ...p,
                    channels: { ...p.channels, browserPush: val } as any,
                  }));
                }}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
            </Box>

            <Box
              p={3}
              style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px" }}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box display="flex" alignItems="center" gap={2}>
                <UnmuteIcon size={16} />
                <span style={{ fontSize: "14px", fontWeight: "600" }}>In-App Audio Alerts</span>
              </Box>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.inAppSounds)}
                onChange={(e) => {
                  const val = e.target.checked;
                  setNotificationPrefs((p) => ({ ...p, inAppSounds: val }));
                }}
                style={{ width: "18px", height: "18px", cursor: "pointer" }}
              />
            </Box>
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
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
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
                  style={{ width: "18px", height: "18px", cursor: "pointer" }}
                />
              </Box>
            ))}
          </Box>
        </Box>

        {/* Email Digest Frequency */}
        <Box mb={4}>
          <FormLabel style={{ display: "block", marginBottom: "6px" }}>Email Digest Frequency</FormLabel>
          <select
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
            disabled={isSavingNotifications}
            onClick={async () => {
              setIsSavingNotifications(true);
              setNotificationSuccess(null);
              try {
                await updateNotificationSettings(notificationPrefs);
                setNotificationSuccess("Notification preferences saved successfully!");
              } catch {
                // Handled
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
