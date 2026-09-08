-- =====================================================================
-- DSIL Run Sheet – 공정 런시트 스키마 (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
-- 사용법
--   1. https://supabase.com 에서 새 프로젝트 생성 (Free tier 충분)
--   2. SQL Editor 에 이 파일 전체를 붙여 넣고 Run (여러 번 실행해도 안전)
--   3. Storage 에 public 버킷 "run-photos" 생성 (스텝 사진). 아래 storage 정책 블록 참고
--   4. Project Settings > API 의 URL 과 anon key 를 assets/js/config.js 에 입력, backend: 'supabase'
--
-- 로그인이 없는 앱입니다. anon 키로 읽고 쓰므로 "주소 + anon 키를 아는 사람 = 사용자" 입니다.
-- 연구실 내부용으로만 쓰고, 외부에 주소를 알리지 마세요. run_logs(변경 이력)는 추가만 됩니다.
--
-- 구조
--   modules  : 공정 모듈. domain(device|package), fields(JSON) = 조건 항목 정의, checklist(JSON)
--   flows    : 공정 흐름. items(JSON) = [{kind:'module'|'flow', refId, label, note, params} | {kind:'split', name, branches:[{id,name,count,items}]}]
--   runs     : 런. team/owner/domain, 기판 라벨·수량·이름, tree(JSON: 스텝 참조·분기점), steps(JSON: 스텝 전체)
--   run_logs : 변경 이력 (작업 로그 + 시트 수정). who/team/date 로 이력 페이지에서 묶어 봄. 추가만.
-- =====================================================================

create extension if not exists "pgcrypto";

-- 계정: 이름 + PIN(SHA-256 해시). 권한 검사는 브라우저에서 하므로 내부용. 관리자 계정은 앱이 처음 실행될 때 만듭니다.
create table if not exists public.accounts (
  id           text primary key,
  name         text not null,
  team         text not null default '',
  pin_hash     text not null,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now()
);
create unique index if not exists accounts_name_key on public.accounts (lower(replace(name, ' ', '')));
alter table public.accounts enable row level security;
drop policy if exists "accounts: all" on public.accounts;
create policy "accounts: all" on public.accounts for all to anon, authenticated using (true) with check (true);

create table if not exists public.modules (
  id           text primary key,
  domain       text not null default 'device',
  name         text not null,
  category     text not null default 'etc',
  equipment    text not null default '',
  description  text not null default '',
  minutes      integer not null default 0,
  fields       jsonb not null default '[]'::jsonb,
  checklist    jsonb not null default '[]'::jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.modules add column if not exists domain text not null default 'device';

create table if not exists public.flows (
  id           text primary key,
  domain       text not null default 'device',
  name         text not null,
  device       text not null default '',
  description  text not null default '',
  unit_label   text not null default '기판',
  unit_count   integer not null default 1,
  items        jsonb not null default '[]'::jsonb,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.flows add column if not exists domain text not null default 'device';
alter table public.flows add column if not exists unit_label text not null default '기판';
alter table public.flows add column if not exists unit_count integer not null default 1;

create table if not exists public.runs (
  id           text primary key,
  code         text not null,
  domain       text not null default 'device',
  team         text not null default '',
  owner        text not null default '',
  title        text not null,
  flow_id      text,
  flow_name    text not null default '',
  sample       text not null default '',
  substrate    text not null default '',
  goal         text not null default '',
  note         text not null default '',
  unit_label   text not null default '기판',
  unit_count   integer not null default 1,
  units        jsonb not null default '[]'::jsonb,
  tree         jsonb not null default '[]'::jsonb,
  steps        jsonb not null default '[]'::jsonb,
  status       text not null default 'active' check (status in ('active', 'paused', 'done', 'aborted')),
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.runs add column if not exists domain text not null default 'device';
alter table public.runs add column if not exists team text not null default '';
alter table public.runs add column if not exists unit_label text not null default '기판';
alter table public.runs add column if not exists unit_count integer not null default 1;
alter table public.runs add column if not exists units jsonb not null default '[]'::jsonb;
alter table public.runs add column if not exists tree jsonb not null default '[]'::jsonb;
alter table public.runs add column if not exists owner_id text;
alter table public.runs add column if not exists archived boolean not null default false;
alter table public.runs add column if not exists archived_at timestamptz;
create index if not exists runs_owner_idx on public.runs (owner_id, updated_at desc);
create index if not exists runs_archived_idx on public.runs (archived, archived_at desc);
-- 라이브러리 소유·잠금: seed = 기본 제공(수정·삭제 불가), owner_id = 만든 계정
alter table public.modules add column if not exists seed boolean not null default false;
alter table public.modules add column if not exists owner_id text;
alter table public.modules add column if not exists owner_name text not null default '';
alter table public.flows add column if not exists seed boolean not null default false;
alter table public.flows add column if not exists owner_id text;
alter table public.flows add column if not exists owner_name text not null default '';
create index if not exists runs_status_idx on public.runs (status, updated_at desc);
create index if not exists runs_team_idx on public.runs (team, domain);
create unique index if not exists runs_code_key on public.runs (code);

create table if not exists public.run_logs (
  id           text primary key,
  run_id       text not null references public.runs (id) on delete cascade,
  step_id      text,
  seq          integer,
  step_name    text not null default '',
  branch       text not null default '',
  who          text not null default '',
  team         text not null default '',
  action       text not null,
  detail       text not null default '',
  date         date,
  created_at   timestamptz not null default now()
);
alter table public.run_logs add column if not exists branch text not null default '';
alter table public.run_logs add column if not exists team text not null default '';
alter table public.run_logs add column if not exists date date;
create index if not exists run_logs_run_idx on public.run_logs (run_id, created_at desc);
create index if not exists run_logs_created_idx on public.run_logs (created_at desc);
create index if not exists run_logs_team_idx on public.run_logs (team, who, date);

-- ---------------------------------------------------------------------
-- RLS: anon / authenticated 모두 읽기·쓰기 (로그인 없는 내부 도구). 이력은 삭제·수정 불가.
-- ---------------------------------------------------------------------
alter table public.modules  enable row level security;
alter table public.flows    enable row level security;
alter table public.runs     enable row level security;
alter table public.run_logs enable row level security;

drop policy if exists "modules: all" on public.modules;
create policy "modules: all" on public.modules for all to anon, authenticated using (true) with check (true);
drop policy if exists "flows: all" on public.flows;
create policy "flows: all" on public.flows for all to anon, authenticated using (true) with check (true);
drop policy if exists "runs: all" on public.runs;
create policy "runs: all" on public.runs for all to anon, authenticated using (true) with check (true);
drop policy if exists "logs: read" on public.run_logs;
create policy "logs: read" on public.run_logs for select to anon, authenticated using (true);
drop policy if exists "logs: insert" on public.run_logs;
create policy "logs: insert" on public.run_logs for insert to anon, authenticated with check (true);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists modules_touch on public.modules;
create trigger modules_touch before update on public.modules for each row execute procedure public.touch_updated_at();
drop trigger if exists flows_touch on public.flows;
create trigger flows_touch before update on public.flows for each row execute procedure public.touch_updated_at();
drop trigger if exists runs_touch on public.runs;
create trigger runs_touch before update on public.runs for each row execute procedure public.touch_updated_at();

do $$ begin alter publication supabase_realtime add table public.runs;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.modules; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.flows;   exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Storage (스텝 사진): Dashboard > Storage > New bucket "run-photos" (Public bucket 체크) 를 만든 뒤 아래를 실행
-- ---------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('run-photos', 'run-photos', true) on conflict (id) do nothing;
-- drop policy if exists "run-photos: read" on storage.objects;
-- create policy "run-photos: read"   on storage.objects for select to anon, authenticated using (bucket_id = 'run-photos');
-- drop policy if exists "run-photos: write" on storage.objects;
-- create policy "run-photos: write"  on storage.objects for insert to anon, authenticated with check (bucket_id = 'run-photos');
-- drop policy if exists "run-photos: delete" on storage.objects;
-- create policy "run-photos: delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'run-photos');
