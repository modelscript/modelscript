// SPDX-License-Identifier: AGPL-3.0-or-later

import { Spinner, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Box from "../components/Box";

const OAuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Check search params or hash fragment for token
    let token = searchParams.get("token");
    if (!token && window.location.hash) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]!);
    }

    if (token) {
      // Immediately scrub token from address bar and history to prevent leakage
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.setItem("modelscript-auth-token", token);
      window.location.href = "/home"; // Hard reload to re-init auth context
      return undefined;
    } else {
      const errorParam = searchParams.get("error_description") || searchParams.get("error");
      setAuthError(
        errorParam
          ? `Authentication failed: ${errorParam}. Redirecting to login...`
          : "Authentication failed or was cancelled. Redirecting to login...",
      );
      const timer = setTimeout(() => navigate("/login"), 2000);
      return () => clearTimeout(timer);
    }
  }, [searchParams, navigate]);

  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100vh" px={3}>
      {authError ? (
        <Box
          p={3}
          style={{
            background: "rgba(248, 81, 73, 0.1)",
            border: "1px solid rgba(248, 81, 73, 0.4)",
            borderRadius: "8px",
            color: "var(--color-danger-fg)",
            maxWidth: "420px",
            textAlign: "center",
          }}
          role="alert"
        >
          <Text fontWeight="bold" display="block" mb={1}>
            OAuth Sign-In Failed
          </Text>
          <Text fontSize={1}>{authError}</Text>
        </Box>
      ) : (
        <>
          <Spinner size="large" />
          <Text mt={3} color="var(--color-fg-muted)">
            Authenticating with provider...
          </Text>
        </>
      )}
    </Box>
  );
};

export default OAuthCallbackPage;
