# G2 performance fixture chain

This fixture is restricted to the independent Team OS 4.0 project
`jgcrhoabvaowxnqksvkq` and one explicit `g2-*` run id.

1. A trusted server uses Supabase Auth Admin `createUser` to create exactly
   30 users. Each user must carry the three `raw_app_meta_data` markers listed
   in `setup.sql`. Use run-scoped addresses under a non-operating test domain;
   never reuse the five permanent G1 acceptance accounts.
2. Execute `setup.sql` once with the returned 30 UUIDs. The database rejects
   existing profiles, wrong project/run metadata, duplicates, and any count
   other than 30. One transaction creates exactly 100000 `g2_performance`
   work items and the private run manifest.
3. Run the authorized performance acceptance once.
4. Execute `cleanup.sql`. It deletes only rows whose company, source class,
   generation rule, profile ids, and manifest all match the run. A mismatch
   aborts the transaction without partial cleanup.
5. From the cleanup result, a trusted server calls Auth Admin `deleteUser` for
   exactly those 30 UUIDs. Re-read Auth Admin afterward and require all 30 to
   be absent. If Auth deletion fails, preserve the cleaned manifest and stop;
   a later separately authorized cleanup may reuse its returned UUID list.

The SQL deliberately never inserts into or deletes from `auth.users`.
