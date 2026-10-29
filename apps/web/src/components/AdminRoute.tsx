// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../AuthContext";

interface AdminRouteProps {
  children: React.ReactElement;
}

export const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return <div style={{ minHeight: "100vh", backgroundColor: "transparent" }} />;
  }

  const isStaff = Boolean(
    user &&
    (isAdmin ||
      user.role === "moderator" ||
      user.role === "auditor" ||
      user.account_type === "moderator" ||
      user.account_type === "auditor"),
  );

  if (!isStaff) {
    return <Navigate to="/home" replace />;
  }

  return children;
};

export default AdminRoute;
