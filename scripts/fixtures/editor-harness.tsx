import { parseStudentFile } from "../../src/lib/imports";
// Local verification only. This entry is never included in the Next.js application.
import { createRoot } from "react-dom/client";
import { WorkspaceProvider } from "../../src/components/workspace-context";
import { CatalogProvider } from "../../src/components/catalog";
import { ExamEditor } from "../../src/components/exam-editor";
import { Scanner } from "../../src/components/scanner";
import { browserClient } from "../../src/lib/supabase/client";
Object.assign(window, { __parseStudentFile: parseStudentFile });
const scanner = window.location.pathname === "/scanner";
async function mount() {
  if (scanner) {
    // Local transport fixture only. The production entry never imports this file.
    const payload = btoa(
      JSON.stringify({
        sub: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).replaceAll("=", "");
    await browserClient().auth.setSession({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.local-test`,
      refresh_token: "local-test",
    });
  }
  createRoot(document.getElementById("root")!).render(
    <WorkspaceProvider
      session={{
        id: "11111111-1111-4111-8111-111111111111",
        email: "docente@example.test",
        role: "teacher",
      }}
    >
      <CatalogProvider>
        <main className="main">{scanner ? <Scanner /> : <ExamEditor />}</main>
      </CatalogProvider>
    </WorkspaceProvider>,
  );
}
void mount();
