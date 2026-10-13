-- ============================================================
-- 0119_practice_modalities_other
--
-- A professional can declare what she practises BEYOND the five modalities
-- the product knows.
--
-- `profiles.practice_modalities` (0050/0078) is a closed list on purpose: it
-- bounds what the therapeutic plan may propose (PRD §10.9) and what the
-- library puts first, so every value in it has to mean something to the
-- product. That left no way to say "I also do Tui Na" — and left the platform
-- blind to exactly the practices it does not serve yet, which is the thing a
-- roadmap decision needs to see.
--
-- So the free answer gets its OWN column and never mixes with the closed list:
--
--   * `practice_modalities`        — the five slugs. Clinical effect. Unchanged.
--   * `practice_modalities_other`  — what she typed. No clinical effect at all:
--     it does not widen the plan, is not sent to any model and does not rank a
--     library document. It is recorded, shown back to her, and readable by the
--     platform team (account dossier + /admin/insights).
--
-- Keeping free text out of every prompt is deliberate. A label is 60
-- characters of her own words, and 60 characters is enough room for an
-- instruction; the assistants carry clinical-safety rules that must not be
-- reachable from a settings field.
--
-- The onboarding also changes shape with this migration: it stops walking a
-- real consultation and becomes the preparation of the practice. One RPC
-- (`complete_practice_scope`) saves the whole "how I work" answer — the five,
-- the others, the areas (0103) and the timezone — in one transaction.
-- ============================================================

-- ---------- The column ----------

alter table public.profiles
  add column if not exists practice_modalities_other text[] not null default '{}'::text[];

comment on column public.profiles.practice_modalities_other is
  'Modalidades que a profissional declarou além das cinco do produto (0119), como ela escreveu. Sem efeito clínico: não amplia o plano terapêutico e não entra em prompt. Serve para ela se ver representada e para o time saber quem usa a plataforma.';

-- ---------- One normaliser ----------
--
-- Trim, collapse inner whitespace (a pasted line break becomes a space), drop
-- empties, keep the FIRST spelling of a case-insensitive duplicate in the order
-- she typed it — and drop the five slugs: typed as free text they are the
-- canonical modality, not "another one".

create or replace function public.normalize_practice_modalities_other(entries text[])
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(value order by position), '{}'::text[])
  from (
    select distinct on (lower(value)) value, position
    from (
      select btrim(regexp_replace(entry, '\s+', ' ', 'g')) as value, position
      from unnest(coalesce(entries, '{}'::text[])) with ordinality as listed(entry, position)
    ) cleaned
    where value <> ''
      and lower(value) <> all (
        array['acupuncture', 'diet', 'moxibustion', 'auriculotherapy', 'cupping']::text[]
      )
    order by lower(value), position
  ) deduplicated;
$$;

revoke all on function public.normalize_practice_modalities_other(text[]) from public, anon;

comment on function public.normalize_practice_modalities_other(text[]) is
  'Normaliza as modalidades livres (0119): apara, colapsa espaços, descarta vazios e os cinco slugs do produto, e mantém a primeira grafia de cada repetição.';

-- ---------- One validator, also the row guard ----------
--
-- `profiles` is writable by its owner through PostgREST (the profile card
-- updates it directly), so the RPC cannot be the only gate. The CHECK below is
-- what refuses a payload written around it.
--
-- The rules are about what this text will meet later, not about taste:
--   * up to 10 entries of 2–60 characters — a label, not a paragraph;
--   * no control characters;
--   * never starting with = + - @ — the first character a spreadsheet reads as
--     a formula, and this list WILL be exported by whoever studies it;
--   * no case-insensitive repeats.

create or replace function public.practice_modalities_other_valid(entries text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select entries is not null
    and cardinality(entries) <= 10
    and not exists (
      select 1
      from unnest(entries) as entry
      where entry is null
         or entry <> btrim(entry)
         or char_length(entry) not between 2 and 60
         or entry ~ '[[:cntrl:]]'
         or entry ~ '^[=+@-]'
    )
    and (select count(distinct lower(entry)) from unnest(entries) as entry) = cardinality(entries);
$$;

-- A pure predicate over its argument: it reads no table. It stays callable by
-- every role ON PURPOSE — the CHECK runs as whoever writes the row (the owner
-- through PostgREST, the sign-up trigger, a backup restore), and a role without
-- EXECUTE here would turn every profile write into "permission denied".
grant execute on function public.practice_modalities_other_valid(text[]) to public;

comment on function public.practice_modalities_other_valid(text[]) is
  'Predicado puro usado pelo CHECK de profiles.practice_modalities_other (0119): até 10 rótulos de 2–60 caracteres, sem caractere de controle, sem começar por = + - @, sem repetição.';

alter table public.profiles
  drop constraint if exists profiles_practice_modalities_other_check;
alter table public.profiles
  add constraint profiles_practice_modalities_other_check
  check (public.practice_modalities_other_valid(practice_modalities_other));

-- ---------- Editing it from /settings ----------
--
-- Same design as update_practice_modalities (0078): audited, validated here,
-- refused during a support session.

create or replace function public.update_practice_modalities_other(target_entries text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_entries text[];
  actor_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  normalized_entries := public.normalize_practice_modalities_other(target_entries);
  if not public.practice_modalities_other_valid(normalized_entries) then
    return jsonb_build_object('ok', false, 'code', 'invalid_modality_other');
  end if;

  update public.profiles
     set practice_modalities_other = normalized_entries,
         updated_at = now()
   where id = auth.uid();

  select m.org_id into actor_org
  from public.memberships m
  where m.user_id = auth.uid()
  order by m.created_at
  limit 1;

  -- The COUNT, never the list: the audit trail is read by more people than the
  -- profile is, and what she practises is hers to show (0050's discipline).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_org,
    auth.uid(),
    'practice.modalities_other.updated',
    'profile',
    auth.uid()::text,
    jsonb_build_object('otherCount', cardinality(normalized_entries))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'updated',
    'practice_modalities_other', to_jsonb(normalized_entries)
  );
end;
$$;

revoke all on function public.update_practice_modalities_other(text[]) from public, anon;
grant execute on function public.update_practice_modalities_other(text[]) to authenticated;

comment on function public.update_practice_modalities_other(text[]) is
  'Atualiza as modalidades livres da própria profissional (/settings). Auditado (contagem, nunca a lista), validado e recusado durante sessão de suporte.';

-- ---------- The preparation step: "how I work", in one write ----------
--
-- The guided onboarding used to open on a timezone picker and then walk a real
-- consultation. It is now the preparation of the practice, and its first step
-- saves everything that changes what the product prepares for her.
--
-- The timezone is confirmed here WITHOUT a field of its own. The client reads
-- the browser's zone: when it keeps the same clock as the stored one it is
-- adopted in silence; when the clock differs she is asked. `target_timezone_source`
-- records what happened, so a silent confirmation is never indistinguishable
-- from an answered one in the audit trail:
--
--   browser — adopted from the browser, same clock as before, no question;
--   default — the browser offered no usable zone, so the stored one stood;
--   chosen  — she answered the question (or picked it herself);
--   kept    — it had been confirmed before; this call did not ask.
--
-- `timezone_confirmed_at` is stamped ONCE (coalesce): walking the preparation
-- again must not move the moment the activation predicate was first met.

create or replace function public.complete_practice_scope(
  target_org uuid,
  target_timezone text,
  target_modalities text[],
  target_modalities_other text[],
  target_areas text[],
  target_timezone_source text default 'chosen'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_timezone text := nullif(btrim(target_timezone), '');
  normalized_modalities text[];
  normalized_other text[];
  normalized_areas text[];
  timezone_source text := case
    when target_timezone_source in ('browser', 'default', 'chosen', 'kept') then target_timezone_source
    else 'chosen'
  end;
  previous_timezone text;
  previous_confirmed_at timestamptz;
  confirmed_at timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  -- Support sees the account; it does not get to redefine what she practises.
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_org is null
     or not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if normalized_timezone is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names where name = normalized_timezone
     ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_timezone');
  end if;

  -- Same normalisation as 0050/0078: trim, lower, distinct, sorted.
  select coalesce(array_agg(value order by value), '{}'::text[])
    into normalized_modalities
  from (
    select distinct lower(btrim(modality)) as value
    from unnest(coalesce(target_modalities, '{}'::text[])) as modality
    where nullif(btrim(modality), '') is not null
  ) normalized;

  if exists (
    select 1
    from unnest(normalized_modalities) as modality
    where modality <> all (
      array['acupuncture', 'diet', 'moxibustion', 'auriculotherapy', 'cupping']::text[]
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_modality');
  end if;

  -- Same normalisation as 0103.
  select coalesce(array_agg(value order by value), '{}'::text[])
    into normalized_areas
  from (
    select distinct lower(btrim(area)) as value
    from unnest(coalesce(target_areas, '{}'::text[])) as area
    where nullif(btrim(area), '') is not null
  ) normalized;

  if exists (
    select 1 from unnest(normalized_areas) as area
    where area <> all (array['fertility']::text[])
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_area');
  end if;

  normalized_other := public.normalize_practice_modalities_other(target_modalities_other);
  if not public.practice_modalities_other_valid(normalized_other) then
    return jsonb_build_object('ok', false, 'code', 'invalid_modality_other');
  end if;

  select o.timezone, o.timezone_confirmed_at
    into previous_timezone, previous_confirmed_at
  from public.organizations o
  where o.id = target_org
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.organizations
     set timezone = normalized_timezone,
         timezone_confirmed_at = coalesce(timezone_confirmed_at, now())
   where id = target_org
   returning timezone_confirmed_at into confirmed_at;

  update public.profiles
     set practice_modalities = normalized_modalities,
         practice_modalities_other = normalized_other,
         practice_areas = normalized_areas,
         updated_at = now()
   where id = auth.uid();

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'practice.scope.completed',
    'organization',
    target_org::text,
    jsonb_build_object(
      'timezone', normalized_timezone,
      'timezoneChanged', previous_timezone is distinct from normalized_timezone,
      'timezoneSource', timezone_source,
      'timezoneFirstConfirmation', previous_confirmed_at is null,
      -- Counts, never the lists (0050/0078). The areas are a closed
      -- vocabulary and were already logged by name in 0103.
      'modalityCount', cardinality(normalized_modalities),
      'otherCount', cardinality(normalized_other),
      'areas', to_jsonb(normalized_areas)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'completed',
    'timezone', normalized_timezone,
    'timezone_confirmed_at', confirmed_at,
    'practice_modalities', to_jsonb(normalized_modalities),
    'practice_modalities_other', to_jsonb(normalized_other),
    'practice_areas', to_jsonb(normalized_areas)
  );
end;
$$;

revoke all on function public.complete_practice_scope(uuid, text, text[], text[], text[], text) from public, anon;
grant execute on function public.complete_practice_scope(uuid, text, text[], text[], text[], text) to authenticated;

comment on function public.complete_practice_scope(uuid, text, text[], text[], text[], text) is
  'Passo "Como você atende" do preparo do consultório (0119): grava modalidades, modalidades livres, áreas e o fuso numa só transação. Carimba timezone_confirmed_at uma única vez e registra na auditoria se o fuso foi adotado do navegador ou respondido por ela.';

-- ---------- The account dossier shows what she typed ----------
--
-- The dossier's "Modalidades" row read `practice_modalities` alone. For the
-- very accounts this column exists to reveal — someone who practises nothing
-- on the closed list — that row said "nothing declared", which is the opposite
-- of what she told us.
--
-- Copied verbatim from 0117, with one field added to `identity`:
-- `modalitiesOther`.

create or replace function public.admin_account_dossier(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  org public.organizations%rowtype;
  owner_id uuid;
  owner_profile public.profiles%rowtype;
  owner_user record;
  live_sub record;
  active_patients integer := 0;
  finalized_records integer := 0;
  library jsonb := '{}'::jsonb;
  identity jsonb;
  money jsonb;
  usage jsonb;
  broken jsonb;
  ai jsonb;
  spend jsonb;
  consent jsonb;
  access jsonb;
begin
  -- Same gate as the overview: the console, or a cron with the service key.
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  select * into org from public.organizations where id = target_org;
  if not found then
    raise exception 'workspace_not_found';
  end if;

  -- The owner membership, or any member if the owner ever left.
  select m.user_id into owner_id
  from public.memberships m
  where m.org_id = target_org
  order by (m.role = 'owner') desc, m.created_at
  limit 1;

  select * into owner_profile from public.profiles where id = owner_id;

  select
    u.created_at as user_created_at,
    u.recovery_sent_at,
    u.confirmation_sent_at,
    nullif(btrim(coalesce(u.email_change, '')), '') as email_change,
    nullif(btrim(coalesce(u.encrypted_password, '')), '') is not null as has_password
  into owner_user
  from auth.users u
  where u.id = owner_id;

  select s.*, p.name as plan_name, p.slug as plan_slug, p.price_cents
  into live_sub
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.org_id = target_org and s.status in ('trialing', 'active', 'past_due')
  order by s.created_at desc
  limit 1;

  select count(*) into active_patients
  from public.patients where org_id = target_org and archived_at is null;

  select count(*) into finalized_records
  from public.consultations where org_id = target_org and status = 'finalized';

  -- The library meter answers differently per plan (unlimited plans omit the
  -- counters entirely). Never let its gate take the whole dossier down.
  begin
    library := public.org_message_allowance(target_org, 'biblioteca-mtc');
  exception when others then
    library := jsonb_build_object('error', 'unavailable');
  end;

  -- ---------- Who she is, and what each blank blocks ----------

  identity := jsonb_build_object(
    'ownerId', owner_id,
    'userCreatedAt', owner_user.user_created_at,
    'modalities', owner_profile.practice_modalities,
    -- What she typed beyond the closed list (0119). Never a clinical input.
    'modalitiesOther', owner_profile.practice_modalities_other,
    'areas', owner_profile.practice_areas,
    -- Type and last two digits only: the column holds raw digits.
    'fiscalId', case
      when org.billing_cpf_cnpj is null then null
      when length(org.billing_cpf_cnpj) = 11 then 'CPF ***' || right(org.billing_cpf_cnpj, 2)
      else 'CNPJ ***' || right(org.billing_cpf_cnpj, 2)
    end,
    -- Asaas refuses to create a customer without these, so a blank here is a
    -- sale that cannot complete — shown apart from the owner's own phone,
    -- which is a different column and hides this one when coalesced.
    'billingPhone', nullif(btrim(coalesce(org.billing_phone, '')), ''),
    'postalCodeOnFile', org.billing_postal_code is not null,
    'addressNumberOnFile', org.billing_address_number is not null,
    'checkoutReady', org.billing_cpf_cnpj is not null
      and org.billing_postal_code is not null
      and org.billing_address_number is not null,
    'audioRetention', org.audio_retention,
    'timezoneConfirmed', org.timezone_confirmed_at is not null,
    -- True: the conversion automation is silent for her; only a human lever left.
    'lifecycleEmailOptOut', coalesce(owner_profile.lifecycle_email_opt_out, false),
    'hasPassword', coalesce(owner_user.has_password, false),
    'recoverySentAt', owner_user.recovery_sent_at,
    'emailChangePending', owner_user.email_change is not null,
    -- Keeps the conversion arithmetic honest: our own accounts are not customers.
    'staffAccount', exists (
      select 1 from public.memberships m
      join public.profiles p on p.id = m.user_id
      where m.org_id = target_org and p.is_superadmin
    ),
    -- What she ASKED FOR at the start choice (PRD §6.4). `completed_steps` is
    -- click history, never activation — activation is the live counters below.
    'onboarding', (
      select jsonb_build_object('track', os.selected_track, 'dismissed', os.dismissed, 'completedAt', os.completed_at)
      from public.onboarding_state os
      where os.user_id = owner_id
      order by os.updated_at desc
      limit 1
    )
  );

  -- ---------- Money ----------

  money := jsonb_build_object(
    'lifetimePaidCents', (
      select coalesce(sum(i.amount_cents), 0) from public.invoices i
      where i.org_id = target_org and i.status = 'paid'
    ),
    'payments', (
      select count(*) from public.invoices i where i.org_id = target_org and i.status = 'paid'
    ),
    -- Reported beside the total because a reversal flips the row instead of
    -- adding a negative one: without this, refunded money just disappears.
    'refundedCents', (
      select coalesce(sum(i.amount_cents), 0) from public.invoices i
      where i.org_id = target_org and i.status = 'refunded'
    ),
    'payingSince', (
      select min(i.paid_at) from public.invoices i where i.org_id = target_org and i.status = 'paid'
    ),
    -- Clamped like the activation dates: a payment migrated from the old
    -- system can predate the workspace, and a negative lag is not a fact
    -- about her, it is a fact about the migration.
    'daysToFirstPayment', (
      select case
        when min(i.paid_at) is null then null
        else greatest(floor(extract(epoch from (min(i.paid_at) - org.created_at)) / 86400.0)::int, 0)
      end
      from public.invoices i where i.org_id = target_org and i.status = 'paid'
    ),
    'lastPaidCents', (
      select i.amount_cents from public.invoices i
      where i.org_id = target_org and i.status = 'paid'
      order by i.paid_at desc limit 1
    ),
    'currency', coalesce((
      select i.currency from public.invoices i where i.org_id = target_org order by i.created_at desc limit 1
    ), 'BRL'),
    'providerCustomerId', live_sub.provider_customer_id,
    'providerSubscriptionId', live_sub.provider_subscription_id,
    'coupon', (
      select jsonb_build_object('code', c.code, 'type', c.discount_type, 'value', c.discount_value)
      from public.coupons c where c.id = live_sub.coupon_id
    ),
    'invoices', coalesce((
      select jsonb_agg(row order by row ->> 'at' desc) from (
        select jsonb_build_object(
          'at', coalesce(i.paid_at, i.due_at, i.created_at),
          'amountCents', i.amount_cents,
          'status', i.status,
          'provider', i.provider,
          'description', i.description,
          'invoiceUrl', i.invoice_url
        ) as row
        from public.invoices i
        where i.org_id = target_org
        order by coalesce(i.paid_at, i.due_at, i.created_at) desc
        limit 12
      ) recent
    ), '[]'::jsonb),
    -- Invoices upsert on (provider, provider_invoice_id): a retry that
    -- succeeds flips the same row, so this is what is failing NOW.
    'failedCharges', (
      select jsonb_build_object(
        'count', count(*),
        'since', min(i.created_at),
        'invoiceUrl', (
          select i2.invoice_url from public.invoices i2
          where i2.org_id = target_org and i2.status = 'failed'
          order by i2.created_at desc limit 1
        )
      )
      from public.invoices i where i.org_id = target_org and i.status = 'failed'
    ),
    -- 0104 cannot see this: 'incomplete' is outside its live-subscription
    -- filter, so an account sitting on an open charge reads as "Gratuito".
    'openCheckout', (
      select jsonb_build_object(
        'planName', p.name,
        'provider', s.provider,
        'createdAt', s.created_at,
        'ageDays', floor(extract(epoch from (now() - s.created_at)) / 86400.0)::int,
        'url', (
          select bo.result ->> 'url' from public.billing_operations bo where bo.id = s.billing_operation_id
        )
      )
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.org_id = target_org and s.status = 'incomplete'
      order by s.created_at desc limit 1
    ),
    'checkout', (
      select jsonb_build_object(
        'failed90d', count(*) filter (where bo.kind = 'checkout' and bo.status = 'failed' and bo.created_at >= now() - interval '90 days'),
        -- A 'processing' row whose lease expired is a crashed worker, not a
        -- purchase in flight.
        'stuck', count(*) filter (where bo.status = 'processing' and bo.lease_expires_at <= now()),
        'lastError', (
          select bo2.error_code from public.billing_operations bo2
          where bo2.org_id = target_org and bo2.status = 'failed'
          order by bo2.created_at desc limit 1
        )
      )
      from public.billing_operations bo where bo.org_id = target_org
    ),
    -- unique (org_id, trigger): each moment fires once per workspace FOR
    -- LIFE, so "expired" is a door that closed permanently.
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trigger', co.trigger,
        'state', case
          when co.converted_at is not null then 'converted'
          when co.dismissed_at is not null then 'dismissed'
          when co.expires_at <= now() then 'expired'
          else 'live'
        end,
        'openedAt', co.opened_at,
        'expiresAt', co.expires_at,
        'couponCode', co.coupon_code
      ) order by co.opened_at desc)
      from public.conversion_offers co where co.org_id = target_org
    ), '[]'::jsonb),
    -- A comped plan change UPDATEs the row in place (0067), so the audit
    -- trail is the other half of this history; the console links to it.
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planName', p.name,
        'status', s.status,
        'period', s.period,
        'provider', s.provider,
        'createdAt', s.created_at,
        'canceledAt', s.canceled_at,
        'cancellationRequestedAt', s.cancellation_requested_at
      ) order by s.created_at desc)
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.org_id = target_org
    ), '[]'::jsonb)
  );

  -- ---------- Is the product happening to her ----------

  usage := jsonb_build_object(
    'activePatients', active_patients,
    'archivedPatients', (
      select count(*) from public.patients where org_id = target_org and archived_at is not null
    ),
    -- Clamped like the record below, and for the same reason: an imported
    -- chart can carry a date older than the workspace, and "-20 days to
    -- first patient" tells an operator nothing at all.
    'daysToFirstPatient', (
      select case
        when min(pt.created_at) is null then null
        else greatest(floor(extract(epoch from (min(pt.created_at) - org.created_at)) / 86400.0)::int, 0)
      end
      from public.patients pt where pt.org_id = target_org
    ),
    -- Imported history is somebody else's past, not her first record here.
    -- The null check is load-bearing: `greatest(null, 0)` is 0 in Postgres,
    -- so without it an account that NEVER finalized a record would report
    -- "0 days to first record" — activation at its most flattering and most
    -- false. Clamped at zero only for backdated finalizations.
    'daysToFirstRecord', (
      select case
        when min(c.finalized_at) is null then null
        else greatest(floor(extract(epoch from (min(c.finalized_at) - org.created_at)) / 86400.0)::int, 0)
      end
      from public.consultations c
      where c.org_id = target_org and c.status = 'finalized' and c.import_batch_id is null
    ),
    -- 'draft' is her own unfinished record; 'awaiting_review' is where the AI
    -- pipeline parks one. Folding them together hides which side is stuck.
    'funnel', (
      select jsonb_build_object(
        'scheduled', count(*) filter (where c.status = 'scheduled'),
        'inProgress', count(*) filter (where c.status = 'in_progress'),
        'awaitingReview', count(*) filter (where c.status = 'awaiting_review'),
        'draft', count(*) filter (where c.status = 'draft'),
        'finalized', count(*) filter (where c.status = 'finalized'),
        'cancelled', count(*) filter (where c.status = 'cancelled')
      )
      from public.consultations c where c.org_id = target_org
    ),
    -- updated_at, not created_at: autosave-on-blur touches it, so this really
    -- reads "untouched for N days".
    'oldestOpenRecordDays', (
      select max(floor(extract(epoch from (now() - c.updated_at)) / 86400.0))::int
      from public.consultations c
      where c.org_id = target_org and c.status in ('in_progress', 'awaiting_review', 'draft')
    ),
    -- Audio reached the record. It does NOT prove the AI filled anything —
    -- an audio_only recording transcribes without extraction.
    'recordsFromAudio', (
      select count(*) from public.consultations c
      where c.org_id = target_org and c.transcription_id is not null
    ),
    'recordsTyped', (
      select count(*) from public.consultations c
      where c.org_id = target_org and c.transcription_id is null and c.status = 'finalized'
    ),
    'addenda', (select count(*) from public.consultation_addenda where org_id = target_org),
    'recordings', (
      select jsonb_build_object(
        'total', count(*),
        'ready', count(*) filter (where r.status = 'ready'),
        'failed', count(*) filter (where r.status = 'failed'),
        'cancelled', count(*) filter (where r.status = 'cancelled'),
        'lastAt', max(r.created_at),
        'modeAi', count(*) filter (where r.mode = 'ai'),
        'modeAudioOnly', count(*) filter (where r.mode = 'audio_only'),
        'modeUnknown', count(*) filter (where r.mode is null or r.mode not in ('ai', 'audio_only'))
      )
      from public.recordings r where r.org_id = target_org
    ),
    -- The companion app is the core capture loop; web and QR are fallbacks.
    -- 100% web on a paying account means the app never got installed.
    'captureSurface', coalesce((
      select jsonb_object_agg(s.surface, s.n)
      from (
        select coalesce(r.captured_on, 'unknown') as surface, count(*) as n
        from public.recordings r where r.org_id = target_org group by 1
      ) s
    ), '{}'::jsonb),
    'mobileDevices', (
      select jsonb_build_object(
        'count', count(*) filter (where md.enabled),
        'lastSeenAt', max(md.last_seen_at),
        'platforms', coalesce(jsonb_agg(distinct md.platform) filter (where md.enabled), '[]'::jsonb)
      )
      from public.mobile_devices md where md.org_id = target_org
    ),
    'minutes', (
      select jsonb_build_object(
        'lifetimeCycle', ceil(coalesce(sum(au.cycle_seconds), 0) / 60.0)::int,
        'lifetimePack', ceil(coalesce(sum(au.pack_seconds), 0) / 60.0)::int,
        'perFinalizedRecord', case
          when finalized_records > 0
          then round((coalesce(sum(au.seconds), 0) / 60.0 / finalized_records)::numeric, 1)
        end
      )
      from public.audio_usage au where au.org_id = target_org
    ),
    'weeklyRecordings', (
      select jsonb_agg(w.n order by w.weeks_ago desc)
      from (
        select i as weeks_ago, (
          select count(*) from public.recordings r
          where r.org_id = target_org
            and r.created_at >= date_trunc('week', now()) - (i || ' weeks')::interval
            and r.created_at < date_trunc('week', now()) - ((i - 1) || ' weeks')::interval
        ) as n
        from generate_series(7, 0, -1) i
      ) w
    ),
    'documents', (
      select jsonb_build_object(
        'issued', count(*) filter (where d.status = 'issued'),
        'draft', count(*) filter (where d.status = 'draft'),
        'revoked', count(*) filter (where d.status = 'revoked'),
        'byKind', coalesce((
          select jsonb_object_agg(k.kind, k.n)
          from (
            select d2.kind, count(*) as n from public.documents d2
            where d2.org_id = target_org and d2.kind is not null
            group by d2.kind
          ) k
        ), '{}'::jsonb)
      )
      from public.documents d where d.org_id = target_org
    ),
    -- The only place the platform can prove the document reached the patient.
    'shareLinks', (
      select jsonb_build_object(
        'created', count(*),
        'opened', count(*) filter (where l.opened_at is not null),
        'totalOpens', coalesce(sum(l.open_count), 0),
        'lastOpenedAt', max(l.opened_at)
      )
      from public.document_share_links l where l.org_id = target_org
    )
  );

  -- ---------- What is broken right now ----------

  broken := jsonb_build_object(
    'failedRecordings30d', (
      select count(*) from public.recordings r
      where r.org_id = target_org and r.status = 'failed' and r.created_at >= now() - interval '30 days'
    ),
    'failedRecordingsTotal', (
      select count(*) from public.recordings r where r.org_id = target_org and r.status = 'failed'
    ),
    -- capture/upload is her device; transcription/extraction is our pipeline.
    -- NULL is bucketed, never dropped: the check constraint is NOT VALID.
    'failureStages', coalesce((
      select jsonb_object_agg(s.stage, s.n)
      from (
        select coalesce(r.failure_stage, 'unknown') as stage, count(*) as n
        from public.recordings r
        where r.org_id = target_org and r.status = 'failed' and r.created_at >= now() - interval '30 days'
        group by 1
      ) s
    ), '{}'::jsonb),
    'lastFailure', (
      select jsonb_build_object(
        'at', r.updated_at,
        'errorCode', r.error_code,
        -- Raw provider text: diagnostics for the operator, never UI copy and
        -- never shown to the professional.
        'message', left(t.error, 200)
      )
      from public.recordings r
      left join public.transcriptions t on t.id = r.transcription_id
      where r.org_id = target_org and r.status = 'failed'
      order by r.updated_at desc limit 1
    ),
    -- Not a failure row, which is why the audit console cannot see it.
    'stuckProcessing', (
      select jsonb_build_object(
        'count', count(*),
        'maxAttempts', coalesce(max(r.processing_attempts), 0)
      )
      from public.recordings r
      where r.org_id = target_org and r.status = 'processing'
        and (r.processing_lease_expires_at is null or r.processing_lease_expires_at <= now())
    ),
    -- Audio delivered and nothing picked it up. Under ten minutes this is the
    -- normal hot path, so the cutoff is part of the question.
    'strandedUploads', (
      select count(*) from public.recordings r
      where r.org_id = target_org and r.status = 'uploaded' and r.mode = 'ai'
        and r.uploaded_at <= now() - interval '10 minutes'
    ),
    'audioDeletionPending', (
      select jsonb_build_object('count', count(*), 'oldest', min(r.audio_deletion_requested_at))
      from public.recordings r
      where r.org_id = target_org and r.audio_deletion_requested_at is not null and r.audio_deleted_at is null
    ),
    'audioDeletionErrors', (
      select count(*) from public.transcriptions t
      where t.org_id = target_org and t.deletion_error is not null and t.audio_deleted_at is null
    ),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', b.kind,
        'status', b.status,
        'source', b.source_system,
        'counts', b.counts,
        'error', b.error,
        'createdAt', b.created_at,
        'revertedAt', b.reverted_at
      ) order by b.created_at desc)
      from (
        select * from public.import_batches where org_id = target_org order by created_at desc limit 5
      ) b
    ), '[]'::jsonb)
  );

  -- ---------- Is the AI earning its cost here ----------

  ai := jsonb_build_object(
    -- Unlimited plans omit used/limit entirely: pass the RPC's own answer
    -- through instead of inventing a denominator.
    'library', library,
    'libraryLedger', (
      select jsonb_build_object(
        'billedUnitsThisMonth', round(coalesce(sum(l.weight) filter (where l.created_at >= date_trunc('month', now())), 0)::numeric, 1),
        'viaApp', count(*) filter (where l.channel is distinct from 'mcp'),
        'viaMcp', count(*) filter (where l.channel = 'mcp'),
        'firstAt', min(l.created_at),
        'lastAt', max(l.created_at),
        'activeMonths', count(distinct date_trunc('month', l.created_at))
      )
      from public.library_usage l where l.org_id = target_org
    ),
    'usageAlerts', coalesce((
      select jsonb_object_agg(a.meter, jsonb_build_object('maxThreshold', a.max_threshold, 'lastAt', a.last_at))
      from (
        select ua.meter, max(ua.threshold) as max_threshold, max(ua.created_at) as last_at
        from public.usage_alerts ua where ua.org_id = target_org group by ua.meter
      ) a
    ), '{}'::jsonb),
    'caseReviews', (
      select jsonb_build_object(
        'total', count(*),
        'aboutAPatient', count(*) filter (where c.patient_id is not null),
        'lastAt', max(c.updated_at)
      )
      from public.conversations c where c.org_id = target_org
    ),
    'ownProtocols', (
      select jsonb_build_object(
        'total', count(*),
        'ready', count(*) filter (where kd.status = 'ready'),
        'failed', count(*) filter (where kd.status = 'error')
      )
      from public.knowledge_documents kd
      join public.knowledge_collections kc on kc.id = kd.collection_id
      where kc.org_id = target_org
    ),
    -- Acceptance is what still STANDS: `ai_answer_decisions` records only
    -- 'edited' and 'rejected' (0059), and a rejection deletes the answer.
    'anamnesis', (
      select jsonb_build_object(
        'fromAudio', (
          select count(*) from public.anamnesis_answers a
          where a.org_id = target_org and a.source in ('patient_report', 'ai_inference', 'professional_voice')
        ),
        'edited', (
          select count(*) from public.ai_answer_decisions d
          where d.org_id = target_org and d.decision = 'edited'
        ),
        'rejected', (
          select count(*) from public.ai_answer_decisions d
          where d.org_id = target_org and d.decision = 'rejected'
        )
      )
    ),
    -- 'draft' is the AI's unreviewed pile, not her work in progress.
    'hypotheses', (
      select jsonb_build_object(
        'total', count(*),
        'awaitingReview', count(*) filter (where h.status = 'draft'),
        'accepted', count(*) filter (where h.status = 'accepted'),
        'edited', count(*) filter (where h.status = 'edited'),
        'rejected', count(*) filter (where h.status = 'rejected'),
        'withoutLibrary', count(*) filter (where h.retrieval_failed),
        'stale', count(*) filter (where h.stale_at is not null)
      )
      from public.consultation_hypotheses h where h.org_id = target_org
    ),
    'plans', (
      select jsonb_build_object(
        'ai', count(*) filter (where p.origin = 'ai'),
        'aiValidated', count(*) filter (where p.origin = 'ai' and p.status = 'validated'),
        'manual', count(*) filter (where p.origin = 'manual')
      )
      from public.consultation_plans p where p.org_id = target_org
    ),
    'reasoningPaywall', (
      select jsonb_build_object(
        'viewed', count(*) filter (where pe.event_name = 'upgrade.prompt_viewed'),
        'clicked', count(*) filter (where pe.event_name = 'upgrade.prompt_clicked')
      )
      from public.product_events pe
      where pe.org_id = target_org and pe.properties ->> 'feature' = 'clinical_reasoning'
    )
  );

  -- ---------- Consent, risk and the promises with clocks on them ----------

  consent := jsonb_build_object(
    'activePatients', active_patients,
    -- Two separate gates gate the loop: audio-recording authorizes capture,
    -- ai-processing authorizes sending it out. Either alone overstates it.
    'clearedForAudio', (
      select count(distinct ca.subject_id) from public.consent_acceptances ca
      join public.consent_terms ct on ct.id = ca.term_id
      where ca.org_id = target_org and ca.subject_type = 'patient' and ca.revoked_at is null
        and ct.slug = 'audio-recording'
    ),
    'clearedForAi', (
      select count(distinct ca.subject_id) from public.consent_acceptances ca
      join public.consent_terms ct on ct.id = ca.term_id
      where ca.org_id = target_org and ca.subject_type = 'patient' and ca.revoked_at is null
        and ct.slug = 'ai-processing'
    ),
    'signedByPatient', (
      select count(*) from public.consent_acceptances ca
      where ca.org_id = target_org and ca.revoked_at is null
        and ca.manifested_by in ('patient', 'legal_representative')
    ),
    'declaredByProfessional', (
      select count(*) from public.consent_acceptances ca
      where ca.org_id = target_org and ca.revoked_at is null and ca.manifested_by = 'professional'
    ),
    -- decision IS FALSE is the only recorded refusal; a purpose never offered
    -- leaves no row at all. The AI-record notice is a notice, not a gate.
    'refusals', (
      select count(*) from public.patient_consent_session_items i
      join public.patient_consent_sessions s on s.id = i.session_id
      where s.org_id = target_org and i.decision is false and i.slug <> 'ai-record-notice'
    ),
    'qrSessions', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where s.status = 'completed'),
        'pending', count(*) filter (where s.status = 'pending'),
        'expired', count(*) filter (where s.status = 'expired'),
        'lastCompletedAt', max(s.completed_at)
      )
      from public.patient_consent_sessions s where s.org_id = target_org
    ),
    'audioUnderRevokedConsent', (
      select count(*) from public.recordings r
      join public.consent_acceptances ca on ca.id = r.consent_acceptance_id
      where r.org_id = target_org and ca.revoked_at is not null and r.audio_deleted_at is null
    ),
    -- A flag, not an execution: the chart is still there, intact.
    'erasureRequests', (
      select jsonb_build_object('count', count(*), 'oldest', min(pt.deletion_requested_at))
      from public.patients pt where pt.org_id = target_org and pt.deletion_requested_at is not null
    ),
    'exports', (
      select jsonb_build_object(
        'count', count(*),
        'last', (
          select jsonb_build_object(
            'status', e.status,
            'requestedAt', e.requested_at,
            'completedAt', e.completed_at,
            'expiresAt', e.expires_at,
            'lastDownloadedAt', e.last_downloaded_at,
            'patientCount', e.patient_count
          )
          from public.account_exports e where e.org_id = target_org
          order by e.requested_at desc limit 1
        )
      )
      from public.account_exports where org_id = target_org
    )
  );

  -- ---------- Getting in, and who already has ----------

  access := jsonb_build_object(
    -- Sessions, not logins, and support visits excluded or they inflate her
    -- activity. An empty table means "no trail", never "never signed in".
    'signIns', (
      select jsonb_build_object(
        'total', count(*),
        'last30d', count(*) filter (where a.created_at >= now() - interval '30 days'),
        'lastAt', max(a.created_at)
      )
      from public.access_events a where a.user_id = owner_id and a.impersonated_by is null
    ),
    'trailAvailable', exists (select 1 from public.access_events limit 1),
    'mfa', (
      select jsonb_build_object(
        'verified', count(*) filter (where f.status = 'verified'),
        'unverified', count(*) filter (where f.status <> 'verified')
      )
      from auth.mfa_factors f where f.user_id = owner_id
    ),
    -- target_org_id is ON DELETE SET NULL, so an org-only filter loses history.
    'supportVisits', (
      select jsonb_build_object(
        'count', count(*),
        'lastAt', max(i.started_at),
        'lastActor', (
          select p.display_name from public.impersonation_sessions i2
          join public.profiles p on p.id = i2.actor_id
          where i2.target_org_id = target_org or i2.target_user_id = owner_id
          order by i2.started_at desc limit 1
        )
      )
      from public.impersonation_sessions i
      where i.target_org_id = target_org or i.target_user_id = owner_id
    )
  );


  -- ---------- What the AI cost us here ----------

  spend := jsonb_build_object(
    'usdToBrl', nullif(public.ai_price_book() ->> 'usdToBrl', '')::numeric,
    'window', (
      select jsonb_build_object(
        'costUsdMicros', coalesce(sum(s.cost_usd_micros) filter (where s.occurred_at >= now() - interval '30 days'), 0),
        'calls', count(*) filter (where s.occurred_at >= now() - interval '30 days'),
        'unpricedCalls', count(*) filter (where s.occurred_at >= now() - interval '30 days' and not s.priced),
        'estimatedCalls', count(*) filter (where s.occurred_at >= now() - interval '30 days' and s.estimated),
        'lifetimeCostUsdMicros', coalesce(sum(s.cost_usd_micros), 0),
        'lifetimeCalls', count(*),
        'firstAt', min(s.occurred_at),
        'lastAt', max(s.occurred_at)
      )
      from public.ai_spend s where s.org_id = target_org
    ),
    -- What the money bought. Units travel with the cost so a provider invoice
    -- can be argued with.
    'byFeature', coalesce((
      select jsonb_agg(x.f order by x.cost desc)
      from (
        select
          coalesce(sum(s.cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'feature', s.feature,
            'costUsdMicros', coalesce(sum(s.cost_usd_micros), 0),
            'calls', count(*),
            'unpricedCalls', count(*) filter (where not s.priced),
            'estimatedCalls', count(*) filter (where s.estimated),
            'tokensIn', coalesce(sum(s.tokens_in), 0),
            'tokensOut', coalesce(sum(s.tokens_out), 0),
            'audioSeconds', coalesce(sum(s.audio_seconds), 0),
            'lastAt', max(s.occurred_at)
          ) as f
        from public.ai_spend s
        where s.org_id = target_org and s.occurred_at >= now() - interval '30 days'
        group by s.feature
      ) x
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(x.m order by x.cost desc)
      from (
        select
          coalesce(sum(s.cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'provider', s.provider,
            'model', s.model,
            'costUsdMicros', coalesce(sum(s.cost_usd_micros), 0),
            'calls', count(*),
            'priced', bool_or(s.priced)
          ) as m
        from public.ai_spend s
        where s.org_id = target_org and s.occurred_at >= now() - interval '30 days'
        group by s.provider, s.model
      ) x
    ), '[]'::jsonb),
    -- Six months of bill, oldest first: a cost that doubled has a shape, and
    -- a single expensive month is not a trend.
    'monthly', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'month', to_char(m.month, 'YYYY-MM'),
          'costUsdMicros', coalesce((
            select sum(s.cost_usd_micros) from public.ai_spend s
            where s.org_id = target_org
              and s.occurred_at >= m.month
              and s.occurred_at < m.month + interval '1 month'
          ), 0),
          'calls', (
            select count(*) from public.ai_spend s
            where s.org_id = target_org
              and s.occurred_at >= m.month
              and s.occurred_at < m.month + interval '1 month'
          )
        )
        order by m.month
      )
      from (
        select date_trunc('month', now()) - (i || ' months')::interval as month
        from generate_series(5, 0, -1) i
      ) m
    ), '[]'::jsonb)
  );

  return jsonb_build_object(
    'orgId', target_org,
    'generatedAt', now(),
    'identity', identity,
    'money', money,
    'usage', usage,
    'broken', broken,
    'ai', ai || jsonb_build_object('spend', spend),
    'consent', consent,
    'access', access,
    -- Action and timestamp only: `metadata` carries patient ids and free text.
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at) order by e.created_at desc)
      from (
        select action, created_at from public.audit_events
        where org_id = target_org order by created_at desc limit 20
      ) e
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.admin_account_dossier(uuid) is
  'Everything the platform knows about one account: registration, money, usage, failures, AI verdicts and what the AI cost, consent and access. Superadmin or service role only; carries no clinical content.';

revoke all on function public.admin_account_dossier(uuid) from public, anon;
grant execute on function public.admin_account_dossier(uuid) to authenticated;
