// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getUserFollowing } from "../api";
import { useAuth } from "../AuthContext";
import { usePageTitle } from "../util/title";
import { FollowListPageLayout, type FollowUser } from "./FollowersPage";

const FollowingPage: React.FC = () => {
  const { username } = useParams();
  usePageTitle(username ? `People followed by @${username}` : "Following");
  const { token } = useAuth();
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!username) return;
      setLoading(true);
      try {
        const data = await getUserFollowing(username);
        setUsers(data.following || []);
      } catch (err) {
        console.error("Failed to load following", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username, token]);

  return (
    <FollowListPageLayout
      username={username}
      activeTab="following"
      users={users}
      loading={loading}
      emptyMessage={`@${username} isn't following anyone yet.`}
    />
  );
};

export default FollowingPage;
