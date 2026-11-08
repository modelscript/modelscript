// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from "react";
import { listSpaces, type SpaceRecord } from "../api";
import CreateSpaceModal from "./spaces/CreateSpaceModal";
import SpaceCard from "./spaces/SpaceCard";
import Spinner from "./Spinner";

interface ProfileSpacesProps {
  username: string;
  isOwnProfile: boolean;
}

export const ProfileSpaces: React.FC<ProfileSpacesProps> = ({ username, isOwnProfile }) => {
  const [spaces, setSpaces] = useState<SpaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const fetchUserSpaces = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listSpaces({ ownerType: "user", namespace: username });
      setSpaces(list);
    } catch {
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void fetchUserSpaces();
  }, [fetchUserSpaces]);

  if (loading) {
    return (
      <div style={{ padding: "36px", display: "flex", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>Personal Engineering Spaces (@{username})</h3>
          <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "var(--color-text-muted)" }}>
            Git-backed Living Docs, real-time channels, and multiphysics sandboxes hosted in @{username}&apos;s profile
            container.
          </p>
        </div>

        {isOwnProfile && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            style={{
              padding: "7px 14px",
              borderRadius: "8px",
              border: "none",
              background: "var(--ms-brand, #2563eb)",
              color: "#ffffff",
              fontSize: "12.5px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + New Personal Space
          </button>
        )}
      </div>

      {spaces.length === 0 ? (
        <div
          style={{
            padding: "32px 20px",
            borderRadius: "12px",
            border: "1px dashed var(--color-border)",
            textAlign: "center",
          }}
        >
          <p style={{ margin: "0 0 12px", color: "var(--color-text-muted)", fontSize: "13.5px" }}>
            @{username} has not published any personal Spaces yet.
          </p>
          {isOwnProfile && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Create Personal Space
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "12px" }}>
          {spaces.map((sp) => (
            <SpaceCard key={sp.id} space={sp} />
          ))}
        </div>
      )}

      <CreateSpaceModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        defaultOwnerType="user"
        onCreated={() => {
          void fetchUserSpaces();
        }}
      />
    </div>
  );
};

export default ProfileSpaces;
