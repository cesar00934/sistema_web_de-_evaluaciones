import type { SupabaseClient } from "@supabase/supabase-js";
export const resultColumns =
  "owner_id,id,version_id,student_id,automatic_score,manual_score,maximum_score,grade,pending,updated_at,students!inner(first_names,last_names,grade,section),versions!inner(label,exam_id,exams!inner(title,area,bimester))";
export interface Filters {
  owner?: string;
  area: string;
  bimester: string;
  grade: string;
  section: string;
  student: string;
  version: string;
  from: string;
  until: string;
  pending: boolean;
}
export const emptyFilters: Filters = {
  area: "",
  bimester: "",
  grade: "",
  section: "",
  student: "",
  version: "",
  from: "",
  until: "",
  pending: false,
};
export interface ResultRow {
  owner_id: string;
  id: string;
  version_id: string;
  student_id: string;
  automatic_score: number;
  manual_score: number;
  maximum_score: number;
  grade: number;
  pending: number;
  updated_at: string;
  students: {
    first_names: string;
    last_names: string;
    grade: string;
    section: string;
  };
  versions: {
    label: string;
    exam_id: string;
    exams: { title: string; area: string; bimester: string };
  };
}
export function resultQuery(db: SupabaseClient, f: Filters) {
  const source =
    f.from || f.until
      ? db
          .rpc(
            "results_by_dates",
            {
              p_from: f.from ? `${f.from}T00:00:00-05:00` : null,
              p_until: f.until ? `${f.until}T23:59:59.999-05:00` : null,
            },
            { count: "exact" },
          )
          .select(resultColumns)
      : db.from("results").select(resultColumns, { count: "exact" });
  let q = source.order("updated_at", { ascending: false });
  if (f.owner) q = q.eq("owner_id", f.owner);
  for (const [key, column] of [
    ["area", "versions.exams.area"],
    ["bimester", "versions.exams.bimester"],
    ["grade", "students.grade"],
    ["section", "students.section"],
    ["student", "student_id"],
    ["version", "version_id"],
  ] as const)
    if (f[key]) q = q.eq(column, f[key]);
  if (f.pending) q = q.gt("pending", 0);
  return q;
}
