import { NextRequest, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import { evaluationSchema, validateOwnedAssets } from "@/lib/evaluation";
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
    const { db, user } = await authenticated(),
      input = evaluationSchema.parse(await request.json());
    validateOwnedAssets(input.settings, user.id);
    const { bankIds, revision, ...exam } = input;
    const { data, error } = await db.rpc("save_evaluation", {
      p_exam: exam,
      p_bank_ids: bankIds,
      p_revision: revision,
    });
    if (error) throw error;
    return NextResponse.json({ id: exam.id, revision: data });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          typeof e === "object" && e && "message" in e
            ? String(e.message)
            : "No se pudo guardar",
      },
      { status: 400 },
    );
  }
}
