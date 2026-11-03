-- Tacit Growth: motor de correo y aprendizaje (Fase 6)
-- Se corre UNA vez en el SQL Editor de Supabase (proyecto tacit-growth).
-- Solo agrega columnas y amplía valores permitidos; no borra ni cambia datos existentes.

-- Prospectos: correo verificado y respuesta
alter table prospects add column if not exists email_status text;
alter table prospects add column if not exists replied_at timestamptz;
alter table prospects add column if not exists reply_channel text;

alter table prospects drop constraint if exists prospects_status_check;
alter table prospects add constraint prospects_status_check check (status in (
  'nuevo','descartado','investigado','listo','enviado','respondio','reunion','cerrado','rebotado'));

-- Mensajes: tipos de correo, asunto e identificadores de Gmail
alter table outreach_messages add column if not exists subject text;
alter table outreach_messages add column if not exists gmail_message_id text;
alter table outreach_messages add column if not exists gmail_thread_id text;
alter table outreach_messages add column if not exists rfc_message_id text;

alter table outreach_messages drop constraint if exists outreach_messages_kind_check;
alter table outreach_messages add constraint outreach_messages_kind_check check (kind in (
  'invitacion','mensaje','seguimiento_1','seguimiento_2','correo_1','correo_2','correo_3'));

create index if not exists outreach_messages_thread_idx on outreach_messages (gmail_thread_id);
create index if not exists outreach_messages_sent_idx on outreach_messages (kind, sent_at);
