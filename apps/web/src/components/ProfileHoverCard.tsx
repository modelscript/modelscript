/* eslint-disable */
import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";

const PopoverContainer = styled.div`
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  margin-top: 8px;
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  padding: 16px;
  width: 300px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: default;
`;

interface AvatarProps {
  $url?: string;
  $letter?: string;
}
const Avatar = styled.div<AvatarProps>`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background-color: var(--color-done-emphasis);
  background-image: ${(props) => (props.$url ? `url("${props.$url}")` : "none")};
  background-size: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 24px;
  flex-shrink: 0;

  &::after {
    content: "${(props: any) => (!props.$url && props.$letter ? props.$letter : "")}";
  }
`;

interface FollowButtonProps {
  $following: boolean;
  $blocked?: boolean;
}
const FollowButton = styled.button<FollowButtonProps>`
  border-radius: 9999px;
  font-weight: bold;
  padding: 6px 16px;
  border: none;
  cursor: pointer;
  background-color: ${(props) =>
    props.$blocked
      ? "var(--color-danger-emphasis)"
      : props.$following
        ? "var(--color-canvas-subtle)"
        : "var(--color-fg-default)"};
  color: ${(props) =>
    props.$blocked ? "white" : props.$following ? "var(--color-fg-default)" : "var(--color-bg-primary)"};
  border: ${(props) => (props.$following && !props.$blocked ? "1px solid var(--color-border-default)" : "none")};

  &:hover {
    background-color: ${(props) =>
      props.$blocked
        ? "var(--color-danger-emphasis)"
        : props.$following
          ? "var(--color-canvas-subtle)"
          : "var(--color-fg-muted)"};
  }
`;

const BioText = styled.div`
  font-size: 14px;
  color: var(--color-fg-default);
  margin-top: 12px;
  margin-bottom: 12px;
  line-height: 1.4;
`;

const StatLink = styled(Link)`
  color: var(--color-fg-muted);
  text-decoration: none;
  font-size: 14px;
  &:hover {
    text-decoration: underline;
  }
`;

const StatCount = styled.span`
  color: var(--color-fg-default);
  font-weight: bold;
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const ModalCard = styled.div`
  background-color: var(--color-bg-primary);
  border-radius: 16px;
  padding: 32px;
  width: 320px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
`;

export default function ProfileHoverCard({
  username,
  children,
  showProfileSummaryBtn = true,
}: {
  username: string;
  children: React.ReactNode;
  showProfileSummaryBtn?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [data, setData] = useState<any>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showUnblockModal, setShowUnblockModal] = useState(false);
  const { user, token } = useAuth();

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProfile = async () => {
    if (data) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/${username}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        setData(json.profile);
        setIsFollowing(json.isFollowing);
      }
    } catch (e) {}
  };

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShow(true);
      fetchProfile();
    }, 400);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setShow(false);
    }, 300);
  };

  const handleFollowToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!user || isBlocked) return;

    try {
      const res = await fetch(`${API_BASE_URL}/social/${username}/follow`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setIsFollowing(json.following);
        if (data) {
          setData({ ...data, follower_count: data.follower_count + (json.following ? 1 : -1) });
        }
      }
    } catch (err) {}
  };

  const handleBlockClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isBlocked) {
      setShowUnblockModal(true);
    } else {
      setIsBlocked(true);
    }
  };

  const confirmUnblock = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsBlocked(false);
    setShowUnblockModal(false);
  };

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {show && (
        <PopoverContainer onClick={(e) => e.stopPropagation()}>
          {!data ? (
            <Box display="flex" justifyContent="center" p={3}>
              <div style={{ color: "var(--color-fg-muted)" }}>Loading...</div>
            </Box>
          ) : (
            <>
              <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                <Avatar $url={data.avatar_url} $letter={data.username.charAt(0).toUpperCase()} />
                {user && user.id !== data.id && (
                  <FollowButton
                    $following={isFollowing}
                    $blocked={isBlocked}
                    onClick={isBlocked ? handleBlockClick : handleFollowToggle}
                  >
                    {isBlocked ? "Blocked" : isFollowing ? "Following" : "Follow"}
                  </FollowButton>
                )}
              </Box>
              <Box mt={2}>
                <div style={{ fontWeight: "bold", fontSize: "15px", color: "var(--color-fg-default)" }}>
                  {data.display_name || data.username}
                </div>
                <div className="handle-text" style={{ marginTop: "2px" }}>
                  @{data.username}
                </div>
              </Box>

              {data.bio && <BioText>{data.bio}</BioText>}

              <Box display="flex" gap={3} mt={2}>
                <StatLink to={`/${data.username}/following`}>
                  <StatCount>{data.following_count}</StatCount> Following
                </StatLink>
                <StatLink to={`/${data.username}/followers`}>
                  <StatCount>{data.follower_count}</StatCount> Followers
                </StatLink>
              </Box>

              {showProfileSummaryBtn && (
                <Box mt={3} pt={3} borderTop="1px solid var(--color-border-default)">
                  <Link to={`/${data.username}`} style={{ textDecoration: "none" }}>
                    <button
                      style={{
                        width: "100%",
                        padding: "8px",
                        borderRadius: "9999px",
                        backgroundColor: "transparent",
                        border: "1px solid var(--color-border-default)",
                        cursor: "pointer",
                        fontWeight: "bold",
                        color: "var(--color-fg-default)",
                      }}
                    >
                      Profile Summary
                    </button>
                  </Link>
                </Box>
              )}
            </>
          )}
        </PopoverContainer>
      )}

      {showUnblockModal && (
        <ModalOverlay
          onClick={(e) => {
            e.stopPropagation();
            setShowUnblockModal(false);
          }}
        >
          <ModalCard onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: "bold", fontSize: "20px", marginBottom: "8px" }}>Unblock @{username}?</div>
            <div style={{ color: "var(--color-fg-muted)", fontSize: "15px", marginBottom: "24px", lineHeight: "1.4" }}>
              They will be able to follow you and view your posts.
            </div>
            <button
              onClick={confirmUnblock}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "9999px",
                marginBottom: "12px",
                backgroundColor: "var(--color-fg-default)",
                color: "var(--color-bg-primary)",
                fontWeight: "bold",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
              }}
            >
              Unblock
            </button>
            <button
              onClick={() => setShowUnblockModal(false)}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "9999px",
                backgroundColor: "transparent",
                color: "var(--color-fg-default)",
                fontWeight: "bold",
                border: "1px solid var(--color-border-default)",
                cursor: "pointer",
                fontSize: "16px",
              }}
            >
              Cancel
            </button>
          </ModalCard>
        </ModalOverlay>
      )}
    </div>
  );
}
