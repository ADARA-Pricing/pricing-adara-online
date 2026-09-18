"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, RefreshCcw, Search, Send } from "lucide-react";

type Question = {
  id: number;
  item_id?: string;
  item_title?: string | null;
  text?: string;
  status?: string;
  date_created?: string;
  answer?: { text?: string; status?: string; date_created?: string } | null;
};

function dateTime(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}

export default function MobileQuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadQuestions() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/mercadolibre/questions?status=UNANSWERED&limit=50", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudieron cargar las preguntas.");
      setQuestions(data.questions || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las preguntas.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void loadQuestions(); }, []);

  const filteredQuestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return questions;
    return questions.filter((question) => `${question.text || ""} ${question.item_title || ""} ${question.item_id || ""}`.toLowerCase().includes(term));
  }, [questions, query]);

  async function answerQuestion(event: FormEvent<HTMLFormElement>, question: Question) {
    event.preventDefault();
    const text = String(drafts[question.id] || "").trim();
    if (!text) return;
    setSending(question.id); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/mercadolibre/questions/answer", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: question.id, text }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "No se pudo enviar la respuesta.");
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setMessage("Respuesta enviada a Mercado Libre.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "No se pudo enviar la respuesta.");
    } finally { setSending(null); }
  }

  return <main className="mobile-questions-page">
    <header className="mobile-questions-header">
      <div className="mobile-questions-icon"><MessageCircleQuestion aria-hidden="true" /></div>
      <div><h1>Preguntas</h1><p>Respondé consultas de Mercado Libre.</p></div>
      <button type="button" onClick={() => void loadQuestions()} disabled={loading} aria-label="Actualizar preguntas"><RefreshCcw aria-hidden="true" /></button>
    </header>

    <div className="mobile-questions-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o consulta" /></div>
    {message && <p className="mobile-questions-message success"><CheckCircle2 aria-hidden="true" />{message}</p>}
    {error && <p className="mobile-questions-message error">{error}</p>}

    <section className="mobile-questions-list" aria-live="polite">
      <div className="mobile-questions-list-title"><strong>{loading ? "Actualizando…" : `${filteredQuestions.length} pendientes`}</strong><span>Mercado Libre</span></div>
      {!loading && filteredQuestions.length === 0 && <div className="mobile-questions-empty"><CheckCircle2 aria-hidden="true" /><strong>No hay preguntas pendientes</strong><span>Las nuevas consultas aparecerán al actualizar.</span></div>}
      {filteredQuestions.map((question) => <article className="mobile-question-card" key={question.id}>
        <div className="mobile-question-product"><strong>{question.item_title || question.item_id || "Publicación de Mercado Libre"}</strong><span>{question.item_id || ""} · {dateTime(question.date_created)}</span></div>
        <p>{question.text || "Consulta sin texto disponible."}</p>
        <form onSubmit={(event) => void answerQuestion(event, question)}>
          <textarea value={drafts[question.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Escribí tu respuesta…" maxLength={2000} rows={3} />
          <div><small>{(drafts[question.id] || "").length}/2000</small><button type="submit" disabled={sending === question.id || !(drafts[question.id] || "").trim()}>{sending === question.id ? "Enviando…" : <><Send aria-hidden="true" />Responder</>}</button></div>
        </form>
      </article>)}
    </section>
  </main>;
}
