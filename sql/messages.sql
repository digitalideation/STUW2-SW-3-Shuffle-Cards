create table messages (
  id uuid default gen_random_uuid() primary key,
  username text not null,
  text text not null,
  created_at timestamp with time zone default now()
);