import { createContext, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code ?? "REQUEST_FAILED");
  return body.data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(credentials) {
      const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify(credentials) });
      setUser(data.user);
    },
    async register(credentials) {
      const data = await request("/api/auth/register", { method: "POST", body: JSON.stringify(credentials) });
      setUser(data.user);
    },
    async logout() {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
