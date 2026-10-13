-- ============================================================
-- 0121_practice_identity
--
-- O consultório ganha identidade própria: documento, contato e endereço
-- completo. Até aqui a organização tinha nome e fuso — e nada que identificasse
-- a clínica para a paciente.
--
-- POR QUE NÃO REUSA OS billing_* (migração 0069): aqueles campos existem para o
-- provedor de pagamento e guardam só o que o Asaas exige — CPF/CNPJ, telefone,
-- CEP e número, sem rua, bairro, cidade nem UF. A decisão de produto
-- (2026-10-12) é mantê-los SEPARADOS: a cobrança pode sair no CPF da
-- profissional enquanto o receituário leva o CNPJ da clínica, e forçar um
-- número só obrigaria quem tem os dois a escolher qual documento sai errado.
-- Os dois conjuntos são preenchidos em telas diferentes e nenhum lê o outro.
--
-- TUDO NULLABLE, de propósito. Há contas em produção desde antes desta tela e
-- um NOT NULL aqui derrubaria todas elas. A obrigatoriedade de telefone,
-- e-mail, cidade e UF vive em update_practice_settings, que é o ÚNICO caminho
-- de escrita destes campos — ou seja, vale no momento de SALVAR a tela do
-- consultório, exatamente onde foi pedida, sem bloquear quem ainda não passou
-- por lá.
--
-- `complete_practice_context` (0050) continua podendo confirmar o fuso sem nada
-- disso: o preparo da prática não é hora de pedir endereço.
--
-- Dígitos, nunca a máscara — a regra do repositório para campo semântico
-- (packages/fields). O CHECK é o que garante isso contra uma escrita futura que
-- esqueça o onlyDigits().
-- ============================================================

alter table public.organizations
  add column if not exists practice_document text,
  add column if not exists practice_phone text,
  add column if not exists practice_email text,
  add column if not exists practice_postal_code text,
  add column if not exists practice_street text,
  add column if not exists practice_number text,
  add column if not exists practice_complement text,
  add column if not exists practice_district text,
  add column if not exists practice_city text,
  add column if not exists practice_state text;

comment on column public.organizations.practice_document is
  'CPF (11) ou CNPJ (14) da clinica, so digitos. Independente de billing_cpf_cnpj: este identifica o consultorio nos documentos emitidos.';
comment on column public.organizations.practice_email is
  'E-mail de contato do consultorio — o que a paciente usa. Nao e o e-mail de login (auth.users).';

alter table public.organizations drop constraint if exists organizations_practice_document_check;
alter table public.organizations add constraint organizations_practice_document_check
  check (practice_document is null or practice_document ~ '^([0-9]{11}|[0-9]{14})$');

alter table public.organizations drop constraint if exists organizations_practice_phone_check;
alter table public.organizations add constraint organizations_practice_phone_check
  check (practice_phone is null or practice_phone ~ '^[0-9]{10,11}$');

-- Deliberadamente frouxo: uma regex estrita de e-mail rejeita endereço válido.
-- O CHECK barra o que é obviamente lixo; o formulário valida o resto.
alter table public.organizations drop constraint if exists organizations_practice_email_check;
alter table public.organizations add constraint organizations_practice_email_check
  check (
    practice_email is null
    or (
      char_length(practice_email) <= 160
      and practice_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    )
  );

alter table public.organizations drop constraint if exists organizations_practice_postal_code_check;
alter table public.organizations add constraint organizations_practice_postal_code_check
  check (practice_postal_code is null or practice_postal_code ~ '^[0-9]{8}$');

-- Conjunto fechado: duas letras quaisquer deixariam passar "XX", e o endereço
-- impresso ficaria inválido sem ninguém perceber.
alter table public.organizations drop constraint if exists organizations_practice_state_check;
alter table public.organizations add constraint organizations_practice_state_check
  check (
    practice_state is null
    or practice_state in (
      'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
      'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
    )
  );

alter table public.organizations drop constraint if exists organizations_practice_address_size_check;
alter table public.organizations add constraint organizations_practice_address_size_check
  check (
    coalesce(char_length(practice_street), 0) <= 160
    and coalesce(char_length(practice_number), 0) <= 20
    and coalesce(char_length(practice_complement), 0) <= 80
    and coalesce(char_length(practice_district), 0) <= 120
    and coalesce(char_length(practice_city), 0) <= 120
  );

-- ---------- A tela do consultório, agora inteira ----------
-- Assinatura NOVA, não um overload: a antiga tinha um único chamador, e deixar
-- as duas conviverem faria uma chamada de 3 argumentos limpar o endereço em
-- silêncio — o formulário manda sempre todos os campos.
drop function if exists public.update_practice_settings(uuid, text, text);

create or replace function public.update_practice_settings(
  target_org uuid,
  target_name text,
  target_timezone text,
  target_document text,
  target_phone text,
  target_email text,
  target_postal_code text,
  target_street text,
  target_number text,
  target_complement text,
  target_district text,
  target_city text,
  target_state text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_name text := nullif(btrim(target_name), '');
  normalized_timezone text := nullif(btrim(target_timezone), '');
  normalized_document text := nullif(regexp_replace(coalesce(target_document, ''), '[^0-9]', '', 'g'), '');
  normalized_phone text := nullif(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g'), '');
  normalized_email text := nullif(btrim(lower(coalesce(target_email, ''))), '');
  normalized_postal_code text := nullif(regexp_replace(coalesce(target_postal_code, ''), '[^0-9]', '', 'g'), '');
  normalized_street text := nullif(btrim(coalesce(target_street, '')), '');
  normalized_number text := nullif(btrim(coalesce(target_number, '')), '');
  normalized_complement text := nullif(btrim(coalesce(target_complement, '')), '');
  normalized_district text := nullif(btrim(coalesce(target_district, '')), '');
  normalized_city text := nullif(btrim(coalesce(target_city, '')), '');
  normalized_state text := nullif(upper(btrim(coalesce(target_state, ''))), '');
  previous_org public.organizations%rowtype;
  updated_org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if target_org is null
     or normalized_name is null
     or char_length(normalized_name) < 3
     or char_length(normalized_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_practice_name';
  end if;
  if normalized_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
     ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;

  -- Obrigatórios DESTA TELA. Não viram NOT NULL na coluna de propósito: a regra
  -- vale para quem salva o formulário, não para as contas que já existiam.
  if normalized_phone is null or normalized_phone !~ '^[0-9]{10,11}$' then
    raise exception using errcode = '22023', message = 'invalid_practice_phone';
  end if;
  if normalized_email is null
     or char_length(normalized_email) > 160
     or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception using errcode = '22023', message = 'invalid_practice_email';
  end if;
  if normalized_city is null or char_length(normalized_city) > 120 then
    raise exception using errcode = '22023', message = 'invalid_practice_city';
  end if;
  if normalized_state is null
     or normalized_state not in (
       'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
       'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
     ) then
    raise exception using errcode = '22023', message = 'invalid_practice_state';
  end if;

  -- Opcionais — mas se vierem, têm de estar certos.
  if normalized_document is not null and normalized_document !~ '^([0-9]{11}|[0-9]{14})$' then
    raise exception using errcode = '22023', message = 'invalid_practice_document';
  end if;
  if normalized_postal_code is not null and normalized_postal_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_practice_postal_code';
  end if;

  select o.* into previous_org
  from public.organizations o
  where o.id = target_org
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  update public.organizations
     set name = normalized_name,
         timezone = normalized_timezone,
         timezone_confirmed_at = coalesce(timezone_confirmed_at, now()),
         practice_document = normalized_document,
         practice_phone = normalized_phone,
         practice_email = normalized_email,
         practice_postal_code = normalized_postal_code,
         practice_street = normalized_street,
         practice_number = normalized_number,
         practice_complement = normalized_complement,
         practice_district = normalized_district,
         practice_city = normalized_city,
         practice_state = normalized_state
   where id = target_org
  returning * into updated_org;

  -- Nome e fuso vão com valor porque são operacionais e já iam. Documento,
  -- contato e endereço entram só como "mudou ou não": audit_events é append-only
  -- e sobrevive à exclusão da conta — guardar o CPF e o endereço da clínica ali
  -- criaria uma segunda base de dados pessoais que ninguém consegue apagar.
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'org.settings.updated',
    'organization',
    target_org::text,
    jsonb_build_object(
      'nameChanged', previous_org.name is distinct from updated_org.name,
      'previousName', previous_org.name,
      'name', updated_org.name,
      'timezoneChanged', previous_org.timezone is distinct from updated_org.timezone,
      'previousTimezone', previous_org.timezone,
      'timezone', updated_org.timezone,
      'timezoneConfirmed', previous_org.timezone_confirmed_at is null,
      'documentChanged', previous_org.practice_document is distinct from updated_org.practice_document,
      'contactChanged', (previous_org.practice_phone is distinct from updated_org.practice_phone)
                        or (previous_org.practice_email is distinct from updated_org.practice_email),
      'addressChanged', (previous_org.practice_postal_code is distinct from updated_org.practice_postal_code)
                        or (previous_org.practice_street is distinct from updated_org.practice_street)
                        or (previous_org.practice_number is distinct from updated_org.practice_number)
                        or (previous_org.practice_complement is distinct from updated_org.practice_complement)
                        or (previous_org.practice_district is distinct from updated_org.practice_district)
                        or (previous_org.practice_city is distinct from updated_org.practice_city)
                        or (previous_org.practice_state is distinct from updated_org.practice_state)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'updated',
    'id', updated_org.id,
    'name', updated_org.name,
    'timezone', updated_org.timezone,
    'timezone_confirmed_at', updated_org.timezone_confirmed_at
  );
end;
$$;

revoke all on function public.update_practice_settings(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.update_practice_settings(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to authenticated;
