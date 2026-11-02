"use client";

// Se muestra si una página del panel falla (por ejemplo, la base de datos no responde).
export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <h1>Algo falló</h1>
      <p className="alert alert-error">
        No se pudieron cargar los datos. Revisa que Supabase esté configurado y que /api/health responda ok.
        {error.digest && <> Código: {error.digest}</>}
      </p>
      <p style={{ marginTop: 16 }}>
        <button onClick={reset}>Reintentar</button>
      </p>
    </>
  );
}
