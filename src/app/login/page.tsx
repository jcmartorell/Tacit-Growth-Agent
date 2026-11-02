import { LoginForm } from "./login-form";
import { Mark } from "@/app/mark";

export const metadata = { title: "Entrar · Tacit Growth" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <Mark size={28} />
          <span className="brand-name">Tacit</span>
          <span className="brand-tag">Growth</span>
        </div>
        <h1>Entrar al panel</h1>
        <p className="muted">Entra con tu correo y contraseña.</p>
        {error && <p className="alert alert-error">{error}</p>}
        <LoginForm />
      </div>
    </main>
  );
}
