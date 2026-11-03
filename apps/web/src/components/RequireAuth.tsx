// SPDX-License-Identifier: AGPL-3.0-or-later

import { LockIcon, TelescopeIcon } from "@primer/octicons-react";
import React from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useInstanceBranding } from "../InstanceBrandingContext";
import { EmptyState } from "./EmptyState";

export interface RequireAuthProps {
  /** Short noun phrase for the gated feature, e.g. "your notifications". */
  feature: string;
  children: React.ReactNode;
}

/**
 * Renders children for signed-in users; redirects to the full-page logout
 * confirmation if the user just signed out; otherwise renders a consistent
 * sign-in prompt.
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({ feature, children }) => {
  const { user, isLoading, justLoggedOut } = useAuth();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";
  const location = useLocation();

  if (isLoading) return null;
  if (user) return <>{children}</>;
  if (justLoggedOut) {
    return <Navigate to="/logout" replace />;
  }

  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <EmptyState
      icon={<LockIcon size={24} />}
      title="Sign in to continue"
      body={`You need an ${brandName} account to see ${feature}.`}
      actions={
        <>
          <Link className="ms-btn ms-btn-primary" to={`/login?next=${next}`}>
            Log in
          </Link>
          <Link className="ms-btn ms-btn-secondary" to="/signup">
            Create account
          </Link>
          <Link className="ms-btn ms-btn-quiet" to="/explore">
            <TelescopeIcon size={14} />
            Explore
          </Link>
        </>
      }
    />
  );
};

export default RequireAuth;
