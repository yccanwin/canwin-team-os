import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createProtectedKey,
  decryptBuffer,
  encryptBuffer,
  getStoragePolicySql,
  packDirectory,
  readProtectedKey,
  sha256,
  unpackDirectoryBundle,
} from './sealed-recovery-lib.mjs'
import { loadRestoreRun, runExternal, runPgTool, runPsql } from './temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const skipLocalPostgres = process.argv.includes('--skip-local-postgres')
const run = loadRestoreRun(repoRoot)
const pgBin = dirname(run.toolchain.pgDump.path)
const paths = {
  initdb: resolve(pgBin, 'initdb.exe'),
  pgCtl: resolve(pgBin, 'pg_ctl.exe'),
  psql: run.toolchain.psql.path,
  pgDump: run.toolchain.pgDump.path,
  pgDumpAll: resolve(pgBin, 'pg_dumpall.exe'),
  createdb: resolve(pgBin, 'createdb.exe'),
}
const workRoot = 'D:\\CanWin-Team-OS-4.0-Recovery-Preflight'
const keyRoot = 'E:\\CanWin-Team-OS-4.0-Recovery-Keys-Preflight'
mkdirSync(workRoot, { recursive: true })
mkdirSync(keyRoot, { recursive: true })
const workdir = mkdtempSync(resolve(workRoot, '.runtime-'))
const keyPath = resolve(keyRoot, `self-test-${process.pid}-${Date.now()}.dpapi`)
const dataDirectory = resolve(workdir, 'postgres-data')
const port = 56000 + Math.floor(Math.random() * 500)
const pgBase = { PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'postgres', PGPASSWORD: '', PGSSLMODE: 'disable' }
let serverStarted = false
let key

try {
  key = createProtectedKey({ repoRoot, keyPath })
  const recovered = readProtectedKey({ repoRoot, keyPath })
  if (!key.equals(recovered)) throw new Error('DPAPI recovery key roundtrip failed')
  const plaintext = Buffer.from('CanWin Team OS 4.0 sealed recovery self-test', 'utf8')
  const encrypted = encryptBuffer(plaintext, recovered)
  if (!decryptBuffer(encrypted, key).equals(plaintext)) throw new Error('AES-GCM artifact roundtrip failed')
  const tampered = Buffer.from(encrypted)
  tampered[tampered.length - 1] ^= 1
  let tamperRejected = false
  try { decryptBuffer(tampered, key) } catch { tamperRejected = true }
  if (!tamperRejected) throw new Error('AES-GCM tamper detection failed')

  const bundleSource = resolve(workdir, 'bundle-source')
  const bundleTarget = resolve(workdir, 'bundle-target')
  mkdirSync(resolve(bundleSource, 'nested'), { recursive: true })
  mkdirSync(bundleTarget, { recursive: true })
  writeFileSync(resolve(bundleSource, 'nested', 'evidence.txt'), plaintext, { flag: 'wx' })
  const bundle = packDirectory(bundleSource)
  unpackDirectoryBundle(bundle, bundleTarget)
  if (sha256(readFileSync(resolve(bundleTarget, 'nested', 'evidence.txt'))) !== sha256(plaintext)) {
    throw new Error('directory bundle roundtrip failed')
  }

  if (skipLocalPostgres) {
    console.log('[p0:sealed-runtime] READY crypto=PASS dpapi=PASS tamper=PASS bundle=PASS syntheticRestore=SKIPPED reason=owner-authorized-windows-account-encoding secretsPrinted=0 writes=local-only')
  } else {
  runExternal({
    commandPath: paths.initdb,
    args: ['--pgdata', dataDirectory, '--username=postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'],
    timeout: 120000,
    env: {
      ...process.env,
      LANG: 'C',
      LC_ALL: 'C',
      USER: 'canwin_recovery',
      USERNAME: 'canwin_recovery',
    },
  })
  runExternal({
    commandPath: paths.pgCtl,
    args: ['--pgdata', dataDirectory, '--wait', '--timeout=30', '--options', `-h 127.0.0.1 -p ${port}`, 'start'],
    timeout: 60000,
  })
  serverStarted = true
  const postgresEnv = { ...pgBase, PGDATABASE: 'postgres' }
  runExternal({ commandPath: paths.createdb, args: ['canwin_source'], env: { ...process.env, ...postgresEnv } })
  runExternal({ commandPath: paths.createdb, args: ['canwin_target'], env: { ...process.env, ...postgresEnv } })
  const sourceEnv = { ...pgBase, PGDATABASE: 'canwin_source' }
  const targetEnv = { ...pgBase, PGDATABASE: 'canwin_target' }
  runPsql({
    psqlPath: paths.psql,
    pgEnvironment: sourceEnv,
    sql: `
      create schema auth;
      create schema storage;
      create schema supabase_migrations;
      create table auth.users(id text primary key,email text,encrypted_password text,banned_until timestamptz);
      create table auth.identities(id text primary key,user_id text not null references auth.users(id),provider text);
      create table storage.objects(id text primary key,name text);
      alter table storage.objects enable row level security;
      create policy "sealed test read" on storage.objects for select to public using (true);
      create table supabase_migrations.schema_migrations(version text primary key);
      create table public.sample(id integer primary key,user_id text references auth.users(id),amount numeric(14,2));
      insert into auth.users values('u1','owner@example.invalid','hash',null);
      insert into auth.identities values('i1','u1','email');
      insert into public.sample values(1,'u1',12.34);
      insert into supabase_migrations.schema_migrations values('20260719000000');
    `,
  })
  runPsql({
    psqlPath: paths.psql,
    pgEnvironment: targetEnv,
    sql: `
      create schema auth;
      create schema storage;
      create schema supabase_migrations;
      create table auth.users(id text primary key,email text,encrypted_password text,banned_until timestamptz);
      create table auth.identities(id text primary key,user_id text not null references auth.users(id),provider text);
      create table storage.objects(id text primary key,name text);
      alter table storage.objects enable row level security;
      create table supabase_migrations.schema_migrations(version text primary key);
    `,
  })

  const files = Object.fromEntries(['auth', 'schema', 'data', 'migrations', 'policies', 'pre', 'post'].map((name) => [name, resolve(workdir, `${name}.sql`)]))
  runPgTool({ commandPath: paths.pgDumpAll, pgEnvironment: sourceEnv, args: ['--roles-only', '--no-role-passwords', '--no-privileges', '--no-comments', '--role=postgres', '--file', resolve(workdir, 'roles.sql')] })
  runPgTool({ commandPath: paths.pgDump, pgEnvironment: sourceEnv, args: ['--schema=auth', '--table=auth.users', '--table=auth.identities', '--data-only', '--column-inserts', '--disable-triggers', '--no-owner', '--no-privileges', '--role=postgres', '--file', files.auth] })
  runPgTool({ commandPath: paths.pgDump, pgEnvironment: sourceEnv, args: ['--schema=public', '--schema-only', '--no-owner', '--no-privileges', '--no-comments', '--role=postgres', '--file', files.schema] })
  let schema = readFileSync(files.schema, 'utf8')
  if ((schema.match(/CREATE SCHEMA public;/g) ?? []).length !== 1) throw new Error('pg_dump public schema shape is unsupported')
  schema = schema.replace('CREATE SCHEMA public;', 'CREATE SCHEMA IF NOT EXISTS public;').replace(/^ALTER SCHEMA public OWNER TO .*;\r?\n/gm, '')
  writeFileSync(files.schema, schema)
  runPgTool({ commandPath: paths.pgDump, pgEnvironment: sourceEnv, args: ['--schema=public', '--data-only', '--inserts', '--rows-per-insert=100', '--disable-triggers', '--no-owner', '--no-privileges', '--role=postgres', '--file', files.data] })
  runPgTool({ commandPath: paths.pgDump, pgEnvironment: sourceEnv, args: ['--schema=supabase_migrations', '--data-only', '--inserts', '--rows-per-insert=100', '--disable-triggers', '--no-owner', '--no-privileges', '--role=postgres', '--file', files.migrations] })
  writeFileSync(files.policies, getStoragePolicySql({ psqlPath: paths.psql, pgEnvironment: sourceEnv }), { flag: 'wx' })
  writeFileSync(files.pre, 'set role postgres;\nset session_replication_role = replica;\n', { flag: 'wx' })
  writeFileSync(files.post, "update auth.users set banned_until=now()+interval '100 years';\nset session_replication_role=origin;\n", { flag: 'wx' })
  runPgTool({
    commandPath: paths.psql,
    pgEnvironment: targetEnv,
    args: ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', files.pre, '--file', files.auth, '--file', files.schema, '--file', files.data, '--file', files.migrations, '--file', files.policies, '--file', files.post],
  })
  const result = runPsql({
    psqlPath: paths.psql,
    pgEnvironment: targetEnv,
    sql: `select concat((select count(*) from public.sample),'|',(select count(*) from auth.users where banned_until>now()+interval '99 years'),'|',(select count(*) from auth.identities),'|',(select count(*) from supabase_migrations.schema_migrations),'|',(select count(*) from pg_policies where schemaname='storage'));`,
  })
  if (result !== '1|1|1|1|1') throw new Error('synthetic single-transaction restore did not reconcile')
  console.log(`[p0:sealed-runtime] READY crypto=PASS dpapi=PASS tamper=PASS bundle=PASS syntheticRestore=PASS port=${port} secretsPrinted=0 writes=local-only`)
  }
} finally {
  if (key) key.fill(0)
  if (serverStarted) {
    try {
      runExternal({ commandPath: paths.pgCtl, args: ['--pgdata', dataDirectory, '--wait', '--timeout=30', 'stop'], timeout: 60000 })
    } catch {
      console.error('[p0:sealed-runtime] WARNING local PostgreSQL self-test server did not stop cleanly')
    }
  }
  const resolvedWorkdir = resolve(workdir)
  if (!resolvedWorkdir.startsWith(resolve(workRoot) + '\\')) throw new Error('unsafe self-test cleanup path')
  rmSync(resolvedWorkdir, { recursive: true, force: true })
  const resolvedKeyPath = resolve(keyPath)
  if (!resolvedKeyPath.startsWith(resolve(keyRoot) + '\\')) throw new Error('unsafe key cleanup path')
  rmSync(resolvedKeyPath, { force: true })
}
