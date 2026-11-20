-- Public-to-authenticated aggregate only; does not expose registrant identities.
begin;
create or replace view public.event_capacity_counts as
select event_id,coalesce(sum(people_count),0)::integer as registered_people
from public.event_registrations
where status='registered'
group by event_id;
grant select on public.event_capacity_counts to authenticated;
commit;
