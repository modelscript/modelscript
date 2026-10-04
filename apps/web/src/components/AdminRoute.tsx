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
    return <div style={{ minHeight: "100vh", backgroundColor: "var(--color-canvas-default)" }} />;
  }

  if (!user || !isAdmin) {
    return <Navigate to="/home" replace />;
  }

  return children;
};

export default AdminRoute;
