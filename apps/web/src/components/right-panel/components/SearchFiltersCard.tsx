// SPDX-License-Identifier: AGPL-3.0-or-later

import { Heading, Text } from "@primer/react";
import React from "react";
import { Card } from "../styles";

export const SearchFiltersCard: React.FC = () => {
  return (
    <Card style={{ padding: "16px" }}>
      <Heading
        as="h3"
        style={{
          fontSize: "18px",
          fontWeight: 800,
          marginBottom: "16px",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        Search filters
      </Heading>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <Text
            style={{
              fontWeight: "bold",
              fontSize: "14px",
              display: "block",
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            People
          </Text>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "14px",
              cursor: "pointer",
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            <span>From anyone</span>
            <input
              type="radio"
              name="people-filter"
              defaultChecked
              style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
            />
          </label>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "14px",
              cursor: "pointer",
              color: "var(--color-text-primary)",
            }}
          >
            <span>People you follow</span>
            <input
              type="radio"
              name="people-filter"
              style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
            />
          </label>
        </div>

        <div style={{ height: "1px", backgroundColor: "var(--color-border)" }} />

        <div>
          <Text
            style={{
              fontWeight: "bold",
              fontSize: "14px",
              display: "block",
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            Location
          </Text>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "14px",
              cursor: "pointer",
              marginBottom: "8px",
              color: "var(--color-text-primary)",
            }}
          >
            <span>Anywhere</span>
            <input
              type="radio"
              name="location-filter"
              defaultChecked
              style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
            />
          </label>
          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "14px",
              cursor: "pointer",
              color: "var(--color-text-primary)",
            }}
          >
            <span>Near you</span>
            <input
              type="radio"
              name="location-filter"
              style={{ accentColor: "var(--color-accent-cyan)", width: "16px", height: "16px" }}
            />
          </label>
        </div>

        <div style={{ height: "1px", backgroundColor: "var(--color-border)" }} />

        <a
          href="#advanced"
          style={{ color: "var(--color-accent-cyan)", textDecoration: "none", fontSize: "14px", fontWeight: "500" }}
        >
          Advanced search
        </a>
      </div>
    </Card>
  );
};
