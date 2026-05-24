/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { CodeIcon, GlobeIcon, ImageIcon, SlidersIcon, XIcon } from "@primer/octicons-react";
import { IconButton, Textarea } from "@primer/react";
import React, { useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
`;

const ModalPanel = styled.div`
  background: var(--color-bg-primary);
  width: 100%;
  max-width: 600px;
  border-radius: 16px;
  border: 1px solid var(--color-border-subtle);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  padding: 12px 16px 4px;
`;

const Body = styled.div`
  padding: 4px 20px 20px;
  display: flex;
  gap: 12px;
`;

const ToolbarButton = styled.button`
  background: none;
  border: 1px solid var(--color-accent-blue);
  color: var(--color-accent-blue);
  border-radius: 9999px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: var(--color-accent-purple-bg);
  }

  &:disabled {
    border-color: var(--color-border-default);
    color: var(--color-fg-muted);
    cursor: not-allowed;
  }
`;

const TweetButton = styled.button`
  background-color: #1d9bf0;
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 8px 20px;
  font-size: 15px;
  font-weight: bold;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Avatar = styled.div<{ $url?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: var(--color-accent-emphasis);
  background-image: ${(props) => (props.$url ? `url(${props.$url})` : "none")};
  background-size: cover;
  flex-shrink: 0;
`;

interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: (post: any) => void;
  quotePost?: any;
  replyToPost?: any;
}

const ComposeModal: React.FC<ComposeModalProps> = ({ onClose, onPostCreated, quotePost, replyToPost }) => {
  const { user, token } = useAuth();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await fetch(`${API_BASE_URL}/storage/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const view_config = JSON.stringify({ url: uploadData.url });

        const artifactRes = await fetch(`${API_BASE_URL}/social/artifact-views`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ artifact_type: uploadData.view_type, view_config, title: file.name }),
        });

        if (artifactRes.ok) {
          const artifactData = await artifactRes.json();
          setArtifactId(artifactData.id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const createDummyArtifact = async (type: string) => {
    if (!token) return;
    try {
      let view_config = "{}";
      if (type === "modelica-code") {
        view_config = JSON.stringify({ code: "model BouncingBall\n  Real h(start=1);\n  Real v;\nend BouncingBall;" });
      } else if (type === "simulation-plot") {
        view_config = JSON.stringify({
          model: "BouncingBall",
          overrides: { "h(start)": 10, e: 0.8 },
          variables: ["h", "v"],
          timeRange: [0, 5],
        });
      }

      const res = await fetch(`${API_BASE_URL}/social/artifact-views`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ artifact_type: type, view_config, title: `Example ${type}` }),
      });
      if (res.ok) {
        const data = await res.json();
        setArtifactId(data.id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async () => {
    if ((!content.trim() && !artifactId) || !token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/social/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          artifact_view_id: artifactId,
          quote_post_id: quotePost?.id,
          reply_to_id: replyToPost?.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onPostCreated?.(data.post);
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Overlay onClick={onClose}>
      <ModalPanel onClick={(e) => e.stopPropagation()}>
        <Header>
          <IconButton
            icon={XIcon}
            variant="invisible"
            onClick={onClose}
            aria-label="Close"
            sx={{ color: "var(--color-fg-default)" }}
          />
          <Box flex={1} />
          <button
            style={{
              background: "none",
              border: "none",
              color: "#1d9bf0",
              fontWeight: "bold",
              fontSize: "15px",
              cursor: "pointer",
              paddingRight: "8px",
            }}
          >
            Drafts
          </button>
        </Header>
        <Body>
          <Avatar $url={user?.avatar_url} />
          <Box flex={1} display="flex" flexDirection="column">
            {replyToPost && (
              <Box mb={2} display="flex" gap={1} fontSize="14px" color="var(--color-fg-muted)">
                <span>Replying to</span>
                <span style={{ color: "#1d9bf0", fontWeight: "500" }}>@{replyToPost.username}</span>
              </Box>
            )}
            <Textarea
              block
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={replyToPost ? "Post your reply" : "What's happening?"}
              rows={4}
              sx={{
                border: "none",
                boxShadow: "none",
                fontSize: "20px",
                padding: 0,
                "&:focus-within": { boxShadow: "none" },
                resize: "none",
                background: "transparent",
                color: "var(--color-fg-default)",
              }}
              autoFocus
            />
            {quotePost && (
              <Box mt={2} p={3} border="1px solid var(--color-border-subtle)" borderRadius="12px">
                <Box display="flex" alignItems="center" gap={1} mb={1}>
                  <Text style={{ fontWeight: "bold", fontSize: "13px" }}>
                    {quotePost.display_name || quotePost.username}
                  </Text>
                  <Text color="var(--color-fg-muted)" style={{ fontSize: "13px" }}>
                    @{quotePost.username}
                  </Text>
                </Box>
                <Text style={{ fontSize: "14px" }}>{quotePost.content}</Text>
              </Box>
            )}

            {!replyToPost && (
              <Box
                mt={3}
                mb={2}
                display="flex"
                alignItems="center"
                gap={2}
                style={{ cursor: "pointer", width: "fit-content" }}
              >
                <GlobeIcon size={16} style={{ color: "#1d9bf0" }} />
                <span style={{ color: "#1d9bf0", fontWeight: "bold", fontSize: "14px" }}>Everyone can reply</span>
              </Box>
            )}

            <div
              style={{
                height: "1px",
                backgroundColor: "var(--color-border-subtle)",
                width: "100%",
                marginBottom: "12px",
              }}
            />

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" gap={1} alignItems="center">
                <IconButton
                  icon={CodeIcon}
                  variant="invisible"
                  onClick={() => createDummyArtifact("modelica-code")}
                  disabled={artifactId !== null}
                  aria-label="Add Code"
                  title="Add Code"
                  sx={{
                    color: artifactId !== null ? "var(--color-fg-muted)" : "#1d9bf0",
                    borderRadius: "50%",
                    "&:hover": {
                      backgroundColor: "rgba(29, 155, 240, 0.1)",
                    },
                  }}
                />
                <input
                  type="file"
                  style={{ display: "none" }}
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  disabled={artifactId !== null || uploadingFile}
                />
                <IconButton
                  icon={ImageIcon}
                  variant="invisible"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={artifactId !== null || uploadingFile}
                  aria-label="Upload Media"
                  title="Upload Media (Images, Videos, CAD, PDFs, CSV)"
                  sx={{
                    color: artifactId !== null || uploadingFile ? "var(--color-fg-muted)" : "#1d9bf0",
                    borderRadius: "50%",
                    "&:hover": {
                      backgroundColor: "rgba(29, 155, 240, 0.1)",
                    },
                  }}
                />
                <IconButton
                  icon={SlidersIcon}
                  variant="invisible"
                  onClick={() => createDummyArtifact("simulation-plot")}
                  disabled={artifactId !== null}
                  aria-label="Add Params"
                  title="Add Params"
                  sx={{
                    color: artifactId !== null ? "var(--color-fg-muted)" : "#1d9bf0",
                    borderRadius: "50%",
                    "&:hover": {
                      backgroundColor: "rgba(29, 155, 240, 0.1)",
                    },
                  }}
                />
                {artifactId !== null && (
                  <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>
                    Artifact Attached
                  </span>
                )}
                {uploadingFile && (
                  <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>
                    Uploading...
                  </span>
                )}
              </Box>
              <TweetButton onClick={handleSubmit} disabled={(!content.trim() && !artifactId) || submitting}>
                {replyToPost ? "Reply" : "Post"}
              </TweetButton>
            </Box>
          </Box>
        </Body>
      </ModalPanel>
    </Overlay>
  );
};

export default ComposeModal;
