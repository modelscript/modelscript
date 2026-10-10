// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  CpuIcon,
  LinkExternalIcon,
  LinkIcon,
  PlusIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Select, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import styled from "styled-components";
import type { ArtifactViewerInfo, ClassDetail, ClassSummary } from "../api";
import { checkUnitParity, type DigitalThreadTwin, type DomainType } from "../util/digitalThread";

/* ─── Styled Components ─── */

const FormSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--color-canvas-subtle, rgba(22, 27, 34, 0.6));
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 10px;
  padding: 16px;
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #c9d1d9);
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-fg-muted, #8b949e);
`;

const ParityCard = styled.div<{ $status: "compatible" | "warning" | "incompatible" }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 13px;
  border: 1px solid
    ${(props) => {
      switch (props.$status) {
        case "compatible":
          return "rgba(46, 160, 67, 0.4)";
        case "warning":
          return "rgba(217, 119, 6, 0.4)";
        case "incompatible":
          return "rgba(248, 81, 73, 0.4)";
      }
    }};
  background: ${(props) => {
    switch (props.$status) {
      case "compatible":
        return "rgba(46, 160, 67, 0.1)";
      case "warning":
        return "rgba(217, 119, 6, 0.1)";
      case "incompatible":
        return "rgba(248, 81, 73, 0.1)";
    }
  }};
  color: var(--color-fg-default, #c9d1d9);
`;

/* ─── Component Props ─── */

export interface CreateSemanticLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newTwin: DigitalThreadTwin) => void;
  packageName: string;
  packageVersion: string;
  classes?: ClassSummary[];
  rootClass?: ClassDetail | null;
  artifactViewers?: ArtifactViewerInfo[];
}

export const CreateSemanticLinkModal: React.FC<CreateSemanticLinkModalProps> = ({
  isOpen,
  onClose,
  onSave,
  packageName,
  packageVersion,
  classes = [],
  rootClass = null,
  artifactViewers = [],
}) => {
  // Source State
  const [sourceDomain, setSourceDomain] = useState<DomainType>("modelica");
  const [sourceName, setSourceName] = useState(rootClass?.name || packageName || "");
  const [sourceVariable, setSourceVariable] = useState("");
  const [sourceUnit, setSourceUnit] = useState("N.m");
  const [sourceKind, setSourceKind] = useState("Variable");

  // Target State
  const [targetDomain, setTargetDomain] = useState<DomainType>("cad");
  const [targetName, setTargetName] = useState("");
  const [targetAttribute, setTargetAttribute] = useState("");
  const [targetUnit, setTargetUnit] = useState("N*m");
  const [targetKind, setTargetKind] = useState("SolidBody");

  // Relationship
  const [relationship, setRelationship] = useState<DigitalThreadTwin["relationship"]>("twin");

  // Parity computation
  const parity = useMemo(() => {
    return checkUnitParity(sourceUnit, targetUnit);
  }, [sourceUnit, targetUnit]);

  const handleSourceDomainChange = (domain: DomainType) => {
    setSourceDomain(domain);
    if (domain === "modelica") setSourceKind("Variable");
    else if (domain === "sysml2") setSourceKind("Part");
    else if (domain === "cad") setSourceKind("SolidBody");
    else if (domain === "fea") setSourceKind("MeshElement");
    else if (domain === "dataset") setSourceKind("Column");
  };

  const handleTargetDomainChange = (domain: DomainType) => {
    setTargetDomain(domain);
    if (domain === "cad") setTargetKind("SolidBody");
    else if (domain === "modelica") setTargetKind("Component");
    else if (domain === "sysml2") setTargetKind("Attribute");
    else if (domain === "fea") setTargetKind("BoundaryCondition");
    else if (domain === "dataset") setTargetKind("TelemetrySignal");
  };

  // Candidate source options from classes
  const classOptions = useMemo(() => {
    return classes.map((c) => c.name);
  }, [classes]);

  // Candidate CAD artifacts from viewers
  const cadOptions = useMemo(() => {
    return artifactViewers
      .filter((av) => {
        const p = av.path.toLowerCase();
        return p.endsWith(".step") || p.endsWith(".stp") || p.endsWith(".scad") || av.type.toLowerCase() === "cad";
      })
      .map((av) => av.path);
  }, [artifactViewers]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceName.trim() || !targetName.trim()) return;

    const newTwin: DigitalThreadTwin = {
      id: `twin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: {
        domain: sourceDomain,
        name: sourceName.trim(),
        qualifiedName: `${sourceDomain}::${sourceName.trim()}`,
        kind: sourceKind,
        variable: sourceVariable.trim() || undefined,
        unit: sourceUnit.trim() || undefined,
      },
      target: {
        domain: targetDomain,
        name: targetName.trim(),
        qualifiedName: `${targetDomain}::${targetName.trim()}`,
        kind: targetKind,
        attribute: targetAttribute.trim() || undefined,
        unit: targetUnit.trim() || undefined,
      },
      relationship,
      parity,
      cadViewerConfig:
        targetDomain === "cad"
          ? {
              url: `/api/v1/libraries/${packageName}/${packageVersion}/artifacts/${encodeURIComponent(targetName)}`,
            }
          : undefined,
    };

    onSave(newTwin);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onDismiss={onClose}
      aria-labelledby="create-semantic-link-title"
      sx={{
        width: ["90vw", "720px"],
        maxWidth: "760px",
        background: "var(--color-canvas-default, #0d1117)",
        border: "1px solid var(--color-border-default, #30363d)",
        borderRadius: "14px",
        boxShadow: "0 24px 48px rgba(0, 0, 0, 0.5)",
      }}
    >
      <Dialog.Header id="create-semantic-link-title" sx={{ borderBottomColor: "var(--color-border-subtle, #21262d)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <LinkIcon size={20} fill="#38bdf8" />
          <Text sx={{ fontWeight: 600, fontSize: 16 }}>Create Cross-Language Semantic Link</Text>
        </div>
      </Dialog.Header>

      <form onSubmit={handleSubmit}>
        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
          {/* Relationship Selection */}
          <FieldGroup>
            <FieldLabel>Relationship Semantics</FieldLabel>
            <Select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as DigitalThreadTwin["relationship"])}
              sx={{ width: "100%" }}
            >
              <Select.Option value="twin">Digital Twin Counterpart (Bidirectional Equivalence)</Select.Option>
              <Select.Option value="cad-binding">CAD Geometry Binding (Kinematic Transform Coupling)</Select.Option>
              <Select.Option value="implements">Architecture Implementation (SysML v2 ⟷ Modelica)</Select.Option>
              <Select.Option value="verification">
                Requirement Verification (ReqIF ⟷ Simulation Trajectory)
              </Select.Option>
              <Select.Option value="calibrated-by">Experimental Data Calibration (Simulation ⟷ Dataset)</Select.Option>
            </Select>
          </FieldGroup>

          {/* Source Domain */}
          <FormSection>
            <SectionHeader>
              <CpuIcon size={16} fill="#a855f7" />
              Source Element (Domain Origin)
            </SectionHeader>

            <FieldRow>
              <FieldGroup>
                <FieldLabel>Domain</FieldLabel>
                <Select
                  value={sourceDomain}
                  onChange={(e) => handleSourceDomainChange(e.target.value as DomainType)}
                  sx={{ width: "100%" }}
                >
                  <Select.Option value="modelica">Modelica (.mo)</Select.Option>
                  <Select.Option value="sysml2">SysML v2 (.sysml)</Select.Option>
                  <Select.Option value="cad">STEP CAD (.step)</Select.Option>
                  <Select.Option value="fea">FEA / Mesh (.inp)</Select.Option>
                  <Select.Option value="dataset">Simulation / Dataset (.csv)</Select.Option>
                </Select>
              </FieldGroup>

              <FieldGroup>
                <FieldLabel>Element Name / Class</FieldLabel>
                {classOptions.length > 0 && sourceDomain === "modelica" ? (
                  <Select value={sourceName} onChange={(e) => setSourceName(e.target.value)} sx={{ width: "100%" }}>
                    {classOptions.map((opt) => (
                      <Select.Option key={opt} value={opt}>
                        {opt}
                      </Select.Option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="e.g. ElectricDrive or Propulsion::Motor"
                    sx={{ width: "100%" }}
                  />
                )}
              </FieldGroup>
            </FieldRow>

            <FieldRow>
              <FieldGroup>
                <FieldLabel>Variable / Port (Optional)</FieldLabel>
                <TextInput
                  value={sourceVariable}
                  onChange={(e) => setSourceVariable(e.target.value)}
                  placeholder="e.g. tau or flange_b.tau"
                  sx={{ width: "100%" }}
                />
              </FieldGroup>

              <FieldGroup>
                <FieldLabel>Physical Unit</FieldLabel>
                <TextInput
                  value={sourceUnit}
                  onChange={(e) => setSourceUnit(e.target.value)}
                  placeholder="e.g. N.m, kg, V, m/s, W"
                  sx={{ width: "100%" }}
                />
              </FieldGroup>
            </FieldRow>
          </FormSection>

          {/* Target Domain */}
          <FormSection>
            <SectionHeader>
              <LinkExternalIcon size={16} fill="#06b6d4" />
              Target Element (Counterpart Destination)
            </SectionHeader>

            <FieldRow>
              <FieldGroup>
                <FieldLabel>Domain</FieldLabel>
                <Select
                  value={targetDomain}
                  onChange={(e) => handleTargetDomainChange(e.target.value as DomainType)}
                  sx={{ width: "100%" }}
                >
                  <Select.Option value="cad">STEP CAD (.step)</Select.Option>
                  <Select.Option value="sysml2">SysML v2 (.sysml)</Select.Option>
                  <Select.Option value="modelica">Modelica (.mo)</Select.Option>
                  <Select.Option value="fea">FEA / Mesh (.inp)</Select.Option>
                  <Select.Option value="dataset">Simulation / Dataset (.csv)</Select.Option>
                </Select>
              </FieldGroup>

              <FieldGroup>
                <FieldLabel>Target Resource / Part</FieldLabel>
                {cadOptions.length > 0 && targetDomain === "cad" ? (
                  <Select value={targetName} onChange={(e) => setTargetName(e.target.value)} sx={{ width: "100%" }}>
                    <Select.Option value="">Select a CAD model...</Select.Option>
                    {cadOptions.map((opt) => (
                      <Select.Option key={opt} value={opt}>
                        {opt}
                      </Select.Option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    placeholder="e.g. Chassis.step or Avionics::Inverter"
                    sx={{ width: "100%" }}
                  />
                )}
              </FieldGroup>
            </FieldRow>

            <FieldRow>
              <FieldGroup>
                <FieldLabel>Target Attribute / Solid (Optional)</FieldLabel>
                <TextInput
                  value={targetAttribute}
                  onChange={(e) => setTargetAttribute(e.target.value)}
                  placeholder="e.g. rotor_solid or torqueLimit"
                  sx={{ width: "100%" }}
                />
              </FieldGroup>

              <FieldGroup>
                <FieldLabel>Physical Unit</FieldLabel>
                <TextInput
                  value={targetUnit}
                  onChange={(e) => setTargetUnit(e.target.value)}
                  placeholder="e.g. N*m, kg, V, m/s, W"
                  sx={{ width: "100%" }}
                />
              </FieldGroup>
            </FieldRow>
          </FormSection>

          {/* Live Physical Quantity Parity Card */}
          <ParityCard $status={parity.status}>
            {parity.status === "compatible" && (
              <CheckCircleFillIcon size={20} fill="#3fb950" style={{ flexShrink: 0 }} />
            )}
            {parity.status === "warning" && <AlertIcon size={20} fill="#d29922" style={{ flexShrink: 0 }} />}
            {parity.status === "incompatible" && <XCircleFillIcon size={20} fill="#f85149" style={{ flexShrink: 0 }} />}

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ fontWeight: 600, fontSize: "13px" }}>
                Physical Parity:{" "}
                {parity.status === "compatible"
                  ? "Validated"
                  : parity.status === "warning"
                    ? "Scaling Warning"
                    : "Incompatible Dimensions"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-fg-muted, #8b949e)" }}>{parity.message}</div>
              {parity.factor !== undefined && parity.factor !== 1.0 && (
                <div style={{ fontSize: "11px", color: "#d29922" }}>Conversion scale factor: ×{parity.factor}</div>
              )}
            </div>
          </ParityCard>
        </div>

        {/* Footer actions */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--color-border-subtle, #21262d)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <Button variant="invisible" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!sourceName.trim() || !targetName.trim() || parity.status === "incompatible"}
            leadingVisual={PlusIcon}
          >
            Create Semantic Link
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

export default CreateSemanticLinkModal;
