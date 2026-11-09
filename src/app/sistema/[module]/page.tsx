import { notFound } from "next/navigation";
import { Records } from "@/components/records";
import { ExamEditor } from "@/components/exam-editor";
import { Scanner } from "@/components/scanner";
import { Results } from "@/components/results";
import { SettingsPanel } from "@/components/settings";
import { AdminPanel } from "@/components/admin-panel";
import { QuestionBank } from "@/components/question-bank";
import { authenticated } from "@/lib/supabase/server";
export default async function Page({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (module === "administracion") {
    const { db } = await authenticated();
    const { data } = await db.rpc("is_admin");
    if (!data) notFound();
    return <AdminPanel />;
  }
  if (module === "preguntas") return <QuestionBank />;
  if (["alumnos", "docentes"].includes(module))
    return <Records module={module} />;
  if (module === "examenes") return <ExamEditor />;
  if (module === "escaner") return <Scanner />;
  if (["resultados", "correccion", "reportes"].includes(module))
    return <Results mode={module} />;
  if (module === "configuracion") return <SettingsPanel />;
  notFound();
}
