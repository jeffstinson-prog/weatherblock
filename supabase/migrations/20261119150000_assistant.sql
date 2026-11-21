-- The assistant: questions people ask, kept 30 days, so the owners can see
-- what the help center doesn't answer yet.

create table wb.assistant_questions (
  id bigint generated always as identity primary key,
  asked_at timestamptz not null default now(),
  question text not null check (length(question) <= 1000),
  answered boolean not null,
  blocked_rule text check (length(blocked_rule) <= 40),
  help_slugs text[] not null default '{}'
);
create index assistant_questions_at on wb.assistant_questions (asked_at);

alter table wb.assistant_questions enable row level security;
create policy owners_only on wb.assistant_questions for all to authenticated using (wb.is_owner()) with check (wb.is_owner());
grant select, delete on wb.assistant_questions to authenticated;
grant select, insert, delete on wb.assistant_questions to service_role;

create function wb_api.log_question(p_question text, p_answered boolean, p_blocked text, p_slugs text[]) returns void
language sql security definer set search_path = '' as $$
  insert into wb.assistant_questions (question, answered, blocked_rule, help_slugs)
  values (left(p_question, 1000), p_answered, left(p_blocked, 40), coalesce(p_slugs[1:3], '{}'))
$$;
revoke all on function wb_api.log_question(text, boolean, text, text[]) from public;
grant execute on function wb_api.log_question(text, boolean, text, text[]) to anon, authenticated, service_role;

-- Clean-up now also forgets assistant questions after 30 days.
create or replace function wb.cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gate integer;
  rates integer;
  questions integer;
begin
  gate := wb.purge_gate_codes();
  delete from wb.rate_events where at < now() - interval '1 day';
  get diagnostics rates = row_count;
  delete from wb.assistant_questions where asked_at < now() - interval '30 days';
  get diagnostics questions = row_count;
  return jsonb_build_object('gate_codes', gate, 'rate_events', rates, 'assistant_questions', questions);
end $$;
