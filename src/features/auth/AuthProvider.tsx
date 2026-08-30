"use client";

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  requestSignUpOtp: (email: string) => Promise<void>;
  verifySignUpOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string, redirectTo: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = Boolean(supabase);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }
      if (import.meta.env.VITE_DEV_AUTO_LOGIN !== "true") {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch("/api/testing/auto-login", { method: "POST" });
        if (response.ok) {
          const credentials = await response.json() as { access_token: string; refresh_token: string };
          const { data: autoLogin, error } = await supabase.auth.setSession(credentials);
          if (error) throw error;
          if (active) setSession(autoLogin.session);
        }
      } catch {
        // Normal authentication remains available when the explicit testing bypass is disabled.
      } finally {
        if (active) setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    loading,
    session,
    user: session?.user ?? null,
    async signIn(email, password) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async requestSignUpOtp(email) {
      if (!supabase) return;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
    },
    async verifySignUpOtp(email, token) {
      if (!supabase) return;
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (error) throw error;
    },
    async signOut() {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async requestPasswordReset(email, redirectTo) {
      if (!supabase) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    async updatePassword(password) {
      if (!supabase) return;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
  }), [configured, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
