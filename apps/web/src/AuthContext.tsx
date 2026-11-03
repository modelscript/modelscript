// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api, { getTotalAdminBadgeCount, type AdminOverviewCounts } from "./api";
import { groupNotifications } from "./pages/notifications/types";
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
  email_verified?: boolean | number | undefined;
  onboarding_completed?: boolean | number | undefined;
  engineering_persona?: string | null | undefined;
  credit_balance?: number | undefined;
  default_post_visibility?: "public" | "unlisted" | "followers" | "direct" | string | undefined;
  actor_url?: string | null | undefined;
}

export interface LoggedOutUserSnapshot {
  username: string;
  display_name?: string | undefined;
  avatar_url?: string | undefined;
  email?: string | undefined;
  signedOutAt: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  justLoggedOut: boolean;
  lastLoggedOutUser: LoggedOutUserSnapshot | null;
  clearJustLoggedOut: () => void;
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
    inviteCode?: string,
  ) => Promise<{
    verificationRequired?: boolean | undefined;
    verificationToken?: string | undefined;
    message?: string | undefined;
  }>;
  updateToken: (newToken: string | null) => void;
  setSession: (newToken: string, newUser?: User | null) => void;
  logout: (options?: { redirect?: boolean | undefined }) => void;
  unreadCount: number;
  setUnreadCount: (c: number) => void;
  refreshUnreadCount: () => void;
  adminPendingCount: number;
  refreshAdminCount: () => void;
  creditBalance: number;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const TOKEN_KEY = "modelscript-auth-token";
const LAST_LOGGED_OUT_USER_KEY = "modelscript:last-logged-out-user";
const USER_CACHE_KEY = "modelscript-auth-user";

function readCachedUser(): User | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY) || localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (parsed && typeof parsed.id === "number") {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function readLastLoggedOutUser(): LoggedOutUserSnapshot | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_LOGGED_OUT_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LoggedOutUserSnapshot;
    if (parsed && typeof parsed.username === "string") {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function getFallbackAuthContext(): AuthContextType {
  let cachedUser: User | null = null;
  let cachedToken: string | null = null;
  if (typeof localStorage !== "undefined") {
    cachedToken = localStorage.getItem(TOKEN_KEY) || localStorage.getItem("token");
    try {
      const rawUser = localStorage.getItem("user");
      if (rawUser) cachedUser = JSON.parse(rawUser);
    } catch {
      // ignore JSON parse error
    }
  }
  return {
    user: cachedUser,
    token: cachedToken,
    isAuthenticated: Boolean(cachedToken || cachedUser),
    isAdmin: Boolean(cachedUser && (cachedUser.account_type === "admin" || cachedUser.role === "admin")),
    isLoading: false,
    justLoggedOut: false,
    lastLoggedOutUser: readLastLoggedOutUser(),
    clearJustLoggedOut: () => {},
    login: async () => ({}),
    complete2FALogin: async () => {},
    register: async () => ({}),
    updateToken: () => {},
    setSession: () => {},
    logout: () => {},
    unreadCount: 0,
    setUnreadCount: () => {},
    refreshUnreadCount: () => {},
    adminPendingCount: 0,
    refreshAdminCount: () => {},
    creditBalance: cachedUser?.credit_balance ?? 0,
    refreshWallet: async () => {},
    refreshUser: async () => {},
  };
}

// Preserve AuthContext across Vite HMR and dynamically imported routes
const AuthContext: React.Context<AuthContextType | null> =
  (globalThis as unknown as { __MODEL_SCRIPT_AUTH_CONTEXT__?: React.Context<AuthContextType | null> })
    .__MODEL_SCRIPT_AUTH_CONTEXT__ ||
  ((
    globalThis as unknown as { __MODEL_SCRIPT_AUTH_CONTEXT__?: React.Context<AuthContextType | null> }
  ).__MODEL_SCRIPT_AUTH_CONTEXT__ = createContext<AuthContextType | null>(null));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [cachedInitialUser] = useState<User | null>(readCachedUser);
  const [user, setUser] = useState<User | null>(cachedInitialUser);
  const [token, setToken] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null,
  );
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const cached = readCachedUser();
    return Boolean(storedToken && !cached);
  });
  const [justLoggedOut, setJustLoggedOut] = useState(false);
  const [lastLoggedOutUser, setLastLoggedOutUser] = useState<LoggedOutUserSnapshot | null>(() =>
    readLastLoggedOutUser(),
  );

  const [unreadCount, setUnreadCount] = useState(0);
  const [adminPendingCount, setAdminPendingCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState<number>(() => cachedInitialUser?.credit_balance ?? 0);

  const isAdmin = Boolean(user && (user.account_type === "admin" || user.role === "admin"));

  // Keep localStorage user snapshot in sync with active user state
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      if (user) {
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
        localStorage.setItem("user", JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_CACHE_KEY);
        localStorage.removeItem("user");
      }
    } catch {
      // ignore storage errors
    }
  }, [user]);

  const clearJustLoggedOut = useCallback(() => {
    setJustLoggedOut(false);
  }, []);

  const clearLoggedOutState = useCallback(() => {
    setJustLoggedOut(false);
    setLastLoggedOutUser(null);
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(LAST_LOGGED_OUT_USER_KEY);
      } catch {
        // ignore storage errors
      }
    }
  }, []);

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
        if (typeof window !== "undefined" && window.location?.pathname === "/notifications") {
          setUnreadCount(0);
          return;
        }
        if (typeof res.data?.unreadCount === "number") {
          setUnreadCount(res.data.unreadCount);
        } else if (Array.isArray(res.data?.notifications)) {
          setUnreadCount(groupNotifications(res.data.notifications).filter((n) => !n.read).length);
        } else {
          setUnreadCount(0);
        }
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

  // Validate stored or newly set token on boot or token changes
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    let isMounted = true;
    api
      .get("/auth/me")
      .then((res) => {
        if (!isMounted) return;
        if (res.data?.user) {
          setUser(res.data.user);
          if (typeof res.data.user?.credit_balance === "number") {
            setCreditBalance(res.data.user.credit_balance);
          }
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [token]);

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

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.requires2FA) {
        return { requires2FA: true, tempToken: data.tempToken };
      }
      clearLoggedOutState();
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
    },
    [clearLoggedOutState],
  );

  const complete2FALogin = useCallback(
    async (tempToken: string, code: string) => {
      const { data } = await api.post("/auth/2fa/challenge", { tempToken, code });
      clearLoggedOutState();
      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
        api.defaults.headers.common["Authorization"] = `Bearer ${data.token}`;
      }
      setToken(data.token);
      setUser(data.user);
      if (typeof data.user?.credit_balance === "number") {
        setCreditBalance(data.user.credit_balance);
      }
    },
    [clearLoggedOutState],
  );

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      acceptTerms: boolean = true,
      captchaToken: string = (typeof window !== "undefined" && (window as any).__MODEL_SCRIPT_CAPTCHA_TOKEN__) || "",
      inviteCode?: string,
    ) => {
      const { data } = await api.post("/auth/register", {
        username,
        email,
        password,
        acceptTerms,
        captchaToken,
        ...(inviteCode ? { inviteCode } : {}),
      });
      if (data.token) {
        clearLoggedOutState();
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
    [clearLoggedOutState],
  );

  const updateToken = useCallback(
    (newToken: string | null) => {
      if (newToken) {
        clearLoggedOutState();
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
    },
    [clearLoggedOutState],
  );

  const setSession = useCallback(
    (newToken: string, newUser?: User | null) => {
      clearLoggedOutState();
      if (newToken) {
        localStorage.setItem(TOKEN_KEY, newToken);
        localStorage.setItem("token", newToken);
        api.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
      }
      setToken(newToken);
      if (newUser) {
        setUser(newUser);
        const bal = (newUser as User & { credit_balance?: number }).credit_balance;
        if (typeof bal === "number") {
          setCreditBalance(bal);
        }
      }
    },
    [clearLoggedOutState],
  );

  const logout = useCallback(
    (options?: { redirect?: boolean | undefined }) => {
      const snapshot: LoggedOutUserSnapshot | null = user
        ? {
            username: user.username,
            display_name: user.display_name,
            avatar_url: user.avatar_url,
            email: user.email,
            signedOutAt: Date.now(),
          }
        : readLastLoggedOutUser();

      if (snapshot && typeof sessionStorage !== "undefined") {
        try {
          sessionStorage.setItem(LAST_LOGGED_OUT_USER_KEY, JSON.stringify(snapshot));
        } catch {
          // ignore storage errors
        }
      }
      setLastLoggedOutUser(snapshot);
      setJustLoggedOut(options?.redirect !== false);

      api.post("/auth/logout").catch(() => {});
      void clearOfflineCache();
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      } catch {
        // ignore storage errors
      }
      setToken(null);
      setUser(null);
      setUnreadCount(0);
      setAdminPendingCount(0);

      if (options?.redirect !== false && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("modelscript:logged-out", { detail: { user: snapshot } }));
      }
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isAdmin,
        isLoading,
        justLoggedOut,
        lastLoggedOutUser,
        clearJustLoggedOut,
        login,
        complete2FALogin,
        register,
        updateToken,
        setSession,
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
  if (!ctx) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      console.warn("[AuthContext] useAuth called outside active AuthProvider; returning fallback context.");
    }
    return getFallbackAuthContext();
  }
  return ctx;
}
