// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { followUser, unfollowUser } from "../api";

interface FollowButtonProps {
  username: string;
  initialIsFollowing: boolean;
  onToggle?: (isFollowing: boolean) => void;
  size?: "small" | "medium" | "large";
  isRssFeed?: boolean;
}

const StyledFollowBtn = styled.button<{ $isFollowing: boolean; $size?: string }>`
  border-radius: 9999px;
  font-weight: 600;
  font-size: ${(props) => (props.$size === "small" ? "12px" : "13.5px")};
  height: ${(props) => (props.$size === "small" ? "30px" : "36px")};
  padding: ${(props) => (props.$size === "small" ? "0 14px" : "0 20px")};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;

  ${(props) =>
    props.$isFollowing
      ? `
    background-color: transparent;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-strong);
    box-shadow: none;

    &:hover {
      background-color: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.35);
      color: var(--color-error);
    }
  `
      : `
    background-color: var(--color-text-primary);
    color: var(--color-bg-primary);
    border: 1px solid var(--color-text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);

    &:hover {
      opacity: 0.88;
      transform: translateY(-1px);
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.12);
    }

    &:active {
      transform: translateY(0);
    }
  `}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

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
      if (isFollowing) {
        await unfollowUser(username);
      } else {
        await followUser(username);
      }
      setIsFollowing(!isFollowing);
      onToggle?.(!isFollowing);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <StyledFollowBtn onClick={toggleFollow} disabled={loading} $isFollowing={isFollowing} $size={size}>
      {isFollowing ? (isRssFeed ? "Subscribed" : "Following") : isRssFeed ? "Subscribe" : "Follow"}
    </StyledFollowBtn>
  );
};

export default FollowButton;
