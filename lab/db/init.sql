create table if not exists contas (
  conta          text primary key,
  saldo_inicial  numeric(14,2) not null,
  criado_em      timestamptz not null default now()
);

create table if not exists lancamentos (
  id         bigserial primary key,
  conta      text not null references contas(conta),
  data       date not null,
  descricao  text not null,
  valor      numeric(14,2) not null
);

create index if not exists ix_lancamentos_conta_data on lancamentos (conta, data desc);

-- abertura de conta e cartões de crédito (também criadas pelo core na subida, para volumes já existentes)
create table if not exists aberturas (
  id         bigserial primary key,
  conta      text not null references contas(conta),
  nome       text not null,
  cpf        text not null,
  email      text,
  renda      numeric(14,2),
  documento  text,
  status     text not null,
  criado_em  timestamptz not null default now()
);

create table if not exists cartoes (
  id         bigserial primary key,
  conta      text not null references contas(conta),
  tipo       text not null,
  renda      numeric(14,2) not null,
  limite     numeric(14,2),
  status     text not null,
  motivo     text,
  criado_em  timestamptz not null default now()
);
