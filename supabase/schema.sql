-- Crono-Dia: esquema de base de datos para Supabase.
-- Pégalo completo en Supabase > SQL Editor > New query > Run. Se puede ejecutar más de una vez.
-- Cada fila pertenece a un usuario (user_id) y la seguridad por filas (RLS) solo le deja ver y cambiar las suyas.

-- Horario fijo: actividades que se repiten cada semana.
create table if not exists public.routines (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 100),
  scope       text not null check (scope in ('trabajo', 'personal')),
  start_time  time,
  end_time    time,
  days        smallint[] not null check (days <@ array[0,1,2,3,4,5,6]::smallint[]),  -- 0 = domingo ... 6 = sábado
  from_date   date not null default current_date,
  created_at  timestamptz not null default now()
);

-- Actividades de cada día.
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 100),
  scope       text not null check (scope in ('trabajo', 'personal')),
  date        date not null,
  start_time  time,
  end_time    time,
  done        boolean not null default false,
  done_at     timestamptz,
  skipped     boolean not null default false,   -- actividad fija que quitaste solo de ese día
  carried     boolean not null default false,   -- pasada desde otro día
  routine_id  uuid references public.routines (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- una actividad fija solo se crea una vez por día (los NULL no cuentan, así que las manuales no chocan)
  unique (user_id, routine_id, date)
);
create index if not exists tasks_user_date_idx on public.tasks (user_id, date);

-- Cierre del día: nota y marca de "ya revisé lo que no cumplí".
create table if not exists public.days (
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date      date not null,
  note      text not null default '' check (char_length(note) <= 400),
  reviewed  boolean not null default false,
  primary key (user_id, date)
);

-- Aviso para planificar.
create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  plan_mode  text not null default 'pm' check (plan_mode in ('am', 'pm')),
  plan_time  time not null default '23:00'
);

-- Seguridad por filas: cada usuario solo accede a lo suyo.
alter table public.routines enable row level security;
alter table public.tasks    enable row level security;
alter table public.days     enable row level security;
alter table public.settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['routines', 'tasks', 'days', 'settings'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Sincronización en vivo entre celular y computadora.
do $$
declare t text;
begin
  foreach t in array array['routines', 'tasks', 'days', 'settings'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
