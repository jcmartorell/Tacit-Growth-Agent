"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, null);

  return (
    <form action={action} className="stack">
      <label htmlFor="email">Correo</label>
      <input id="email" name="email" type="email" required autoComplete="email" placeholder="tu@tacit.guru" />
      <button type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Enviar enlace"}
      </button>
      {state && <p className={state.ok ? "alert alert-ok" : "alert alert-error"}>{state.message}</p>}
    </form>
  );
}
