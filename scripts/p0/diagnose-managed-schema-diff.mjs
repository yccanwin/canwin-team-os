import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemporaryDbEnvironment, loadRestoreRun, runPsql } from './temporary-db-access.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const run = loadRestoreRun(repoRoot)
const query = `
select coalesce(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,
  'table',c.relname,
  'trigger',t.tgname,
  'functionSchema',pn.nspname,
  'functionName',p.proname,
  'definition',pg_get_triggerdef(t.oid,true),
  'functionMd5',md5(pg_get_functiondef(p.oid))
) order by n.nspname,c.relname,t.tgname),'[]'::jsonb)::text
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid=t.tgrelid
join pg_catalog.pg_namespace n on n.oid=c.relnamespace
join pg_catalog.pg_proc p on p.oid=t.tgfoid
join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace
where not t.tgisinternal and n.nspname in ('auth','storage');`
const collect = (projectRef) => JSON.parse(runPsql({
  psqlPath: run.toolchain.psql.path,
  pgEnvironment: getTemporaryDbEnvironment({
    cliPath: run.toolchain.supabaseCli.path,
    projectRef,
    connectionMode: 'session-pooler',
  }),
  sql: query,
}))
const source = collect(run.source.projectRef)
const target = collect(run.target.projectRef)
const key = (item) => `${item.schema}.${item.table}.${item.trigger}`
const targetByKey = new Map(target.map((item) => [key(item), item]))
const sourceByKey = new Map(source.map((item) => [key(item), item]))
const sourceOnly = source.filter((item) => !targetByKey.has(key(item)))
const targetOnly = target.filter((item) => !sourceByKey.has(key(item)))
const changed = source.filter((item) => {
  const other = targetByKey.get(key(item))
  return other && (item.definition !== other.definition || item.functionMd5 !== other.functionMd5)
})
console.log(JSON.stringify({
  sourceCount: source.length,
  targetCount: target.length,
  sourceOnly,
  targetOnly,
  changed,
  readOnly: true,
  businessRowsRead: false,
  writes: 'temporary-login-role-only',
}, null, 2))
