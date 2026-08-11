"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard");
  }

  async function signUp() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("Usuario creado. Revisá el mail si Supabase pide confirmación.");
  }

  return (
    <main className="container">
      <section className="card login">
        <div className="login-brand">
          <img src="/logo-adara.png" alt="ADARA Group" />
          <h1>Pricing ADARA</h1>
          <p>Ingreso del equipo</p>
        </div>

        {message && <div className="message success">{message}</div>}
        {error && <div className="message error">{error}</div>}

        <form onSubmit={signIn} className="grid-2" style={{ gridTemplateColumns: "1fr" }}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div className="actions">
            <button className="button" disabled={loading} type="submit">
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
            <button className="button ghost" disabled={loading} type="button" onClick={signUp}>
              Crear usuario
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
