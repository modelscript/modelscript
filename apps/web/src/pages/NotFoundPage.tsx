// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArrowLeftIcon, HomeIcon } from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../components/Box";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 48px 24px;
  text-align: center;
`;

const NotFoundCard = styled.div`
  max-width: 520px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`;

const GlitchNumber = styled.div`
  font-size: 72px;
  font-weight: 900;
  letter-spacing: -2px;
  background: linear-gradient(135deg, #a485ff, #00d2ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1;
`;

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <Container>
      <NotFoundCard>
        <GlitchNumber>404</GlitchNumber>
        <Heading as="h1" sx={{ fontSize: 24, m: 0 }}>
          Page not found
        </Heading>
        <Text sx={{ color: "fg.muted", fontSize: 15, maxWidth: 400 }}>
          The page or resource you are looking for doesn't exist, has been removed, or is temporarily unavailable.
        </Text>
        <Box display="flex" gap={3} mt={3}>
          <Button leadingVisual={ArrowLeftIcon} onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button variant="primary" leadingVisual={HomeIcon} onClick={() => navigate("/")}>
            Explore Feed
          </Button>
        </Box>
      </NotFoundCard>
    </Container>
  );
}
