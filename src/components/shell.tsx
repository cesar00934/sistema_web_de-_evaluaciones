"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  FileText,
  ScanLine,
  CheckCheck,
  ChartNoAxesCombined,
  Settings,
  LogOut,
  GraduationCap,
  Menu,
  Cloud,
} from "lucide-react";
import { browserClient } from "@/lib/supabase/client";
import { useCatalog } from "./catalog";
const links = [
  ["", "Inicio", LayoutDashboard],
  ["alumnos", "Alumnos", Users],
  ["docentes", "Docentes y cursos", GraduationCap],
  ["preguntas", "Banco de preguntas", BookOpen],
  ["examenes", "Evaluaciones", FileText],
  ["escaner", "Escáner", ScanLine],
  ["correccion", "Corrección", CheckCheck],
  ["resultados", "Resultados", ChartNoAxesCombined],
  ["reportes", "Reportes y análisis", ChartNoAxesCombined],
  ["configuracion", "Configuración", Settings],
] as const;
export function Shell({
  email,
  children,
  role = "teacher",
}: {
  email: string;
  children: React.ReactNode;
  role?: "teacher" | "admin";
}) {
  const router = useRouter(),
    path = usePathname(),
    [open, setOpen] = useState(false);
  const { error: catalogError } = useCatalog();
  return (
    <div className="app">
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Link className="brand" href="/sistema">
          <span className="brand-mark">C</span>
          <span>
            CRAMER <b>EVAL</b>
            <small>GESTIÓN ACADÉMICA</small>
          </span>
        </Link>
        <span className="nav-label">ESPACIO DE TRABAJO</span>
        <nav>
          {links.map(([slug, label, Icon]) => (
            <Link
              key={slug}
              href={`/sistema${slug ? `/${slug}` : ""}`}
              onClick={() => setOpen(false)}
              className={
                path === `/sistema${slug ? `/${slug}` : ""}` ? "active" : ""
              }
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
          {role === "admin" && (
            <Link
              className={path === "/sistema/administracion" ? "active" : ""}
              href="/sistema/administracion"
            >
              <Users size={19} />
              Administración
            </Link>
          )}
        </nav>
        <div className="sidebar-foot">
          <Cloud size={17} />
          <span>
            Espacio privado
            <br />
            <small>Datos protegidos por cuenta</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            aria-label="Abrir navegación"
            className="icon-button mobile-menu"
            onClick={() => setOpen(!open)}
          >
            <Menu />
          </button>
          <span className="muted">
            Plataforma de evaluación{" "}
            <span className="desktop">/ Espacio docente</span>
          </span>
          <div className="account">
            <span className="avatar">{email[0]?.toUpperCase()}</span>
            <span className="desktop">{email}</span>
            <button
              className="icon-button"
              aria-label="Cerrar sesión"
              onClick={async () => {
                await browserClient().auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">
          {catalogError && <p className="notice">{catalogError}</p>}
          {children}
        </main>
        <footer>
          CRAMER EVAL <span>Evaluación con propósito.</span>
        </footer>
      </div>
    </div>
  );
}
