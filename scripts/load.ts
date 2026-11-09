import { PGlite } from "@electric-sql/pglite";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { questionSchema, sheetLayout } from "../src/lib/domain";
async function main() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of ["001_academic.sql", "003_reports.sql", "004_legacy.sql"])
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  const owner = "11111111-1111-4111-8111-111111111111";
  await db.query("insert into auth.users values($1)", [owner]);
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
    owner,
  ]);
  const students = Array.from({ length: 1000 }, (_, i) => ({
    id: `s${i}`,
    code: `c${i}`,
  }));
  await db.query(
    `insert into students(id,code,first_names,last_names) select x->>'id',x->>'code','Sintético','Carga' from jsonb_array_elements($1) x`,
    [JSON.stringify(students)],
  );
  await db.exec(`insert into exams(id,title) values('exam','Carga sintética')`);
  const questions = Array.from({ length: 50 }, (_, i) =>
      questionSchema.parse({
        id: `q${i}`,
        type: "multipleChoice",
        prompt: `Pregunta sintética ${i + 1}`,
        options: ["A", "B", "C", "D"],
        correctOptionIndex: i % 4,
        score: 1,
      }),
    ),
    pages = sheetLayout(questions),
    items = pages.flatMap((p) => p.items);
  await db.query(
    `insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values('version','exam','LOAD',$1,$2,$3,20)`,
    [JSON.stringify(questions), JSON.stringify(items), pages.length],
  );
  const timings: number[] = [],
    start = performance.now();
  for (let student = 0; student < 200; student++)
    for (const page of pages) {
      const t = performance.now(),
        i = student * pages.length + page.pageNumber,
        answers = page.items.map((item) => ({
          questionId: item.questionId,
          selected: item.correctOptionIndex,
          status: "answered",
          confidence: 0.99,
        }));
      await db.query("select commit_scan($1,$2,$3)", [
        JSON.stringify({
          id: `scan${i}`,
          version_id: "version",
          student_id: `s${student}`,
          page_number: page.pageNumber,
          image_hash: i.toString(16).padStart(64, "0"),
        }),
        JSON.stringify(answers),
        "reject",
      ]);
      timings.push(performance.now() - t);
    }
  const elapsed = performance.now() - start;
  timings.sort((a, b) => a - b);
  const queryStart = performance.now();
  await db.query(
    "select id,grade,pending from results order by updated_at desc limit 25",
  );
  const pageMs = performance.now() - queryStart;
  const summaryStart = performance.now();
  await db.query("select academic_summary()");
  const summaryMs = performance.now() - summaryStart;
  const r = {
    engine: "PGlite PostgreSQL, local, single connection, synthetic data",
    students: 1000,
    evaluatedStudents: 200,
    questionsPerExam: 50,
    scanPages: timings.length,
    storedAnswers: 10000,
    concurrency: 1,
    elapsedMs: elapsed,
    commitP50Ms: timings[Math.floor(timings.length * 0.5)],
    commitP95Ms: timings[Math.floor(timings.length * 0.95)],
    page25Ms: pageMs,
    summaryMs,
    note: "No mide usuarios simultáneos ni capacidad de Supabase/Vercel ni red/cámara.",
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/load-local.json", JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  await db.close();
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
