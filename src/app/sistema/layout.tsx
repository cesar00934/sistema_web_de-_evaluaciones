export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { configured, serverClient } from "@/lib/supabase/server";
import { Shell } from "@/components/shell";
import { WorkspaceProvider } from "@/components/workspace-context";
import { CatalogProvider } from "@/components/catalog";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!configured()) redirect("/login");
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = profile?.role === "admin" ? "admin" : "teacher";
  return (
    <WorkspaceProvider session={{ id: user.id, email: user.email ?? "", role }}>
      <CatalogProvider>
        <Shell email={user.email ?? ""} role={role}>
          {children}
        </Shell>
      </CatalogProvider>
    </WorkspaceProvider>
  );
}
