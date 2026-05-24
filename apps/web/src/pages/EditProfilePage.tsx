import { Button, Heading, TextInput, Textarea } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import Box from "../components/Box";
import { API_BASE_URL } from "../config";

const EditProfilePage: React.FC = () => {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE_URL}/users/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ display_name: displayName, bio, location, website }),
      });
      navigate(`/${user?.username}`);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box p={4}>
      <Heading as="h1" mb={4}>
        Edit Profile
      </Heading>

      <Box display="flex" flexDirection="column" gap={3} maxWidth="500px">
        <Box>
          <Box mb={1} fontWeight="bold">
            Display Name
          </Box>
          <TextInput block value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Box>
        <Box>
          <Box mb={1} fontWeight="bold">
            Bio
          </Box>
          <Textarea block value={bio} onChange={(e) => setBio(e.target.value)} rows={3} />
        </Box>
        <Box>
          <Box mb={1} fontWeight="bold">
            Location
          </Box>
          <TextInput block value={location} onChange={(e) => setLocation(e.target.value)} />
        </Box>
        <Box>
          <Box mb={1} fontWeight="bold">
            Website
          </Box>
          <TextInput block value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </Box>

        <Box mt={3}>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default EditProfilePage;
