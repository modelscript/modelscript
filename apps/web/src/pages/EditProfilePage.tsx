// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon } from "@primer/octicons-react";
import { Button, Flash, Heading, Spinner, TextInput, Textarea } from "@primer/react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserProfile, updateUserProfile } from "../api";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { CircleIconButton, StickyHeader } from "../components/SharedStyles";
import { usePageTitle } from "../util/title";

const EditProfilePage: React.FC = () => {
  usePageTitle("Edit Profile");
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!user?.username) {
      setInitialLoading(false);
      return;
    }

    async function loadCurrentProfile() {
      try {
        const data = await getUserProfile(user.username);
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await updateUserProfile({
        display_name: displayName,
        bio,
        location,
        website,
        avatar_url: avatarUrl,
        banner_url: bannerUrl,
      });

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

  return (
    <Box minHeight="100vh" style={{ paddingBottom: "100px" }}>
      <StickyHeader style={{ gap: "16px", padding: "12px 16px" }}>
        <CircleIconButton onClick={() => navigate(-1)} aria-label="Go Back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        <Heading as="h2" style={{ fontSize: "20px", margin: 0, fontWeight: 700 }}>
          Edit Profile
        </Heading>
      </StickyHeader>

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
            {/* Banner preview */}
            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Banner Image URL
              </Box>
              <TextInput
                block
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://example.com/banner.jpg"
              />
              {bannerUrl && (
                <Box
                  mt={2}
                  style={{
                    height: "120px",
                    borderRadius: "8px",
                    backgroundImage: `url(${bannerUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    border: "1px solid var(--color-border-default)",
                  }}
                />
              )}
            </Box>

            {/* Avatar preview */}
            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Avatar Image URL
              </Box>
              <Box display="flex" gap={3} alignItems="center">
                <TextInput
                  block
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                />
                {avatarUrl && (
                  <Box
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      backgroundImage: `url(${avatarUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      border: "2px solid var(--color-accent-emphasis)",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Box>
            </Box>

            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Display Name
              </Box>
              <TextInput
                block
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Jane Doe"
              />
            </Box>

            <Box>
              <Box mb={1} fontWeight="bold" fontSize="14px">
                Bio
              </Box>
              <Textarea
                block
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                placeholder="Tell the community about your research and simulation models..."
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
                placeholder="https://modelscript.org"
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
