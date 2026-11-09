"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";
export function Login({
  configured,
  reset = false,
}: {
  configured: boolean;
  reset?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(e.currentTarget),
        db = browserClient(),
        email = String(form.get("email") ?? ""),
        password = String(form.get("password") ?? "");
      if (reset) {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        router.replace("/sistema");
        router.refresh();
      } else if (recovery) {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/password`,
        });
        if (error) throw error;
        setMessage("Si la cuenta existe, recibirás un enlace de recuperación.");
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/sistema");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo completar la solicitud",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">C</span> CRAMER <b>EVAL</b>
        </div>
        <div>
          <span className="eyebrow">DEL AULA A LA EVIDENCIA</span>
          <h1>
            Más tiempo para <br />
            enseñar. <br />
            <em>Mejores decisiones.</em>
          </h1>
          <p>
            Diseña evaluaciones, revisa respuestas y acompaña el progreso de
            cada alumno desde un solo lugar.
          </p>
        </div>
        <small>COLEGIO CRAMER · Plataforma académica</small>
      </section>
      <section className="login-form">
        <div className="card">
          <span className="eyebrow">TU ESPACIO ACADÉMICO</span>
          <h2>
            {reset
              ? "Nueva contraseña"
              : recovery
                ? "Recuperar acceso"
                : "Bienvenido de nuevo"}
          </h2>
          <p className="muted">
            {reset
              ? "Usa al menos 10 caracteres."
              : "Ingresa con la cuenta habilitada por el administrador."}
          </p>
          {!configured ? (
            <div className="notice">
              Falta configurar Supabase. Consulta el README de web-next y
              completa las variables de .env.local.
            </div>
          ) : (
            <form onSubmit={submit}>
              {!reset && (
                <label>
                  Correo electrónico
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
              )}
              {(!recovery || reset) && (
                <label>
                  Contraseña
                  <input
                    name="password"
                    type="password"
                    minLength={reset ? 10 : 1}
                    autoComplete={reset ? "new-password" : "current-password"}
                    required
                  />
                </label>
              )}
              <button disabled={busy}>
                {busy
                  ? "Procesando…"
                  : reset
                    ? "Guardar contraseña"
                    : recovery
                      ? "Enviar enlace"
                      : "Iniciar sesión →"}
              </button>
            </form>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {!reset && (
            <button
              className="text-button"
              onClick={() => {
                setRecovery(!recovery);
                setMessage("");
              }}
            >
              {recovery
                ? "Volver al inicio de sesión"
                : "¿Olvidaste tu contraseña?"}
            </button>
          )}
          <small className="muted">Acceso privado · Sin registro público</small>
        </div>
      </section>
    </main>
  );
}
