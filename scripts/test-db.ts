import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { questionSchema, sheetLayout } from "../src/lib/domain";
async function main() {
  const db = new PGlite();
  const checks: string[] = [];
  const ok = (s: string) => {
    checks.push(s);
    console.log(`✓ ${s}`);
  };
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text default '',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const name of [
    "001_academic.sql",
    "002_storage.sql",
    "003_reports.sql",
    "004_legacy.sql",
    "005_selection.sql",
    "006_editor_and_roles.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  const u = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  await db.query("insert into auth.users(id) values($1),($2)", [u, other]);
  const asUser = async (id: string) => {
    await db.exec(`reset role;set role authenticated;`);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
  };
  await asUser(u);
  await db.exec(
    `insert into students(id,code,first_names,last_names) values('s','code','Ana','Pérez');insert into exams(id,title) values('e','Examen');`,
  );
  const question = questionSchema.parse({
      id: "q",
      prompt: "2+2",
      type: "multipleChoice",
      options: ["3", "4"],
      correctOptionIndex: 1,
      score: 10,
    }),
    open = questionSchema.parse({
      id: "open",
      prompt: "Explica",
      type: "openResponse",
      score: 10,
    }),
    questions = [question, open],
    pages = sheetLayout(questions),
    items = pages.flatMap((p) => [...p.items, ...p.written]);
  await db.query(
    `insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values('v','e','A',$1,$2,2,20)`,
    [JSON.stringify(questions), JSON.stringify(items)],
  );
  const scan = (id: string, hash: string, page = 1) => ({
    id,
    version_id: "v",
    student_id: "s",
    image_hash: hash.repeat(64),
    page_number: page,
  });
  const answer = [
    { questionId: "q", selected: 1, status: "answered", confidence: 0.9 },
  ];
  const commit = async (
    s: unknown,
    a: unknown = answer,
    resolution = "reject",
  ) =>
    (
      await db.query<{
        r: { disposition: string; result?: { grade: number; pending: number } };
      }>(`select commit_scan($1,$2,$3) r`, [
        JSON.stringify(s),
        JSON.stringify(a),
        resolution,
      ])
    ).rows[0].r;
  const first = await commit(scan("one", "a"));
  assert.equal(first.disposition, "inserted");
  assert.equal(Number(first.result!.grade), 10);
  assert.equal(first.result!.pending, 1);
  ok("La página abierta faltante mantiene la nota provisional");
  assert.equal((await commit(scan("one", "a"))).disposition, "duplicate");
  assert.equal((await commit(scan("two", "b"))).disposition, "conflict");
  ok("Deduplicación por ID/hash y conflicto por alumno/versión/página");
  await commit(scan("two", "b"), answer, "compare");
  let r = (await db.query<{ pending: number }>("select pending from results"))
    .rows[0];
  assert.equal(r.pending, 2);
  await db.query(`select resolve_scan('two')`);
  r = (await db.query<{ pending: number }>("select pending from results"))
    .rows[0];
  assert.equal(r.pending, 1);
  ok("Comparación mantiene pendiente; selección explícita resuelve conflicto");
  await db.query(`select review_answer('v','s','open',8,'{"text":"rúbrica"}')`);
  let grade = (await db.query<{ grade: string }>("select grade from results"))
    .rows[0].grade;
  assert.equal(Number(grade), 18);
  await assert.rejects(() =>
    db.query(`select review_answer('v','s','open',11)`),
  );
  ok("Puntaje manual validado contra máximo");
  await commit(scan("three", "c"), [{ ...answer[0], selected: 0 }], "replace");
  grade = (await db.query<{ grade: string }>("select grade from results"))
    .rows[0].grade;
  assert.equal(Number(grade), 8);
  ok("Reemplazo/reproceso conserva revisión manual");
  await db.query(
    `insert into attachments(id,scan_id,path,bytes,mime) values('img','three',$1,1000,'image/jpeg')`,
    [`${u}/three.jpg`],
  );
  await db.query(
    `insert into storage.objects(bucket_id,name) values('scans',$1)`,
    [`${u}/three.jpg`],
  );
  await db.query(`delete from storage.objects where name=$1`, [
    `${u}/three.jpg`,
  ]);
  await db.exec(`delete from attachments where id='img'`);
  assert.equal(
    Number(
      (await db.query<{ grade: string }>("select grade from results")).rows[0]
        .grade,
    ),
    8,
  );
  assert.equal((await db.query("select * from answers")).rows.length, 3);
  assert.equal((await db.query("select * from students")).rows.length, 1);
  ok("Eliminar imagen conserva alumnos, respuestas, revisión y nota");
  await db.query(
    `insert into storage.objects(bucket_id,name) values('questions',$1)`,
    [`${u}/question.png`],
  );
  await db.query(
    `insert into questions(id,prompt,payload) values('bank','Enunciado',$1)`,
    [JSON.stringify({ imagePath: `${u}/question.png` })],
  );
  await db.query(`delete from storage.objects where name=$1`, [
    `${u}/question.png`,
  ]);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    1,
  );
  ok("Storage protege imágenes de preguntas referenciadas");
  await asUser(other);
  for (const table of [
    "students",
    "exams",
    "versions",
    "scans",
    "answers",
    "results",
    "manual_grades",
    "attachments",
    "questions",
  ])
    assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  await assert.rejects(() => db.query(`select resolve_scan('three')`));
  await assert.rejects(() => db.query(`select review_answer('v','s','q',1)`));
  await assert.rejects(() =>
    db.query(
      "insert into students(owner_id,id,code,first_names,last_names) values($1,'bad','bad','x','x')",
      [u],
    ),
  );
  await assert.rejects(() =>
    db.query(`insert into storage.objects(bucket_id,name) values('scans',$1)`, [
      `${u}/steal.jpg`,
    ]),
  );
  ok("RLS bloquea lectura, escritura, RPC y Storage entre cuentas");
  await db.exec("reset role;set role anon;");
  await db.query(`select set_config('request.jwt.claim.sub','',false)`);
  await assert.rejects(() =>
    db.query(`select commit_scan('{}','[]','reject')`),
  );
  ok("Anónimo no puede ejecutar operaciones académicas");
  await asUser(u);
  const summary = (
    await db.query<{ s: { total: number; pending: number; average: number } }>(
      "select academic_summary() s",
    )
  ).rows[0].s;
  assert.equal(summary.total, 1);
  assert.equal(summary.pending, 0);
  assert.equal(Number(summary.average), 8);
  ok("Reporte agregado respeta revisión y excluye pendientes");
  await db.query(`select reprocess_scan('three',$1,'Reprocesado')`, [
    JSON.stringify([{ ...answer[0], selected: 1 }]),
  ]);
  assert.equal(
    Number(
      (await db.query<{ grade: string }>("select grade from results")).rows[0]
        .grade,
    ),
    18,
  );
  assert.equal((await db.query("select * from manual_grades")).rows.length, 1);
  ok(
    "Reproceso real conserva puntaje manual y actualiza solo la lectura automática",
  );
  await db.query(
    `insert into legacy_archive(kind,id,payload) values('results','legacy-id',$1)`,
    [
      JSON.stringify({
        payload: JSON.stringify({ examVersionId: "v", studentId: "s" }),
      }),
    ],
  );
  await db.query(`select restore_result_identity('legacy-id')`);
  assert.equal(
    (await db.query<{ id: string }>("select id from results")).rows[0].id,
    "legacy-id",
  );
  ok("Migración conserva ID del resultado y su nota");
  const chosen = (
    await db.query<{ ids: string[] }>(`select select_question_ids(1) ids`)
  ).rows[0].ids;
  assert.equal(chosen.length, 1);
  await assert.rejects(() => db.query(`select select_question_ids(99)`));
  ok("Selección automática valida cantidad y disponibilidad");
  const filtered = (
    await db.query<{ s: { total: number } }>(
      `select academic_summary(p_version=>'otra') s`,
    )
  ).rows[0].s;
  assert.equal(filtered.total, 0);
  assert.equal(
    (
      await db.query(
        `select * from results_by_dates(now()+interval '1 day',null)`,
      )
    ).rows.length,
    0,
  );
  ok("Filtros de versión y fecha se aplican en PostgreSQL");
  assert.equal(
    (await db.query<{ role: string }>("select role from profiles")).rows[0]
      .role,
    "teacher",
  );
  await assert.rejects(() =>
    db.query(`update profiles set role='admin' where id=$1`, [u]),
  );
  await assert.rejects(() =>
    db.query(`select admin_set_role($1,'admin')`, [other]),
  );
  ok("Docentes no pueden elevar su rol ni modificar perfiles");
  const inline = {
    ...question,
    id: "inline",
    prompt: "Pregunta creada dentro de Evaluaciones",
    topic: "Solo docente A",
  };
  const draft = {
    id: "inline-exam",
    title: "Evaluación editable",
    area: "ÁREA GUARDADA",
    level: "PRIMARIA",
    grade: "2",
    section: "A",
    bimester: "II",
    unit: "2",
    scale_maximum: 20,
    settings: {
      localQuestions: [inline],
      scoringMode: "manual",
      total: 40,
      columns: 2,
      teacherName: "Docente A",
      institutional: { headerFirst: "builtin:1.jpg" },
    },
  };
  const saveDraft = async (value: unknown, bank: string[] = [], revision = 0) =>
    (
      await db.query<{ r: number }>("select save_evaluation($1,$2,$3) r", [
        JSON.stringify(value),
        bank,
        revision,
      ])
    ).rows[0].r;
  assert.equal(await saveDraft(draft), 1);
  assert.equal(
    (await db.query(`select id from questions where id='inline'`)).rows.length,
    0,
  );
  assert.equal(
    (await db.query(`select id from exams where id='inline-exam'`)).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        `select value from catalog_options where kind='topic' and value='Solo docente A'`,
      )
    ).rows.length,
    1,
  );
  ok(
    "Pregunta interna, encabezado y catálogos se guardan sin agregarla al banco",
  );
  assert.equal(await saveDraft(draft, ["inline"], 1), 2);
  assert.equal(
    (await db.query(`select id from questions where id='inline'`)).rows.length,
    1,
  );
  await assert.rejects(
    () => saveDraft({ ...draft, title: "Pestaña antigua" }, [], 1),
    /otra pestaña/,
  );
  assert.equal(
    (
      await db.query<{ title: string }>(
        `select title from exams where id='inline-exam'`,
      )
    ).rows[0].title,
    "Evaluación editable",
  );
  ok(
    "Casilla de banco persiste y una revisión antigua no sobrescribe otra pestaña",
  );
  await asUser(other);
  assert.equal(
    (await db.query(`select id from exams where id='inline-exam'`)).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        `select value from catalog_options where value='Solo docente A'`,
      )
    ).rows.length,
    0,
  );
  await saveDraft(
    {
      ...draft,
      title: "Otra cuenta",
      settings: {
        ...draft.settings,
        localQuestions: [{ ...inline, topic: "Solo docente B" }],
      },
    },
    ["inline"],
  );
  await db.exec(
    `insert into students(id,code,first_names,last_names) values('s','code','Docente','B');insert into exams(id,title) values('e','Examen B');`,
  );
  await db.query(
    `insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values('v','e','B',$1,$2,2,20)`,
    [JSON.stringify(questions), JSON.stringify(items)],
  );
  await commit(scan("three", "c"));
  await db.query(`select review_answer('v','s','open',1)`);
  assert.equal(
    Number(
      (await db.query<{ grade: string }>("select grade from results")).rows[0]
        .grade,
    ),
    11,
  );
  await db.query(
    `insert into storage.objects(bucket_id,name) values('questions',$1)`,
    [`${other}/other.png`],
  );
  await asUser(u);
  assert.equal(
    Number(
      (await db.query<{ grade: string }>("select grade from results")).rows[0]
        .grade,
    ),
    18,
  );
  assert.equal(
    (
      await db.query<{ title: string }>(
        `select title from exams where id='inline-exam'`,
      )
    ).rows[0].title,
    "Evaluación editable",
  );
  ok(
    "Dos cuentas con los mismos IDs conservan preguntas, imágenes y notas independientes",
  );
  const admin = "33333333-3333-4333-8333-333333333333";
  await db.exec("reset role");
  await db.query(
    `insert into auth.users(id,email,raw_user_meta_data) values($1,'admin@example.test','{"role":"admin"}')`,
    [admin],
  );
  assert.equal(
    (
      await db.query<{ role: string }>(
        "select role from profiles where id=$1",
        [admin],
      )
    ).rows[0].role,
    "teacher",
  );
  await db.query(`update profiles set role='admin' where id=$1`, [admin]);
  await asUser(admin);
  assert.equal(
    (await db.query<{ r: boolean }>("select is_admin() r")).rows[0].r,
    true,
  );
  assert.equal((await db.query("select * from results")).rows.length, 2);
  assert.equal((await db.query("select * from profiles")).rows.length, 3);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    2,
  );
  assert.equal(
    (
      await db.query(
        `update students set first_names='Cambio' where owner_id=$1 returning id`,
        [u],
      )
    ).rows.length,
    0,
  );
  ok(
    "Administrador ve usuarios, notas y evidencia de ambas cuentas con lectura autorizada",
  );
  await db.query(`select admin_set_role($1,'admin')`, [other]);
  await db.query(`select admin_set_role($1,'teacher')`, [other]);
  await assert.rejects(
    () => db.query(`select admin_set_role($1,'teacher')`, [admin]),
    /al menos un administrador/,
  );
  ok(
    "Roles administrativos no proceden de metadata y se protege al último administrador",
  );
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/db-verification.json",
    JSON.stringify(
      {
        engine:
          "PGlite PostgreSQL; auth/storage contracts emulated, no hosted Supabase",
        checks,
      },
      null,
      2,
    ),
  );
  await db.close();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
