// SPDX-License-Identifier: AGPL-3.0-or-later

import { DeviceCameraIcon, LinkIcon, TrashIcon, UploadIcon } from "@primer/octicons-react";
import { Button, Flash, Spinner, TextInput, Textarea } from "@primer/react";
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserProfile, updateUserProfile } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import PageHeader from "../components/PageHeader";
import { usePageTitle } from "../util/title";
import { safeCssImageUrl } from "../util/url";

const DISPLAY_NAME_MAX = 50;
const BIO_MAX = 160;

async function readAndResizeImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("Empty image file"));
        return;
      }
      if (file.type === "image/svg+xml" || file.type === "image/gif") {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
          resolve(canvas.toDataURL(outputType, 0.86));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

const EditProfilePage: React.FC = () => {
  usePageTitle("Edit Profile");
  const { user, token, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [showUrlInputs, setShowUrlInputs] = useState(false);
  const [dragTarget, setDragTarget] = useState<"banner" | "avatar" | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user?.username) {
      setInitialLoading(false);
      return;
    }

    const username = user.username;
    async function loadCurrentProfile() {
      try {
        const data = await getUserProfile(username);
        const p = data.profile;
        if (p) {
          setDisplayName(p.display_name || "");
          setBio(p.bio || "");
          setLocation(p.location || "");
          setWebsite(p.website || "");
          setAvatarUrl(p.avatar_url || "");
          setBannerUrl(p.banner_url || "");
        }
      } catch (err) {
        console.error("Failed to load user profile", err);
      } finally {
        setInitialLoading(false);
      }
    }

    loadCurrentProfile();
  }, [user?.username, token]);

  const handleImageFile = async (file: File | undefined, target: "banner" | "avatar") => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (PNG, JPEG, WebP, GIF, or SVG).");
      return;
    }
    setError(null);
    try {
      const dataUrl =
        target === "banner" ? await readAndResizeImage(file, 1200, 400) : await readAndResizeImage(file, 256, 256);
      if (target === "banner") {
        setBannerUrl(dataUrl);
      } else {
        setAvatarUrl(dataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image file");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updateUserProfile({
        display_name: displayName.slice(0, DISPLAY_NAME_MAX),
        bio: bio.slice(0, BIO_MAX),
        location,
        website,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
      });
      await refreshUser();

      setSuccess(true);
      setTimeout(() => {
        navigate(`/${user?.username}`);
      }, 700);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (initialLoading) {
    return (
      <Box p={6} display="flex" justifyContent="center">
        <Spinner size="large" />
      </Box>
    );
  }

  const resolvedBannerCss = safeCssImageUrl(bannerUrl);
  const resolvedAvatarCss = safeCssImageUrl(avatarUrl);
  const avatarInitial = (displayName || user?.username || "?").charAt(0).toUpperCase();

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "100px" }}>
      <PageHeader back title="Edit Profile" />

      <Box p={4} maxWidth="640px" mx="auto">
        {error && (
          <Flash variant="danger" style={{ marginBottom: "16px" }}>
            {error}
          </Flash>
        )}
        {success && (
          <Flash variant="success" style={{ marginBottom: "16px" }}>
            Profile updated successfully! Redirecting...
          </Flash>
        )}

        <form onSubmit={handleSave}>
          <Box display="flex" flexDirection="column" gap={3}>
            {/* Hidden file inputs for WYSIWYG Banner & Avatar */}
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              aria-label="Upload banner image"
              onChange={(e) => {
                handleImageFile(e.target.files?.[0], "banner");
                e.target.value = "";
              }}
            />
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              aria-label="Upload avatar image"
              onChange={(e) => {
                handleImageFile(e.target.files?.[0], "avatar");
                e.target.value = "";
              }}
            />

            {/* Unified WYSIWYG Profile Banner (180px) + overlapping circular Avatar (96px) header */}
            <Box
              style={{
                borderRadius: "14px",
                border: "1px solid var(--color-border-default)",
                background: "var(--surface-overlay, var(--color-canvas-subtle))",
                overflow: "hidden",
                paddingBottom: "16px",
              }}
            >
              {/* 180px Interactive Banner */}
              <div
                role="button"
                tabIndex={0}
                aria-label="Click or drag and drop an image to update profile banner"
                onClick={() => bannerInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    bannerInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragTarget("banner");
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (dragTarget === "banner") setDragTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragTarget(null);
                  const file = e.dataTransfer.files?.[0];
                  void handleImageFile(file, "banner");
                }}
                style={{
                  position: "relative",
                  height: "180px",
                  width: "100%",
                  cursor: "pointer",
                  backgroundColor: "var(--color-canvas-subtle)",
                  backgroundImage:
                    resolvedBannerCss ||
                    "linear-gradient(135deg, rgba(6, 182, 212, 0.22) 0%, rgba(139, 92, 246, 0.22) 100%)",
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  outline: dragTarget === "banner" ? "2px dashed var(--color-accent-cyan, #06b6d4)" : "none",
                  outlineOffset: "-4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "filter 0.15s ease",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 14px",
                    borderRadius: "9999px",
                    background: "rgba(10, 15, 28, 0.72)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                    color: "#ffffff",
                    fontSize: "12px",
                    fontWeight: 600,
                    pointerEvents: "none",
                  }}
                >
                  <UploadIcon size={14} />
                  <span>{dragTarget === "banner" ? "Drop banner image here" : "Click or drag to change banner"}</span>
                </div>

                {bannerUrl && (
                  <button
                    type="button"
                    aria-label="Remove banner image"
                    title="Remove banner image"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBannerUrl("");
                    }}
                    style={{
                      position: "absolute",
                      top: "12px",
                      right: "12px",
                      width: "32px",
                      height: "32px",
                      borderRadius: "50%",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      background: "rgba(10, 15, 28, 0.75)",
                      color: "#ffffff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>

              {/* Overlapping 96px Circular Avatar + URL toggle row */}
              <Box
                px={3}
                display="flex"
                alignItems="flex-end"
                justifyContent="space-between"
                style={{ marginTop: "-48px", position: "relative", zIndex: 2 }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Click or drag and drop an image to update profile avatar"
                  onClick={(e) => {
                    e.stopPropagation();
                    avatarInputRef.current?.click();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      avatarInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragTarget("avatar");
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragTarget === "avatar") setDragTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragTarget(null);
                    const file = e.dataTransfer.files?.[0];
                    void handleImageFile(file, "avatar");
                  }}
                  style={{
                    position: "relative",
                    width: "96px",
                    height: "96px",
                    borderRadius: "50%",
                    backgroundColor: "var(--color-accent-purple, #8b5cf6)",
                    backgroundImage: resolvedAvatarCss || "none",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    border:
                      dragTarget === "avatar"
                        ? "3px dashed var(--color-accent-cyan, #06b6d4)"
                        : "4px solid var(--color-bg-primary, #0b0f19)",
                    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#ffffff",
                    fontSize: "34px",
                    fontWeight: 800,
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {!resolvedAvatarCss && <span>{avatarInitial}</span>}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(10, 15, 28, 0.45)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                    }}
                  >
                    <DeviceCameraIcon size={20} />
                  </div>
                </div>

                <Box display="flex" alignItems="center" gap={2} mb={1}>
                  {avatarUrl && (
                    <Button size="small" type="button" onClick={() => setAvatarUrl("")} style={{ fontSize: "12px" }}>
                      Clear avatar
                    </Button>
                  )}
                  <Button
                    size="small"
                    type="button"
                    leadingVisual={LinkIcon}
                    onClick={() => setShowUrlInputs((prev) => !prev)}
                    aria-expanded={showUrlInputs}
                  >
                    {showUrlInputs ? "Hide image URLs" : "Use image URL"}
                  </Button>
                </Box>
              </Box>

              {showUrlInputs && (
                <Box
                  px={3}
                  pt={3}
                  mt={3}
                  display="flex"
                  flexDirection="column"
                  gap={2}
                  style={{ borderTop: "1px solid var(--color-border-subtle)" }}
                >
                  <Box>
                    <Box mb={1} fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)">
                      Banner Image URL
                    </Box>
                    <TextInput
                      block
                      value={bannerUrl}
                      onChange={(e) => setBannerUrl(e.target.value)}
                      placeholder="https://example.com/banner.jpg"
                      aria-label="Banner Image URL"
                    />
                  </Box>
                  <Box>
                    <Box mb={1} fontWeight="bold" fontSize="12px" color="var(--color-fg-muted)">
                      Avatar Image URL
                    </Box>
                    <TextInput
                      block
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      aria-label="Avatar Image URL"
                    />
                  </Box>
                </Box>
              )}
            </Box>

            <Box>
              <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                <Box fontWeight="bold" fontSize="14px">
                  Display Name
                </Box>
                <Box
                  fontSize="12px"
                  style={{
                    color:
                      displayName.length >= DISPLAY_NAME_MAX
                        ? "var(--color-danger-fg, #f85149)"
                        : displayName.length >= DISPLAY_NAME_MAX - 5
                          ? "#f59e0b"
                          : "var(--color-fg-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {displayName.length}/{DISPLAY_NAME_MAX}
                </Box>
              </Box>
              <TextInput
                block
                value={displayName}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => setDisplayName(e.target.value.slice(0, DISPLAY_NAME_MAX))}
                placeholder="e.g. Jane Doe"
                aria-label="Display Name"
              />
            </Box>

            <Box>
              <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
                <Box fontWeight="bold" fontSize="14px">
                  Bio
                </Box>
                <Box
                  fontSize="12px"
                  style={{
                    color:
                      bio.length >= BIO_MAX
                        ? "var(--color-danger-fg, #f85149)"
                        : bio.length >= BIO_MAX - 15
                          ? "#f59e0b"
                          : "var(--color-fg-muted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {bio.length}/{BIO_MAX}
                </Box>
              </Box>
              <Textarea
                block
                value={bio}
                maxLength={BIO_MAX}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                rows={3}
                placeholder="Tell the community about your research and simulation models..."
                aria-label="Bio"
              />
            </Box>

            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Location
              </Box>
              <TextInput
                block
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Zurich, Switzerland"
                aria-label="Location"
              />
            </Box>

            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Website
              </Box>
              <TextInput
                block
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://ansatz.social"
                aria-label="Website"
              />
            </Box>

            <Box mt={3} display="flex" gap={2}>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </Button>
              <Button type="button" onClick={() => navigate(-1)} disabled={saving}>
                Cancel
              </Button>
            </Box>
          </Box>
        </form>
      </Box>
    </Box>
  );
};

export default EditProfilePage;
