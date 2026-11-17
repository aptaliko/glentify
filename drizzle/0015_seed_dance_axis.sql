-- Registers the Χορός (dance) classification axis. The axis row was previously created only by
-- scripts/seed-axis-types.ts (run by dev:up), so databases created before that never got it:
-- the song editor lists axis_types, so Χορός could not be picked there. Idempotent.
insert into "axis_types" ("key", "label", "lookup_table", "hierarchical")
values ('dance', 'Χορός', 'dances', false)
on conflict ("key") do nothing;
