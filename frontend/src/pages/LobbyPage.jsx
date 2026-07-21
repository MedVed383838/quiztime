import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";

function formatRemaining(milliseconds) {
  return `${Math.max(0, Math.ceil(milliseconds / 1000))} сек`;
}

function typeLabel(type) {
  return type === "MULTIPLE_CHOICE" ? "Множественный выбор" : "Один правильный ответ";
}

export default function LobbyPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const socketRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket = io("/", { withCredentials: true });
    socketRef.current = socket;
    const check = async () => {
      const response = await fetch(`/api/sessions/${sessionId}`, { credentials: "include" });
      if (response.ok) {
        const body = await response.json();
        if (body.data.session.status === "CANCELLED") navigate("/dashboard");
      }
    };

    socket.on("session:cancelled", () => navigate("/dashboard"));
    socket.on("participant:list", ({ participants }) => {
      setSnapshot((current) => current ? { ...current, participants, participantCount: participants.length } : current);
    });
    socket.on("participant:count", ({ participantCount }) => {
      setSnapshot((current) => current ? { ...current, participantCount } : current);
    });
    socket.on("question:started", (event) => {
      setSelectedOptionIds([]);
      setSnapshot((current) => current ? { ...current, ...event, hasAnswered: false, selectedOptionIds: [], answeredCount: 0 } : event);
    });
    socket.on("question:progress", ({ answeredCount }) => {
      setSnapshot((current) => current ? { ...current, answeredCount } : current);
    });
    socket.on("question:closed", (result) => {
      setSnapshot((current) => current ? { ...current, phase: "QUESTION_REVIEW", lastQuestionResult: result } : current);
    });
    socket.on("question:review", (review) => {
      setSnapshot((current) => current ? { ...current, ...review, phase: "QUESTION_REVIEW" } : current);
    });
    socket.on("connect", () => {
      socket.emit("session:subscribe", { sessionId: Number(sessionId) }, (result) => {
        if (result.ok) {
          setSnapshot(result.data);
          setSelectedOptionIds(result.data.selectedOptionIds ?? []);
        } else setError(result.error.message);
      });
    });

    const timer = setInterval(check, 1000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [navigate, sessionId]);

  useEffect(() => {
    const deadline = snapshot?.currentQuestion?.questionEndsAt;
    if (snapshot?.phase !== "QUESTION_ACTIVE" || !deadline) {
      setRemaining(null);
      return undefined;
    }
    const update = () => setRemaining(new Date(deadline).getTime() - Date.now());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [snapshot?.currentQuestion?.questionEndsAt, snapshot?.phase]);

  const cancel = async () => {
    setBusy(true);
    await fetch(`/api/sessions/${sessionId}/cancel`, { method: "POST", credentials: "include" });
    navigate("/dashboard");
  };

  const leave = async () => {
    await fetch(`/api/sessions/${sessionId}/leave`, { method: "POST", credentials: "include" });
    navigate("/dashboard");
  };

  const startQuestion = () => {
    setBusy(true);
    socketRef.current?.emit("question:start", { sessionId: Number(sessionId) }, (result) => {
      setBusy(false);
      if (!result.ok) setError(result.error.message);
    });
  };

  const toggleOption = (optionId) => {
    if (snapshot?.hasAnswered || busy) return;
    if (snapshot.currentQuestion.type === "SINGLE_CHOICE") setSelectedOptionIds([optionId]);
    else setSelectedOptionIds((current) => current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]);
  };

  const submitAnswer = () => {
    if (!snapshot?.currentQuestion || selectedOptionIds.length === 0 || snapshot.hasAnswered) return;
    setBusy(true);
    socketRef.current?.emit("answer:submit", { sessionId: Number(sessionId), questionId: snapshot.currentQuestion.id, optionIds: selectedOptionIds }, (result) => {
      setBusy(false);
      if (result.ok) setSnapshot((current) => ({ ...current, hasAnswered: true, selectedOptionIds }));
      else setError(result.error.message);
    });
  };

  if (error) return <main className="game-shell"><section className="game-card"><p className="game-error" role="alert">{error}</p></section></main>;
  if (!snapshot) return <main className="game-shell"><section className="game-card"><p>Подключение к игре…</p></section></main>;

  if (snapshot.phase === "QUESTION_ACTIVE") {
    return <main className="game-shell"><section className="game-card question-screen">
      <div className="game-topbar"><span className="brand-mark">QuizTime</span><span>{snapshot.isHost ? `PIN: ${snapshot.pin}` : `Ведущий: ${snapshot.hostDisplayName}`}</span><span className="timer-badge">{formatRemaining(remaining ?? 0)}</span></div>
      <span className="question-type">{typeLabel(snapshot.currentQuestion.type)}</span>
      <h1>{snapshot.currentQuestion.text}</h1>
      {snapshot.currentQuestion.imageUrl && <img className="question-hero-image" src={snapshot.currentQuestion.imageUrl} alt="Иллюстрация вопроса" />}
      {snapshot.isHost ? <><div className="host-question-state"><strong>Ответили: {snapshot.answeredCount ?? 0} / {snapshot.participantCount}</strong><p>Ожидайте окончания времени ответа.</p></div><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></> : <>
        <div className="answer-options">{snapshot.currentQuestion.options.map((option) => <button className={`answer-option ${selectedOptionIds.includes(option.id) ? "selected" : ""}`} key={option.id} type="button" onClick={() => toggleOption(option.id)} disabled={snapshot.hasAnswered || busy}><span>{option.text}</span><span className="option-indicator">{snapshot.currentQuestion.type === "MULTIPLE_CHOICE" ? (selectedOptionIds.includes(option.id) ? "✓" : "□") : (selectedOptionIds.includes(option.id) ? "●" : "○")}</span></button>)}</div>
        <button className="game-primary-button" type="button" onClick={submitAnswer} disabled={snapshot.hasAnswered || selectedOptionIds.length === 0 || busy}>{snapshot.hasAnswered ? "Ответ принят" : "Отправить ответ"}</button>
      </>}
    </section></main>;
  }

  if (snapshot.phase === "QUESTION_REVIEW") {
    const result = snapshot.lastQuestionResult;
    return <main className="game-shell"><section className="game-card review-screen">
      <div className="game-topbar"><span className="brand-mark">QuizTime</span><span>{snapshot.currentQuestion?.text}</span></div>
      {snapshot.isHost ? <><h1>Статистика ответа</h1><div className="review-stats"><strong>{snapshot.reviewStats.answeredCount} ответов</strong><strong>{snapshot.reviewStats.correctCount} правильных</strong></div><div className="option-stats">{snapshot.reviewStats.optionStats.map((item) => <div key={item.optionId}><span>{snapshot.currentQuestion.options.find((option) => option.id === item.optionId)?.text}</span><b>{item.selectedCount}</b></div>)}</div><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></> : <><h1>{result?.isCorrect ? "Правильный ответ!" : "Ответ неверный"}</h1><p className="score-result">+{result?.awardedPoints ?? 0} баллов</p><p>Ваш результат: {result?.totalScore ?? snapshot.myScore} баллов</p></>}
      <p className="review-note">В следующей части игры ведущий продолжит сессию.</p>
    </section></main>;
  }

  return <main className="game-shell"><section className="game-card lobby-screen">
    <div className="game-topbar"><span className="brand-mark">QuizTime</span><span className="lobby-badge">● Игровое лобби</span></div>
    <div className="pin-panel"><p>КОД ИГРЫ</p><strong>{snapshot.pin ?? "Ожидание ведущего"}</strong></div>
    {!snapshot.isHost && <p>Ведущий: {snapshot.hostDisplayName}</p>}
    <div className="participant-heading"><h1>Участники</h1><span>{snapshot.participantCount}</span></div>
    {snapshot.participants?.length ? <ul className="participant-grid">{snapshot.participants.map((participant) => <li key={participant.id} className={participant.isConnected ? "connected" : "disconnected"}><span>{participant.displayName}</span><small>{participant.isConnected ? "онлайн" : "не в сети"}</small></li>)}</ul> : <p>Пока никто не подключился.</p>}
    <div className="lobby-actions">{snapshot.isHost ? <><button className="game-primary-button" type="button" onClick={startQuestion} disabled={snapshot.participantCount === 0 || busy}>Начать вопрос</button><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></> : <button className="game-secondary-button" type="button" onClick={leave}>Выйти из сессии</button>}</div>
  </section></main>;
}
