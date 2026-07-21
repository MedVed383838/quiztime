import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "", displayName: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (isRegister) await register(form);
      else await login({ email: form.email, password: form.password });
      navigate(location.state?.returnTo ?? "/dashboard", { replace: true });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <form className="welcome-card auth-form" onSubmit={submit}>
        <p className="eyebrow">QuizTime</p>
        <h1>{isRegister ? "Регистрация" : "Вход"}</h1>
        {isRegister && <input aria-label="Имя" placeholder="Имя" minLength="2" maxLength="40" required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />}
        <input aria-label="Email" type="email" placeholder="Email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input aria-label="Пароль" type="password" placeholder="Пароль" minLength="8" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        {error && <p role="alert">Ошибка: {error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? "Сохраняем…" : isRegister ? "Создать аккаунт" : "Войти"}</button>
        <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Уже есть аккаунт" : "Создать аккаунт"}</Link>
      </form>
    </main>
  );
}
