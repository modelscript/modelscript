// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "../components/Box";

const OAuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // We'll update useAuth later to handle this directly,
  // but for now we just read the token from the URL if returned that way.

  useEffect(() => {
    // Check search params or hash fragment for token
    let token = searchParams.get("token");
    if (!token && window.location.hash) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (token) {
      // Immediately scrub token from address bar and history to prevent leakage
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.setItem("modelscript-auth-token", token);
      window.location.href = "/home"; // Hard reload to re-init auth context
    } else {
      // Simulate OAuth flow locally if no backend token is present
      const timer = setTimeout(() => navigate("/login"), 2000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, navigate]);

  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100vh">
      <Spinner size="large" />
      <Text mt={3} color="var(--color-fg-muted)">
        Authenticating with provider...
      </Text>
    </Box>
  );
};

export default OAuthCallbackPage;
