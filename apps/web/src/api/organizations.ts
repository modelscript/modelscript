// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export type OrgRole = "owner" | "admin" | "maintainer" | "contributor" | "member";

export interface Organization {
  id: number;
  slug: string;
  name: string;
  display_name?: string | null;
  description: string | null;
  website?: string | null;
  billing_email?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  role?: OrgRole;
  created_at: string;
}

export interface OrganizationMember {
  user_id: number;
  userId?: number;
  username: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  role: OrgRole;
  created_at: string;
}

export interface UpdateOrganizationPayload {
  name?: string;
  display_name?: string;
  description?: string | null;
  website?: string | null;
  billing_email?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
}

export const getMyOrganizations = async (): Promise<Organization[]> => {
  const { data } = await api.get<{ organizations: Organization[] }>("/organizations/my");
  return data.organizations || [];
};

export const listUserOrganizations = getMyOrganizations;

export const createOrganization = async (payload: {
  slug: string;
  name: string;
  description?: string;
}): Promise<Organization> => {
  const { data } = await api.post<{ organization: Organization }>("/organizations", payload);
  return data.organization;
};

export const updateOrganization = async (
  orgName: string,
  payload: UpdateOrganizationPayload,
): Promise<Organization> => {
  const { data } = await api.patch<{ organization?: Organization } & Partial<Organization>>(
    `/organizations/${encodeURIComponent(orgName)}`,
    payload,
  );
  return data.organization ?? (data as unknown as Organization);
};

export const getOrganizationMembers = async (slug: string): Promise<OrganizationMember[]> => {
  const { data } = await api.get<{ members: OrganizationMember[] }>(`/organizations/${slug}/members`);
  return data.members || [];
};

export const addOrganizationMember = async (
  slug: string,
  username: string,
  role: OrgRole = "contributor",
): Promise<void> => {
  await api.post(`/organizations/${slug}/members`, { username, role });
};

export const updateOrgMemberRole = async (orgName: string, username: string, role: OrgRole): Promise<void> => {
  await api.patch(`/organizations/${encodeURIComponent(orgName)}/members/${encodeURIComponent(username)}`, {
    role,
  });
};

export const removeOrganizationMember = async (slug: string, userId: number): Promise<void> => {
  await api.delete(`/organizations/${slug}/members/${userId}`);
};
