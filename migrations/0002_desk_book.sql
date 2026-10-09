create table if not exists desk_book (
  id int primary key,
  book jsonb not null,
  updated_at timestamptz not null default now()
);
