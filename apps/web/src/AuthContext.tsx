// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { getTotalAdminBadgeCount, type AdminOverviewCounts } from "./api";
import { clearOfflineCache } from "./util/offline-storage";

export interface User {
  id: number;
  username: string;
  email: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  banner_url?: string | undefined;
  account_type?: string | undefined;
  role?: string | undefined;
  isAdmin?: boolean | undefined;
  has_password?: boolean | undefined;
  token_version?: number | undefined;
  totp_enabled?: boolean | undefined;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (
    email: string,
    password: string,
  ) => Promise<{ requires2FA?: boolean | undefined; tempToken?: string | undefined; user?: User | undefined }>;
  complete2FALogin: (tempToken: string, code: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    acceptTerms?: boolean,
    captchaToken?: string,
  ) => Promise<{ verificationRequired?: boolean | undefined; message?: string | undefined }>;
  updateToken: (newToken: string | null) => void;
  logout: () => void;
  unreadCount: number;
  setUnreadCount: (c: number) => void;
  refreshUnreadCount: () => void;
  adminPendingCount: number;
  refreshAdminCount: () => void;
  creditBalance: number;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "modelscript-auth-token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(!!token);

  const [unreadCount, setUnreadCount] = useState(0);
  const [adminPendingCount, setAdminPendingCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState<number>(0);

  const isAdmin = Boolean(user && (user.account_type === "admin" || user.role === "admin"));

  // Set/clear the axios default header whenever token changes
  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    } else {
      localStorage.removeItem(TOKEN_KEY);
      delete api.defaults.headers.common["Authorization"];
    }
  }, [token]);

  const refreshUnreadCount = useCallback(() => {
    if (!token) return;
    api
      .get("/social/notifications")
      .then((res) => {
        setUnreadCount(res.data.unreadCount || 0);
      })
      .catch(() => {});
  }, [token]);

  const refreshAdminCount = useCallback(() => {
    if (!token || !isAdmin) {
      setAdminPendingCount(0);
      return;
    }
    api
      .get("/admin/overview")
      .then((res) => {
        if (res.data && typeof res.data === "object") {
          setAdminPendingCount(getTotalAdminBadgeCount(res.data as AdminOverviewCounts));
        }
      })
      .catch(() => {});
  }, [token, isAdmin]);

  const refreshWallet = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.get("/auth/me");
      if (res.data?.user) {
        setUser(res.data.user);
        if (typeof res.data.user.credit_balance === "number") {
          setCreditBalance(res.data.user.credit_balance);
        }
      }
    } catch {
      // Ignore wallet fetch error
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setAdminPendingCount(0);
      return;
    }
    refreshUnreadCount();
    refreshAdminCount();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      refreshUnreadCount();
      refreshAdminCount();
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshUnreadCount();
        refreshAdminCount();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [token, refreshUnreadCount, refreshAdminCount]);

  useEffect(() => {
    const handleWalletUpdate = () => {
      void refreshWallet();
    };
    const handleAdminOverviewUpdate = (e: Event) => {
      const detail = (e as CustomEvent<AdminOverviewCounts | undefined>)?.detail;
      if (detail && typeof detail === "object" && "pendingReports" in detail) {
        setAdminPendingCount(getTotalAdminBadgeCount(detail));
      } else {
        refreshAdminCount();
      }
    };
    window.addEventListener("modelscript:wallet-update", handleWalletUpdate);
    window.addEventListener("modelscript:admin-overview-update", handleAdminOverviewUpdate);

    const handleAuthExpired = () => {
      void clearOfflineCache();
      setToken(null);
      setUser(null);
      setAdminPendingCount(0);
    };
    window.addEventListener("modelscript:auth-expired", handleAuthExpired);

    return () => {
      window.removeEventListener("modelscript:wallet-update", handleWalletUpdate);
      window.removeEventListener("modelscript:admin-overview-update", handleAdminOverviewUpdate);
      window.removeEventListener("modelscript:auth-expired", handleAuthExpired);
    };
  }, [refreshWallet, refreshAdminCount]);

  // Validate stored or newly set token when user is not yet populated
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    if (user) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    api
      .get("/auth/me")
      .then((res) => {
        setUser(res.data.user);
        if (typeof res.data.user?.credit_balance === "number") {
          setCreditBalance(res.data.user.credit_balance);
        }
      })
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [token, user]);

  const refreshUser = useCallback(async () => {
    const activeToken = token || localStorage.getItem(TOKEN_KEY);
    if (!activeToken) return;
    try {
      const res = await api.get("/auth/me");
      if (res.data?.user) {
        setUser(res.data.user);
        if (typeof res.data.user.credit_balance === "number") {
          setCreditBalance(res.data.user.credit_balance);
        }
      }
    } catch {
      // Ignore refresh error
    }
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.requires2FA) {
      return { requires2FA: true, tempToken: data.tempToken };
    }
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
    }
    setToken(data.token);
    setUser(data.user);
    if (typeof data.user?.credit_balance === "number") {
      setCreditBalance(data.user.credit_balance);
    }
    return { requires2FA: false, user: data.user };
  }, []);

  const complete2FALogin = useCallback(async (tempToken: string, code: string) => {
    const { data } = await api.post("/auth/2fa/challenge", { tempToken, code });
    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
    }
    setToken(data.token);
    setUser(data.user);
    if (typeof data.user?.credit_balance === "number") {
      setCreditBalance(data.user.credit_balance);
    }
  }, []);

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      acceptTerms: boolean = true,
      captchaToken: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ? "" : "mock-token",
    ) => {
      const { data } = await api.post("/auth/register", {
        username,
        email,
        password,
        acceptTerms,
        captchaToken,
      });
      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
        setToken(data.token);
        setUser(data.user);
        if (typeof data.user?.credit_balance === "number") {
          setCreditBalance(data.user.credit_balance);
        }
      }
      return data;
    },
    [],
  );

  const updateToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
      api.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
      setToken(newToken);
      api
        .get("/auth/me")
        .then((res) => {
          if (res.data?.user) {
            setUser(res.data.user);
            if (typeof res.data.user.credit_balance === "number") {
              setCreditBalance(res.data.user.credit_balance);
            }
          }
        })
        .catch(() => {});
    } else {
      localStorage.removeItem(TOKEN_KEY);
      delete api.defaults.headers.common["Authorization"];
      setToken(null);
      setUser(null);
      setAdminPendingCount(0);
    }
  }, []);

  const logout = useCallback(() => {
    api.post("/auth/logout").catch(() => {});
    void clearOfflineCache();
    setToken(null);
    setUser(null);
    setAdminPendingCount(0);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isAdmin,
        isLoading,
        login,
        complete2FALogin,
        register,
        updateToken,
        logout,
        unreadCount,
        setUnreadCount,
        refreshUnreadCount,
        adminPendingCount,
        refreshAdminCount,
        creditBalance,
        refreshWallet,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
