// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export type OrgRole = "owner" | "maintainer" | "contributor";

export interface Organization {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  role?: OrgRole | "member";
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

export const getMyOrganizations = async (): Promise<Organization[]> => {
  const { data } = await api.get<{ organizations: Organization[] }>("/organizations/my");
  return data.organizations || [];
};

export const createOrganization = async (payload: {
  slug: string;
  name: string;
  description?: string;
}): Promise<Organization> => {
  const { data } = await api.post<{ organization: Organization }>("/organizations", payload);
  return data.organization;
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

export const removeOrganizationMember = async (slug: string, userId: number): Promise<void> => {
  await api.delete(`/organizations/${slug}/members/${userId}`);
};
