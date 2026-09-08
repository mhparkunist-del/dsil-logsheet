-- =====================================================================
-- DSIL Log Sheet – 장비 사용 로그시트 스키마 (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
-- 사용법
--   1. https://supabase.com 에서 새 프로젝트 생성 (Free tier 충분)
--   2. SQL Editor 에 이 파일 전체를 붙여 넣고 Run (여러 번 실행해도 안전)
--   3. Authentication > Providers > Email 에서 "Enable email OTP / magic link" 확인
--   4. Project Settings > API 의 URL 과 anon key 를 assets/js/config.js 에 입력,
--      backend: 'supabase' 로 변경
--   5. 관리자 지정:  update public.profiles set is_admin = true, status = 'active' where email = 'admin@kaist.ac.kr';
--
-- 구조
--   profiles      : auth.users 와 1:1. 관리자 플래그, 승인 상태
--   equipment     : 장비. fields(JSON) 는 로그시트의 공정·측정 조건 항목 정의, issue(JSON) 는 열려 있는 이상 보고
--   log_entries   : 로그시트 한 줄. status open(사용 중) → closed(종료). deleted 는 소프트 삭제
--   audit_log     : 변경 이력. 트리거·함수만 INSERT, 관리자만 SELECT (삭제 경로 없음)
--   security_events : 로그인 실패·잠금·매크로 의심
-- 규칙(트리거)
--   - 같은 장비에 open 기록이 있으면 allow_concurrent 가 아닌 한 새 사용 시작 거부
--   - 종료 시 condition = 'issue' 면 equipment.issue 에 이상 보고를 열고, resolve_issue() 로 닫음
--   - 본인 기록은 open 이거나 작성 7일 이내에만 수정 (관리자는 언제나)
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  name         text,
  is_admin     boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'rejected')),
  approved_at  timestamptz,
  approved_by  text,
  created_at   timestamptz not null default now()
);

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles: admin update" on public.profiles;
create policy "profiles: admin update" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- equipment
-- ---------------------------------------------------------------------
create table if not exists public.equipment (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  location         text not null default '',
  manager_name     text not null default '',
  model            text not null default '',
  color            text not null default '#004191',
  fields           jsonb not null default '[]'::jsonb,   -- [{key,label,type,unit,options,required}]
  rules            text not null default '',
  allow_concurrent boolean not null default false,
  active           boolean not null default true,
  issue            jsonb,                                 -- {open,note,by,at,entryId} | null
  created_at       timestamptz not null default now()
);
create unique index if not exists equipment_name_key on public.equipment (lower(replace(name, ' ', '')));

alter table public.equipment enable row level security;
drop policy if exists "equipment: read" on public.equipment;
create policy "equipment: read" on public.equipment for select to authenticated using (public.is_active());
drop policy if exists "equipment: admin write" on public.equipment;
create policy "equipment: admin write" on public.equipment for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- log_entries
-- ---------------------------------------------------------------------
create table if not exists public.log_entries (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  equipment_id  uuid not null references public.equipment (id) on delete restrict,
  user_id       uuid not null references auth.users (id) on delete restrict,
  user_name     text not null default '',
  start_at      timestamptz not null,
  end_at        timestamptz,
  sample        text not null default '',
  purpose       text not null default '',
  params        jsonb not null default '{}'::jsonb,      -- {fieldKey: value}
  condition     text not null default 'normal' check (condition in ('normal', 'issue')),
  issues        text not null default '',
  note          text not null default '',
  status        text not null default 'open' check (status in ('open', 'closed')),
  closed_at     timestamptz,
  updated_at    timestamptz,
  updated_by    text,
  deleted       boolean not null default false,
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text not null default '',
  constraint end_after_start check (end_at is null or end_at >= start_at),
  constraint closed_has_end  check (status = 'open' or end_at is not null)
);
create index if not exists log_entries_eq_start_idx on public.log_entries (equipment_id, start_at desc);
create index if not exists log_entries_user_idx     on public.log_entries (user_id, start_at desc);
create index if not exists log_entries_open_idx     on public.log_entries (equipment_id) where status = 'open' and not deleted;

-- ---------------------------------------------------------------------
-- audit_log (추가만)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  action       text not null,        -- start | close | create | update | delete | restore | issue | resolve | equipment
  entry_id     uuid,
  equipment_id uuid,
  by_id        uuid,
  by_name      text not null default '',
  detail       text not null default ''
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists "audit: admin read" on public.audit_log;
create policy "audit: admin read" on public.audit_log for select to authenticated using (public.is_admin());

create or replace function public.current_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(name, email) from public.profiles where id = auth.uid()), '');
$$;

create or replace function public.kst(t timestamptz)
returns text language sql immutable as $$
  select case when t is null then '(없음)' else to_char(t at time zone 'Asia/Seoul', 'MM/DD HH24:MI') end;
$$;

-- ---------------------------------------------------------------------
-- 트리거: 사용자 이름 고정, 사용 중 중복 검사, 시각 필드
-- ---------------------------------------------------------------------
create or replace function public.log_entries_before()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_other record; v_conc boolean;
begin
  if tg_op = 'INSERT' then
    new.user_name := coalesce(nullif(public.current_name(), ''), new.user_name);
  else
    new.updated_at := now();
    if new.updated_by is null or new.updated_by = old.updated_by then new.updated_by := public.current_name(); end if;
  end if;
  if new.status = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  if new.status = 'open' and not new.deleted then
    select allow_concurrent into v_conc from public.equipment where id = new.equipment_id;
    for v_other in
      select user_id, user_name, start_at from public.log_entries
      where equipment_id = new.equipment_id and status = 'open' and not deleted and id <> new.id
    loop
      if v_other.user_id = new.user_id then
        raise exception '이미 이 장비를 사용 중으로 기록되어 있습니다. 먼저 종료하세요.';
      end if;
      if not coalesce(v_conc, false) then
        raise exception '%님이 %부터 사용 중입니다.', v_other.user_name, public.kst(v_other.start_at);
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists log_entries_before on public.log_entries;
create trigger log_entries_before before insert or update on public.log_entries for each row execute procedure public.log_entries_before();

-- ---------------------------------------------------------------------
-- 트리거: 변경 이력 + 이상 보고
-- ---------------------------------------------------------------------
create or replace function public.log_entries_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text; v_detail text := ''; v_eq text;
begin
  select name into v_eq from public.equipment where id = new.equipment_id;
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      v_action := 'start'; v_detail := coalesce(v_eq, '') || ' · ' || public.kst(new.start_at) || ' · ' || new.purpose;
    else
      v_action := 'create'; v_detail := coalesce(v_eq, '') || ' · ' || public.kst(new.start_at) || '~' || public.kst(new.end_at) || ' · ' || new.purpose;
    end if;
  else
    if not old.deleted and new.deleted then
      v_action := 'delete'; v_detail := new.delete_reason;
    elsif old.deleted and not new.deleted then
      v_action := 'restore';
    elsif old.status = 'open' and new.status = 'closed' then
      v_action := 'close';
      v_detail := coalesce(v_eq, '') || ' · ' || public.kst(new.start_at) || '~' || public.kst(new.end_at) || case when new.condition = 'issue' then ' · 이상: ' || new.issues else '' end;
    else
      v_action := 'update';
      v_detail := concat_ws(' / ',
        case when old.start_at  is distinct from new.start_at  then '시작: ' || public.kst(old.start_at) || ' → ' || public.kst(new.start_at) end,
        case when old.end_at    is distinct from new.end_at    then '종료: ' || public.kst(old.end_at) || ' → ' || public.kst(new.end_at) end,
        case when old.sample    is distinct from new.sample    then '시료/소자: ' || coalesce(nullif(old.sample, ''), '(없음)') || ' → ' || coalesce(nullif(new.sample, ''), '(없음)') end,
        case when old.purpose   is distinct from new.purpose   then '목적·내용: ' || old.purpose || ' → ' || new.purpose end,
        case when old.condition is distinct from new.condition then '장비 상태: ' || old.condition || ' → ' || new.condition end,
        case when old.issues    is distinct from new.issues    then '이상 내용: ' || coalesce(nullif(old.issues, ''), '(없음)') || ' → ' || coalesce(nullif(new.issues, ''), '(없음)') end,
        case when old.note      is distinct from new.note      then '비고: ' || coalesce(nullif(old.note, ''), '(없음)') || ' → ' || coalesce(nullif(new.note, ''), '(없음)') end,
        case when old.params    is distinct from new.params    then '조건: ' || old.params::text || ' → ' || new.params::text end);
      if v_detail = '' then v_detail := '변경 없음'; end if;
    end if;
  end if;
  insert into public.audit_log (action, entry_id, equipment_id, by_id, by_name, detail)
  values (v_action, new.id, new.equipment_id, auth.uid(), public.current_name(), left(coalesce(v_detail, ''), 1000));

  -- 이상 보고: 종료된 기록이 condition = 'issue' 가 되면 장비에 열어 둠
  if new.status = 'closed' and new.condition = 'issue' and not new.deleted
     and (tg_op = 'INSERT' or old.condition is distinct from new.condition or old.status is distinct from new.status) then
    update public.equipment
       set issue = jsonb_build_object('open', true, 'note', new.issues, 'by', new.user_name, 'at', now(), 'entryId', new.id)
     where id = new.equipment_id;
    insert into public.audit_log (action, entry_id, equipment_id, by_id, by_name, detail)
    values ('issue', new.id, new.equipment_id, auth.uid(), new.user_name, left(new.issues, 1000));
  end if;
  return new;
end;
$$;
drop trigger if exists log_entries_after on public.log_entries;
create trigger log_entries_after after insert or update on public.log_entries for each row execute procedure public.log_entries_after();

-- 장비 변경 이력
create or replace function public.equipment_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (action, equipment_id, by_id, by_name, detail) values ('equipment', old.id, auth.uid(), public.current_name(), '장비 삭제: ' || old.name);
    return old;
  end if;
  insert into public.audit_log (action, equipment_id, by_id, by_name, detail)
  values ('equipment', new.id, auth.uid(), public.current_name(), case when tg_op = 'INSERT' then '장비 추가: ' else '장비 수정: ' end || new.name);
  return new;
end;
$$;
drop trigger if exists equipment_audit on public.equipment;
create trigger equipment_audit after insert or update of name, location, manager_name, model, fields, rules, allow_concurrent, active or delete on public.equipment for each row execute procedure public.equipment_audit();

-- 점검 완료: 관리자 또는 장비 담당자(이름 일치)
create or replace function public.resolve_issue(p_equipment_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_eq record; v_me record;
begin
  select * into v_eq from public.equipment where id = p_equipment_id;
  if v_eq.id is null then raise exception '장비를 찾을 수 없습니다.'; end if;
  if v_eq.issue is null or coalesce((v_eq.issue ->> 'open')::boolean, false) = false then raise exception '처리할 이상 보고가 없습니다.'; end if;
  select * into v_me from public.profiles where id = auth.uid();
  if v_me.id is null or v_me.status <> 'active' then raise exception '로그인이 필요합니다.'; end if;
  if not v_me.is_admin and lower(replace(coalesce(v_me.name, ''), ' ', '')) <> lower(replace(v_eq.manager_name, ' ', '')) then
    raise exception '관리자 또는 장비 담당자(%)만 점검 완료 처리할 수 있습니다.', coalesce(nullif(v_eq.manager_name, ''), '미지정');
  end if;
  update public.equipment set issue = null where id = p_equipment_id;
  insert into public.audit_log (action, entry_id, equipment_id, by_id, by_name, detail)
  values ('resolve', nullif(v_eq.issue ->> 'entryId', '')::uuid, p_equipment_id, auth.uid(), coalesce(v_me.name, v_me.email),
          left('점검 완료: ' || coalesce(p_note, '') || ' (보고: ' || coalesce(v_eq.issue ->> 'note', '') || ')', 1000));
end;
$$;
revoke all on function public.resolve_issue(uuid, text) from public;
grant execute on function public.resolve_issue(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- log_entries RLS
-- ---------------------------------------------------------------------
alter table public.log_entries enable row level security;
drop policy if exists "entries: read" on public.log_entries;
create policy "entries: read" on public.log_entries for select to authenticated
  using (public.is_active() and (not deleted or public.is_admin()));
drop policy if exists "entries: insert own" on public.log_entries;
create policy "entries: insert own" on public.log_entries for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
drop policy if exists "entries: update own" on public.log_entries;
create policy "entries: update own" on public.log_entries for update to authenticated
  using (public.is_active() and user_id = auth.uid() and not deleted and (status = 'open' or created_at > now() - interval '7 days'))
  with check (user_id = auth.uid());
drop policy if exists "entries: admin update" on public.log_entries;
create policy "entries: admin update" on public.log_entries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- DELETE 정책 없음: 소프트 삭제(deleted = true)만 가능

-- ---------------------------------------------------------------------
-- security_events
-- ---------------------------------------------------------------------
create table if not exists public.security_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null,
  severity    text not null default 'low' check (severity in ('low', 'high')),
  name        text not null default '',
  detail      text not null default '',
  page        text not null default '',
  user_agent  text not null default '',
  user_id     uuid
);
create index if not exists security_events_created_idx on public.security_events (created_at desc);

create or replace function public.log_security_event(p_type text, p_severity text, p_name text, p_detail text, p_page text, p_user_agent text)
returns void language sql security definer set search_path = public as $$
  insert into public.security_events (type, severity, name, detail, page, user_agent, user_id)
  values (left(coalesce(p_type, 'other'), 40), case when p_severity = 'high' then 'high' else 'low' end, left(coalesce(p_name, ''), 80), left(coalesce(p_detail, ''), 400), left(coalesce(p_page, ''), 80), left(coalesce(p_user_agent, ''), 160), auth.uid());
$$;
revoke all on function public.log_security_event(text, text, text, text, text, text) from public;
grant execute on function public.log_security_event(text, text, text, text, text, text) to anon, authenticated;

alter table public.security_events enable row level security;
drop policy if exists "security: admin read" on public.security_events;
create policy "security: admin read" on public.security_events for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.log_entries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.equipment;   exception when duplicate_object then null; end $$;

-- (선택) 특정 도메인만 가입 허용: Dashboard > Authentication > Settings > "Restrict sign-ups to email domains" 에 kaist.ac.kr
