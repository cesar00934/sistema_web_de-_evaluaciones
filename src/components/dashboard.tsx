"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  Users,
  CheckCheck,
  Clock,
  ScanLine,
  BookOpen,
} from "lucide-react";
import { browserClient } from "@/lib/supabase/client";
import { Heading, Empty, errorText } from "./common";
import { useWorkspace } from "./workspace-context";
type Summary = {
  total: number;
  pending: number;
  average: number | null;
  maximum: number | null;
  minimum: number | null;
  passed: number;
  courses: { area: string; count: number; average: number }[];
  topics: { topic: string; percentage: number }[];
};
export function Dashboard() {
  const { id: ownerId } = useWorkspace();
  const [stats, setStats] = useState<Summary | null>(null),
    [students, setStudents] = useState(0),
    [exams, setExams] = useState(0),
    [recent, setRecent] = useState<
      {
        id: string;
        title: string;
        area: string;
        grade: string;
        bimester: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      try {
        const db = browserClient();
        const [summary, students, exams, recent] = await Promise.all([
          db.rpc("academic_summary"),
          db
            .from("students")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", ownerId),
          db
            .from("exams")
            .select("id", { count: "exact", head: true })
            .eq("owner_id", ownerId),
          db
            .from("exams")
            .select("id,title,area,grade,bimester")
            .eq("owner_id", ownerId)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);
        for (const result of [summary, students, exams, recent])
          if (result.error) throw result.error;
        setStats(summary.data);
        setStudents(students.count ?? 0);
        setExams(exams.count ?? 0);
        setRecent(recent.data ?? []);
      } catch (e) {
        setError(errorText(e));
      }
    }
    void load();
  }, [ownerId]);
  return (
    <>
      <Heading
        eyebrow="TU PANORAMA ACADÉMICO"
        title="Cada evaluación cuenta."
        description="Una mirada clara al progreso de tus alumnos."
      >
        <Link className="button" href="/sistema/examenes">
          + Crear evaluación
        </Link>
      </Heading>
      {error && <div className="notice">{error}</div>}
      <section className="welcome-banner">
        <div>
          <span className="eyebrow">ENSEÑAR. EVALUAR. ACOMPAÑAR.</span>
          <h2>
            Convierte respuestas
            <br />
            en próximos pasos.
          </h2>
          <p>Todo el ciclo de evaluación en un mismo espacio.</p>
          <Link href="/sistema/escaner" className="button light">
            Abrir escáner <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="sheet-illustration" aria-hidden="true">
          <div className="illustration-title">CRAMER EVAL</div>
          <div className="illustration-lines" />
          {[0, 1, 2, 3].map((i) => (
            <div className="bubble-row" key={i}>
              <span>{i + 1}.</span>
              {[0, 1, 2, 3].map((j) => (
                <i className={i === j ? "filled" : ""} key={j} />
              ))}
            </div>
          ))}
          <div className="floating-check">
            <CheckCheck size={28} /> Progreso que se ve
          </div>
        </div>
      </section>
      <section className="stat-grid">
        {[
          [FileText, "Evaluaciones", exams, "Listas para seguir creciendo"],
          [Users, "Alumnos", students, "Tu comunidad académica"],
          [
            CheckCheck,
            "Promedio confirmado",
            stats?.average?.toFixed(2) ?? "—",
            "Excluye notas pendientes",
          ],
          [
            Clock,
            "Por revisar",
            stats?.pending ?? "—",
            "Resultados con revisión pendiente",
          ],
        ].map(([Icon, label, value, caption], i) => {
          const Component = Icon as typeof FileText;
          return (
            <article className="stat-card" key={i}>
              <div>
                <span>{String(label)}</span>
                <Component size={20} />
              </div>
              <strong>{String(value)}</strong>
              <small>{String(caption)}</small>
            </article>
          );
        })}
      </section>
      <div className="dashboard-grid">
        <section className="card">
          <div className="section-title">
            <h2>Evaluaciones recientes</h2>
            <Link href="/sistema/examenes" className="text-link">
              Ver todas ↗
            </Link>
          </div>
          {!recent.length ? (
            <Empty text="Crea tu primera evaluación con preguntas del banco." />
          ) : (
            recent.map((e) => (
              <Link className="recent-row" key={e.id} href="/sistema/examenes">
                <span className="file-icon">
                  <FileText size={21} />
                </span>
                <span>
                  <strong>{e.title}</strong>
                  <small>
                    {e.area} · {e.grade} · {e.bimester}
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </Link>
            ))
          )}
        </section>
        <section className="card">
          <h2>Tu siguiente paso</h2>
          <p className="muted">Accesos rápidos para tu jornada.</p>
          {[
            [
              "/sistema/preguntas",
              "Construir el banco",
              "Organiza preguntas por tema.",
              BookOpen,
            ],
            [
              "/sistema/escaner",
              "Capturar respuestas",
              "Cámara o carga de imágenes.",
              ScanLine,
            ],
            [
              "/sistema/correccion",
              "Revisar y confirmar",
              "Resuelve lecturas pendientes.",
              CheckCheck,
            ],
          ].map(([href, title, desc, Icon]) => {
            const Component = Icon as typeof BookOpen;
            return (
              <Link
                className="quick-link"
                href={String(href)}
                key={String(href)}
              >
                <Component size={22} />
                <span>
                  <strong>{String(title)}</strong>
                  <small>{String(desc)}</small>
                </span>
                <ArrowUpRight size={16} />
              </Link>
            );
          })}
        </section>
      </div>
      <section className="card">
        <div className="section-title">
          <h2>Áreas que necesitan atención</h2>
          <Link href="/sistema/reportes" className="text-link">
            Explorar análisis ↗
          </Link>
        </div>
        {!stats?.courses.length ? (
          <p className="muted">
            Los indicadores aparecerán cuando haya resultados confirmados.
          </p>
        ) : (
          <div className="metric-grid">
            {stats.courses.slice(0, 6).map((c) => (
              <div key={c.area}>
                <strong>{c.area || "Sin área"}</strong>
                <p>
                  {Number(c.average).toFixed(2)}{" "}
                  <small>promedio · {c.count} resultados</small>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
