// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

export interface User {
  id: number;
  username: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  account_type?: string;
  role?: string;
  has_password?: boolean;
  token_version?: number;
  totp_enabled?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ requires2FA?: boolean; tempToken?: string; user?: User }>;
  complete2FALogin: (tempToken: string, code: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    acceptTerms?: boolean,
    captchaToken?: string,
  ) => Promise<{ verificationRequired?: boolean; message?: string }>;
  logout: () => void;
  unreadCount: number;
  setUnreadCount: (c: number) => void;
  refreshUnreadCount: () => void;
  creditBalance: number;
  refreshWallet: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "modelscript-auth-token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(!!token);

  const [unreadCount, setUnreadCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState<number>(100);

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

  const refreshWallet = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.get("/billing/wallet");
      if (typeof res.data?.creditBalance === "number") {
        setCreditBalance(res.data.creditBalance);
      } else if (typeof res.data?.balance === "number") {
        setCreditBalance(res.data.balance);
      }
    } catch {
      // Ignore wallet fetch error
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    refreshUnreadCount();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      refreshUnreadCount();
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshUnreadCount();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [token, refreshUnreadCount]);

  useEffect(() => {
    if (token) {
      void refreshWallet();
    }
  }, [token, refreshWallet]);

  useEffect(() => {
    const handleWalletUpdate = () => {
      void refreshWallet();
    };
    window.addEventListener("modelscript:wallet-update", handleWalletUpdate);

    const handleAuthExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("modelscript:auth-expired", handleAuthExpired);

    return () => {
      window.removeEventListener("modelscript:wallet-update", handleWalletUpdate);
      window.removeEventListener("modelscript:auth-expired", handleAuthExpired);
    };
  }, [refreshWallet]);

  // On mount, validate stored token
  useEffect(() => {
    if (!token) return;
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.requires2FA) {
      return { requires2FA: true, tempToken: data.tempToken };
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
      captchaToken: string = "mock-token",
    ) => {
      const { data } = await api.post("/auth/register", {
        username,
        email,
        password,
        acceptTerms,
        captchaToken,
      });
      setToken(data.token);
      setUser(data.user);
      if (typeof data.user?.credit_balance === "number") {
        setCreditBalance(data.user.credit_balance);
      }
      return data;
    },
    [],
  );

  const logout = useCallback(() => {
    api.post("/auth/logout").catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = Boolean(user && (user.account_type === "admin" || user.role === "admin"));

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
        logout,
        unreadCount,
        setUnreadCount,
        refreshUnreadCount,
        creditBalance,
        refreshWallet,
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
