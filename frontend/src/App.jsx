import { Link, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import AuthPage from "./pages/AuthPage.jsx";

function Home() {
  return <main className="app-shell"><section className="welcome-card"><p className="eyebrow">QuizTime</p><h1>Интерактивные квизы в реальном времени</h1><p>Введите PIN на следующих этапах или войдите в аккаунт.</p><Link to="/login">Войти</Link> <Link to="/register">Регистрация</Link></section></main>;
}

function Dashboard() {
  const { user, logout } = useAuth();
  return <main className="app-shell"><section className="welcome-card"><p className="eyebrow">Личный кабинет</p><h1>Здравствуйте, {user.displayName}</h1><p>{user.email}</p><button type="button" onClick={logout}>Выйти</button></section></main>;
}

export default function App() {
  return <AuthProvider><Routes><Route path="/" element={<Home />} /><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/register" element={<AuthPage mode="register" />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<Dashboard />} /></Route><Route path="*" element={<Outlet />} /></Routes></AuthProvider>;
}
