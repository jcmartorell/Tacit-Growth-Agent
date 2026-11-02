"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);

  return (
    <form action={action} className="stack">
      <label htmlFor="email">Correo</label>
      <input id="email" name="email" type="email" required autoComplete="email" placeholder="tu@tacit.guru" />
      <label htmlFor="password">Contraseña</label>
      <input id="password" name="password" type="password" autoComplete="current-password" />
      <button type="submit" name="mode" value="password" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
      <button type="submit" name="mode" value="link" className="link" disabled={pending} formNoValidate>
        Sin contraseña: enviar enlace al correo
      </button>
      {state && <p className={state.ok ? "alert alert-ok" : "alert alert-error"}>{state.message}</p>}
    </form>
  );
}
