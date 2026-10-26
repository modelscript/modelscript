// SPDX-License-Identifier: AGPL-3.0-or-later

import { MarkGithubIcon } from "@primer/octicons-react";
import { Heading, Text } from "@primer/react";
import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../Box";
import { Card, ProviderButton } from "../styles";

export const AuthPromptCard: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Card>
      <Heading as="h2" style={{ fontSize: "16px", marginBottom: "6px", fontWeight: 700 }}>
        Engineering Platform
      </Heading>
      <Text as="p" color="var(--color-text-muted)" style={{ fontSize: "13px", marginBottom: "12px", lineHeight: 1.4 }}>
        Simulate physical systems, export FMUs, and collaborate with engineers worldwide.
      </Text>
      <Box display="flex" flexDirection="column" gap={2}>
        <ProviderButton onClick={() => (window.location.href = "/api/v1/auth/login/github")}>
          <MarkGithubIcon size={16} />
          Continue with GitHub
        </ProviderButton>
        <button
          onClick={() => navigate("/signup")}
          style={{
            height: 36,
            background: "var(--gradient-cta)",
            color: "white",
            border: "none",
            borderRadius: 9999,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            width: "100%",
            boxShadow: "0 0 10px rgba(139, 92, 246, 0.25)",
          }}
        >
          Create Free Account
        </button>
      </Box>
      <Box
        mt={3}
        pt={2}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Have an account?</span>
        <button
          onClick={() => navigate("/login")}
          style={{
            background: "none",
            border: "none",
            color: "var(--color-accent-cyan)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
          }}
        >
          Sign in →
        </button>
      </Box>
    </Card>
  );
};
