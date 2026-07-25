import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";

function formatRemaining(milliseconds) {
  return `${Math.max(0, Math.ceil(milliseconds / 1000))} сек`;
}

function typeLabel(type) {
  return type === "MULTIPLE_CHOICE" ? "Множественный выбор" : "Один правильный ответ";
}

function initials(displayName) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
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
    socket.on("session:finished", (event) => {
      setSelectedOptionIds([]);
      setSnapshot((current) => current ? { ...current, ...event } : event);
    });
    socket.on("participant:list", ({ participants }) => {
      setSnapshot((current) => current ? { ...current, participants, participantCount: participants.length } : current);
    });
    socket.on("participant:count", ({ participantCount }) => {
      setSnapshot((current) => current ? { ...current, participantCount } : current);
    });
    socket.on("question:started", (event) => {
      setSelectedOptionIds([]);
      setSnapshot((current) => current ? { ...current, ...event, hasAnswered: false, selectedOptionIds: [], answeredCount: 0, lastQuestionResult: null, reviewStats: null } : event);
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
    const response = await fetch(`/api/sessions/${sessionId}/cancel`, { method: "POST", credentials: "include" });
    if (response.ok) navigate("/dashboard");
    else setError("Не удалось завершить сессию");
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    const response = await fetch(`/api/sessions/${sessionId}/leave`, { method: "POST", credentials: "include" });
    if (response.ok) navigate("/dashboard");
    else setError("Нельзя выйти из уже начавшейся игры");
    setBusy(false);
  };

  const startQuestion = () => {
    setBusy(true);
    socketRef.current?.emit("question:start", { sessionId: Number(sessionId) }, (result) => {
      setBusy(false);
      if (!result.ok) setError(result.error.message);
    });
  };

  const finishSession = () => {
    setBusy(true);
    socketRef.current?.emit("session:finish", { sessionId: Number(sessionId) }, (result) => {
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

  if (error) return <main className="game-shell"><section className="game-card"><p className="game-error" role="alert">{error}</p><Link className="game-secondary-button" to="/dashboard">В кабинет</Link></section></main>;
  if (!snapshot) return <main className="game-shell"><section className="game-card"><p>Подключение к игре…</p></section></main>;

  if (snapshot.status === "FINISHED") {
    return <main className="game-shell"><section className="game-card results-screen">
      <div className="game-topbar"><span className="brand-mark">QuizTime</span><span>Игра завершена</span></div>
      <h1>Итоговый лидерборд</h1>
      {snapshot.myResult && <p className="my-result">Ваш результат: <strong>{snapshot.myResult.rank} место</strong> · {snapshot.myResult.totalScore} баллов</p>}
      <ol className="leaderboard-list">{(snapshot.leaderboard ?? []).map((item) => <li key={item.participantId} className={`leaderboard-item rank-${item.rank} ${snapshot.myResult?.rank === item.rank && snapshot.myResult?.totalScore === item.totalScore ? "current" : ""}`}><span className="leaderboard-rank">{item.rank}</span><span className="leaderboard-name">{item.displayName}</span><span className="leaderboard-score">{item.totalScore} баллов</span><small>{item.correctAnswersCount} правильных</small></li>)}</ol>
      <Link className="game-primary-button results-link" to="/dashboard">В личный кабинет</Link>
    </section></main>;
  }

  if (snapshot.phase === "QUESTION_ACTIVE") {
    return <main className={`game-shell ${snapshot.isHost ? "host-game-shell" : "participant-game-shell"}`}><section className={`game-card question-screen ${snapshot.isHost ? "host-question-screen" : "participant-question-screen"}`}>
      <div className="game-topbar"><span className="brand-mark">QuizTime</span><span className="session-context">{snapshot.isHost ? `PIN: ${snapshot.pin}` : `Ведущий: ${snapshot.hostDisplayName}`}</span><span className="timer-badge">{formatRemaining(remaining ?? 0)}</span></div>
      <span className="question-type">{typeLabel(snapshot.currentQuestion.type)}</span>
      <p className="question-progress">Вопрос {snapshot.currentQuestion.position} из {snapshot.currentQuestion.totalQuestions}</p>
      <h1>{snapshot.currentQuestion.text}</h1>
      {snapshot.isHost ? <><div className={`projector-media ${snapshot.currentQuestion.imageUrl ? "with-image" : "without-image"}`}>{snapshot.currentQuestion.imageUrl && <img className="question-hero-image" src={snapshot.currentQuestion.imageUrl} alt="Иллюстрация вопроса" />}<div className="projector-timer"><strong>{Math.max(0, Math.ceil((remaining ?? 0) / 1000))}</strong><span>сек</span></div></div><div className="host-question-state"><strong>Ответили: {snapshot.answeredCount ?? 0} / {snapshot.participantCount}</strong><p>Ожидайте окончания времени ответа.</p></div><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></> : <>
        {snapshot.currentQuestion.imageUrl && <img className="question-hero-image" src={snapshot.currentQuestion.imageUrl} alt="Иллюстрация вопроса" />}
        <div className="answer-options">{snapshot.currentQuestion.options.map((option, index) => <button className={`answer-option answer-option-${index % 4} ${selectedOptionIds.includes(option.id) ? "selected" : ""}`} key={option.id} type="button" onClick={() => toggleOption(option.id)} disabled={snapshot.hasAnswered || busy}><span className="answer-option-index">{index + 1}</span><span className="answer-option-text">{option.text}</span><span className="option-indicator">{snapshot.currentQuestion.type === "MULTIPLE_CHOICE" ? (selectedOptionIds.includes(option.id) ? "✓" : "") : (selectedOptionIds.includes(option.id) ? "●" : "")}</span></button>)}</div>
        <button className="game-primary-button" type="button" onClick={submitAnswer} disabled={snapshot.hasAnswered || selectedOptionIds.length === 0 || busy}>{snapshot.hasAnswered ? "Ответ принят" : "Отправить ответ"}</button>
      </>}
    </section></main>;
  }

  if (snapshot.phase === "QUESTION_REVIEW") {
    const result = snapshot.lastQuestionResult;
    const hasNextQuestion = snapshot.reviewStats?.hasNextQuestion;
    return <main className={`game-shell ${snapshot.isHost ? "host-game-shell" : "participant-game-shell"}`}><section className={`game-card review-screen ${snapshot.isHost ? "host-review-screen" : "participant-review-screen"}`}>
      <div className="game-topbar"><span className="brand-mark">QuizTime</span><span>{snapshot.currentQuestion?.text}</span></div>
      {snapshot.isHost ? <><h1>Статистика ответа</h1><div className="review-stats"><strong>{snapshot.reviewStats.answeredCount} ответов</strong><strong>{snapshot.reviewStats.correctCount} правильных</strong></div><div className="option-stats">{snapshot.reviewStats.optionStats.map((item) => { const option = snapshot.currentQuestion.options.find((currentOption) => currentOption.id === item.optionId); return <div className={`option-stat ${item.isCorrect ? "correct" : ""}`} key={item.optionId} style={{ "--bar-height": `${Math.max(24, item.selectedCount * 48)}px` }}><b>{item.selectedCount}</b><span>{option?.text}</span>{item.isCorrect && <small>Правильный</small>}</div>; })}</div><div className="review-actions"><button className="game-primary-button" type="button" onClick={hasNextQuestion ? startQuestion : finishSession} disabled={busy}>{hasNextQuestion ? "Следующий вопрос" : "Завершить игру"}</button><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></div></> : <><h1>{result?.isCorrect ? "Правильный ответ!" : "Ответ неверный"}</h1><p className="score-result">+{result?.awardedPoints ?? 0} баллов</p><p>Ваш результат: {result?.totalScore ?? snapshot.myScore} баллов</p><p className="review-note">Ожидайте следующего вопроса или завершения игры ведущим.</p></>}
    </section></main>;
  }

  return <main className={`game-shell ${snapshot.isHost ? "host-game-shell" : "participant-game-shell"}`}><section className={`game-card lobby-screen ${snapshot.isHost ? "host-lobby-screen" : "participant-lobby-screen"}`}>
    <div className="game-topbar"><span className="brand-mark">QuizTime</span><span className="lobby-badge">● Игровое лобби</span></div>
    {snapshot.isHost && <div className="host-lobby-intro"><p>Присоединяйтесь к игре по PIN-коду</p><h1>{snapshot.quizTitle}</h1></div>}
    <div className="pin-panel"><p>{snapshot.isHost ? "КОД ИГРЫ" : "ОЖИДАНИЕ СТАРТА"}</p><strong>{snapshot.pin ?? "Ведущий скоро начнёт"}</strong></div>
    {!snapshot.isHost && <div className="participant-lobby-intro"><h1>{snapshot.quizTitle}</h1><p>Ведущий: <strong>{snapshot.hostDisplayName}</strong></p><p>Ожидайте начала игры.</p></div>}
    <div className="participant-heading"><h1>Участники</h1><span>{snapshot.participantCount}</span></div>
    {snapshot.participants?.length ? <ul className="participant-grid">{snapshot.participants.map((participant) => <li key={participant.id} className={participant.isConnected ? "connected" : "disconnected"}><span className="participant-avatar">{initials(participant.displayName)}</span><span className="participant-info"><strong>{participant.displayName}</strong><small>{participant.isConnected ? "онлайн" : "не в сети"}</small></span></li>)}</ul> : <p className="lobby-empty">Пока никто не подключился.</p>}
    <div className="lobby-actions">{snapshot.isHost ? <><button className="game-primary-button" type="button" onClick={startQuestion} disabled={snapshot.participantCount === 0 || busy}>Начать игру</button><button className="game-secondary-button" type="button" onClick={cancel} disabled={busy}>Завершить сессию</button></> : <button className="game-secondary-button" type="button" onClick={leave} disabled={busy}>Выйти из сессии</button>}</div>
  </section></main>;
}
