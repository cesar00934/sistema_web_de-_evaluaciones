"use client";
import { useCallback, useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/client";
import { Heading, Pager, errorText, Empty } from "./common";
import { resultQuery, emptyFilters, type ResultRow } from "@/lib/result-query";
type Profile = {
  id: string;
  email: string;
  display_name: string;
  role: "teacher" | "admin";
};
export function AdminPanel() {
  const [users, setUsers] = useState<Profile[]>([]),
    [resultOwners, setResultOwners] = useState<Record<string, string>>({}),
    [results, setResults] = useState<ResultRow[]>([]),
    [page, setPage] = useState(0),
    [userPage, setUserPage] = useState(0),
    [userCount, setUserCount] = useState(0),
    [count, setCount] = useState(0),
    [owner, setOwner] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const load = useCallback(async () => {
    const db = browserClient();
    let q = db
      .from("profiles")
      .select("id,email,display_name,role", { count: "exact" })
      .order("email")
      .range(userPage * 25, userPage * 25 + 24);
    if (query) q = q.ilike("email", `%${query.replaceAll("%", "")}%`);
    const [p, r] = await Promise.all([
      q,
      resultQuery(db, { ...emptyFilters, owner }).range(
        page * 25,
        page * 25 + 24,
      ),
    ]);
    if (p.error || r.error) {
      setMessage(p.error?.message ?? r.error?.message ?? "Error");
      return;
    }
    setUsers(p.data);
    setUserCount(p.count ?? 0);
    const rows = r.data as unknown as ResultRow[];
    setResults(rows);
    const ids = [...new Set(rows.map((row) => row.owner_id))];
    if (ids.length) {
      const { data } = await db
        .from("profiles")
        .select("id,email")
        .in("id", ids);
      setResultOwners(
        Object.fromEntries((data ?? []).map((p) => [p.id, p.email])),
      );
    } else setResultOwners({});
    setCount(r.count ?? 0);
  }, [page, userPage, owner, query]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const mode = String(f.get("mode"));
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(f.get("email")),
          name: String(f.get("name")),
          mode,
          ...(mode === "create" ? { password: String(f.get("password")) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setMessage(data.message);
      await load();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="Administración"
        description="Usuarios y resultados de todos los docentes. Los datos conservan su propietario."
      />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="card">
        <h2>Agregar usuario docente</h2>
        <form onSubmit={create}>
          <div className="form-grid">
            <label>
              Nombre
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Correo
              <input name="email" type="email" required />
            </label>
            <label>
              Forma de acceso
              <select name="mode">
                <option value="create">Crear con contraseña</option>
                <option value="invite">Enviar invitación por correo</option>
              </select>
            </label>
            <label>
              Contraseña inicial (solo para creación directa)
              <input
                name="password"
                type="password"
                minLength={10}
                autoComplete="new-password"
              />
            </label>
          </div>
          <button disabled={busy}>
            {busy ? "Procesando…" : "Agregar docente"}
          </button>
        </form>
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Usuarios</h2>
          <input
            aria-label="Buscar usuarios"
            placeholder="Buscar por correo…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setUserPage(0);
            }}
          />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name || u.email}</strong>
                    <small>{u.email}</small>
                  </td>
                  <td>{u.role === "admin" ? "Administrador" : "Docente"}</td>
                  <td>
                    <div className="actions">
                      <button
                        className="secondary"
                        onClick={() => {
                          setOwner(u.id);
                          setPage(0);
                        }}
                      >
                        Ver calificaciones
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const { error } = await browserClient().rpc(
                            "admin_set_role",
                            {
                              p_user: u.id,
                              p_role: u.role === "admin" ? "teacher" : "admin",
                            },
                          );
                          if (error) setMessage(error.message);
                          else {
                            setMessage("Rol actualizado.");
                            await load();
                          }
                          setBusy(false);
                        }}
                      >
                        {u.role === "admin"
                          ? "Convertir en docente"
                          : "Hacer administrador"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={userPage} count={userCount} setPage={setUserPage} />
      </section>
      <section className="card">
        <div className="section-title">
          <h2>Calificaciones de todos los alumnos</h2>
          {owner && (
            <button
              className="secondary"
              onClick={() => {
                setOwner("");
                setPage(0);
              }}
            >
              Mostrar todos los docentes
            </button>
          )}
        </div>
        {!results.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Grupo</th>
                  <th>Evaluación</th>
                  <th>Nota</th>
                  <th>Estado</th>
                  <th>Cuenta docente</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.owner_id}-${r.id}`}>
                    <td>
                      {r.students.last_names}, {r.students.first_names}
                    </td>
                    <td>
                      {r.students.grade} · {r.students.section}
                    </td>
                    <td>{r.versions.exams.title}</td>
                    <td>{Number(r.grade).toFixed(2)}</td>
                    <td>{r.pending ? "Pendiente" : "Confirmado"}</td>
                    <td>{resultOwners[r.owner_id] ?? r.owner_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} count={count} setPage={setPage} />
      </section>
    </>
  );
}
