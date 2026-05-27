/* eslint-disable @typescript-eslint/no-explicit-any */
import { XIcon } from "@primer/octicons-react";
import { IconButton } from "@primer/react";
import React from "react";
import styled from "styled-components";
import Box from "./Box";
import ComposeBox from "./ComposeBox";

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

import type { SpatialPin } from "./artifacts/spatial-pin";

interface ComposeModalProps {
  onClose: () => void;
  onPostCreated?: (post: any) => void;
  quotePost?: any;
  replyToPost?: any;
  pendingPin?: SpatialPin;
}

const ComposeModal: React.FC<ComposeModalProps> = ({ onClose, onPostCreated, quotePost, replyToPost, pendingPin }) => {
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
          <ComposeBox
            onPostCreated={(post) => {
              onPostCreated?.(post);
              onClose();
            }}
            quotePost={quotePost}
            replyToPost={replyToPost}
            pendingPin={pendingPin}
            minRows={4}
            autoFocus={true}
          />
        </Body>
      </ModalPanel>
    </Overlay>
  );
};

export default ComposeModal;
