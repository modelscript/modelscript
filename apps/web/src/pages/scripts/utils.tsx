// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BeakerIcon,
  ClockIcon,
  DatabaseIcon,
  FlameIcon,
  GraphIcon,
  LinkIcon,
  PulseIcon,
  RocketIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "@primer/octicons-react";
import React from "react";

export const normalizeStatus = (rawStatus: string): "RUNNING" | "QUEUED" | "SUCCESS" | "FAILED" | "CANCELLED" => {
  const s = String(rawStatus).toUpperCase();
  if (s === "RUNNING" || s === "PROCESSING") return "RUNNING";
  if (s === "QUEUED" || s === "PENDING" || s === "PROVISIONING") return "QUEUED";
  if (s === "SUCCESS" || s === "COMPLETED") return "SUCCESS";
  if (s === "FAILED" || s === "ERROR") return "FAILED";
  if (s === "CANCELLED" || s === "ABORTED") return "CANCELLED";
  return "QUEUED";
};

export const relativeTime = (dateStr: string | number): string => {
  if (!dateStr) return "recently";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export const categoryIcon = (icon: string): React.ReactElement => {
  switch (icon) {
    case "wind":
      return <RocketIcon size={20} />;
    case "clock":
      return <ClockIcon size={20} />;
    case "flame":
      return <FlameIcon size={20} />;
    case "shield":
      return <ShieldCheckIcon size={20} />;
    case "pulse":
      return <PulseIcon size={20} />;
    case "thermometer":
      return <BeakerIcon size={20} />;
    case "link":
      return <LinkIcon size={20} />;
    case "graph":
      return <GraphIcon size={20} />;
    case "database":
      return <DatabaseIcon size={20} />;
    default:
      return <TerminalIcon size={20} />;
  }
};
