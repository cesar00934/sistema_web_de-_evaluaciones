"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useId,
  type ReactNode,
} from "react";
import { browserClient } from "@/lib/supabase/client";
import { catalogDefaults, builtInAssets } from "@/lib/editor-defaults";
import { useWorkspace } from "./workspace-context";
import { errorText } from "./common";
import { PrivateImage } from "./records";
import {
  imageAccept,
  prepareQuestionImage,
  uploadQuestionImage,
} from "@/lib/question-image";
interface Catalog {
  options: Record<string, string[]>;
  save: (kind: string, value: string) => Promise<void>;
  reload: () => Promise<void>;
  error: string;
}
const CatalogContext = createContext<Catalog | null>(null);
export function CatalogProvider({ children }: { children: ReactNode }) {
  const { id } = useWorkspace(),
    [options, setOptions] = useState(catalogDefaults),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    const db = browserClient();
    const [custom, questions, teachers, courses] = await Promise.all([
      db
        .from("catalog_options")
        .select("kind,value")
        .eq("owner_id", id)
        .order("value")
        .limit(2000),
      db
        .from("questions")
        .select("area,topic,payload->subarea,payload->competency")
        .eq("owner_id", id)
        .limit(500),
      db.from("teachers").select("name").eq("owner_id", id).limit(250),
      db
        .from("courses")
        .select("name,area,subarea")
        .eq("owner_id", id)
        .limit(250),
    ]);
    const merged: Record<string, string[]> = { ...catalogDefaults };
    const add = (kind: string, value: unknown) => {
      if (typeof value === "string" && value.trim())
        merged[kind] = [...new Set([...(merged[kind] ?? []), value.trim()])];
    };
    custom.data?.forEach((r) => add(r.kind, r.value));
    questions.data?.forEach((r) => {
      add("area", r.area);
      add("topic", r.topic);
      add("subarea", r.subarea);
      add("competency", r.competency);
    });
    teachers.data?.forEach((r) => add("teacher", r.name));
    courses.data?.forEach((r) => {
      add("area", r.name);
      add("area", r.area);
      add("subarea", r.subarea);
    });
    setOptions(merged);
    if (custom.error)
      setError(
        "Falta aplicar la migración 006 para guardar catálogos y usar roles.",
      );
    else setError("");
  }, [id]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  async function save(kind: string, value: string) {
    if (!value.trim()) return;
    const { error } = await browserClient()
      .from("catalog_options")
      .upsert(
        { owner_id: id, kind, value: value.trim() },
        { onConflict: "owner_id,kind,value", ignoreDuplicates: true },
      );
    if (error) throw error;
    setOptions((o) => ({
      ...o,
      [kind]: [...new Set([...(o[kind] ?? []), value.trim()])],
    }));
  }
  return (
    <CatalogContext.Provider value={{ options, save, reload, error }}>
      {children}
    </CatalogContext.Provider>
  );
}
export function useCatalog() {
  const c = useContext(CatalogContext);
  if (!c) throw Error("Falta catálogo");
  return c;
}
export function CatalogInput({
  kind,
  name,
  label,
  value,
  onChange,
  required = false,
}: {
  kind: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const { options, save } = useCatalog(),
    list = useId(),
    [message, setMessage] = useState("");
  return (
    <label>
      {label}
      <div className="catalog-field">
        <input
          name={name}
          list={list}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          maxLength={200}
          placeholder="Selecciona o escribe uno nuevo…"
        />
        <button
          type="button"
          className="secondary"
          title="Guardar opción para futuras evaluaciones"
          onClick={async () => {
            try {
              await save(kind, value);
              setMessage("Opción guardada");
            } catch (e) {
              setMessage(errorText(e));
            }
          }}
        >
          Guardar opción
        </button>
      </div>
      <datalist id={list}>
        {(options[kind] ?? []).map((v) => (
          <option value={v} key={v} />
        ))}
      </datalist>
      {message && <small role="status">{message}</small>}
    </label>
  );
}
export function AssetSelect({
  kind,
  label,
  value,
  onChange,
}: {
  kind: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { id } = useWorkspace(),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [assets, setAssets] = useState<
      { id: string; path: string; label: string }[]
    >([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      let q = browserClient()
        .from("design_assets")
        .select("id,path,label", { count: "exact" })
        .eq("owner_id", id)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .range(page * 25, page * 25 + 24);
      if (query) q = q.ilike("label", `%${query.replaceAll("%", "")}%`);
      void q.then(({ data, error, count }) => {
        if (live) {
          setAssets(data ?? []);
          setCount(count ?? 0);
          if (error)
            setMessage(
              "Aplica la migración 006 para guardar imágenes reutilizables.",
            );
        }
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, kind, query, page]);
  const builtin = builtInAssets.filter((a) => a.kind === kind),
    selectedBuiltin = builtin.find((a) => a.id === value);
  return (
    <div className="asset-selector">
      <label>
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Ninguno</option>
          {builtin.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          {value &&
            !builtin.some((a) => a.id === value) &&
            !assets.some((a) => a.path === value) && (
              <option value={value}>Imagen guardada seleccionada</option>
            )}
          {assets.map((a) => (
            <option value={a.path} key={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {selectedBuiltin && (
        <img
          className="asset-preview"
          src={selectedBuiltin.url}
          alt={selectedBuiltin.label}
          loading="lazy"
        />
      )}
      {value && !selectedBuiltin && (
        <PrivateImage key={value} path={value} autoLoad />
      )}
      <div className="asset-actions">
        <input
          aria-label={`Buscar ${label}`}
          placeholder="Buscar en mis imágenes…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <label className="button secondary">
          {busy ? "Guardando…" : "Nueva imagen y guardar"}
          <input
            type="file"
            hidden
            accept={imageAccept}
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setBusy(true);
              try {
                const blob = await prepareQuestionImage(file),
                  path = await uploadQuestionImage(blob, id),
                  assetId = crypto.randomUUID(),
                  db = browserClient();
                const asset = {
                  id: assetId,
                  path,
                  label: file.name.slice(0, 120),
                };
                const { error: ae } = await db
                  .from("design_assets")
                  .insert({ ...asset, owner_id: id, kind });
                if (ae) throw ae;
                setAssets((a) => [asset, ...a]);
                onChange(path);
                setMessage("Imagen guardada en tu biblioteca.");
              } catch (error) {
                setMessage(errorText(error));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {page > 0 && (
          <button
            className="text-button"
            type="button"
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
        )}
        {(page + 1) * 25 < count && (
          <button
            className="text-button"
            type="button"
            onClick={() => setPage(page + 1)}
          >
            Más imágenes
          </button>
        )}
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
