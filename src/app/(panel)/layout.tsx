import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Mark } from "@/app/mark";

// Todo lo que está dentro de (panel) exige sesión con correo autorizado.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark size={24} />
          <span className="brand-name">Tacit</span>
          <span className="brand-tag">Growth</span>
        </div>
        <nav className="nav">
          <Link href="/hoy">Hoy</Link>
          <Link href="/">Resumen</Link>
          <Link href="/prospectos">Prospectos</Link>
          <Link href="/contenido">Contenido</Link>
          <Link href="/costos">Costos de agentes</Link>
          <Link href="/configuracion">Configuración</Link>
          <Link href="/metricas">Métricas</Link>
        </nav>
        <div className="sidebar-foot">
          <span>{user.email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="link">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
