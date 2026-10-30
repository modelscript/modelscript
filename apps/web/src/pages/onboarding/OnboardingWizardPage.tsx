// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  CheckCircleFillIcon,
  CheckIcon,
  CpuIcon,
  GlobeIcon,
  PlayIcon,
  RocketIcon,
  SparkleFillIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { completeUserOnboarding } from "../../api/admin";
import api from "../../api/client";
import { useAuth } from "../../AuthContext";
import AnsatzMark from "../../components/AnsatzLogo";
import { useInstanceBranding } from "../../InstanceBrandingContext";
import { usePageTitle } from "../../util/title";

const PageContainer = styled.div`
  min-height: 100vh;
  background: radial-gradient(circle at 50% 10%, #151d36 0%, #080c16 80%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--color-text-primary, #e2e8f0);
`;

const WizardCard = styled.div`
  background: rgba(14, 20, 36, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(16px);
  border-radius: 20px;
  width: 100%;
  max-width: 760px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  animation: cardFadeIn 0.3s ease-out;

  @keyframes cardFadeIn {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 640px) {
    padding: 24px 20px;
  }
`;

const HeaderSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
`;

const StepIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`;

const StepDot = styled.div<{ $active: boolean; $completed: boolean }>`
  width: ${(props) => (props.$active ? "28px" : "10px")};
  height: 10px;
  border-radius: 5px;
  background: ${(props) =>
    props.$active
      ? "linear-gradient(90deg, #06b6d4, #3b82f6)"
      : props.$completed
        ? "#10b981"
        : "rgba(255, 255, 255, 0.2)"};
  transition: all 0.25s ease;
`;

const Title = styled.h1`
  font-size: 26px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  letter-spacing: -0.02em;
`;

const Subtitle = styled.p`
  font-size: 15px;
  color: var(--color-text-secondary, #94a3b8);
  margin: 0;
  max-width: 540px;
  line-height: 1.5;
`;

const PersonaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const PersonaCard = styled.div<{ $selected: boolean }>`
  background: ${(props) => (props.$selected ? "rgba(6, 182, 212, 0.12)" : "rgba(21, 29, 48, 0.6)")};
  border: 2px solid ${(props) => (props.$selected ? "var(--color-accent-cyan, #06b6d4)" : "rgba(255, 255, 255, 0.08)")};
  border-radius: 14px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 10px;

  &:hover {
    border-color: ${(props) => (props.$selected ? "#06b6d4" : "rgba(255, 255, 255, 0.25)")};
    transform: translateY(-2px);
  }
`;

const PersonaIcon = styled.div`
  font-size: 28px;
`;

const PersonaTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const PersonaDesc = styled.div`
  font-size: 13px;
  color: var(--color-text-secondary, #94a3b8);
  line-height: 1.45;
`;

const CuratorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CuratorCard = styled.div`
  background: rgba(21, 29, 48, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const CuratorInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`;

const CuratorAvatar = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
  border: 1px solid rgba(6, 182, 212, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #06b6d4;
  font-size: 18px;
`;

const CuratorName = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: #fff;
`;

const CuratorHandle = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary, #94a3b8);
`;

const FollowToggle = styled.button<{ $following: boolean }>`
  background: ${(props) => (props.$following ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.1)")};
  border: 1px solid ${(props) => (props.$following ? "rgba(16, 185, 129, 0.4)" : "rgba(255, 255, 255, 0.15)")};
  color: ${(props) => (props.$following ? "#10b981" : "#fff")};
  font-size: 13px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 6px;

  &:hover {
    background: ${(props) => (props.$following ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.2)")};
    border-color: ${(props) => (props.$following ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.3)")};
  }
`;

const StarterGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const StarterCard = styled.div`
  background: rgba(21, 29, 48, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  transition: all 0.15s ease;

  &:hover {
    border-color: rgba(6, 182, 212, 0.5);
    background: rgba(21, 29, 48, 0.85);
  }
`;

const ButtonRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`;

const PrimaryButton = styled.button`
  background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
  border: none;
  color: #fff;
  padding: 12px 28px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: opacity 0.15s ease;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SecondaryButton = styled.button`
  background: transparent;
  border: none;
  color: var(--color-text-secondary, #94a3b8);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  padding: 10px 16px;
  transition: color 0.15s ease;

  &:hover {
    color: #fff;
  }
`;

const PERSONAS = [
  {
    id: "physical_systems",
    icon: "🚀",
    title: "Physical Systems & Multiphysics",
    desc: "Modelica 3.x, FMI 2.0/3.0, differential-algebraic equations (DAEs), power systems, and multi-body dynamics.",
  },
  {
    id: "systems_engineering",
    icon: "📐",
    title: "Systems Engineering & MBSE",
    desc: "SysML v2, KerML standard library, requirements traceability, digital thread architecture, and verification.",
  },
  {
    id: "computational_cad",
    icon: "🛠️",
    title: "Computational CAD & Hardware",
    desc: "STEP AP242, OpenSCAD CSG solid modeling, parametric boundary representations, and PCB manufacturing analysis.",
  },
  {
    id: "scientific_research",
    icon: "🎓",
    title: "Scientific Research & Education",
    desc: "Reproducible mathematical benchmarks, Julia/Python co-simulation, and open physical system exploration.",
  },
];

const BOT_CURATORS = [
  {
    username: "modelica-msl",
    name: "Modelica Standard Library",
    role: "Official verification & MSL benchmark bot",
    icon: <ZapIcon size={20} />,
  },
  {
    username: "sysml-digital-thread",
    name: "SysML v2 Verification Agent",
    role: "Automated MBSE requirement analysis bot",
    icon: <GlobeIcon size={20} />,
  },
  {
    username: "cad-primitives",
    name: "CAD Geometry Hub",
    role: "Parametric CSG & STEP exchange agent",
    icon: <CpuIcon size={20} />,
  },
  {
    username: "ansatz-benchmarks",
    name: "Ansatz Benchmark Suite",
    role: "HPC solver trajectories & regression tracking",
    icon: <SparkleFillIcon size={20} />,
  },
];

const STARTER_MODELS = [
  {
    name: "Chua's Circuit Chaos Oscillator",
    domain: "Modelica",
    desc: "Classic nonlinear chaotic oscillator with dual-scroll attractors and live trajectory plotting.",
    link: "/playground?model=ChuaCircuit",
  },
  {
    name: "Satellite Power & Thermal Subsystem",
    domain: "SysML v2",
    desc: "Low-Earth orbit satellite power generation, battery discharge, and thermal requirements.",
    link: "/playground?model=SatellitePower",
  },
  {
    name: "Bouncing Ball with Mechanical Impact",
    domain: "Modelica Hybrid",
    desc: "Continuous gravity integration with discrete coefficient-of-restitution velocity inversions.",
    link: "/playground?model=BouncingBall",
  },
  {
    name: "CSG Parametric Robotic Arm Joint",
    domain: "OpenSCAD / STEP",
    desc: "Constructive solid geometry joint with hole cutouts and 3D WebAssembly viewer render.",
    link: "/playground?model=RoboticJoint",
  },
];

export default function OnboardingWizardPage() {
  usePageTitle("Welcome to Ansatz — Guided Onboarding");
  const { refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPersona, setSelectedPersona] = useState<string>("physical_systems");
  const [followedBots, setFollowedBots] = useState<Record<string, boolean>>({
    "modelica-msl": true,
    "ansatz-benchmarks": true,
  });
  const [submitting, setSubmitting] = useState(false);

  const toggleFollowBot = (username: string) => {
    setFollowedBots((prev) => {
      const next = !prev[username];
      // Fire-and-forget social follow request
      api.post(`/users/${encodeURIComponent(username)}/follow`).catch(() => {});
      return { ...prev, [username]: next };
    });
  };

  const handleComplete = async (targetPath = "/home") => {
    setSubmitting(true);
    try {
      await completeUserOnboarding(selectedPersona);
      await refreshUser();
      navigate(targetPath);
    } catch {
      // Fallback navigation
      navigate(targetPath);
    } finally {
      setSubmitting(false);
    }
  };

  const brandName = branding.instanceName || "Ansatz";

  return (
    <PageContainer>
      <WizardCard>
        <HeaderSection>
          <div style={{ marginBottom: "8px" }}>
            <AnsatzMark size={44} accentColor={branding.brandAccentColor} />
          </div>
          <StepIndicator>
            <StepDot $active={step === 1} $completed={step > 1} />
            <StepDot $active={step === 2} $completed={step > 2} />
            <StepDot $active={step === 3} $completed={false} />
          </StepIndicator>

          {step === 1 && (
            <>
              <Title>Welcome to {brandName}</Title>
              <Subtitle>
                Select your primary engineering discipline to customize your feed, benchmark suites, and suggested
                models.
              </Subtitle>
            </>
          )}

          {step === 2 && (
            <>
              <Title>Connect with Curators & Autonomous Bots</Title>
              <Subtitle>
                Stay synced with official benchmark updates, continuous compilation results, and verified library
                releases.
              </Subtitle>
            </>
          )}

          {step === 3 && (
            <>
              <Title>Launch Your First Engineering Workspace</Title>
              <Subtitle>
                Explore interactive multiphysics models compiled in local WebAssembly with instant zero-install solver
                execution.
              </Subtitle>
            </>
          )}
        </HeaderSection>

        {/* STEP 1: CHOOSE PERSONA */}
        {step === 1 && (
          <PersonaGrid>
            {PERSONAS.map((p) => {
              const selected = selectedPersona === p.id;
              return (
                <PersonaCard key={p.id} $selected={selected} onClick={() => setSelectedPersona(p.id)}>
                  <PersonaIcon>{p.icon}</PersonaIcon>
                  <PersonaTitle>
                    {p.title}
                    {selected && <CheckCircleFillIcon size={18} fill="#06b6d4" />}
                  </PersonaTitle>
                  <PersonaDesc>{p.desc}</PersonaDesc>
                </PersonaCard>
              );
            })}
          </PersonaGrid>
        )}

        {/* STEP 2: CONNECT WITH BOTS */}
        {step === 2 && (
          <CuratorList>
            {BOT_CURATORS.map((bot) => {
              const following = Boolean(followedBots[bot.username]);
              return (
                <CuratorCard key={bot.username}>
                  <CuratorInfo>
                    <CuratorAvatar>{bot.icon}</CuratorAvatar>
                    <div>
                      <CuratorName>{bot.name}</CuratorName>
                      <CuratorHandle>
                        @{bot.username} • {bot.role}
                      </CuratorHandle>
                    </div>
                  </CuratorInfo>
                  <FollowToggle type="button" $following={following} onClick={() => toggleFollowBot(bot.username)}>
                    {following ? (
                      <>
                        <CheckIcon size={14} /> Following
                      </>
                    ) : (
                      "Follow"
                    )}
                  </FollowToggle>
                </CuratorCard>
              );
            })}
          </CuratorList>
        )}

        {/* STEP 3: STARTER MODELS */}
        {step === 3 && (
          <StarterGrid>
            {STARTER_MODELS.map((m) => (
              <StarterCard key={m.name}>
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--color-accent-cyan, #06b6d4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: "4px",
                    }}
                  >
                    {m.domain}
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>{m.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", lineHeight: "1.4" }}>
                    {m.desc}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleComplete(m.link)}
                  style={{
                    background: "rgba(6, 182, 212, 0.12)",
                    border: "1px solid rgba(6, 182, 212, 0.3)",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    padding: "8px 14px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    width: "fit-content",
                  }}
                >
                  <PlayIcon size={14} /> Open in Playground
                </button>
              </StarterCard>
            ))}
          </StarterGrid>
        )}

        {/* FOOTER ACTIONS */}
        <ButtonRow>
          {step > 1 ? (
            <SecondaryButton type="button" onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
              Back
            </SecondaryButton>
          ) : (
            <div />
          )}

          {step < 3 ? (
            <PrimaryButton type="button" onClick={() => setStep((s) => (s + 1) as 2 | 3)}>
              Continue <ArrowRightIcon size={16} />
            </PrimaryButton>
          ) : (
            <PrimaryButton type="button" disabled={submitting} onClick={() => handleComplete("/home")}>
              {submitting ? "Finalizing…" : "Enter Your Workspace"} <RocketIcon size={16} />
            </PrimaryButton>
          )}
        </ButtonRow>
      </WizardCard>
    </PageContainer>
  );
}
