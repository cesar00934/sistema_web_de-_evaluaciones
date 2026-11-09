import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticated } from "@/lib/supabase/server";
import { z } from "zod";
export async function POST(request: NextRequest) {
  try {
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== request.nextUrl.origin
    )
      return NextResponse.json(
        { error: "Origen no autorizado" },
        { status: 403 },
      );
    const { db } = await authenticated();
    const { data: admin, error: ae } = await db.rpc("is_admin");
    if (ae || !admin)
      return NextResponse.json(
        { error: "Solo el administrador puede crear usuarios" },
        { status: 403 },
      );
    const input = z
      .object({
        email: z.email(),
        name: z.string().trim().min(1).max(120),
        password: z.string().min(10).max(128).optional(),
        mode: z.enum(["create", "invite"]),
      })
      .parse(await request.json());
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret)
      return NextResponse.json(
        {
          error:
            "Configura SUPABASE_SECRET_KEY únicamente en el servidor para crear o invitar usuarios.",
        },
        { status: 503 },
      );
    const service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      secret,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (input.mode === "create" && !input.password)
      throw Error("La contraseña debe tener al menos 10 caracteres");
    const result =
      input.mode === "invite"
        ? await service.auth.admin.inviteUserByEmail(input.email, {
            data: { display_name: input.name },
            redirectTo: `${request.nextUrl.origin}/auth/password`,
          })
        : await service.auth.admin.createUser({
            email: input.email,
            password: input.password,
            email_confirm: true,
            user_metadata: { display_name: input.name },
          });
    if (result.error) throw result.error;
    return NextResponse.json({
      id: result.data.user?.id,
      message:
        input.mode === "invite"
          ? "Invitación enviada."
          : "Usuario docente creado.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : "No se pudo crear el usuario",
      },
      { status: 400 },
    );
  }
}
