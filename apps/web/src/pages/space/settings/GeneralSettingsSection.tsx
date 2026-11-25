// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Heading, Label, Text, TextInput, Textarea } from "@primer/react";
import React from "react";
import type { SpaceDomainPreset, SpaceRecord } from "../../../api";
import Box from "../../../components/Box";
import { StyledBox } from "../../workspace/styles";
import { FieldDescription, FieldLabel, FormRow } from "./styles";
import type { SpacePatch } from "./types";

export interface GeneralSettingsSectionProps {
  space: SpaceRecord;
  canAdmin: boolean;
  saving: boolean;
  name: string;
  setName: (value: string) => void;
  tagline: string;
  setTagline: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  domainPreset: string;
  setDomainPreset: (value: string) => void;
  avatarUrl: string;
  setAvatarUrl: (value: string) => void;
  bannerUrl: string;
  setBannerUrl: (value: string) => void;
  availablePresets: SpaceDomainPreset[];
  activePresetObj: SpaceDomainPreset;
  onSaveSpacePatch: (patch: SpacePatch, successMessage: string) => Promise<boolean>;
}

export const GeneralSettingsSection: React.FC<GeneralSettingsSectionProps> = ({
  space,
  canAdmin,
  saving,
  name,
  setName,
  tagline,
  setTagline,
  description,
  setDescription,
  domainPreset,
  setDomainPreset,
  avatarUrl,
  setAvatarUrl,
  bannerUrl,
  setBannerUrl,
  availablePresets,
  activePresetObj,
  onSaveSpacePatch,
}) => (
  <Box display="flex" flexDirection="column" gap={4}>
    <Box>
      <Heading
        as="h2"
        style={{
          fontSize: "24px",
          borderBottom: "1px solid var(--color-border-default)",
          paddingBottom: "8px",
          marginBottom: "8px",
        }}
      >
        General Settings
      </Heading>
      <Text color="var(--color-fg-muted)" style={{ fontSize: "13px", display: "block", marginBottom: "20px" }}>
        Configure Space profile identity, engineering domain classification, and branding metadata.
      </Text>

      <StyledBox p={4} display="flex" flexDirection="column" gap={4}>
        <FormRow>
          <FieldLabel>Space Name</FieldLabel>
          <FieldDescription>
            The human-readable engineering title of this collaborative cyber-physical Space.
          </FieldDescription>
          <Box display="flex" gap={2} flexWrap="wrap">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. eVTOL 6-DOF Flight Dynamics & Flight Control"
              block
              disabled={!canAdmin}
            />
            {canAdmin && (
              <Button
                variant="primary"
                disabled={saving || !name.trim() || name === space.name}
                onClick={() => void onSaveSpacePatch({ name: name.trim() }, "Space name updated.")}
              >
                Update Name
              </Button>
            )}
          </Box>
        </FormRow>

        <FormRow>
          <FieldLabel>Tagline / Mission Summary</FieldLabel>
          <FieldDescription>
            A concise one-line summary displayed beneath the Space title and across search results.
          </FieldDescription>
          <Box display="flex" gap={2} flexWrap="wrap">
            <TextInput
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="e.g. Full-envelope 6-DOF rigid body flight dynamics and battery thermal runaway protection loop."
              block
              disabled={!canAdmin}
            />
            {canAdmin && (
              <Button
                disabled={saving || tagline === (space.tagline || "")}
                onClick={() => void onSaveSpacePatch({ tagline: tagline.trim() || null }, "Tagline updated.")}
              >
                Update Tagline
              </Button>
            )}
          </Box>
        </FormRow>

        <FormRow>
          <FieldLabel>Engineering Scope & Extended Description</FieldLabel>
          <FieldDescription>
            Detailed engineering scope, requirements overview, and mission architecture parameters.
          </FieldDescription>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide a comprehensive technical overview of this Space..."
            rows={4}
            block
            disabled={!canAdmin}
          />
          {canAdmin && (
            <Box alignSelf="flex-start" mt={1}>
              <Button
                size="small"
                disabled={saving || description === (space.description || "")}
                onClick={() =>
                  void onSaveSpacePatch({ description: description.trim() || null }, "Extended description updated.")
                }
              >
                Update Description
              </Button>
            </Box>
          )}
        </FormRow>

        <FormRow>
          <FieldLabel>Space Avatar & Icon URL</FieldLabel>
          <FieldDescription>Custom graphic image URL representing this Space.</FieldDescription>
          <Box display="flex" gap={2} alignItems="center">
            <TextInput
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/space-avatar.png"
              block
              disabled={!canAdmin}
            />
            {canAdmin && (
              <Button
                size="small"
                disabled={saving || avatarUrl === (space.avatar_url || "")}
                onClick={() => void onSaveSpacePatch({ avatarUrl: avatarUrl.trim() || null }, "Avatar updated.")}
              >
                Save
              </Button>
            )}
          </Box>
        </FormRow>

        <FormRow>
          <FieldLabel>Banner Graphic URL</FieldLabel>
          <FieldDescription>Header banner image displayed on the Space overview page.</FieldDescription>
          <Box display="flex" gap={2} alignItems="center">
            <TextInput
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              placeholder="https://example.com/space-banner.png"
              block
              disabled={!canAdmin}
            />
            {canAdmin && (
              <Button
                size="small"
                disabled={saving || bannerUrl === (space.banner_url || "")}
                onClick={() => void onSaveSpacePatch({ bannerUrl: bannerUrl.trim() || null }, "Banner updated.")}
              >
                Save
              </Button>
            )}
          </Box>
        </FormRow>
      </StyledBox>
    </Box>

    {/* Domain Taxonomy Card */}
    <Box>
      <Heading as="h3" style={{ fontSize: "18px", marginBottom: "12px" }}>
        Domain Taxonomy & Solvers
      </Heading>
      <StyledBox p={4} display="flex" flexDirection="column" gap={3}>
        <FormRow>
          <FieldLabel>Domain Preset</FieldLabel>
          <FieldDescription>
            Determines the default simulation solvers, polyglot compiler frontends, diagram themes, and compliance
            rulepacks.
          </FieldDescription>
          <select
            value={domainPreset}
            onChange={(e) => setDomainPreset(e.target.value)}
            disabled={!canAdmin}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            {availablePresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.icon} {p.name}
              </option>
            ))}
          </select>
        </FormRow>

        {activePresetObj && (
          <Box
            p={3}
            borderRadius={2}
            style={{
              background: "var(--color-canvas-subtle)",
              border: `1px solid ${activePresetObj.accentColor}33`,
            }}
            display="flex"
            flexDirection="column"
            gap={2}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: activePresetObj.accentColor,
                  display: "inline-block",
                }}
              />
              <Text style={{ fontWeight: 700, fontSize: "14px", color: activePresetObj.accentColor }}>
                {activePresetObj.name}
              </Text>
              <Label variant="accent" style={{ fontSize: "10px" }}>
                {activePresetObj.shortLabel}
              </Label>
            </Box>
            <Text style={{ fontSize: "13px", color: "var(--color-fg-muted)" }}>{activePresetObj.description}</Text>
            {activePresetObj.replacesTools && activePresetObj.replacesTools.length > 0 && (
              <Box display="flex" gap={1} flexWrap="wrap" alignItems="center" mt={1}>
                <Text style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-fg-muted)" }}>
                  Replaces Legacy Toolchains:
                </Text>
                {activePresetObj.replacesTools.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: "10.5px",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid var(--color-border-muted)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </Box>
            )}
          </Box>
        )}

        {canAdmin && (
          <Box alignSelf="flex-start" mt={1}>
            <Button
              disabled={saving || domainPreset === space.domain_preset}
              onClick={() =>
                void onSaveSpacePatch({ domainPreset }, `Domain taxonomy changed to ${activePresetObj.name}.`)
              }
            >
              Update Domain Preset
            </Button>
          </Box>
        )}
      </StyledBox>
    </Box>

    {/* Container Identity Card */}
    <Box>
      <Heading as="h3" style={{ fontSize: "18px", marginBottom: "12px" }}>
        Container Identity & Architecture
      </Heading>
      <StyledBox p={3}>
        <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          <Box>
            <Text
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                color: "var(--color-fg-muted)",
                textTransform: "uppercase",
              }}
            >
              Owner Namespace
            </Text>
            <Text style={{ fontSize: "14px", fontWeight: 600, display: "block", marginTop: "2px" }}>
              {space.owner_type === "organization" ? "🏢 @" : "👤 @"}
              {space.owner_namespace}
            </Text>
          </Box>
          <Box>
            <Text
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                color: "var(--color-fg-muted)",
                textTransform: "uppercase",
              }}
            >
              Container Slug
            </Text>
            <Text
              style={{
                fontSize: "14px",
                fontFamily: "var(--ms-font-mono, monospace)",
                display: "block",
                marginTop: "2px",
              }}
            >
              {space.slug}
            </Text>
          </Box>
          <Box>
            <Text
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                color: "var(--color-fg-muted)",
                textTransform: "uppercase",
              }}
            >
              Visibility
            </Text>
            <Box mt={1}>
              <Label variant={space.visibility === "public" ? "success" : "secondary"}>
                {space.visibility.toUpperCase()}
              </Label>
            </Box>
          </Box>
          <Box>
            <Text
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                color: "var(--color-fg-muted)",
                textTransform: "uppercase",
              }}
            >
              Backing Git Vault
            </Text>
            <Text
              style={{
                fontSize: "12.5px",
                fontFamily: "var(--ms-font-mono, monospace)",
                color: "var(--color-fg-muted)",
                marginTop: "2px",
              }}
            >
              {space.default_branch || "main"}
            </Text>
          </Box>
        </Box>
      </StyledBox>
    </Box>
  </Box>
);
