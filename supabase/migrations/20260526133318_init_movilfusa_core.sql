-- Core schema for MovilFusa.

create extension if not exists pgcrypto;

do $$
begin
	if not exists (select 1 from pg_type where typname = 'app_role') then
		create type public.app_role as enum ('client', 'driver', 'admin');
	end if;

	if not exists (select 1 from pg_type where typname = 'service_type') then
		create type public.service_type as enum ('pasajero', 'encomienda');
	end if;

	if not exists (select 1 from pg_type where typname = 'trip_status') then
		create type public.trip_status as enum (
			'PENDING',
			'CONDUCTOR_EN_CAMINO',
			'EN_VIAJE',
			'FINALIZADO',
			'CANCELADO'
		);
	end if;
end
$$;

create table if not exists public.profiles (
	id uuid primary key references auth.users(id) on delete cascade,
	role public.app_role not null,
	name text not null,
	phone text,
	avatar_url text,
	deleted_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.driver_profiles (
	user_id uuid primary key references public.profiles(id) on delete cascade,
	vehicle text not null,
	plate text not null,
	is_available boolean not null default true,
	last_lat double precision,
	last_lng double precision,
	last_seen_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint driver_profiles_plate_unique unique (plate)
);

create table if not exists public.trips (
	id uuid primary key default gen_random_uuid(),
	client_id uuid not null references public.profiles(id) on delete restrict,
	driver_id uuid references public.profiles(id) on delete set null,
	origin_name text not null,
	origin_lat double precision not null,
	origin_lng double precision not null,
	destination_name text not null,
	destination_lat double precision not null,
	destination_lng double precision not null,
	fare numeric(10,2) not null check (fare > 0),
	service_type public.service_type not null,
	package_notes text,
	status public.trip_status not null default 'PENDING',
	accepted_at timestamptz,
	started_at timestamptz,
	finished_at timestamptz,
	cancelled_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table if not exists public.trip_locations (
	id bigint generated always as identity primary key,
	trip_id uuid not null references public.trips(id) on delete cascade,
	driver_id uuid not null references public.profiles(id) on delete restrict,
	lat double precision not null,
	lng double precision not null,
	created_at timestamptz not null default now()
);

create table if not exists public.trip_ratings (
	id bigint generated always as identity primary key,
	trip_id uuid not null unique references public.trips(id) on delete cascade,
	client_id uuid not null references public.profiles(id) on delete restrict,
	stars smallint not null check (stars between 1 and 5),
	message text,
	created_at timestamptz not null default now()
);

create index if not exists idx_trips_status_created_at on public.trips(status, created_at desc);
create index if not exists idx_trips_client_id_created_at on public.trips(client_id, created_at desc);
create index if not exists idx_trips_driver_id_created_at on public.trips(driver_id, created_at desc);
create index if not exists idx_trip_locations_trip_id_created_at on public.trip_locations(trip_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_driver_profiles_updated_at on public.driver_profiles;
create trigger trg_driver_profiles_updated_at
before update on public.driver_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_trips_updated_at on public.trips;
create trigger trg_trips_updated_at
before update on public.trips
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_locations enable row level security;
alter table public.trip_ratings enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists driver_profiles_select_all on public.driver_profiles;
create policy driver_profiles_select_all
on public.driver_profiles
for select
to authenticated
using (true);

drop policy if exists driver_profiles_insert_own on public.driver_profiles;
create policy driver_profiles_insert_own
on public.driver_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists driver_profiles_update_own on public.driver_profiles;
create policy driver_profiles_update_own
on public.driver_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists trips_select_related on public.trips;
create policy trips_select_related
on public.trips
for select
to authenticated
using (
	auth.uid() = client_id
	or auth.uid() = driver_id
	or status = 'PENDING'
);

drop policy if exists trips_insert_client on public.trips;
create policy trips_insert_client
on public.trips
for insert
to authenticated
with check (auth.uid() = client_id);

drop policy if exists trips_update_client_cancel on public.trips;
create policy trips_update_client_cancel
on public.trips
for update
to authenticated
using (auth.uid() = client_id)
with check (auth.uid() = client_id);

drop policy if exists trips_update_driver_assigned on public.trips;
create policy trips_update_driver_assigned
on public.trips
for update
to authenticated
using (auth.uid() = driver_id or (status = 'PENDING' and driver_id is null))
with check (auth.uid() = driver_id);

drop policy if exists trip_locations_select_related on public.trip_locations;
create policy trip_locations_select_related
on public.trip_locations
for select
to authenticated
using (
	exists (
		select 1
		from public.trips t
		where t.id = trip_locations.trip_id
			and (t.client_id = auth.uid() or t.driver_id = auth.uid())
	)
);

drop policy if exists trip_locations_insert_driver on public.trip_locations;
create policy trip_locations_insert_driver
on public.trip_locations
for insert
to authenticated
with check (
	auth.uid() = driver_id
	and exists (
		select 1
		from public.trips t
		where t.id = trip_locations.trip_id
			and t.driver_id = auth.uid()
			and t.status = 'EN_VIAJE'
	)
);

drop policy if exists trip_ratings_select_related on public.trip_ratings;
create policy trip_ratings_select_related
on public.trip_ratings
for select
to authenticated
using (
	exists (
		select 1
		from public.trips t
		where t.id = trip_ratings.trip_id
			and (t.client_id = auth.uid() or t.driver_id = auth.uid())
	)
);

drop policy if exists trip_ratings_insert_client on public.trip_ratings;
create policy trip_ratings_insert_client
on public.trip_ratings
for insert
to authenticated
with check (
	auth.uid() = client_id
	and exists (
		select 1
		from public.trips t
		where t.id = trip_ratings.trip_id
			and t.client_id = auth.uid()
			and t.status = 'FINALIZADO'
	)
);
