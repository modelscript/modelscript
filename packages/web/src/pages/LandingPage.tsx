import { BookIcon, CodeIcon, GitBranchIcon, RocketIcon } from "@primer/octicons-react";
import { Button, Heading, Text } from "@primer/react";
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import Box from "../components/Box";

const float = keyframes`
  0% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0px); }
`;

const pulse = keyframes`
  0% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.05); opacity: 0.9; }
  100% { transform: scale(1); opacity: 0.6; }
`;

const PageContainer = styled(Box)`
  position: relative;
  overflow: hidden;
  background-color: #0d1117; // GitHub night background
  color: #c9d1d9; // GitHub night text
  min-height: calc(100vh - 64px);
`;

const GlowOrb1 = styled.div`
  position: absolute;
  top: -10%;
  left: -5%;
  width: 50vw;
  height: 50vw;
  background: radial-gradient(circle, rgba(164, 133, 255, 0.15) 0%, rgba(0, 0, 0, 0) 70%);
  border-radius: 50%;
  pointer-events: none;
  animation: ${pulse} 8s infinite ease-in-out;
  z-index: 0;
`;

const GlowOrb2 = styled.div`
  position: absolute;
  bottom: -20%;
  right: -10%;
  width: 60vw;
  height: 60vw;
  background: radial-gradient(circle, rgba(0, 210, 255, 0.1) 0%, rgba(0, 0, 0, 0) 70%);
  border-radius: 50%;
  pointer-events: none;
  animation: ${pulse} 12s infinite ease-in-out reverse;
  z-index: 0;
`;

const ContentWrapper = styled(Box)`
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
`;

const GradientText = styled(Heading)`
  background: linear-gradient(90deg, #a485ff, #00d2ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
  display: inline-block;
  font-size: 64px;
  padding-bottom: 10px; /* Prevent descenders like 'g' from being cut off */
`;

const FloatingBox = styled(Box)`
  animation: ${float} 6s infinite ease-in-out;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(164, 133, 255, 0.2), rgba(0, 210, 255, 0.2));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 30px rgba(164, 133, 255, 0.2);
  margin-bottom: 32px;
`;

const GlassCard = styled(Box)`
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.05);
  cursor: default;

  &:hover {
    transform: translateY(-8px);
    border-color: rgba(164, 133, 255, 0.4);
    box-shadow: 0 12px 32px rgba(164, 133, 255, 0.15);
    background: rgba(255, 255, 255, 0.05);
  }
`;

const LandingPage: React.FC = () => {
  useEffect(() => {
    document.title = "ModelScript";
  }, []);

  return (
    <PageContainer display="flex" flexDirection="column" p={6}>
      <GlowOrb1 />
      <GlowOrb2 />
      <ContentWrapper mt={12} mb={10}>
        <Box display="flex" flexDirection="column" alignItems="center" textAlign="center" maxWidth="900px" mb={12}>
          <FloatingBox>
            <RocketIcon size={40} fill="#E2D5FF" />
          </FloatingBox>
          <GradientText
            as="h1"
            style={{ marginBottom: "24px", fontWeight: "800", letterSpacing: "-1.5px", lineHeight: "1.1" }}
          >
            ModelScript Engine
          </GradientText>
          <Text
            as="p"
            style={{ fontSize: "24px", color: "#8b949e", marginBottom: "48px", maxWidth: "700px", lineHeight: "1.6" }}
          >
            Discover, explore, and utilize the power of autonomous modeling. A comprehensive registry for
            next-generation intelligence components.
          </Text>
          <Box display="flex" gap={4} style={{ marginBottom: "80px" }}>
            <Button
              as={Link}
              to="/libraries"
              variant="primary"
              size="large"
              style={{
                fontSize: "18px",
                padding: "0 24px",
                height: "48px",
                borderRadius: "100px",
                background: "linear-gradient(90deg, #8752ff, #2563eb)",
                border: "none",
                color: "#ffffff",
              }}
            >
              Launch Explorer
            </Button>
            <Button
              as="a"
              href="https://github.com/modelscript/modelscript"
              target="_blank"
              size="large"
              style={{
                fontSize: "18px",
                padding: "0 24px",
                height: "48px",
                borderRadius: "100px",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#c9d1d9",
              }}
            >
              View Architecture
            </Button>
          </Box>
        </Box>

        <Box display="flex" gap={5} flexWrap="wrap" justifyContent="center" maxWidth="1200px" mb={8}>
          <FeatureCard
            icon={BookIcon}
            title="Semantic Knowledge"
            description="Access fully unstructured documentation, vector diagrams, and dynamic type graphs for every entity."
          />
          <FeatureCard
            icon={CodeIcon}
            title="Component Synthesis"
            description="Dive deep into the architecture and internal weight parameters of complex network models directly in the UI."
          />
          <FeatureCard
            icon={GitBranchIcon}
            title="Model Lineage"
            description="Explore historical states of algorithmic libraries, tracking performance across distributed simulations."
          />
        </Box>
      </ContentWrapper>
    </PageContainer>
  );
};

const FeatureCard: React.FC<{ icon: React.ElementType; title: string; description: string }> = ({
  icon: Icon,
  title,
  description,
}) => (
  <GlassCard
    p={6}
    borderRadius={3}
    width="30%"
    minWidth="320px"
    display="flex"
    flexDirection="column"
    alignItems="flex-start"
    textAlign="left"
  >
    <Box
      mb={4}
      p={3}
      borderRadius={2}
      style={{ background: "rgba(164,133,255,0.1)", border: "1px solid rgba(164,133,255,0.2)" }}
    >
      <Icon size={24} fill="#a485ff" />
    </Box>
    <Heading as="h3" style={{ fontSize: "22px", marginBottom: "16px", fontWeight: "600", color: "#e6edf3" }}>
      {title}
    </Heading>
    <Text as="p" style={{ color: "#8b949e", fontSize: "16px", lineHeight: "1.5" }}>
      {description}
    </Text>
  </GlassCard>
);

export default LandingPage;
