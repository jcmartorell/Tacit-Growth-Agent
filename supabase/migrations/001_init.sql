-- Tacit Growth: esquema inicial (Fase 1)
-- Se corre UNA vez en el SQL Editor de Supabase, en un proyecto NUEVO y separado de Tacit.
-- Todas las tablas tienen RLS activado y SIN políticas: nadie puede leerlas ni escribirlas
-- desde el navegador. Solo el servidor de la app, con la llave service_role, tiene acceso.

create extension if not exists pgcrypto;

-- Actualiza updated_at automáticamente en cada cambio
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1. Configuración (perfil de cliente ideal, reglas de redacción, límites diarios)
create table settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();

-- 2. Prospectos (vienen de Apollo)
create table prospects (
  id                uuid primary key default gen_random_uuid(),
  apollo_person_id  text unique,
  full_name         text not null,
  title             text,
  company_name      text,
  company_domain    text,
  company_size      integer,
  industry          text,
  country           text,
  linkedin_url      text,
  email             text,
  status            text not null default 'nuevo' check (status in (
                      'nuevo','descartado','investigado','listo',
                      'enviado','respondio','reunion','cerrado')),
  discard_reason    text,
  research          jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index prospects_status_idx on prospects (status);
create trigger prospects_updated_at before update on prospects
  for each row execute function set_updated_at();

-- 3. Mensajes de prospección (invitación, mensaje, seguimientos)
create table outreach_messages (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references prospects(id) on delete cascade,
  kind         text not null check (kind in ('invitacion','mensaje','seguimiento_1','seguimiento_2')),
  body         text not null,
  status       text not null default 'borrador' check (status in ('borrador','aprobado','enviado','descartado')),
  due_at       timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (prospect_id, kind)
);
create index outreach_messages_status_idx on outreach_messages (status, due_at);
create trigger outreach_messages_updated_at before update on outreach_messages
  for each row execute function set_updated_at();

-- 4. Publicaciones (LinkedIn personal, LinkedIn empresa, Instagram)
create table posts (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null check (channel in ('linkedin_personal','linkedin_empresa','instagram')),
  topic         text,
  body          text not null,
  image_url     text,
  status        text not null default 'borrador' check (status in (
                  'borrador','aprobado','publicado','error','descartado')),
  scheduled_at  timestamptz,
  published_at  timestamptz,
  external_id   text,
  error         text,
  metrics       jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index posts_status_idx on posts (status, scheduled_at);
create trigger posts_updated_at before update on posts
  for each row execute function set_updated_at();

-- 5. Registro de cada ejecución de agente (para ver actividad y costo real de LLM)
create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  agent          text not null,
  model          text,
  status         text not null check (status in ('ok','error')),
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(10,4) not null default 0,
  detail         jsonb,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index agent_runs_started_idx on agent_runs (started_at desc);

-- RLS: activado, sin políticas = acceso denegado para anon y authenticated
alter table settings          enable row level security;
alter table prospects         enable row level security;
alter table outreach_messages enable row level security;
alter table posts             enable row level security;
alter table agent_runs        enable row level security;
