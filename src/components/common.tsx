"use client";
import { useEffect, useState, useCallback } from "react";
import { browserClient } from "@/lib/supabase/client";
import { useWorkspace } from "./workspace-context";
export function Heading({
  eyebrow = "GESTIÓN ACADÉMICA",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Empty({
  text = "Todavía no hay registros. Empieza agregando el primero.",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <span>◎</span>
      <h3>Todo listo para empezar</h3>
      <p>{text}</p>
    </div>
  );
}
export function Pager({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {count} registros · Página {page + 1}
      </span>
      <div>
        <button
          type="button"
          className="secondary"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="secondary"
          disabled={(page + 1) * 25 >= count}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
export function useRows<T>(
  table: string,
  columns: string,
  filter: string,
  searchColumn: string,
  page: number,
  order = "id",
) {
  const { id: ownerId } = useWorkspace();
  const [rows, setRows] = useState<T[]>([]),
    [count, setCount] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    let query = browserClient()
      .from(table)
      .select(columns, { count: "exact" })
      .eq("owner_id", ownerId)
      .order(order)
      .range(page * 25, page * 25 + 24);
    if (filter)
      query = query.ilike(
        searchColumn,
        `%${filter.replaceAll("%", "").replaceAll("_", "")}%`,
      );
    const { data, error, count } = await query;
    if (error) setError(error.message);
    else {
      setRows((data ?? []) as T[]);
      setCount(count ?? 0);
      setError("");
    }
    setLoading(false);
  }, [table, columns, filter, searchColumn, page, order, ownerId]);
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      if (active) void load();
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [load]);
  return { rows, count, error, loading, load };
}
export function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function requireUser() {
  const db = browserClient(),
    {
      data: { user },
      error,
    } = await db.auth.getUser();
  if (error || !user) throw Error("La sesión expiró. Vuelve a iniciar sesión.");
  return { db, user };
}
export function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "No se pudo completar la operación";
}
