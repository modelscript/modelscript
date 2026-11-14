// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon } from "@primer/octicons-react";
import { Button, Dialog, Flash, FormControl, Select, Text, Textarea, TextInput } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { applyToWaitlist } from "../../api/admin";
import Box from "../Box";

interface WaitlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultEmail?: string;
  brandName?: string;
}

const HelperCallout = styled.div`
  background: var(--ms-brand-soft, rgba(6, 182, 212, 0.08));
  border: 1px solid color-mix(in srgb, var(--ms-brand) 25%, transparent);
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
  color: var(--ms-brand);
  line-height: 1.5;
`;

const SuccessCard = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 12px;
  gap: 14px;
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
    <Dialog title="Request an Access Key" width="medium" onClose={onClose}>
      {submitted ? (
        <SuccessCard>
          <Box style={{ color: "var(--ms-brand)" }}>
            <CheckCircleFillIcon size={56} />
          </Box>
          <Text as="h3" style={{ fontSize: "20px", fontWeight: 700, margin: 0 }}>
            Application Received
          </Text>
          <Text style={{ fontSize: "14px", color: "var(--ms-text-2, var(--color-fg-muted))", lineHeight: 1.6 }}>
            We&apos;ve reserved your place on the <strong>{brandName}</strong> waitlist for <strong>{email}</strong>.
            Our engineering team reviews applications on a rolling basis, and an invitation access key will be emailed
            to you directly.
          </Text>
          <HelperCallout style={{ width: "100%" }}>
            <strong>Tip for Researchers &amp; Students:</strong> Verified academic accounts (<code>.edu</code>,{" "}
            <code>.ac.uk</code>) qualify for automatic instant access. If you have an institutional address, you can
            register immediately.
          </HelperCallout>
          <Button variant="primary" size="large" block onClick={onClose}>
            Done
          </Button>
        </SuccessCard>
      ) : (
        <form onSubmit={handleSubmit}>
          <Box display="flex" flexDirection="column" gap={3} style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <HelperCallout>
              <strong>Early Access Cohort:</strong> {brandName} is onboarding simulation engineers, computational
              scientists, and university research teams in focused batches. Complete this form to receive your access
              key.
            </HelperCallout>

            {error && <Flash variant="danger">{error}</Flash>}

            <FormControl required>
              <FormControl.Label>Email Address</FormControl.Label>
              <TextInput
                block
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="engineer@institution.edu"
                autoFocus
              />
            </FormControl>

            <Box display="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <FormControl>
                <FormControl.Label>Full Name</FormControl.Label>
                <TextInput
                  block
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dr. Jane Smith"
                />
              </FormControl>
              <FormControl>
                <FormControl.Label>Organization / Institution</FormControl.Label>
                <TextInput
                  block
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="CERN, MIT, Boeing..."
                />
              </FormControl>
            </Box>

            <FormControl>
              <FormControl.Label>Primary Discipline / Domain</FormControl.Label>
              <Select block value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                <Select.Option value="physical_systems">
                  Physical Systems &amp; Multiphysics (Modelica / FMI / DAEs)
                </Select.Option>
                <Select.Option value="systems_engineering">
                  Systems Engineering &amp; MBSE (SysML v2 / KerML)
                </Select.Option>
                <Select.Option value="computational_cad">
                  Computational CAD &amp; Hardware (STEP / OpenSCAD / CSG)
                </Select.Option>
                <Select.Option value="scientific_research">Scientific Research &amp; Education</Select.Option>
                <Select.Option value="other">Other Engineering / Modeling Domain</Select.Option>
              </Select>
            </FormControl>

            <FormControl>
              <FormControl.Label>What will you model or simulate in {brandName}?</FormControl.Label>
              <Textarea
                block
                rows={3}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Brief description of your physical systems, digital thread, or modeling workflow..."
              />
            </FormControl>

            <FormControl>
              <FormControl.Label>Portfolio / GitHub / Web Profile (optional)</FormControl.Label>
              <TextInput
                block
                type="url"
                value={portfolioUrl}
                onChange={(e) => setPortfolioUrl(e.target.value)}
                placeholder="https://github.com/your-org"
              />
            </FormControl>
          </Box>

          <Box
            display="flex"
            justifyContent="flex-end"
            gap={2}
            pt={3}
            mt={3}
            style={{ borderTop: "1px solid var(--ms-divider, var(--color-border-default))" }}
          >
            <Button type="button" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? "Submitting…" : "Request Access Key"}
            </Button>
          </Box>
        </form>
      )}
    </Dialog>
  );
}
