import React, { useState } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";

interface FollowButtonProps {
  username: string;
  initialIsFollowing: boolean;
  onToggle?: (isFollowing: boolean) => void;
  size?: "small" | "medium" | "large";
  isRssFeed?: boolean;
}

const FollowButton: React.FC<FollowButtonProps> = ({ username, initialIsFollowing, onToggle, size, isRssFeed }) => {
  const { token, user } = useAuth();
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [loading, setLoading] = useState(false);

  if (user?.username === username) return null; // Don't show follow button for self

  const toggleFollow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!token) return; // In a real app, redirect to login

    setLoading(true);
    try {
      const method = isFollowing ? "DELETE" : "POST";
      const res = await fetch(`${API_BASE_URL}/users/${username}/follow`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIsFollowing(!isFollowing);
        onToggle?.(!isFollowing);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggleFollow}
      disabled={loading}
      style={{
        borderRadius: "9999px",
        fontWeight: "bold",
        padding: size === "small" ? "6px 12px" : "8px 24px",
        backgroundColor: isFollowing ? "transparent" : "#1f1f1f",
        color: isFollowing ? "var(--color-fg-default)" : "#ffffff",
        border: isFollowing ? "1px solid var(--color-border-default)" : "1px solid #1f1f1f",
        cursor: "pointer",
        fontSize: "14px",
      }}
    >
      {isFollowing ? (isRssFeed ? "Subscribed" : "Following") : isRssFeed ? "Subscribe" : "Follow"}
    </button>
  );
};

export default FollowButton;
