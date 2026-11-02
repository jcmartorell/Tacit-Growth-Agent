# Tacit Growth

Panel interno del motor de growth de Tacit. Proyecto separado de la app de Tacit: otra base de datos, otro deploy, ningún dato de clientes.

## Estado

**Fase 1 (base) lista:** base de datos, login por enlace al correo (solo correos autorizados) y panel con Resumen, Prospectos, Contenido y Costos de agentes. Las tablas están vacías hasta la Fase 2.

## Instalación (una sola vez)

### 1. Supabase (proyecto nuevo)
1. En supabase.com, crea un proyecto nuevo llamado `tacit-growth`. No uses el de Tacit.
2. Abre **SQL Editor**, pega todo el contenido de `supabase/migrations/001_init.sql` y presiona **Run**.
3. En **Table Editor** deben aparecer 5 tablas: `settings`, `prospects`, `outreach_messages`, `posts`, `agent_runs`.
4. En **Project Settings > API Keys** copia:
   - la URL del proyecto,
   - la llave pública (`anon` o `publishable`),
   - la llave secreta (`service_role` o `secret`). **No la compartas.**

### 2. GitHub
Crea el repo privado `Tacit-App/tacit-growth` y sube este código.

### 3. Vercel
1. **Add New > Project**, importa `Tacit-App/tacit-growth`.
2. En **Environment Variables** agrega las 5 variables de `.env.example`.
   - `NEXT_PUBLIC_SITE_URL`: la URL que Vercel le dé al proyecto, sin `/` al final.
   - `ALLOWED_EMAILS`: tu correo.
3. Deploy. Si cambias cualquier variable que empiece con `NEXT_PUBLIC_`, haz **Redeploy**: esas se fijan al compilar.

### 4. Supabase: direcciones permitidas
En **Authentication > URL Configuration**:
- **Site URL**: la URL de Vercel.
- **Redirect URLs**: agrega `https://TU-URL/auth/callback` y `http://localhost:3000/auth/callback`.

### 5. Verificar
1. Abre `https://TU-URL/api/health`. Debe decir `{"ok":true,"db":"ok"}`.
2. Abre `https://TU-URL/`. Debe mandarte a la pantalla de login.
3. Escribe tu correo, abre el enlace **en el mismo navegador** y debes ver el Resumen.

## Seguridad (cómo está construido)
- Las tablas tienen RLS activado sin políticas: desde el navegador no se pueden leer ni escribir.
- Solo el servidor accede a los datos, con la llave secreta, y únicamente después de validar la sesión con Supabase y que el correo esté en `ALLOWED_EMAILS`.
- La pantalla de login solo envía enlaces a correos de esa lista.

## Correr en tu computadora (opcional)
```
cp .env.example .env.local   # y llena los valores
npm install
npm run dev
```
Abre http://localhost:3000
