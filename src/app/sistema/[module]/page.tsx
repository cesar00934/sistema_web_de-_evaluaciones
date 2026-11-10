import { notFound } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceModule } from "@/components/workspace-module";
import { authenticated } from "@/lib/supabase/server";
import Loading from "../loading";
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
  }
  if (
    ![
      "administracion",
      "preguntas",
      "alumnos",
      "docentes",
      "examenes",
      "escaner",
      "resultados",
      "correccion",
      "reportes",
      "configuracion",
    ].includes(module)
  )
    notFound();
  return (
    <Suspense fallback={<Loading />}>
      <WorkspaceModule module={module} />
    </Suspense>
  );
}
