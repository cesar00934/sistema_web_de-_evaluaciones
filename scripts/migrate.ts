import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { migrationPlan, payload, type LegacyExport } from "./migration-plan";
async function main() {
  const args = process.argv.slice(2),
    sourcePath = args.find((a) => !a.startsWith("--"));
  if (!sourcePath)
    throw Error("Uso: npm run migrate -- ruta/legacy.json [--apply]");
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as LegacyExport,
    plan = migrationPlan(source);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/migration-plan.json",
    JSON.stringify(plan, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        counts: plan.counts,
        issues: plan.issues,
        unassigned: plan.unassigned,
        invalidPages: plan.invalidPages,
      },
      null,
      2,
    ),
  );
  if (!args.includes("--apply")) {
    console.log(
      "Solo análisis. No se contactó Supabase. Plan privado en artifacts/migration-plan.json.",
    );
    return;
  }
  if (plan.issues.length)
    throw Error(
      "Resuelve los errores del plan antes de aplicar. No se escribió nada.",
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    email = process.env.MIGRATION_EMAIL!,
    password = process.env.MIGRATION_PASSWORD!;
  if (!url || !key || !email || !password)
    throw Error("Faltan URL, clave pública y MIGRATION_EMAIL/PASSWORD");
  const db = createClient(url, key, { auth: { persistSession: false } }),
    { data: login, error } = await db.auth.signInWithPassword({
      email,
      password,
    });
  if (error) throw error;
  const owner_id = login.user!.id;
  const { count, error: ce } = await db
    .from("students")
    .select("id", { count: "exact", head: true });
  if (ce) throw ce;
  if (count && !args.includes("--resume"))
    throw Error(
      "Usa una cuenta de prueba vacía. --resume permite continuar una importación parcial de esta copia.",
    );
  const put = async (
    table: string,
    row: Record<string, unknown>,
    ignore = false,
  ) => {
    const { error } = await db.from(table).upsert(
      { ...row, owner_id },
      {
        onConflict:
          table === "legacy_archive" ? "owner_id,kind,id" : "owner_id,id",
        ignoreDuplicates: ignore,
      },
    );
    if (error) throw Error(`${table} ${row.id}: ${error.message}`);
  };
  // Preserve all historic payloads before normalization, excluding obsolete device credentials.
  for (const [kind, rows] of Object.entries(source.tables))
    if (!["devices", "sync_events", "schema_meta"].includes(kind))
      for (let i = 0; i < rows.length; i++)
        await put(
          "legacy_archive",
          { kind, id: String(rows[i].id ?? i), payload: rows[i] },
          true,
        );
  for (const r of source.tables.teachers ?? []) {
    const p = payload(r);
    await put("teachers", {
      id: p.id,
      name: p.name ?? "",
      email: p.email ?? "",
    });
  }
  const knownTeachers = new Set(
    (source.tables.teachers ?? []).map((r) => String(payload(r).id)),
  );
  for (const e of plan.exams)
    if (e.teacherId && !knownTeachers.has(e.teacherId)) {
      await put("teachers", { id: e.teacherId, name: e.teacherId, email: "" });
      knownTeachers.add(e.teacherId);
    }
  for (const r of source.tables.courses ?? []) {
    const p = payload(r);
    await put("courses", {
      id: p.id,
      name: p.name ?? r.name ?? "",
      area: p.area ?? r.area ?? "",
      subarea: p.subarea ?? r.subarea ?? "",
      teacher_id: p.teacherId ?? null,
    });
  }
  for (const s of plan.students)
    await put("students", {
      id: s.id,
      code: s.code || s.id,
      first_names: s.firstNames,
      last_names: s.lastNames,
      level: s.level,
      grade: s.grade,
      section: s.section,
      active: s.active !== false,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    });
  const imageRoot = process.env.MIGRATION_IMAGE_ROOT
    ? path.resolve(process.env.MIGRATION_IMAGE_ROOT)
    : null;
  const missingImages: string[] = [];
  async function asset(
    original: string | undefined,
    bucket: string,
    id: string,
  ) {
    if (!original) return null;
    if (!imageRoot) {
      missingImages.push(`${bucket}:${id}`);
      return null;
    }
    let candidate = path.resolve(imageRoot, original);
    if (path.isAbsolute(original)) {
      candidate = path.resolve(imageRoot, path.basename(original));
    }
    const rel = path.relative(imageRoot, candidate);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw Error("Ruta de imagen fuera de la copia");
    try {
      const bytes = await readFile(candidate),
        sharp = (await import("sharp")).default,
        encoded = await sharp(bytes, { limitInputPixels: 32_000_000 })
          .rotate()
          .resize({
            width: 1800,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 86 })
          .toBuffer(),
        target = `${owner_id}/legacy-${encodeURIComponent(id)}.jpg`;
      const { error } = await db.storage
        .from(bucket)
        .upload(target, encoded, { contentType: "image/jpeg", upsert: false });
      if (error && !/exists|duplicate/i.test(error.message)) throw error;
      return { path: target, bytes: encoded.length };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        missingImages.push(`${bucket}:${id}`);
        return null;
      }
      throw e;
    }
  }
  const imageMap = new Map<string, string | null>();
  for (const q of plan.questions) {
    const image = await asset(q.imagePath ?? undefined, "questions", q.id);
    imageMap.set(q.id, image?.path ?? null);
    await put("questions", {
      id: q.id,
      prompt: q.prompt,
      area: q.area,
      topic: q.topic,
      difficulty: q.difficulty,
      archived: q.archived,
      payload: { ...q, imagePath: image?.path ?? null },
    });
  }
  for (const e of plan.exams)
    await put("exams", {
      id: e.id,
      title: e.title,
      area: e.area,
      level: e.level,
      grade: e.grade,
      section: e.section,
      bimester: e.bimester,
      unit: e.unit ?? "",
      teacher_id: e.teacherId ?? null,
      question_ids: e.questionIds,
      scale_maximum: e.scaleMaximum ?? 20,
      settings: e.legacySettings ?? { scoringMode: "manual" },
    });
  for (const v of plan.versions) {
    const e = plan.exams.find((e) => e.id === v.exam_id);
    await put(
      "versions",
      {
        ...v,
        questions: v.questions.map((q) => ({
          ...q,
          imagePath: imageMap.get(q.id) ?? null,
        })),
        scale_maximum: e?.scaleMaximum ?? 20,
      },
      true,
    );
  }
  const reviewQueue: { id: string; reason: string }[] = [];
  const legacyAnswers = (source.tables.answers ?? []).map(payload);
  for (const s of plan.scans) {
    if (
      !s.studentId ||
      plan.invalidPages.includes(s.id) ||
      s.status === "replaced"
    ) {
      reviewQueue.push({
        id: s.id,
        reason: !s.studentId
          ? "Sin alumno"
          : s.status === "replaced"
            ? "Histórico reemplazado: conservado en archivo privado"
            : "Página fuera de versión",
      });
      continue;
    }
    const v = plan.versions.find((v) => v.id === s.examVersionId)!;
    const answers = v.items
      .filter((i) => i.page === s.pageNumber)
      .map((i) => {
        const a = legacyAnswers.find(
            (a) => a.scanId === s.id && a.questionId === i.questionId,
          ),
          selected =
            a?.selectedAnswer != null ? Number(a.selectedAnswer) : null;
        return {
          questionId: i.questionId,
          selected,
          status:
            i.type === "openResponse"
              ? "manualReview"
              : (a?.status ?? "ambiguous"),
          confidence: Math.max(0, Math.min(1, a?.confidence ?? 0)),
        };
      });
    const { data, error } = await db.rpc("commit_scan", {
      p_scan: {
        id: s.id,
        version_id: s.examVersionId,
        student_id: s.studentId,
        page_number: s.pageNumber,
        image_hash: s.imageHash,
        created_at: s.createdAt,
        warning:
          "Importado desde copia SQLite; cotejar con resultado histórico.",
      },
      p_answers: answers,
      p_resolution: "compare",
    });
    if (error) throw Error(`Escaneo ${s.id}: ${error.message}`);
    if (data.disposition === "inserted" || data.disposition === "duplicate") {
      const image = await asset(s.imagePath, "scans", s.id);
      if (image) {
        const { error } = await db.from("attachments").upsert(
          {
            owner_id,
            id: s.id,
            scan_id: s.id,
            path: image.path,
            bytes: image.bytes,
            mime: "image/jpeg",
          },
          { onConflict: "owner_id,scan_id" },
        );
        if (error) throw error;
      }
    }
  }
  for (const m of source.tables.manual_grades ?? []) {
    const legacyResult = (source.tables.results ?? [])
      .map(payload)
      .find((r) => r.id === m.result_id);
    if (!legacyResult) {
      reviewQueue.push({
        id: String(m.id),
        reason: "Revisión sin resultado histórico",
      });
      continue;
    }
    const { error } = await db.rpc("review_answer", {
      p_version: legacyResult.examVersionId,
      p_student: legacyResult.studentId,
      p_question: m.question_id,
      p_score: m.score,
      p_rubric: m.rubric_json ? JSON.parse(String(m.rubric_json)) : {},
    });
    if (error) throw error;
  }
  const hiveRows = source.tables.hive ?? [];
  if (hiveRows.length) {
    const hive = payload(hiveRows[hiveRows.length - 1]).exam_data ?? {};
    const left = await asset(
      hive.logoIzquierdoBytes?.legacyFile,
      "questions",
      "hive-left",
    );
    const right = await asset(
      hive.logoDerechoBytes?.legacyFile,
      "questions",
      "hive-right",
    );
    const central = await asset(
      hive.imagenCentralBytes?.legacyFile,
      "questions",
      "hive-central",
    );
    const watermark = await asset(
      hive.marcaAguaPath,
      "questions",
      "hive-watermark",
    );
    const { error } = await db.from("settings").upsert(
      {
        owner_id,
        institution: hive.nombreColegio || "COLEGIO CRAMER",
        device_name: hive.deviceName || "Navegador",
        preferences: {
          logoLeft: left?.path,
          logoRight: right?.path,
          centralImage: central?.path,
          watermark: watermark?.path,
          frame:
            hive.marcoSeleccionado === "Curvo"
              ? "curved"
              : hive.marcoSeleccionado === "Recto"
                ? "straight"
                : "none",
          email: hive.correo ?? "",
          phone: hive.telefono ?? "",
          facebook: hive.facebook ?? "",
          header: hive.encabezado ?? "",
          header2: hive.encabezado2 ?? "",
        },
      },
      { onConflict: "owner_id" },
    );
    if (error) throw error;
  }
  const comparisons = [];
  for (const original of (source.tables.results ?? []).map(payload)) {
    const { error: identityError } = await db.rpc("restore_result_identity", {
      p_legacy_id: original.id,
    });
    if (identityError)
      reviewQueue.push({
        id: original.id,
        reason: `ID de resultado por conciliar: ${identityError.message}`,
      });
    const { data, error } = await db
      .from("results")
      .select("id,grade,pending")
      .eq("version_id", original.examVersionId)
      .eq("student_id", original.studentId)
      .maybeSingle();
    if (error) throw error;
    comparisons.push({
      legacyId: original.id,
      originalGrade: original.grade,
      current: data,
      requiresReview:
        !data || Math.abs(Number(data.grade) - Number(original.grade)) > 1e-8,
    });
  }
  await writeFile(
    "artifacts/migration-reconciliation.json",
    JSON.stringify(
      {
        sourceHash: plan.sourceHash,
        owner: owner_id,
        missingImages,
        reviewQueue,
        comparisons,
      },
      null,
      2,
    ),
  );
  console.log(
    "Importación finalizada; revisa artifacts/migration-reconciliation.json antes de usar las notas. El archivo privado conserva íntegros los resultados originales.",
  );
  await db.auth.signOut();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
