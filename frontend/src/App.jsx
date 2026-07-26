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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pin, setPin] = useState("");

  const join = (event) => {
    event.preventDefault();
    navigate(user ? "/join" : "/login", { state: user ? { pin } : { returnTo: "/join", pin } });
  };

  return <main className="app-shell home-shell"><header className="public-header"><Link className="brand-link" to="/">QuizTime</Link><nav><Link to="/login">Вход</Link><Link className="primary-link" to="/register">Регистрация</Link></nav></header><section className="home-hero"><p className="eyebrow">Присоединиться к игре</p><h1>Вход в игру</h1><p>Введите шестизначный PIN-код, который сообщил ведущий. После входа вы сразу продолжите подключение к игре.</p><form className="home-pin-form" onSubmit={join}><label className="visually-hidden" htmlFor="home-pin">PIN-код игры</label><input id="home-pin" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000 000" inputMode="numeric" autoComplete="one-time-code" required /><button type="submit" disabled={pin.length !== 6}>Войти в игру <span aria-hidden="true">→</span></button></form><div className="home-account-links"><span>Хотите создать собственный квиз?</span><Link to="/register">Зарегистрироваться</Link></div></section><footer className="public-footer">© 2026 QuizTime Interactive</footer></main>;
}

function formatHistoryDate(value) {
  return value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Дата не указана";
}

function Dashboard() {
  const { user, logout } = useAuth();
  const [quizzes, setQuizzes] = useState([]);
  const [hostedSessions, setHostedSessions] = useState([]);
  const [participations, setParticipations] = useState([]);
  const [tab, setTab] = useState("quizzes");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/quizzes", { credentials: "include" }),
      fetch("/api/me/hosted-sessions", { credentials: "include" }),
      fetch("/api/me/participations", { credentials: "include" }),
    ]).then(async ([quizzesResponse, hostedResponse, participationsResponse]) => {
      const [quizzesBody, hostedBody, participationsBody] = await Promise.all([quizzesResponse.json(), hostedResponse.json(), participationsResponse.json()]);
      if (!quizzesResponse.ok || !hostedResponse.ok || !participationsResponse.ok) throw new Error("Не удалось загрузить данные кабинета");
      if (!active) return;
      setQuizzes(quizzesBody.data.quizzes);
      setHostedSessions(hostedBody.data.sessions);
      setParticipations(participationsBody.data.sessions);
    }).catch((requestError) => {
      if (active) setError(requestError.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);
  const count = tab === "quizzes" ? quizzes.length : tab === "hosted" ? hostedSessions.length : participations.length;
  return <main className="app-shell dashboard-shell"><section className="dashboard-card"><header className="dashboard-header"><div><Link className="brand-link dashboard-brand" to="/dashboard">QuizTime</Link><p className="eyebrow">Личный кабинет</p><h1>Здравствуйте, {user.displayName}</h1><p className="dashboard-copy">Создавайте квизы, проводите игры и анализируйте результаты.</p></div><div className="header-actions"><Link className="secondary-link" to="/join">Войти по PIN</Link><Link className="primary-link" to="/quizzes/new">+ Создать квиз</Link><button className="icon-button" onClick={logout}>Выйти</button></div></header><div className="dashboard-tabs" role="tablist"><button className={tab === "quizzes" ? "active" : ""} type="button" onClick={() => setTab("quizzes")}>Мои квизы</button><button className={tab === "hosted" ? "active" : ""} type="button" onClick={() => setTab("hosted")}>Проведённые игры</button><button className={tab === "participations" ? "active" : ""} type="button" onClick={() => setTab("participations")}>История участия</button></div>{error && <p className="form-alert" role="alert">{error}</p>}{loading ? <div className="empty-state"><strong>Загружаем кабинет…</strong></div> : <><div className="section-heading"><div><p className="eyebrow">{tab === "quizzes" ? "Мои квизы" : tab === "hosted" ? "Проведённые игры" : "История участия"}</p><h2>{tab === "quizzes" ? "Все ваши интерактивы" : tab === "hosted" ? "Завершённые игры" : "Ваши результаты"}</h2></div><span>{count}</span></div>{tab === "quizzes" && <div className="quiz-list">{quizzes.length === 0 && <div className="empty-state"><strong>Квизов пока нет</strong><p>Начните с создания первого квиза.</p></div>}{quizzes.map((quiz) => <article className="quiz-item" key={quiz.id}><div className="quiz-status-icon" aria-hidden="true">?</div><div className="quiz-item-content"><strong>{quiz.title}</strong><p>{quiz.category.name} · {quiz.questionCount} вопросов</p><span className={`status-chip status-${quiz.status.toLowerCase()}`}>{quiz.status === "READY" ? "Готов к запуску" : quiz.status === "ARCHIVED" ? "Архив" : "Черновик"}</span></div><div className="quiz-item-actions"><Link className="text-link" to={`/quizzes/${quiz.id}/edit`}>Открыть</Link>{quiz.activeSession ? <Link className="primary-link" to={`/sessions/${quiz.activeSession.id}/host`}>Вернуться в игру</Link> : quiz.status === "READY" && <Link className="primary-link" to={`/sessions/start/${quiz.id}`}>Запустить</Link>}</div></article>)}</div>}{tab === "hosted" && <div className="history-list">{hostedSessions.length === 0 && <div className="empty-state"><strong>Проведённых игр пока нет</strong><p>Здесь появятся завершённые вами сессии.</p></div>}{hostedSessions.map((session) => <article className="history-item" key={session.id}><div className="history-icon" aria-hidden="true">★</div><div><strong>{session.quizTitle}</strong><p>{formatHistoryDate(session.finishedAt)} · {session.participantCount} участников</p></div><Link className="text-link" to={`/sessions/${session.id}/results`}>Результаты</Link></article>)}</div>}{tab === "participations" && <div className="history-list">{participations.length === 0 && <div className="empty-state"><strong>История участия пуста</strong><p>Завершите игру в роли участника — результат появится здесь.</p></div>}{participations.map((session) => <article className="history-item participation-item" key={session.id}><div className="history-icon" aria-hidden="true">★</div><div><strong>{session.quizTitle}</strong><p>{formatHistoryDate(session.finishedAt)} · {session.participantCount} участников</p><div className="result-chips"><span>{session.rank} место</span><span>{session.totalScore} баллов</span><span>{session.correctAnswersCount} правильных</span></div></div><Link className="text-link" to={`/sessions/${session.id}/results`}>Открыть</Link></article>)}</div>}</>}</section></main>;
}

function QuizEditor() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(quizId);
  const [categories, setCategories] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [show, setShow] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [quizStatus, setQuizStatus] = useState("DRAFT");
  const [error, setError] = useState("");
  const [makingReady, setMakingReady] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", categoryId: "", defaultTimeLimitSeconds: 30 });

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
        setForm({ title: quiz.title, description: quiz.description ?? "", categoryId: String(quiz.categoryId), defaultTimeLimitSeconds: quiz.defaultTimeLimitSeconds });
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
      body: JSON.stringify({ ...form, categoryId: Number(form.categoryId), defaultTimeLimitSeconds: Number(form.defaultTimeLimitSeconds), defaultPointsPerQuestion: 1000, revealCorrectAnswer: true }),
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

  const saveQuestion = (question) => {
    setQuestions((current) => editingQuestion ? current.map((item) => item.id === question.id ? question : item) : [...current, question]);
    setEditingQuestion(null);
    setShow(false);
  };

  const closeQuestionForm = () => {
    setEditingQuestion(null);
    setShow(false);
  };

  return <main className="app-shell editor-shell"><section className="editor-card"><header className="editor-page-header"><Link className="brand-link editor-brand" to="/dashboard">QuizTime</Link><Link className="text-link" to="/dashboard">← В кабинет</Link><div><p className="eyebrow">Настройки квиза</p><h1>{editing ? "Редактор квиза" : "Создание квиза"}</h1><p>Настройте основную информацию, затем добавьте вопросы.</p></div></header><form className="auth-form editor-form" onSubmit={save}><label>Название квиза<input placeholder="Введите яркое название…" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label>Описание<textarea placeholder="Кратко опишите, о чём этот квиз…" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><label>Категория<select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Выберите категорию</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><button>Сохранить черновик</button></form>{error && <p className="form-alert" role="alert">{error}</p>}{editing && <section className="questions-placeholder"><div className="editor-header"><div><p className="eyebrow">Конструктор</p><h2>Вопросы ({questions.length})</h2></div><span className={`status-chip status-${quizStatus.toLowerCase()}`}>{quizStatus}</span></div><div className="question-list">{questions.map((question) => <article className="question-summary" key={question.id}><span>{question.position}</span><strong>{question.text}</strong>{quizStatus === "DRAFT" && <button className="question-edit-button" type="button" onClick={() => { setEditingQuestion(question); setShow(false); }}>Изменить</button>}</article>)}</div>{quizStatus === "DRAFT" && <div className="question-actions"><button type="button" onClick={makeReady} disabled={makingReady}>{makingReady ? "Проверяем квиз…" : "Сделать готовым к запуску"}</button>{!show && !editingQuestion && <button type="button" className="add-question-button" onClick={() => setShow(true)}>+ Добавить вопрос</button>}</div>}{quizStatus === "READY" && <p className="ready-note">Квиз готов. Вернитесь в кабинет и нажмите «Запустить игру».</p>}{(show || editingQuestion) && <QuestionForm quizId={quizId} question={editingQuestion} onSaved={saveQuestion} onCancel={closeQuestionForm} />}</section>}</section></main>;
}

export default function App() {
  return <AuthProvider><Routes><Route path="/" element={<Home />} /><Route path="/join" element={<JoinSessionPage />} /><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/register" element={<AuthPage mode="register" />} /><Route element={<ProtectedRoute />}><Route path="/dashboard" element={<Dashboard />} /><Route path="/quizzes/new" element={<QuizEditor />} /><Route path="/quizzes/:quizId/edit" element={<QuizEditor />} /><Route path="/sessions/start/:quizId" element={<StartSessionPage />} /><Route path="/sessions/:sessionId/host" element={<LobbyPage />} /><Route path="/play/:sessionId" element={<LobbyPage />} /><Route path="/sessions/:sessionId/results" element={<LobbyPage />} /></Route><Route path="*" element={<Outlet />} /></Routes></AuthProvider>;
}
