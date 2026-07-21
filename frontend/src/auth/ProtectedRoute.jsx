import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <p>Проверяем сессию…</p>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
