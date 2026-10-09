// SPDX-License-Identifier: AGPL-3.0-or-later

import { CloudOfflineIcon, ZapIcon } from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";

const slideDown = keyframes`
  from {
    transform: translate(-50%, -20px);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0);
    opacity: 1;
  }
`;

const BannerContainer = styled.div`
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(22, 27, 34, 0.95);
  border: 1px solid rgba(210, 153, 34, 0.4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  font-size: 12px;
  font-weight: 500;
  color: #e6edf3;
  animation: ${slideDown} 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
`;

const WarningDot = styled.span`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #d29922;
  box-shadow: 0 0 8px #d29922;
`;

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <BannerContainer role="status" aria-live="polite">
      <WarningDot />
      <CloudOfflineIcon size={14} fill="#d29922" />
      <span>Offline Mode — Viewing cached models &amp; timeline.</span>
      <span style={{ color: "var(--color-fg-muted)", display: "inline-flex", alignItems: "center", gap: "3px" }}>
        <ZapIcon size={12} fill="#06b6d4" /> Local WASM active
      </span>
    </BannerContainer>
  );
};

export default OfflineBanner;
