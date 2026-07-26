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
      navigate(location.state?.returnTo ?? "/dashboard", { replace: true, state: location.state?.pin ? { pin: location.state.pin } : null });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-shell auth-shell">
      <section className="auth-layout">
        <Link className="brand-link" to="/">QuizTime</Link>
        <form className="welcome-card auth-form auth-card" onSubmit={submit}>
          <div className="auth-icon" aria-hidden="true">?</div>
          <p className="eyebrow">{isRegister ? "Новый аккаунт" : "С возвращением"}</p>
          <h1>{isRegister ? "Создайте аккаунт" : "Войдите в QuizTime"}</h1>
          <p className="auth-copy">{isRegister ? "Собирайте квизы и запускайте игры в реальном времени." : "Продолжайте создавать и проводить свои квизы."}</p>
          {isRegister && <label>Имя<input aria-label="Имя" placeholder="Как к вам обращаться" minLength="2" maxLength="40" required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>}
          <label>Email<input aria-label="Email" type="email" placeholder="name@example.com" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Пароль<input aria-label="Пароль" type="password" placeholder="Минимум 8 символов" minLength="8" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          {error && <p className="form-alert" role="alert">Ошибка: {error}</p>}
          <button type="submit" disabled={submitting}>{submitting ? "Сохраняем…" : isRegister ? "Создать аккаунт" : "Войти"}</button>
          <p className="auth-switch">{isRegister ? "Уже есть аккаунт?" : "Ещё нет аккаунта?"} <Link to={isRegister ? "/login" : "/register"}>{isRegister ? "Войти" : "Зарегистрироваться"}</Link></p>
        </form>
      </section>
    </main>
  );
}
