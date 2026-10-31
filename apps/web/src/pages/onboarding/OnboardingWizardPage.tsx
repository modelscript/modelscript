// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, CheckIcon, KeyIcon, PersonAddIcon, PlayIcon, RocketIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styledImport from "styled-components";
import { followUser, getUserSuggestions, unfollowUser } from "../../api";
import { completeUserOnboarding } from "../../api/admin";
import { useAuth } from "../../AuthContext";
import { useCapabilities } from "../../CapabilitiesContext";
import AnsatzMark from "../../components/AnsatzLogo";
import { useInstanceBranding } from "../../InstanceBrandingContext";
import { usePageTitle } from "../../util/title";

const styled: typeof styledImport = (styledImport as any).default ?? styledImport;

const PageContainer = styled.div`
  min-height: 100vh;
  background: radial-gradient(circle at 50% 10%, #151d36 0%, #080c16 80%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  color: var(--color-text-primary, #e2e8f0);
`;

const WizardCard = styled.div`
  background: rgba(14, 20, 36, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(16px);
  border-radius: 20px;
  width: 100%;
  max-width: 780px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.6);
  padding: 32px 36px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: cardFadeIn 0.25s ease-out;

  @keyframes cardFadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 640px) {
    padding: 24px 18px;
  }
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const HeaderSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  letter-spacing: -0.02em;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-secondary, #94a3b8);
  margin: 0;
  line-height: 1.5;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
`;

const SectionTitle = styled.h2`
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #94a3b8);
  margin: 0;
`;

const PersonaGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const PersonaCard = styled.button<{ $selected: boolean }>`
  background: ${(props) => (props.$selected ? "rgba(6, 182, 212, 0.12)" : "rgba(21, 29, 48, 0.6)")};
  border: 1.5px solid
    ${(props) => (props.$selected ? "var(--color-accent-cyan, #06b6d4)" : "rgba(255, 255, 255, 0.08)")};
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  text-align: left;
  width: 100%;
  color: inherit;
  font-family: inherit;

  &:hover {
    border-color: ${(props) => (props.$selected ? "#06b6d4" : "rgba(255, 255, 255, 0.25)")};
    background: ${(props) => (props.$selected ? "rgba(6, 182, 212, 0.15)" : "rgba(21, 29, 48, 0.85)")};
  }
`;

const PersonaIcon = styled.div`
  font-size: 22px;
  line-height: 1;
  margin-top: 2px;
  flex-shrink: 0;
`;

const PersonaTitle = styled.div`
  font-size: 14.5px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
`;

const PersonaDesc = styled.div`
  font-size: 12.5px;
  color: var(--color-text-secondary, #94a3b8);
  line-height: 1.4;
`;

const StarterGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const StarterCard = styled.div`
  background: rgba(21, 29, 48, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  transition: all 0.15s ease;

  &:hover {
    border-color: rgba(6, 182, 212, 0.5);
    background: rgba(21, 29, 48, 0.85);
  }
`;

const SuggestedList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
`;

const SuggestedUserCard = styled.div`
  background: rgba(21, 29, 48, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const FollowToggle = styled.button<{ $following: boolean }>`
  background: ${(props) => (props.$following ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.1)")};
  border: 1px solid ${(props) => (props.$following ? "rgba(16, 185, 129, 0.4)" : "rgba(255, 255, 255, 0.15)")};
  color: ${(props) => (props.$following ? "#10b981" : "#fff")};
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;

  &:hover {
    background: ${(props) => (props.$following ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.2)")};
    border-color: ${(props) => (props.$following ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.3)")};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`;

const PrimaryButton = styled.button`
  background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
  border: none;
  color: #fff;
  padding: 11px 24px;
  border-radius: 10px;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
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

const SkipButton = styled.button`
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: var(--color-text-secondary, #94a3b8);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 12px;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.05);
  }
`;

export const PERSONAS = [
  {
    id: "physical_systems",
    icon: "🚀",
    title: "Physical Systems & Multiphysics",
    desc: "Modelica 3.x, FMI 2.0/3.0, differential-algebraic equations (DAEs), and power electronics.",
  },
  {
    id: "systems_engineering",
    icon: "📐",
    title: "Systems Engineering & MBSE",
    desc: "SysML v2, KerML standard library, OWL2 ontologies, and digital thread verification.",
  },
  {
    id: "computational_cad",
    icon: "🛠️",
    title: "Computational CAD & CAE",
    desc: "STEP AP242, OpenSCAD CSG solid modeling, CalculiX FEA stress decks, and SU2 CFD.",
  },
  {
    id: "scientific_research",
    icon: "🎓",
    title: "Scientific Research & Dynamics",
    desc: "Nonlinear dynamical systems, SIMPACK multibody drivetrains, and GENSYS railway stability.",
  },
] as const;

export interface StarterModelItem {
  id: string;
  name: string;
  domain: string;
  desc: string;
  link: string;
  personas: string[];
}

export const STARTER_MODELS: StarterModelItem[] = [
  {
    id: "rlc-circuit",
    name: "RLC Resonant Circuit",
    domain: "Modelica 3.x",
    desc: "Second-order series RLC step response with live inductor current and capacitor voltage trajectories.",
    link: "/playground?model=rlc-circuit",
    personas: ["physical_systems", "systems_engineering"],
  },
  {
    id: "bouncing-ball",
    name: "Hybrid Bouncing Ball",
    domain: "Modelica Hybrid",
    desc: "Continuous gravitational free-fall coupled with discrete restitution contact damping.",
    link: "/playground?model=bouncing-ball",
    personas: ["physical_systems", "scientific_research"],
  },
  {
    id: "lorenz-attractor",
    name: "Lorenz Chaotic Attractor",
    domain: "Nonlinear Dynamics",
    desc: "Three-dimensional chaotic convection ODE system with phase-space trajectory plotting.",
    link: "/playground?model=lorenz-attractor",
    personas: ["scientific_research", "physical_systems"],
  },
  {
    id: "pscad-ieee2800-inverter",
    name: "IEEE 2800 Grid-Forming Inverter",
    domain: "PSCAD EMT",
    desc: "230 kV collector line, GSU transformer, and virtual synchronous inverter EMT schematic.",
    link: "/playground?model=pscad-ieee2800-inverter",
    personas: ["physical_systems"],
  },
  {
    id: "sysml-satellite",
    name: "CubeSat Power Architecture",
    domain: "SysML v2",
    desc: "Low-Earth orbit solar array, battery pack, and avionics payload port connectivity model.",
    link: "/playground?model=sysml-satellite",
    personas: ["systems_engineering"],
  },
  {
    id: "owl2-propulsion-ontology",
    name: "Aerospace Propulsion Ontology",
    domain: "OWL2 Ontology",
    desc: "Formal description logic axioms for liquid rocket engines, turbopumps, and thrust chambers.",
    link: "/playground?model=owl2-propulsion-ontology",
    personas: ["systems_engineering"],
  },
  {
    id: "scad-flanged-hub",
    name: "Parametric Flanged Drive Hub",
    domain: "OpenSCAD CSG",
    desc: "Constructive solid geometry drive hub with bolt-circle cutouts and live 3D WebAssembly render.",
    link: "/playground?model=scad-flanged-hub",
    personas: ["computational_cad"],
  },
  {
    id: "step-aerospace-bracket",
    name: "Aerospace Actuator Housing",
    domain: "STEP ISO 10303",
    desc: "AP242 manifold boundary-representation solid bracket with interactive 3D CAD inspection.",
    link: "/playground?model=step-aerospace-bracket",
    personas: ["computational_cad", "systems_engineering"],
  },
  {
    id: "fea-bracket-deck",
    name: "Titanium Actuator Bracket FEA",
    domain: "CalculiX FEA",
    desc: "Ti-6Al-4V C3D8 hexahedral finite element static stress analysis deck under cantilever load.",
    link: "/playground?model=fea-bracket-deck",
    personas: ["computational_cad"],
  },
  {
    id: "cfd-rae2822-su2",
    name: "RAE 2822 Transonic Airfoil CFD",
    domain: "SU2 CFD",
    desc: "Compressible RANS Spalart-Allmaras transonic airfoil solver configuration at Mach 0.729.",
    link: "/playground?model=cfd-rae2822-su2",
    personas: ["computational_cad"],
  },
  {
    id: "simpack-pendulum",
    name: "Wind Turbine Planetary Drivetrain",
    domain: "SIMPACK MBS",
    desc: "Multi-body nacelle bedplate, low-speed rotor shaft, and helical sun gear mesh stiffness model.",
    link: "/playground?model=simpack-pendulum",
    personas: ["scientific_research"],
  },
  {
    id: "gensys-bogie",
    name: "High-Speed Rail Vehicle Bogie",
    domain: "GENSYS Railway",
    desc: "250 km/h railway carbody, primary/secondary suspension, and UIC60 wheel-rail contact model.",
    link: "/playground?model=gensys-bogie",
    personas: ["scientific_research"],
  },
];

export function OnboardingWizardPage() {
  usePageTitle("Welcome to Ansatz — Quickstart");
  const { user, refreshUser } = useAuth();
  const branding = useInstanceBranding();
  const navigate = useNavigate();
  const { hasCapability } = useCapabilities();

  const showInvitesHint = hasCapability("userInvites") && branding.userInvitesEnabled !== false;
  const brandName = branding.instanceName || "Ansatz";

  const [selectedPersona, setSelectedPersona] = useState<string>(user?.engineering_persona || "physical_systems");
  const [suggestedUsers, setSuggestedUsers] = useState<
    Array<{ id: number; username: string; display_name?: string; bio?: string }>
  >([]);
  const [followedUsers, setFollowedUsers] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.engineering_persona) {
      setSelectedPersona(user.engineering_persona);
    }
  }, [user?.engineering_persona]);

  useEffect(() => {
    let active = true;
    getUserSuggestions(3)
      .then((res) => {
        if (!active || !Array.isArray(res?.suggestions)) return;
        const filtered = res.suggestions.filter(
          (s: { username?: string }) => s?.username && (!user || s.username !== user.username),
        );
        setSuggestedUsers(filtered.slice(0, 3));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user]);

  const recommendedModels = useMemo(() => {
    const matching = STARTER_MODELS.filter((m) => m.personas.includes(selectedPersona));
    if (matching.length >= 4) return matching.slice(0, 4);
    const others = STARTER_MODELS.filter((m) => !m.personas.includes(selectedPersona));
    return [...matching, ...others].slice(0, 4);
  }, [selectedPersona]);

  const handleToggleFollow = async (username: string) => {
    const next = !followedUsers[username];
    setFollowedUsers((prev) => ({ ...prev, [username]: next }));
    try {
      if (next) {
        await followUser(username);
      } else {
        await unfollowUser(username);
      }
    } catch {
      setFollowedUsers((prev) => ({ ...prev, [username]: !next }));
    }
  };

  const handleComplete = async (targetPath = "/home") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await completeUserOnboarding(selectedPersona);
      await refreshUser();
      navigate(targetPath);
    } catch {
      navigate(targetPath);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer>
      <WizardCard>
        <TopBar>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <AnsatzMark size={38} logoUrl={branding.brandLogoUrl} accentColor={branding.brandAccentColor} />
            <HeaderSection>
              <Title>Welcome to {brandName}</Title>
              <Subtitle>
                Pick your primary engineering focus to tailor your starter models, or jump straight into your workspace.
              </Subtitle>
            </HeaderSection>
          </div>
          <SkipButton type="button" disabled={submitting} onClick={() => void handleComplete("/home")}>
            Skip &rarr;
          </SkipButton>
        </TopBar>

        {/* SECTION 1: CHOOSE DISCIPLINE */}
        <div>
          <SectionHeader>
            <SectionTitle>1. Select Your Primary Discipline</SectionTitle>
          </SectionHeader>
          <PersonaGrid>
            {PERSONAS.map((p) => {
              const selected = selectedPersona === p.id;
              return (
                <PersonaCard
                  key={p.id}
                  type="button"
                  $selected={selected}
                  onClick={() => setSelectedPersona(p.id)}
                  aria-pressed={selected}
                >
                  <PersonaIcon>{p.icon}</PersonaIcon>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PersonaTitle>
                      <span>{p.title}</span>
                      {selected && <CheckCircleFillIcon size={16} fill="#06b6d4" />}
                    </PersonaTitle>
                    <PersonaDesc>{p.desc}</PersonaDesc>
                  </div>
                </PersonaCard>
              );
            })}
          </PersonaGrid>
        </div>

        {/* SECTION 2: TAILORED STARTER WORKSPACES */}
        <div>
          <SectionHeader>
            <SectionTitle>2. Try an Interactive Starter Model (Zero-Install WASM)</SectionTitle>
          </SectionHeader>
          <StarterGrid>
            {recommendedModels.map((m) => (
              <StarterCard key={m.id}>
                <div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--color-accent-cyan, #06b6d4)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: "3px",
                    }}
                  >
                    {m.domain}
                  </div>
                  <div style={{ fontSize: "14.5px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>
                    {m.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", lineHeight: "1.4" }}>
                    {m.desc}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleComplete(m.link)}
                  style={{
                    background: "rgba(6, 182, 212, 0.12)",
                    border: "1px solid rgba(6, 182, 212, 0.3)",
                    color: "var(--color-accent-cyan, #06b6d4)",
                    padding: "7px 12px",
                    borderRadius: "8px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    cursor: submitting ? "wait" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    width: "fit-content",
                  }}
                >
                  <PlayIcon size={13} /> Open in Playground
                </button>
              </StarterCard>
            ))}
          </StarterGrid>
        </div>

        {/* SECTION 3: OPTIONAL REAL SUGGESTED ENGINEERS */}
        {suggestedUsers.length > 0 && (
          <div>
            <SectionHeader>
              <SectionTitle>Suggested Engineers on {brandName}</SectionTitle>
            </SectionHeader>
            <SuggestedList>
              {suggestedUsers.map((u) => {
                const following = Boolean(followedUsers[u.username]);
                return (
                  <SuggestedUserCard key={u.username}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13.5px",
                          fontWeight: 700,
                          color: "#fff",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {u.display_name || u.username}
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--color-text-secondary, #94a3b8)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        @{u.username}
                      </div>
                    </div>
                    <FollowToggle
                      type="button"
                      $following={following}
                      onClick={() => void handleToggleFollow(u.username)}
                    >
                      {following ? (
                        <>
                          <CheckIcon size={13} /> Following
                        </>
                      ) : (
                        <>
                          <PersonAddIcon size={13} /> Follow
                        </>
                      )}
                    </FollowToggle>
                  </SuggestedUserCard>
                );
              })}
            </SuggestedList>
          </div>
        )}

        {/* FOOTER ACTIONS */}
        <ButtonRow>
          {showInvitesHint ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12.5px",
                color: "var(--color-text-secondary, #94a3b8)",
              }}
            >
              <KeyIcon size={14} fill="#06b6d4" />
              <span>
                You have <strong>5 Golden Ticket</strong> peer invites ready in{" "}
                <button
                  type="button"
                  onClick={() => void handleComplete("/settings/invites")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--color-accent-cyan, #06b6d4)",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    fontSize: "inherit",
                  }}
                >
                  Settings &rarr; Invites
                </button>
              </span>
            </div>
          ) : (
            <div />
          )}

          <PrimaryButton type="button" disabled={submitting} onClick={() => void handleComplete("/home")}>
            {submitting ? "Entering Workspace…" : "Enter Your Workspace"} <RocketIcon size={16} />
          </PrimaryButton>
        </ButtonRow>
      </WizardCard>
    </PageContainer>
  );
}

export default OnboardingWizardPage;
