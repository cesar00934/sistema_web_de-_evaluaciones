"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="card">
      <h1>No se pudo abrir esta página</h1>
      <p>
        Comprueba tu conexión y vuelve a intentarlo. Los datos ya guardados se
        conservan.
      </p>
      <button onClick={reset}>Reintentar</button>
    </section>
  );
}
