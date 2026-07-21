import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";

export default function LobbyPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const socket = io("/", { withCredentials: true });
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
    socket.on("connect", () => {
      socket.emit("session:subscribe", { sessionId: Number(sessionId) }, (result) => {
        if (result.ok) setSnapshot(result.data);
        else setError(result.error.message);
      });
    });

    const timer = setInterval(check, 1000);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [navigate, sessionId]);

  const leave = async () => {
    await fetch(`/api/sessions/${sessionId}/leave`, { method: "POST", credentials: "include" });
    navigate("/dashboard");
  };

  const cancel = async () => {
    await fetch(`/api/sessions/${sessionId}/cancel`, { method: "POST", credentials: "include" });
    navigate("/dashboard");
  };

  if (error) {
    return <main className="app-shell"><section className="welcome-card"><p role="alert">{error}</p></section></main>;
  }

  if (!snapshot) {
    return <main className="app-shell"><section className="welcome-card"><p>Подключение к lobby…</p></section></main>;
  }

  return (
    <main className="app-shell">
      <section className="welcome-card">
        <h1>{snapshot.quizTitle}</h1>
        {snapshot.isHost && <strong>PIN: {snapshot.pin}</strong>}
        {!snapshot.isHost && <p>Ведущий: {snapshot.hostDisplayName}</p>}
        <p>Участников сейчас: {snapshot.participantCount}</p>
        <h2>Кто присутствует</h2>
        {snapshot.participants?.length ? (
          <ul aria-live="polite">
            {snapshot.participants.map((participant) => (
              <li key={participant.id}>
                {participant.displayName} — {participant.isConnected ? "онлайн" : "не в сети"}
              </li>
            ))}
          </ul>
        ) : <p>Пока никто не подключился.</p>}
        {snapshot.isHost ? <button onClick={cancel}>Завершить сессию</button> : <button onClick={leave}>Выйти из сессии</button>}
      </section>
    </main>
  );
}
