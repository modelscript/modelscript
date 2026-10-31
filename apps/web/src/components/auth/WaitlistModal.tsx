// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, KeyIcon, XIcon } from "@primer/octicons-react";
import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { applyToWaitlist } from "../../api/admin";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultEmail?: string;
  brandName?: string;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
`;

const ModalCard = styled.div`
  background: var(--surface-overlay, var(--color-canvas-overlay));
  border: 1px solid var(--border-subtle, var(--color-border-default));
  border-radius: var(--radius-xl, 16px);
  width: 100%;
  max-width: 540px;
  max-height: 90vh;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes modalFadeIn {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

const ModalHeader = styled.div`
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-subtle, var(--color-border-default));
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ModalTitle = styled.h2`
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-text-primary));
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-secondary, var(--color-text-muted));
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-md, 8px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    background: var(--surface-elevated, var(--color-canvas-subtle));
  }
`;

const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const HelperCallout = styled.div`
  background: rgba(6, 182, 212, 0.08);
  border: 1px solid rgba(6, 182, 212, 0.25);
  border-radius: var(--radius-lg, 12px);
  padding: 12px 16px;
  font-size: 13px;
  color: var(--color-accent-cyan, #06b6d4);
  line-height: 1.5;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.label`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
`;

const Input = styled.input`
  background: var(--surface-elevated, var(--color-canvas-subtle));
  border: 1px solid var(--border-subtle, var(--color-border-default));
  border-radius: var(--radius-md, 8px);
  padding: 10px 14px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

const Select = styled.select`
  background: var(--surface-elevated, var(--color-canvas-subtle));
  border: 1px solid var(--border-subtle, var(--color-border-default));
  border-radius: var(--radius-md, 8px);
  padding: 10px 14px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }

  option {
    background: var(--surface-overlay, var(--color-canvas-overlay));
    color: var(--color-text-primary);
  }
`;

const Textarea = styled.textarea`
  background: var(--surface-elevated, var(--color-canvas-subtle));
  border: 1px solid var(--border-subtle, var(--color-border-default));
  border-radius: var(--radius-md, 8px);
  padding: 10px 14px;
  color: var(--color-text-primary);
  font-size: 14px;
  outline: none;
  min-height: 80px;
  resize: vertical;

  &:focus {
    border-color: var(--color-accent-cyan, #06b6d4);
  }
`;

const ModalFooter = styled.div`
  padding: 16px 24px;
  border-top: 1px solid var(--border-subtle, var(--color-border-default));
  display: flex;
  justify-content: flex-end;
  gap: 12px;
`;

const CancelButton = styled.button`
  background: transparent;
  border: 1px solid var(--border-subtle, var(--color-border-default));
  color: var(--color-text-secondary, var(--color-text-muted));
  padding: 9px 18px;
  border-radius: var(--radius-md, 8px);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-text-primary);
    background: var(--surface-elevated, var(--color-canvas-subtle));
  }
`;

const SubmitButton = styled.button`
  background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
  border: none;
  color: #fff;
  padding: 9px 22px;
  border-radius: var(--radius-md, 8px);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover:not(:disabled) {
    opacity: 0.92;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SuccessCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 16px;
  gap: 16px;
`;

export default function WaitlistModal({
  isOpen,
  onClose,
  defaultEmail = "",
  brandName = "Ansatz",
}: WaitlistModalProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [discipline, setDiscipline] = useState("physical_systems");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [statement, setStatement] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, isOpen, { onEscape: onClose });

  useEffect(() => {
    if (defaultEmail) setEmail(defaultEmail);
  }, [defaultEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      await applyToWaitlist({
        email,
        fullName: fullName.trim() || undefined,
        organization: organization.trim() || undefined,
        discipline,
        portfolioUrl: portfolioUrl.trim() || undefined,
        statement: statement.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const ax = err as { response?: { data?: { error?: string | undefined } | undefined } | undefined };
        setError(ax.response?.data?.error || "Failed to submit application");
      } else {
        setError("Failed to submit waitlist application. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Overlay onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="waitlist-title">
      <ModalCard ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle id="waitlist-title">
            <KeyIcon size={20} />
            Request an Access Key
          </ModalTitle>
          <CloseButton onClick={onClose} aria-label="Close dialog">
            <XIcon size={18} />
          </CloseButton>
        </ModalHeader>

        {submitted ? (
          <ModalBody>
            <SuccessCard>
              <div style={{ color: "var(--color-accent-cyan, #06b6d4)" }}>
                <CheckCircleFillIcon size={56} />
              </div>
              <h3
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "var(--color-text-heading, var(--color-text-primary))",
                  margin: 0,
                }}
              >
                Application Received
              </h3>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--color-text-secondary, #94a3b8)",
                  lineHeight: "1.6",
                  margin: 0,
                }}
              >
                We've reserved your place on the <strong>{brandName}</strong> waitlist for <strong>{email}</strong>. Our
                engineering team reviews applications on a rolling basis, and an invitation access key will be emailed
                to you directly.
              </p>
              <HelperCallout style={{ width: "100%", marginTop: "8px" }}>
                💡 <strong>Tip for Researchers & Students:</strong> Verified academic accounts (<code>.edu</code>,{" "}
                <code>.ac.uk</code>) qualify for automatic instant access. If you have an institutional address, you can
                register immediately.
              </HelperCallout>
              <SubmitButton style={{ width: "100%", marginTop: "12px" }} onClick={onClose}>
                Done
              </SubmitButton>
            </SuccessCard>
          </ModalBody>
        ) : (
          <form onSubmit={handleSubmit}>
            <ModalBody>
              <HelperCallout>
                <strong>Early Access Cohort:</strong> {brandName} is onboarding simulation engineers, computational
                scientists, and university research teams in focused batches. Complete this form to receive your access
                key.
              </HelperCallout>

              {error && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    color: "#f87171",
                    fontSize: "13px",
                  }}
                >
                  {error}
                </div>
              )}

              <Field>
                <Label htmlFor="waitlist-email">Email Address *</Label>
                <Input
                  id="waitlist-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="engineer@institution.edu"
                  required
                  autoFocus
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <Field>
                  <Label htmlFor="waitlist-name">Full Name</Label>
                  <Input
                    id="waitlist-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Dr. Jane Smith"
                  />
                </Field>
                <Field>
                  <Label htmlFor="waitlist-org">Organization / Institution</Label>
                  <Input
                    id="waitlist-org"
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="CERN, MIT, Boeing..."
                  />
                </Field>
              </div>

              <Field>
                <Label htmlFor="waitlist-discipline">Primary Discipline / Domain</Label>
                <Select id="waitlist-discipline" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                  <option value="physical_systems">Physical Systems & Multiphysics (Modelica / FMI / DAEs)</option>
                  <option value="systems_engineering">Systems Engineering & MBSE (SysML v2 / KerML)</option>
                  <option value="computational_cad">Computational CAD & Hardware (STEP / OpenSCAD / CSG)</option>
                  <option value="scientific_research">Scientific Research & Education</option>
                  <option value="other">Other Engineering / Modeling Domain</option>
                </Select>
              </Field>

              <Field>
                <Label htmlFor="waitlist-statement">What will you model or simulate in {brandName}?</Label>
                <Textarea
                  id="waitlist-statement"
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="Brief description of your physical systems, digital thread, or modeling workflow..."
                />
              </Field>

              <Field>
                <Label htmlFor="waitlist-portfolio">Portfolio / GitHub / Web Profile (optional)</Label>
                <Input
                  id="waitlist-portfolio"
                  type="url"
                  value={portfolioUrl}
                  onChange={(e) => setPortfolioUrl(e.target.value)}
                  placeholder="https://github.com/your-org"
                />
              </Field>
            </ModalBody>

            <ModalFooter>
              <CancelButton type="button" onClick={onClose}>
                Cancel
              </CancelButton>
              <SubmitButton type="submit" disabled={loading}>
                {loading ? "Submitting…" : "Request Access Key"}
              </SubmitButton>
            </ModalFooter>
          </form>
        )}
      </ModalCard>
    </Overlay>
  );
}
