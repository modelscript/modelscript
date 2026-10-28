// SPDX-License-Identifier: AGPL-3.0-or-later

import { LockIcon } from "@primer/octicons-react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { EmptyState } from "./EmptyState";

export interface RequireAuthProps {
  /** Short noun phrase for the gated feature, e.g. "your notifications". */
  feature: string;
  children: React.ReactNode;
}

/**
 * Renders children for signed-in users; otherwise a consistent sign-in prompt
 * (instead of empty personal pages or account forms that can't work).
 */
export const RequireAuth: React.FC<RequireAuthProps> = ({ feature, children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;
  if (user) return <>{children}</>;

  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <EmptyState
      icon={<LockIcon size={24} />}
      title="Sign in to continue"
      body={`You need a ModelScript account to see ${feature}.`}
      actions={
        <>
          <Link className="ms-btn ms-btn-primary" to={`/login?next=${next}`}>
            Log in
          </Link>
          <Link className="ms-btn ms-btn-secondary" to="/signup">
            Create account
          </Link>
        </>
      }
    />
  );
};

export default RequireAuth;
