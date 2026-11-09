import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash"),
    type = request.nextUrl.searchParams.get("type");
  if (token_hash && (type === "invite" || type === "recovery")) {
    const db = await serverClient();
    const { error } = await db.auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(new URL("/auth/password", request.url));
  }
  return NextResponse.redirect(
    new URL("/login?error=invalid-link", request.url),
  );
}
