// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PresetBadge {
  label: string;
  color: string;
}

export const PRESET_BADGES: Record<string, PresetBadge> = {
  systems_general: { label: "Systems & DAE", color: "#3b82f6" },
  oil_gas_process: { label: "Oil, Gas & Process", color: "#f59e0b" },
  power_rf_grid: { label: "Power Grids & RF", color: "#10b981" },
  automotive_robotics: { label: "Automotive & Robotics", color: "#ef4444" },
  aerospace_cad: { label: "3D CAD & Aerospace", color: "#8b5cf6" },
  pharma_chem_bio: { label: "Pharma & Bio", color: "#ec4899" },
  med_radiology: { label: "Medical & Biomech", color: "#06b6d4" },
};
