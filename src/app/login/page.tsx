export const dynamic = "force-dynamic";
import { configured } from "@/lib/supabase/server";
import { Login } from "@/components/login";
export default function Page() {
  return <Login configured={configured()} />;
}
