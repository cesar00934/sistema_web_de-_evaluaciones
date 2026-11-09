"use client";
import { useEffect, useState } from "react";
import { Heading, requireUser, errorText } from "./common";
import { LegacyArchive } from "./legacy-archive";
import { browserClient } from "@/lib/supabase/client";
import { useWorkspace } from "./workspace-context";
export function SettingsPanel() {
  const { id: ownerId } = useWorkspace();
  const [settings, setSettings] = useState<{
      institution: string;
      device_name: string;
      preferences?: {
        logoLeft?: string;
        logoRight?: string;
        centralImage?: string;
        watermark?: string;
        frame?: string;
        email?: string;
        phone?: string;
        facebook?: string;
        header?: string;
        header2?: string;
      };
    } | null>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    void browserClient()
      .from("settings")
      .select("institution,device_name,preferences")
      .eq("owner_id", ownerId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        else
          setSettings(
            data ?? { institution: "COLEGIO CRAMER", device_name: "Navegador" },
          );
      });
  }, [ownerId]);
  return (
    <>
      <Heading
        title="Configuración"
        description="La identidad de tu espacio y las preferencias de trabajo."
      />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="card">
        <h2>Identidad institucional</h2>
        {settings && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const { db, user } = await requireUser();
                const preferences = { ...settings.preferences };
                for (const field of [
                  "email",
                  "phone",
                  "facebook",
                  "header",
                  "header2",
                ] as const)
                  preferences[field] = String(f.get(field) ?? "").trim();
                preferences.frame = String(f.get("frame") ?? "none");
                for (const name of [
                  "logoLeft",
                  "logoRight",
                  "centralImage",
                  "watermark",
                ] as const) {
                  if (f.get(`clear_${name}`) === "on") delete preferences[name];
                  const file = f.get(name) as File;
                  if (file?.size) {
                    if (
                      file.size > 2 * 1024 * 1024 ||
                      !["image/png", "image/jpeg"].includes(file.type)
                    )
                      throw Error("Imágenes PNG/JPG, máximo 2 MB.");
                    const bitmap = await createImageBitmap(file);
                    bitmap.close();
                    const path = `${user.id}/logo-${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
                    const { error } = await db.storage
                      .from("questions")
                      .upload(path, file, {
                        contentType: file.type,
                        upsert: false,
                      });
                    if (error) throw error;
                    preferences[name] = path;
                  }
                }
                const { error } = await db.from("settings").upsert({
                  owner_id: user.id,
                  institution: String(f.get("institution")),
                  device_name: String(f.get("device_name")),
                  preferences,
                });
                if (error) throw error;
                setSettings({
                  institution: String(f.get("institution")),
                  device_name: String(f.get("device_name")),
                  preferences,
                });
                setMessage("Configuración guardada.");
              } catch (e) {
                setMessage(errorText(e));
              }
            }}
          >
            <div className="form-grid">
              <label>
                Marco del encabezado
                <select
                  name="frame"
                  defaultValue={settings.preferences?.frame ?? "none"}
                >
                  <option value="none">Sin marco</option>
                  <option value="curved">Curvo</option>
                  <option value="straight">Recto</option>
                </select>
              </label>
              {(["centralImage", "watermark"] as const).map((name) => (
                <label key={name}>
                  {name === "centralImage"
                    ? "Imagen central de fondo"
                    : "Marca de agua al pie"}
                  <input
                    name={name}
                    type="file"
                    accept="image/png,image/jpeg"
                  />
                  {settings.preferences?.[name] && (
                    <span className="check">
                      <input type="checkbox" name={`clear_${name}`} />
                      Quitar de los próximos PDF
                    </span>
                  )}
                </label>
              ))}
              <label>
                Nombre de la institución
                <input
                  name="institution"
                  defaultValue={settings.institution}
                  maxLength={60}
                  required
                />
              </label>
              <label>
                Logo izquierdo (PNG/JPG, 2 MB)
                <input
                  type="file"
                  name="logoLeft"
                  accept="image/png,image/jpeg"
                />
                {settings.preferences?.logoLeft && (
                  <small>
                    Logo guardado; se conserva si no seleccionas otro.
                  </small>
                )}
              </label>
              <label>
                Logo derecho (PNG/JPG, 2 MB)
                <input
                  type="file"
                  name="logoRight"
                  accept="image/png,image/jpeg"
                />
                {settings.preferences?.logoRight && (
                  <small>
                    Logo guardado; se conserva si no seleccionas otro.
                  </small>
                )}
              </label>
              <label>
                Nombre del dispositivo
                <input
                  name="device_name"
                  defaultValue={settings.device_name}
                  maxLength={80}
                  required
                />
              </label>
            </div>
            <div className="form-grid">
              {[
                ["email", "Correo institucional"],
                ["phone", "Teléfono"],
                ["facebook", "Facebook / contacto"],
                ["header", "Encabezado adicional"],
                ["header2", "Segundo encabezado"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    maxLength={100}
                    defaultValue={String(
                      settings.preferences?.[
                        key as keyof typeof settings.preferences
                      ] ?? "",
                    )}
                  />
                </label>
              ))}
            </div>
            <button>Guardar configuración</button>
          </form>
        )}
      </section>
      <section className="card">
        <h2>Acceso desde tus dispositivos</h2>
        <p>
          Inicia sesión con la misma cuenta en tu computadora y celular. Los
          datos se guardan en Supabase. Esta versión requiere Internet y
          sustituye el emparejamiento Wi-Fi local.
        </p>
        <p>
          Los docentes de esta pantalla son registros académicos. Las cuentas de
          acceso las crea o invita el administrador desde Supabase Auth. Cada
          cuenta dispone de su propio espacio privado.
        </p>
        <h3>Instalación en celular</h3>
        <p>
          Desde el menú del navegador, elige “Agregar a pantalla de inicio” o
          “Instalar” cuando esté disponible. La aplicación seguirá necesitando
          conexión.
        </p>
      </section>
      <LegacyArchive />
    </>
  );
}
