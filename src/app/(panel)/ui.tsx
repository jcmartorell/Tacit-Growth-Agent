"use client";

import { useState, useTransition } from "react";

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Copia el texto:", text);
        }
      }}
    >
      {done ? "Copiado ✓" : label}
    </button>
  );
}

// Botón que ejecuta una server action y muestra estado mientras corre
export function ActionButton({
  action,
  label,
  pendingLabel = "…",
  variant = "primary",
}: {
  action: () => Promise<unknown>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cls = variant === "primary" ? "" : variant === "danger" ? "btn-danger" : "btn-secondary";
  return (
    <span className="action">
      <button
        type="button"
        className={cls}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await action();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Error");
            }
          })
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="inline-error">{error}</span>}
    </span>
  );
}
