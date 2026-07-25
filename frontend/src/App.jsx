import { useEffect, useState } from "react";
import { Link, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import ProtectedRoute from "./auth/ProtectedRoute.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import QuestionForm from "./pages/QuestionForm.jsx";
import LobbyPage from "./pages/LobbyPage.jsx";
import StartSessionPage from "./pages/StartSessionPage.jsx";
import JoinSessionPage from "./pages/JoinSessionPage.jsx";

function Home() {
  return <main className="app-shell home-shell"><header className="public-header"><Link className="brand-link" to="/">QuizTime</Link><nav><Link to="/login">Вход</Link><Link className="primary-link" to="/register">Регистрация</Link></nav></header><section className="home-hero"><p className="eyebrow">Интерактивные квизы</p><h1>Игра начинается<br />с одного PIN-кода</h1><p>Присоединяйтесь к игре по шестизначному коду или создавайте собственные квизы для команды и друзей.</p><div className="home-actions"><Link className="primary-link" to="/login">Войти в аккаунт</Link><Link className="secondary-link" to="/register">Создать квиз</Link></div></section><footer className="public-footer">© 2026 QuizTime Interactive</footer></main>;
}

function Dashboard() {
  const { user, logout } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  useEffect(() => {
    fetch("/api/quizzes", { credentials: "include" }).then((response) => response.json()).then((body) => setQuizzes(body.data.quizzes));
  }, []);
  return <main className="app-shell dashboard-shell"><section className="dashboard-card"><header className="dashboard-header"><div><p className="eyebrow">Личный кабинет</p><h1>Здравствуйте, {user.displayName}</h1><p className="dashboard-copy">Создавайте квизы, готовьте вопросы и запускайте игры.</p></div><div className="header-actions"><Link className="secondary-link" to="/join">Войти по PIN</Link><Link className="primary-link" to="/quizzes/new">+ Создать квиз</Link><button className="icon-button" onClick={logout}>Выйти</button></div></header><div className="section-heading"><div><p className="eyebrow">Мои квизы</p><h2>Все ваши интерактивы</h2></div><span>{quizzes.length}</span></div><div className="quiz-list">{quizzes.length === 0 && <div className="empty-state"><strong>Квизов пока нет</strong><p>Начните с создания первого квиза.</p></div>}{quizzes.map((quiz) => <article className="quiz-item" key={quiz.id}><div className="quiz-status-icon" aria-hidden="true">?</div><div className="quiz-item-content"><strong>{quiz.title}</strong><p>{quiz.category.name} · {quiz.questionCount} вопросов</p><span className={`status-chip status-${quiz.status.toLowerCase()}`}>{quiz.status === "READY" ? "Готов к запуску" : quiz.status === "ARCHIVED" ? "Архив" : "Черновик"}</span></div><div className="quiz-item-actions"><Link className="text-link" to={`/quizzes/${quiz.id}/edit`}>Открыть</Link>{quiz.status === "READY" && <Link className="primary-link" to={`/sessions/start/${quiz.id}`}>Запустить</Link>}</div></article>)}</div></section></main>;
}

function QuizEditor() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(quizId);
  const [categories, setCategories] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [show, setShow] = useState(false);
  const [quizStatus, setQuizStatus] = useState("DRAFT");
  const [error, setError] = useState("");
  const [makingReady, setMakingReady] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", categoryId: "" });

  useEffect(() => {
    Promise.all([
      fetch("/api/categories", { credentials: "include" }).then((response) => response.json()),
      editing ? fetch(`/api/quizzes/${quizId}`, { credentials: "include" }).then((response) => response.json()) : Promise.resolve(null),
    ]).then(([categoriesBody, quizBody]) => {
      setCategories(categoriesBody.data.categories);
      if (quizBody) {
        const quiz = quizBody.data.quiz;
        setQuestions(quiz.questions);
        setQuizStatus(quiz.status);
        setForm({ title: quiz.title, description: quiz.description ?? "", categoryId: String(quiz.categoryId) });
      }
    });
  }, [editing, quizId]);

  const save = async (event) => {
    event.preventDefault();
    setError("");
    const response = await fetch(editing ? `/api/quizzes/${quizId}` : "/api/quizzes", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ...form, categoryId: Number(form.categoryId), defaultTimeLimitSeconds: 30, defaultPointsPerQuestion: 1000, revealCorrectAnswer: true }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Не удалось сохранить квиз");
      return;
    }
    navigate(`/quizzes/${body.data.quiz.id}/edit`);
  };

  const makeReady = async () => {
    setError("");
    setMakingReady(true);
    const response = await fetch(`/api/quizzes/${quizId}/ready`, { method: "POST", credentials: "include" });
    const body = await response.json();
    setMakingReady(false);
    if (!response.ok) {
      setError(body.error?.message ?? "Не удалось подготовить квиз к запуску");
      return;
    }
    setQuizStatus(body.data.quiz.status);
  };

  return <main className="app-shell editor-shell"><section className="editor-card"><header className="editor-page-header"><Link className="text-link" to="/dashboard">← В кабинет</Link><div><p className="eyebrow">Настройки квиза</p><h1>{editing ? "Редактор квиза" : "Создание квиза"}</h1><p>Настройте основную информацию, затем добавьте вопросы.</p></div></header><form className="auth-form editor-form" onSubmit={save}><label>Название квиза<input placeholder="Введите яркое название…" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Описание<textarea placeholder="Кратко опишите, о чём этот квиз…" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Категория<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Выберите категорию</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><button>Сохранить черновик</button></form>{error && <p className="form-alert" role="alert">{error}</p>}{editing && <section className="questions-placeholder"><div className="editor-header"><div><p className="eyebrow">Конструктор</p><h2>Вопросы ({questions.length})</h2></div><span className={`status-chip status-${quizStatus.toLowerCase()}`}>{quizStatus}</span></div>{questions.map((question) => <p className="question-summary" key={question.id}><span>{question.position}</span>{question.text}</p>)}{quizStatus === "DRAFT" && <button type="button" onClick={makeReady} disabled={makingReady}>{makingReady ? "Проверяем квиз…" : "Сделать готовым к запуску"}</button>}{quizStatus === "READY" && <p className="ready-note">Квиз готов. Вернитесь в кабинет и нажмите «Запустить игру».</p>}{show ? <QuestionForm quizId={quizId} onSaved={(question) => { setQuestions([...questions, question]); setShow(false); }} onCancel={() => setShow(false)} /> : quizStatus === "DRAFT" && <button type="button" className="add-question-button" onClick={() => setShow(true)}>+ Добавить вопрос</button>}</section>}</section></main>;
}

export default function App() {
  return <AuthProvider><Routes><Route path="/" element={<Home />} /><Route path="/join" element={<JoinSessionPage />} /><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/register" element={<AuthPage mode="register" />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<Dashboard />} /><Route path="/quizzes/new" element={<QuizEditor />} /><Route path="/quizzes/:quizId/edit" element={<QuizEditor />} /><Route path="/sessions/start/:quizId" element={<StartSessionPage />} /><Route path="/sessions/:sessionId/host" element={<LobbyPage />} /><Route path="/play/:sessionId" element={<LobbyPage />} /><Route path="/sessions/:sessionId/results" element={<LobbyPage />} /></Route><Route path="*" element={<Outlet />} /></Routes></AuthProvider>;
}
