/* eslint-disable */
import { CodeIcon, GlobeIcon, ImageIcon, SlidersIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React, { useRef, useState } from "react";
import styled from "styled-components";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../config";
import Box from "./Box";

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

const ComposeInput = styled.textarea`
  width: 100%;
  border: none;
  outline: none;
  font-size: 20px;
  padding: 4px 0;
  resize: none;
  background: transparent;
  color: var(--color-fg-default);
  font-family: inherit;
  overflow: hidden;
  box-sizing: border-box;
  &::placeholder {
    color: var(--color-fg-muted);
  }
`;

interface ComposeBoxProps {
  onPostCreated?: (post: any) => void;
  quotePost?: any;
  replyToPost?: any;
  placeholder?: string;
  minRows?: number;
  autoFocus?: boolean;
}

export default function ComposeBox({
  onPostCreated,
  quotePost,
  replyToPost,
  placeholder,
  minRows = 2,
  autoFocus,
}: ComposeBoxProps) {
  const { user, token } = useAuth();
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          content: content.trim(),
          artifact_view_id: artifactId,
          quote_post_id: quotePost?.id,
          reply_to_id: replyToPost?.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setContent("");
        setArtifactId(null);
        onPostCreated?.(data.post);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box display="flex" gap={3} w="100%">
      {user?.avatar_url ? (
        <img
          src={user.avatar_url}
          alt="avatar"
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            objectFit: "cover",
            backgroundColor: "var(--color-canvas-subtle)",
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            backgroundColor: "var(--color-accent-emphasis)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: "bold",
            flexShrink: 0,
            fontSize: 20,
          }}
        >
          {user?.username?.charAt(0).toUpperCase()}
        </div>
      )}
      <Box flex={1} display="flex" flexDirection="column" style={{ minWidth: 0 }}>
        {replyToPost && (
          <Box mb={2} display="flex" gap={1} fontSize="14px" color="var(--color-fg-muted)">
            <span>Replying to</span>
            <span style={{ color: "#1d9bf0", fontWeight: "500" }}>@{replyToPost.username}</span>
          </Box>
        )}
        <ComposeInput
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder || (replyToPost ? "Post your reply" : "What is happening?!")}
          rows={Math.max(minRows, content.split("\n").length)}
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              handleSubmit();
            }
          }}
        />
        {quotePost && (
          <Box mt={2} p={3} border="1px solid var(--color-border-subtle)" borderRadius="12px">
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <span style={{ fontWeight: "bold", fontSize: "13px" }}>
                {quotePost.display_name || quotePost.username}
              </span>
              <span style={{ color: "var(--color-fg-muted)", fontSize: "13px" }}>@{quotePost.username}</span>
            </Box>
            <span style={{ fontSize: "14px" }}>{quotePost.content}</span>
          </Box>
        )}

        {!replyToPost && (
          <Box
            mt={2}
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
            marginTop: "8px",
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
              <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginLeft: "8px" }}>Uploading...</span>
            )}
          </Box>
          <TweetButton onClick={handleSubmit} disabled={(!content.trim() && !artifactId) || submitting}>
            {replyToPost ? "Reply" : "Post"}
          </TweetButton>
        </Box>
      </Box>
    </Box>
  );
}
