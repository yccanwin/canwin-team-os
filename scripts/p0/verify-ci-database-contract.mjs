import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'ci-database-test-contract.json')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const contract = readJson(contractPath)
const clone = (value) => structuredClone(value)
const normalizeLf = (value) => value.replace(/\r\n?/g, '\n')
const normalizeDefinitionText = (value) => value.toLowerCase().replace(/\s+/g, '')
  .replace(/setsearch_path(?:to|=)/g, 'setsearch_path=')
  .replace(/(\d+):00:00/g, '$1hours')
const sha256Lf = (path) => createHash('sha256').update(normalizeLf(readFileSync(path, 'utf8')), 'utf8').digest('hex')
const exactSet = (actual, expected) =>
  Array.isArray(actual) && actual.length === new Set(actual).size &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const expectedCategories = { database: 7, permission: 11, business: 9 }
const expectedCatalog = { publicTables: 103, publicRoutines: 168, publicViews: 11, storageBuckets: 1 }
const expectedCrmLeadsVisibleColumns = [
  'id', 'read_scope', 'store_name', 'contact_name', 'masked_phone', 'district_name',
  'business_type', 'source', 'created_at', 'next_action_at', 'stage', 'facts',
  'lead_status', 'owner_display_name', 'claimable', 'active_opportunity_id',
  'recycle_risk', 'recycle_due_at', 'recycle_paused', 'address',
]
const expectedCrmLeadsVisibleColumnAssertionFiles = new Set([
  'supabase/tests/crm_core.sql',
  'supabase/tests/sales_automation.sql',
])
const expectedRollbackFixtures = new Set([
  'supabase/tests/access_control_foundation.sql',
  'supabase/tests/customer_import_behavior.sql',
  'supabase/tests/hardware_inventory_behavior.sql',
  'supabase/tests/hardware_shipping_chain_behavior.sql',
  'supabase/tests/team_os_4_p1_access_shell.sql',
])
const allowedModes = new Set(['read_only', 'rollback_fixture'])
const forbiddenSqlBoundary = /(?:^|\W)(?:dblink_connect|postgres_fdw|postgresql_fdw|http_get|http_post|net\.http_)(?:\W|$)/i
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function splitSqlStatements(sql) {
  const statements = []
  let start = 0
  let index = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let blockCommentDepth = 0
  let dollarTag = null

  while (index < sql.length) {
    if (inLineComment) {
      if (sql[index] === '\n') inLineComment = false
      index += 1
      continue
    }
    if (blockCommentDepth > 0) {
      if (sql.startsWith('/*', index)) {
        blockCommentDepth += 1
        index += 2
      } else if (sql.startsWith('*/', index)) {
        blockCommentDepth -= 1
        index += 2
      } else index += 1
      continue
    }
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length
        dollarTag = null
      } else index += 1
      continue
    }
    if (inSingleQuote) {
      if (sql[index] === "'" && sql[index + 1] === "'") index += 2
      else if (sql[index] === '\\') index += Math.min(2, sql.length - index)
      else {
        if (sql[index] === "'") inSingleQuote = false
        index += 1
      }
      continue
    }
    if (inDoubleQuote) {
      if (sql[index] === '"' && sql[index + 1] === '"') index += 2
      else {
        if (sql[index] === '"') inDoubleQuote = false
        index += 1
      }
      continue
    }

    if (sql.startsWith('--', index)) {
      inLineComment = true
      index += 2
    } else if (sql.startsWith('/*', index)) {
      blockCommentDepth = 1
      index += 2
    } else if (sql[index] === "'") {
      inSingleQuote = true
      index += 1
    } else if (sql[index] === '"') {
      inDoubleQuote = true
      index += 1
    } else if (sql[index] === '$') {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (match) {
        dollarTag = match[0]
        index += dollarTag.length
      } else index += 1
    } else if (sql[index] === ';') {
      const statement = sql.slice(start, index + 1).trim()
      if (statement) statements.push(statement)
      index += 1
      start = index
    } else index += 1
  }

  const trailing = sql.slice(start).trim()
  if (trailing) statements.push(trailing)
  return statements
}

function stripLeadingSqlTrivia(statement) {
  let index = 0
  while (index < statement.length) {
    while (/\s/.test(statement[index] ?? '')) index += 1
    if (statement.startsWith('--', index)) {
      const newline = statement.indexOf('\n', index + 2)
      index = newline < 0 ? statement.length : newline + 1
      continue
    }
    if (statement.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < statement.length && depth > 0) {
        if (statement.startsWith('/*', index)) {
          depth += 1
          index += 2
        } else if (statement.startsWith('*/', index)) {
          depth -= 1
          index += 2
        } else index += 1
      }
      continue
    }
    break
  }
  return statement.slice(index)
}

function splitSqlCommaList(value) {
  const entries = []
  let start = 0
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (inSingleQuote) {
      if (character === "'" && value[index + 1] === "'") index += 1
      else if (character === "'") inSingleQuote = false
      continue
    }
    if (inDoubleQuote) {
      if (character === '"' && value[index + 1] === '"') index += 1
      else if (character === '"') inDoubleQuote = false
      continue
    }
    if (character === "'") inSingleQuote = true
    else if (character === '"') inDoubleQuote = true
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (character === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const trailing = value.slice(start).trim()
  if (trailing) entries.push(trailing)
  return entries
}

function findDirectInsertColumns(sql, qualifiedTable) {
  const insertPattern = new RegExp(
    `^insert\\s+into\\s+${escapeRegex(qualifiedTable)}\\s*\\(([\\s\\S]*?)\\)\\s*(?:values|select)\\b`,
    'i',
  )
  return splitSqlStatements(sql).flatMap((statement) => {
    const match = stripLeadingSqlTrivia(statement).match(insertPattern)
    if (!match) return []
    return [{
      statement,
      columns: splitSqlCommaList(match[1]).map((column) => column.trim().replace(/^"|"$/g, '').toLowerCase()),
    }]
  })
}

const directDealOrderInsertProbeValid = findDirectInsertColumns(
  "insert into public.deal_orders(id,team_id,order_number) values('1','T','CW-1');",
  'public.deal_orders',
)
const directDealOrderInsertProbeInvalid = findDirectInsertColumns(
  "insert into public.deal_orders(id,team_id) values('1','T');",
  'public.deal_orders',
)
const directDealOrderInsertProbePassed =
  directDealOrderInsertProbeValid.length === 1 &&
  directDealOrderInsertProbeValid[0].columns.includes('order_number') &&
  directDealOrderInsertProbeInvalid.length === 1 &&
  !directDealOrderInsertProbeInvalid[0].columns.includes('order_number')

function stripFunctionParameterDefault(value) {
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (inSingleQuote) {
      if (character === "'" && value[index + 1] === "'") index += 1
      else if (character === "'") inSingleQuote = false
      continue
    }
    if (inDoubleQuote) {
      if (character === '"' && value[index + 1] === '"') index += 1
      else if (character === '"') inDoubleQuote = false
      continue
    }
    if (character === "'") inSingleQuote = true
    else if (character === '"') inDoubleQuote = true
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (depth === 0 && character === '=') return value.slice(0, index).trim()
    else if (depth === 0 && /^default\b/i.test(value.slice(index))
      && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trim()
  }
  return value.trim()
}

const functionTypeLeadTokens = new Set([
  'bigint', 'bigserial', 'bit', 'boolean', 'box', 'bytea', 'character', 'cidr', 'circle',
  'date', 'decimal', 'double', 'inet', 'integer', 'interval', 'json', 'jsonb', 'line',
  'lseg', 'macaddr', 'money', 'numeric', 'path', 'pg_lsn', 'point', 'polygon', 'real',
  'smallint', 'smallserial', 'serial', 'text', 'time', 'timestamp', 'tsquery', 'tsvector',
  'txid_snapshot', 'uuid', 'varbit', 'varchar', 'xml',
])

function normalizeFunctionType(value) {
  let type = value.trim().toLowerCase()
    .replace(/\bpg_catalog\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\[\s*\]/g, '[]')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\)/g, ')')
  const aliases = new Map([
    ['bool', 'boolean'], ['int', 'integer'], ['int2', 'smallint'], ['int4', 'integer'],
    ['int8', 'bigint'], ['float4', 'real'], ['float8', 'double precision'],
    ['timestamptz', 'timestamp with time zone'], ['timestamp without time zone', 'timestamp'],
    ['timetz', 'time with time zone'], ['time without time zone', 'time'],
    ['varchar', 'character varying'],
  ])
  const arraySuffix = type.endsWith('[]') ? '[]' : ''
  if (arraySuffix) type = type.slice(0, -2)
  return `${aliases.get(type) ?? type}${arraySuffix}`
}

function normalizeReferenceSignature(value) {
  return splitSqlCommaList(value).map(normalizeFunctionType)
}

function normalizeCreateSignature(value) {
  return splitSqlCommaList(value).flatMap((rawParameter) => {
    let parameter = stripFunctionParameterDefault(rawParameter)
    const modeMatch = parameter.match(/^(inout|in|out|variadic)\s+/i)
    if (modeMatch) {
      if (modeMatch[1].toLowerCase() === 'out') return []
      parameter = parameter.slice(modeMatch[0].length).trim()
    }
    const namedMatch = parameter.match(/^("(?:""|[^"])+"|[a-z_][a-z0-9_$]*)\s+([\s\S]+)$/i)
    if (namedMatch) {
      const firstToken = namedMatch[1].replace(/^"|"$/g, '').toLowerCase()
      if (!functionTypeLeadTokens.has(firstToken) && !firstToken.includes('.') && !firstToken.endsWith('[]')) {
        parameter = namedMatch[2]
      }
    }
    return [normalizeFunctionType(parameter)]
  })
}

function definitionTargetKey(target) {
  return target.kind === 'function'
    ? `function:${target.name}(${target.signature.join(',')})`
    : `view:${target.name}`
}

function definitionTargetFromReference(match) {
  const kind = match[1].toLowerCase()
  return {
    kind,
    name: match[2].toLowerCase(),
    signature: kind === 'function'
      ? normalizeReferenceSignature((match[3] ?? '()').slice(1, -1))
      : [],
  }
}

function findDefinitionReferences(sql) {
  return [...sql.matchAll(/pg_get_(function|view)def\s*\(\s*'public\.([a-z0-9_]+)(\((?:''|[^'])*\))?/gi)]
    .map((match) => ({ ...definitionTargetFromReference(match), index: match.index }))
}

function findFunctionIdentityReferences(sql) {
  return [...sql.matchAll(/'public\.([a-z0-9_]+)\(((?:''|[^'])*)\)'/gi)].map((match) => {
    const before = sql.slice(Math.max(0, match.index - 80), match.index)
    const after = sql.slice(match.index + match[0].length, match.index + match[0].length + 80)
    const isExplicitAbsenceAssertion = /to_regprocedure\s*\(\s*$/i.test(before)
      && /^\s*\)\s*is\s+not\s+null\b/i.test(after)
    return {
      kind: 'function',
      name: match[1].toLowerCase(),
      signature: normalizeReferenceSignature(match[2]),
      expectedState: isExplicitAbsenceAssertion ? 'absent' : 'present',
      index: match.index,
    }
  })
}

function parseCreateDefinition(statement) {
  const sql = stripLeadingSqlTrivia(statement)
  const match = sql.match(/^create\s+(?:or\s+replace\s+)?(function|view)\s+public\.([a-z0-9_]+)\b/i)
  if (!match) return null
  const kind = match[1].toLowerCase()
  if (kind === 'view') return { kind, name: match[2].toLowerCase(), signature: [] }
  const openIndex = sql.indexOf('(', match[0].length)
  const closeIndex = findMatchingSqlParen(sql, openIndex)
  if (openIndex < 0 || closeIndex < 0) return null
  return {
    kind,
    name: match[2].toLowerCase(),
    signature: normalizeCreateSignature(sql.slice(openIndex + 1, closeIndex)),
  }
}

function parseFunctionRename(statement) {
  const sql = stripLeadingSqlTrivia(statement)
  const match = sql.match(/^alter\s+function\s+public\.([a-z0-9_]+)\s*\(/i)
  if (!match) return null
  const openIndex = sql.indexOf('(', match.index)
  const closeIndex = findMatchingSqlParen(sql, openIndex)
  if (closeIndex < 0) return null
  const renameMatch = sql.slice(closeIndex + 1).match(/^\s*rename\s+to\s+([a-z0-9_]+)\b/i)
  if (!renameMatch) return null
  return {
    source: {
      kind: 'function',
      name: match[1].toLowerCase(),
      signature: normalizeReferenceSignature(sql.slice(openIndex + 1, closeIndex)),
    },
    target: {
      kind: 'function',
      name: renameMatch[1].toLowerCase(),
      signature: normalizeReferenceSignature(sql.slice(openIndex + 1, closeIndex)),
    },
  }
}

function parseDropFunctionIdentities(statement) {
  const sql = stripLeadingSqlTrivia(statement)
  if (!/^drop\s+function\b/i.test(sql)) return []
  return [...sql.matchAll(/\bpublic\.([a-z0-9_]+)\s*\(/gi)].flatMap((match) => {
    const openIndex = sql.indexOf('(', match.index)
    const closeIndex = findMatchingSqlParen(sql, openIndex)
    if (openIndex < 0 || closeIndex < 0) return []
    return [{
      kind: 'function',
      name: match[1].toLowerCase(),
      signature: normalizeReferenceSignature(sql.slice(openIndex + 1, closeIndex)),
    }]
  })
}

function findFinalFunctionIdentities(installationSources) {
  const identities = new Map()
  for (const source of installationSources) {
    for (const statement of source.statements) {
      const definition = parseCreateDefinition(statement)
      if (definition?.kind === 'function') identities.set(definitionTargetKey(definition), definition)
      for (const dropped of parseDropFunctionIdentities(statement)) identities.delete(definitionTargetKey(dropped))
      const rename = parseFunctionRename(statement)
      if (rename) {
        identities.delete(definitionTargetKey(rename.source))
        identities.set(definitionTargetKey(rename.target), rename.target)
      }
    }
  }
  return identities
}

function findObjectDefinitions(migrationSources, target) {
  const direct = []
  const renames = []
  for (const [migrationIndex, migration] of migrationSources.entries()) {
    for (const [statementIndex, statement] of migration.statements.entries()) {
      const identity = parseCreateDefinition(statement)
      if (identity && definitionTargetKey(identity) === definitionTargetKey(target)) {
        direct.push({ file: migration.file, statement, migrationIndex, statementIndex })
      }
      const rename = parseFunctionRename(statement)
      if (rename && definitionTargetKey(rename.target) === definitionTargetKey(target)) {
        renames.push({ ...rename, migrationIndex, statementIndex })
      }
    }
  }
  if (direct.length > 0) return direct

  const finalRename = renames.at(-1)
  if (!finalRename) return []
  const sourceDefinitions = []
  for (const [migrationIndex, migration] of migrationSources.entries()) {
    for (const [statementIndex, statement] of migration.statements.entries()) {
      if (migrationIndex > finalRename.migrationIndex
        || (migrationIndex === finalRename.migrationIndex && statementIndex >= finalRename.statementIndex)) continue
      const identity = parseCreateDefinition(statement)
      if (identity && definitionTargetKey(identity) === definitionTargetKey(finalRename.source)) {
        sourceDefinitions.push({ file: migration.file, statement, migrationIndex, statementIndex, renamedTo: target.name })
      }
    }
  }
  return sourceDefinitions
}

const statementParserProbe = splitSqlStatements(`
create or replace function public.p0_parser_probe() returns text language plpgsql as $body$
begin perform ';'; perform "quoted;identifier"; return '/* not a comment; */'; end
$body$;
-- a line comment containing ;
create or replace view public.p0_parser_probe_view as select ';'::text as "semi;colon";
/* outer comment ; /* nested comment ; */ tail ; */
select 'quoted;literal';
`)
const statementParserProbePassed = statementParserProbe.length === 3
  && /^create\s+or\s+replace\s+function/i.test(stripLeadingSqlTrivia(statementParserProbe[0]))
  && /^create\s+or\s+replace\s+view/i.test(stripLeadingSqlTrivia(statementParserProbe[1]))
  && /^select\s+'quoted;literal'/i.test(stripLeadingSqlTrivia(statementParserProbe[2]))

function findPolicyPresenceWriteAssertions(sql) {
  const compact = sql.replace(/\s+/g, '')
  return [...compact.matchAll(/ifexists\(select1frompg_policies[\s\S]*?\)thenraiseexception/gi)]
    .map((match) => match[0])
    .filter((assertion) => /cmdin\([^)]*'(?:INSERT|UPDATE|DELETE|ALL)'/i.test(assertion))
    .filter((assertion) => !/permissive='PERMISSIVE'/i.test(assertion))
}

function findFormattingSensitiveDefinitionAssertions(sql) {
  const directDefinitionAssertion = /position\s*\(\s*'((?:''|[^'])*)'\s+in\s+(?:lower\s*\(\s*)?pg_get_(?:function|view)def/gi
  return [...sql.matchAll(directDefinitionAssertion)]
    .map((match) => match[1])
    .filter((fragment) => /\s(?:=|<>|>=|<=|>|<|\+|-)\s/.test(fragment) || fragment.includes('count(DISTINCT'))
}

function findExactViewColumnAssertions(sql) {
  const pattern = /if\s*\(\s*select\s+array_agg\s*\(\s*column_name::text\s+order\s+by\s+ordinal_position\s*\)\s*from\s+information_schema\.columns\s+where\s+table_schema\s*=\s*'public'\s*and\s*table_name\s*=\s*'([a-z0-9_]+)'\s*\)\s*is\s+distinct\s+from\s+array\s*\[([\s\S]*?)\]\s*then/gi
  return [...sql.matchAll(pattern)].map((match) => ({
    view: match[1].toLowerCase(),
    columns: [...match[2].matchAll(/'((?:''|[^'])*)'/g)].map((column) => column[1].replace(/''/g, "'")),
  }))
}

function findMatchingSqlParen(sql, openIndex) {
  let depth = 0
  let inString = false
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index]
    if (inString) {
      if (character === "'" && sql[index + 1] === "'") index += 1
      else if (character === "'") inString = false
      continue
    }
    if (character === "'") inString = true
    else if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function findRequiredDirectDefinitionAssertions(sql) {
  const assertions = []
  const definitionVariables = new Map()
  for (const reference of findDefinitionReferences(sql)) {
    const statementStart = sql.lastIndexOf(';', reference.index) + 1
    const statementEndIndex = sql.indexOf(';', reference.index)
    const statementEnd = statementEndIndex < 0 ? sql.length : statementEndIndex
    const clause = sql.slice(statementStart, statementEnd)
    const localReferenceIndex = reference.index - statementStart
    const beforeReference = clause.slice(0, localReferenceIndex)
    const afterReference = clause.slice(localReferenceIndex)
    const assignment = beforeReference.match(/\b([a-z][a-z0-9_]*)\s*(?:text\s*)?:=\s*[\s\S]*$/i)
    const selectInto = afterReference.match(/^[\s\S]*\binto\s+([a-z][a-z0-9_]*)\s*$/i)
    const variableName = assignment?.[1] ?? selectInto?.[1]
    if (variableName) definitionVariables.set(variableName.toLowerCase(), reference)
  }
  for (const match of sql.matchAll(/\bposition\s*\(/gi)) {
    const openIndex = sql.indexOf('(', match.index)
    const closeIndex = findMatchingSqlParen(sql, openIndex)
    if (closeIndex < 0) continue
    const inner = sql.slice(openIndex + 1, closeIndex)
    const fragmentMatch = inner.match(/^\s*'((?:''|[^'])*)'\s+in\b/i)
    const directTarget = findDefinitionReferences(inner)[0]
    const variableMatch = inner.match(/\bin\s+([a-z][a-z0-9_]*)\s*$/i)
    const target = directTarget ?? definitionVariables.get(variableMatch?.[1]?.toLowerCase())
    const comparatorMatch = sql.slice(closeIndex + 1, closeIndex + 20).match(/^\s*([=<>]+)\s*0/)
    if (fragmentMatch && target && comparatorMatch?.[1] === '=') {
      assertions.push({
        fragment: fragmentMatch[1].replace(/''/g, "'"),
        kind: target.kind,
        name: target.name,
        signature: target.signature,
      })
    }
  }
  return assertions
}

const definitionResolutionProbeSql = `
do $$declare
  wrapper_def text;
  legacy_def text:=pg_get_functiondef('public.p0_overload_legacy(text)'::regprocedure);
  implementation_def text;
begin
  select lower(pg_get_functiondef('public.p0_overload(text)'::regprocedure))into wrapper_def;
  implementation_def:=lower(pg_get_functiondef('public.p0_overload(text,text)'::regprocedure));
  if position('wrapper_marker' in wrapper_def)=0 then raise exception 'wrapper';end if;
  if position('implementation_marker' in implementation_def)=0 then raise exception 'implementation';end if;
  if position('legacy_marker' in legacy_def)=0 then raise exception 'legacy';end if;
end$$;
`
const definitionResolutionProbeMigration = `
create or replace function public.p0_overload(p_value text)returns text language sql as $$select 'legacy_marker'$$;
alter function public.p0_overload(text)rename to p0_overload_legacy;
create or replace function public.p0_overload(p_value text,p_extra text)returns text language sql as $$select 'implementation_marker'$$;
create or replace function public.p0_overload(p_value text)returns text language sql as $$select 'wrapper_marker'$$;
`
const definitionResolutionProbeSources = [{
  file: 'probe.sql',
  sql: definitionResolutionProbeMigration,
  statements: splitSqlStatements(definitionResolutionProbeMigration),
}]
const definitionResolutionProbeAssertions = findRequiredDirectDefinitionAssertions(definitionResolutionProbeSql)
const definitionResolutionProbeExpectedTargets = [
  'function:p0_overload(text)',
  'function:p0_overload(text,text)',
  'function:p0_overload_legacy(text)',
]
const definitionResolutionProbeTargetsPassed = exactSet(
  definitionResolutionProbeAssertions.map(definitionTargetKey),
  definitionResolutionProbeExpectedTargets,
)
const definitionResolutionProbeSourcesPassed = definitionResolutionProbeAssertions.every((assertion) => {
  const finalDefinition = findObjectDefinitions(definitionResolutionProbeSources, assertion).at(-1)
  return finalDefinition?.statement.includes(assertion.fragment)
})
const viewIntervalNormalizationProbePassed =
  normalizeDefinitionText("interval '48 hours'") === normalizeDefinitionText("interval '48:00:00'")
const exactViewColumnAssertionProbe = findExactViewColumnAssertions(`
if (select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns where table_schema='public' and table_name='p0_column_probe')
  is distinct from array['id','name'] then raise exception 'drift';end if;
`)
const exactViewColumnAssertionProbePassed = exactViewColumnAssertionProbe.length === 1
  && exactViewColumnAssertionProbe[0].view === 'p0_column_probe'
  && JSON.stringify(exactViewColumnAssertionProbe[0].columns) === JSON.stringify(['id', 'name'])
const functionIdentityProbeMigration = `
create function public.p0_identity_probe(p_value text)returns text language sql as $$select p_value$$;
drop function public.p0_identity_probe(text);
create function public.p0_identity_probe(p_value text,p_key uuid)returns text language sql as $$select p_value$$;
`
const functionIdentityProbeSources = [{
  file: 'probe.sql',
  statements: splitSqlStatements(functionIdentityProbeMigration),
}]
const functionIdentityProbeFinal = findFinalFunctionIdentities(functionIdentityProbeSources)
const functionIdentityProbeReferences = findFunctionIdentityReferences(`
select to_regprocedure('public.p0_identity_probe(text)') is not null;
select to_regprocedure('public.p0_identity_probe(text,uuid)');
`)
const functionIdentityFinalStateProbePassed = functionIdentityProbeFinal.size === 1
  && functionIdentityProbeReferences[0].expectedState === 'absent'
  && functionIdentityProbeReferences[1].expectedState === 'present'
  && !functionIdentityProbeFinal.has(definitionTargetKey(functionIdentityProbeReferences[0]))
  && functionIdentityProbeFinal.has(definitionTargetKey(functionIdentityProbeReferences[1]))

function validate(candidate) {
  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const counts = candidate.expectedCounts ?? {}
  const tests = candidate.tests ?? []
  const sourceRules = candidate.testSourceRules ?? {}
  const runtime = candidate.runtime ?? {}
  const boundary = candidate.acceptanceBoundary ?? {}

  check(candidate.schemaVersion === 1, 'schema version must be 1')
  check(candidate.manifestType === 'canwin-team-os-p0-ci-database-tests', 'manifest type drift')
  check(candidate.contractStatus === 'p1_acl_and_atomic_compatibility_repair_candidate_database_ci_pending', 'contract status drift')

  check(candidate.baseline?.path === 'supabase/schema.sql', 'baseline path drift')
  check(candidate.baseline?.sha256Lf === sha256Lf(resolve(repoRoot, 'supabase', 'schema.sql')), 'baseline hash drift')
  check(candidate.migrations?.directory === 'supabase/migrations', 'migration directory drift')
  check(candidate.migrations?.sha256Manifest === 'docs/team-os-4.0/p0/migration-sha256-manifest.json', 'migration manifest path drift')
  check(candidate.migrations?.expectedCount === 71, 'migration expected count drift')

  const manifest = readJson(resolve(repoRoot, candidate.migrations?.sha256Manifest ?? 'missing'))
  const migrationFiles = readdirSync(resolve(repoRoot, candidate.migrations?.directory ?? 'missing'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const migrationSources = migrationFiles.map((file) => ({
    file,
    sql: normalizeLf(readFileSync(resolve(repoRoot, candidate.migrations.directory, file), 'utf8')),
  })).map((migration) => ({ ...migration, statements: splitSqlStatements(migration.sql) }))
  const baselineSql = normalizeLf(readFileSync(resolve(repoRoot, candidate.baseline?.path ?? 'missing'), 'utf8'))
  const installationSources = [{
    file: candidate.baseline?.path ?? 'missing',
    sql: baselineSql,
    statements: splitSqlStatements(baselineSql),
  }, ...migrationSources]
  const finalFunctionIdentities = findFinalFunctionIdentities(installationSources)
  check(manifest.expectedCount === 71 && manifest.entries?.length === 71, 'migration manifest count drift')
  check(migrationFiles.length === 71, 'migration directory count drift')
  check(exactSet(migrationFiles, (manifest.entries ?? []).map((entry) => entry.file)), 'migration file set drift')
  for (const entry of manifest.entries ?? []) {
    check(entry.sha256 === sha256Lf(resolve(repoRoot, candidate.migrations.directory, entry.file)), `migration hash drift ${entry.file}`)
  }

  check(counts.database === expectedCategories.database, 'database expected count drift')
  check(counts.permission === expectedCategories.permission, 'permission expected count drift')
  check(counts.business === expectedCategories.business, 'business expected count drift')
  check(counts.total === 27, 'total expected count drift')
  check(counts.postInstallCatalogAssertions === 4, 'catalog assertion count drift')
  check(counts.definitionReferencedObjects === 54, 'definition referenced object count drift')
  check(counts.redefinedDefinitionReferencedObjects === 28, 'redefined definition object count drift')
  check(counts.crmLeadsVisibleExactColumnAssertions === 2, 'crm_leads_visible exact column assertion count drift')
  check(counts.directDealOrderFixtureFiles === 2, 'direct deal order fixture file count drift')
  check(counts.directDealOrderInsertStatements === 2, 'direct deal order insert statement count drift')
  check(counts.finalPublicFunctionIdentities === 168, 'final public function identity count drift')
  check(counts.functionIdentityReferences === 216, 'function identity reference count drift')
  check(sourceRules.doKeywordSeparatedFromDollarQuote === true, 'DO dollar-quote separator rule drift')
  check(sourceRules.forbiddenUnseparatedToken === 'do$$', 'DO dollar-quote forbidden token drift')
  check(sourceRules.policyWriteAssertionsRequirePermissiveFilter === true, 'policy write assertion source rule drift')
  check(sourceRules.definitionFragmentAssertionsNormalizeFormatting === true, 'definition fragment formatting source rule drift')
  check(sourceRules.requiredDefinitionFragmentsMatchFinalCreateStatement === true, 'final definition CREATE statement source rule drift')
  check(sourceRules.definitionStatementParserHandlesQuotedSemicolons === true, 'definition statement parser source rule drift')
  check(sourceRules.definitionReferencesResolveAssignmentsOverloadsAndRenames === true, 'definition reference resolution source rule drift')
  check(sourceRules.viewIntervalLiteralsNormalizeInputAndCanonicalOutput === true, 'view interval normalization source rule drift')
  check(sourceRules.crmLeadsVisibleExactColumnAssertionsMatchFinalContract === true, 'crm_leads_visible exact column source rule drift')
  check(sourceRules.directDealOrderFixturesIncludeFinalRequiredOrderNumber === true, 'direct deal order required number source rule drift')
  check(sourceRules.functionIdentityReferencesMatchFinalMigrationState === true, 'final function identity source rule drift')
  check(statementParserProbePassed, 'definition statement parser probe failed')
  check(definitionResolutionProbeTargetsPassed, `definition assignment/overload target probe failed actual=${definitionResolutionProbeAssertions.map(definitionTargetKey).join(',')}`)
  check(definitionResolutionProbeSourcesPassed, 'definition overload/rename source probe failed')
  check(viewIntervalNormalizationProbePassed, 'view interval input/output normalization probe failed')
  check(exactViewColumnAssertionProbePassed, 'exact view column assertion parser probe failed')
  check(directDealOrderInsertProbePassed, 'direct deal order insert parser probe failed')
  check(functionIdentityFinalStateProbePassed, 'final function identity parser probe failed')
  check(tests.length === counts.total, 'test entry count drift')
  check(exactSet(tests.map((entry) => entry.path), tests.map((entry) => entry.path)), 'duplicate test path')

  const discoveredTests = readdirSync(resolve(repoRoot, 'supabase', 'tests'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => `supabase/tests/${name}`)
  check(exactSet(tests.map((entry) => entry.path), discoveredTests), 'test file set drift')
  for (const [category, expected] of Object.entries(expectedCategories)) {
    check(tests.filter((entry) => entry.category === category).length === expected, `${category} category count drift`)
  }
  check(tests.every((entry) => Object.hasOwn(expectedCategories, entry.category)), 'unknown test category')
  check(tests.every((entry) => allowedModes.has(entry.executionMode)), 'unknown execution mode')
  check(exactSet(
    tests.filter((entry) => entry.executionMode === 'rollback_fixture').map((entry) => entry.path),
    [...expectedRollbackFixtures],
  ), 'rollback fixture set drift')

  const definitionTargets = new Map()
  const crmLeadsVisibleColumnAssertionFiles = new Set()
  let crmLeadsVisibleExactColumnAssertions = 0
  const directDealOrderFixtureFiles = new Set()
  let directDealOrderInsertStatements = 0
  let functionIdentityReferences = 0
  for (const entry of tests) {
    const absolutePath = resolve(repoRoot, entry.path)
    const sql = normalizeLf(readFileSync(absolutePath, 'utf8'))
    for (const target of findDefinitionReferences(sql)) {
      definitionTargets.set(definitionTargetKey(target), target)
    }
    for (const identity of findFunctionIdentityReferences(sql)) {
      functionIdentityReferences += 1
      const key = definitionTargetKey(identity)
      if (identity.expectedState === 'absent') {
        check(!finalFunctionIdentities.has(key), `retired function identity unexpectedly remains after the final migration ${entry.path}:${key}`)
      } else {
        check(finalFunctionIdentities.has(key), `function identity reference is absent after the final migration ${entry.path}:${key}`)
      }
    }
    check(entry.sha256Lf === sha256Lf(absolutePath), `test hash drift ${entry.path}`)
    check(!/^\s*\\/m.test(sql), `psql meta-command forbidden ${entry.path}`)
    check(!forbiddenSqlBoundary.test(sql), `remote SQL boundary forbidden ${entry.path}`)
    check(!/\bdo\$\$/i.test(sql), `DO keyword must be separated from dollar quote ${entry.path}`)
    check(findPolicyPresenceWriteAssertions(sql).length === 0, `policy presence misclassified as write grant ${entry.path}`)
    check(findFormattingSensitiveDefinitionAssertions(sql).length === 0, `definition fragment assertion depends on source formatting ${entry.path}`)
    for (const assertion of findExactViewColumnAssertions(sql)) {
      if (assertion.view !== 'crm_leads_visible') continue
      crmLeadsVisibleColumnAssertionFiles.add(entry.path)
      crmLeadsVisibleExactColumnAssertions += 1
      check(JSON.stringify(assertion.columns) === JSON.stringify(expectedCrmLeadsVisibleColumns), `crm_leads_visible exact column assertion does not match final contract ${entry.path}`)
    }
    const directDealOrderInserts = findDirectInsertColumns(sql, 'public.deal_orders')
    if (directDealOrderInserts.length > 0) directDealOrderFixtureFiles.add(entry.path)
    directDealOrderInsertStatements += directDealOrderInserts.length
    for (const insert of directDealOrderInserts) {
      check(insert.columns.includes('order_number'), `direct deal order fixture missing final required order_number ${entry.path}`)
    }
    for (const assertion of findRequiredDirectDefinitionAssertions(sql)) {
      const definitions = findObjectDefinitions(migrationSources, assertion)
      const targetKey = definitionTargetKey(assertion)
      check(definitions.length > 0, `definition source missing for ${targetKey}`)
      const finalDefinition = definitions.at(-1)
      const normalizedFragment = normalizeDefinitionText(assertion.fragment)
      const normalizedFinalStatement = normalizeDefinitionText(finalDefinition?.statement ?? '')
      check(normalizedFinalStatement.includes(normalizedFragment), `required definition fragment not found in final CREATE statement ${entry.path}:${targetKey}:${finalDefinition?.file ?? 'missing'}:${assertion.fragment}`)
    }
    if (entry.executionMode === 'rollback_fixture') {
      check(/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(sql), `fixture must begin a transaction ${entry.path}`)
      check(/rollback\s*;\s*$/i.test(sql), `fixture must end with rollback ${entry.path}`)
    } else {
      check(!/^\s*(?:begin|commit|rollback)\s*;/im.test(sql), `read-only test contains transaction control ${entry.path}`)
    }
  }
  const redefinedDefinitionTargets = [...definitionTargets.values()]
    .filter((target) => findObjectDefinitions(migrationSources, target).length > 1)
  check(definitionTargets.size === counts.definitionReferencedObjects, `definition referenced object inventory drift expected=${counts.definitionReferencedObjects} actual=${definitionTargets.size}`)
  check(redefinedDefinitionTargets.length === counts.redefinedDefinitionReferencedObjects, `redefined definition object inventory drift expected=${counts.redefinedDefinitionReferencedObjects} actual=${redefinedDefinitionTargets.length}`)
  check(crmLeadsVisibleExactColumnAssertions === counts.crmLeadsVisibleExactColumnAssertions, `crm_leads_visible exact column assertion inventory drift expected=${counts.crmLeadsVisibleExactColumnAssertions} actual=${crmLeadsVisibleExactColumnAssertions}`)
  check(exactSet([...crmLeadsVisibleColumnAssertionFiles], [...expectedCrmLeadsVisibleColumnAssertionFiles]), 'crm_leads_visible exact column assertion file set drift')
  check(directDealOrderFixtureFiles.size === counts.directDealOrderFixtureFiles, `direct deal order fixture file inventory drift expected=${counts.directDealOrderFixtureFiles} actual=${directDealOrderFixtureFiles.size}`)
  check(directDealOrderInsertStatements === counts.directDealOrderInsertStatements, `direct deal order insert inventory drift expected=${counts.directDealOrderInsertStatements} actual=${directDealOrderInsertStatements}`)
  check(finalFunctionIdentities.size === counts.finalPublicFunctionIdentities, `final public function identity inventory drift expected=${counts.finalPublicFunctionIdentities} actual=${finalFunctionIdentities.size}`)
  check(functionIdentityReferences === counts.functionIdentityReferences, `function identity reference inventory drift expected=${counts.functionIdentityReferences} actual=${functionIdentityReferences}`)

  check(JSON.stringify(candidate.postInstallCatalog) === JSON.stringify(expectedCatalog), 'post-install catalog contract drift')
  const salesV3 = candidate.historicalChainExpectations?.salesOsV3 ?? {}
  check(salesV3.foundationMigration === 'supabase/migrations/20260713080000_add_access_control_foundation.sql', 'sales_os_v3 foundation migration drift')
  check(salesV3.foundationInsertedEnabled === false, 'sales_os_v3 foundation default drift')
  check(salesV3.finalEnableMigration === 'supabase/migrations/20260713200000_enable_sales_os_v3_pilot.sql', 'sales_os_v3 enable migration drift')
  check(salesV3.after69MigrationsEnabled === true, 'sales_os_v3 final-chain state drift')
  check(salesV3.operationalUsePausedOutsideDatabaseFlag === true, '3.0 operational pause boundary drift')
  const foundationSql = normalizeLf(readFileSync(resolve(repoRoot, salesV3.foundationMigration ?? 'missing'), 'utf8'))
  const pilotSql = normalizeLf(readFileSync(resolve(repoRoot, salesV3.finalEnableMigration ?? 'missing'), 'utf8'))
  const accessTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/access_control_foundation.sql'), 'utf8'))
  check(/'sales_os_v3'[\s\S]*false/i.test(foundationSql), 'foundation disabled insert evidence missing')
  check(/set\s+enabled\s*=\s*true/i.test(pilotSql), 'pilot enable evidence missing')
  check(accessTestSql.includes('20260713200000') && accessTestSql.includes("if not public.is_feature_enabled('CANWIN_TEAM', 'sales_os_v3')"), 'post-chain feature test semantics drift')
  check(!accessTestSql.includes('sales_os_v3 must default to disabled'), 'obsolete pre-pilot assertion returned')
  const qualification = candidate.historicalChainExpectations?.crmOpportunityQualification ?? {}
  check(qualification.foundationMigration === 'supabase/migrations/20260713090000_add_crm_core.sql', 'qualification foundation migration drift')
  check(exactSet(qualification.foundationAllowedGrades, ['A', 'B', 'C']), 'qualification foundation grades drift')
  check(qualification.foundationRequiredAdvisoryFacts === true, 'qualification foundation facts drift')
  check(qualification.finalMigration === 'supabase/migrations/20260716114824_add_package_price_and_relax_qualification.sql', 'qualification final migration drift')
  check(exactSet(qualification.after69AllowedGrades, ['A', 'B', 'C', 'D']), 'qualification final grades drift')
  check(qualification.after69RequiredAdvisoryFacts === false, 'qualification final advisory-facts drift')
  check(qualification.confirmedContactGateFunction === 'public.qualify_crm_lead(uuid)', 'qualification contact gate function drift')
  const qualificationFoundationSql = normalizeLf(readFileSync(resolve(repoRoot, qualification.foundationMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const qualificationFinalSql = normalizeLf(readFileSync(resolve(repoRoot, qualification.finalMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const crmCoreTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/crm_core.sql'), 'utf8'))
  check(qualificationFoundationSql.includes("selecttarget_gradein('a','b','c')") && qualificationFoundationSql.includes('coalesce(target_annual_fee_viable,false)'), 'qualification foundation strict-rule evidence missing')
  check(qualificationFinalSql.includes("selecttarget_gradein('a','b','c','d')"), 'qualification final grade-rule evidence missing')
  check(qualificationFinalSql.includes("lead_row.contactability_status<>'ready'") && qualificationFinalSql.includes('public.crm_lead_private'), 'qualification confirmed-contact gate evidence missing')
  check(crmCoreTestSql.includes('20260716114824') && crmCoreTestSql.includes("crm_is_valid_opportunity('D',false,false,null) is distinct from true"), 'post-chain qualification test semantics drift')
  check(crmCoreTestSql.includes("crm_is_valid_opportunity('E',true,true,null) is distinct from false"), 'post-chain invalid-grade test missing')
  check(!crmCoreTestSql.includes('Qualification rule skeleton failed'), 'obsolete strict qualification assertion returned')
  const leadsView = candidate.historicalChainExpectations?.crmLeadsVisible ?? {}
  check(leadsView.finalMigration === 'supabase/migrations/20260717184206_add_quick_lead_address.sql', 'lead view final migration drift')
  check(JSON.stringify(leadsView.after69Columns) === JSON.stringify(expectedCrmLeadsVisibleColumns), 'lead view final column order drift')
  check(leadsView.addressHiddenFromOtherOwner === true, 'lead view address privacy drift')
  check(leadsView.rawPhoneColumnForbidden === true, 'lead view raw phone boundary drift')
  const finalLeadViewSql = normalizeLf(readFileSync(resolve(repoRoot, leadsView.finalMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  check(finalLeadViewSql.includes("casewhenl.owner_idisnotnullandl.owner_id<>auth.uid()thennullelsel.addressendaddress"), 'lead view address privacy evidence missing')
  check(crmCoreTestSql.includes('20260717184206') && crmCoreTestSql.includes("'recycle_paused',\n      'address']"), 'lead view final column test drift')
  check(!/array\[[^\]]*'recycle_paused'\s*\]\s*then/.test(crmCoreTestSql), 'obsolete pre-address column contract returned')
  const importAccess = candidate.historicalChainExpectations?.customerImportHistoryAccess ?? {}
  check(importAccess.foundationMigration === 'supabase/migrations/20260713150000_add_customer_import.sql', 'import access foundation migration drift')
  check(exactSet(importAccess.protectedTables, ['import_rows', 'import_created_entities']), 'import protected table set drift')
  check(exactSet(importAccess.clientRoles, ['anon', 'authenticated']), 'import client role set drift')
  check(importAccess.requiredRestrictiveAllGate === 'sales os v3 server gate', 'import restrictive gate drift')
  check(importAccess.permissiveClientWritePoliciesAllowed === false, 'import permissive write boundary drift')
  check(importAccess.directClientWritePrivilegesAllowed === false, 'import direct write privilege boundary drift')
  const importFoundationSql = normalizeLf(readFileSync(resolve(repoRoot, importAccess.foundationMigration ?? 'missing'), 'utf8')).replace(/\s+/g, '').toLowerCase()
  const customerImportTestSql = normalizeLf(readFileSync(resolve(repoRoot, 'supabase/tests/customer_import.sql'), 'utf8'))
  check(importFoundationSql.includes('createpolicy"salesosv3servergate"onpublic.%iasrestrictiveforalltoauthenticated'), 'import restrictive gate source evidence missing')
  check(customerImportTestSql.includes("permissive='RESTRICTIVE'") && customerImportTestSql.includes("permissive='PERMISSIVE'"), 'import permissive/restrictive policy test drift')
  check(customerImportTestSql.includes("from(values('anon'),('authenticated'))") && customerImportTestSql.includes('has_table_privilege'), 'import effective client privilege test missing')
  check(!customerImportTestSql.includes("cmd in('INSERT','UPDATE','DELETE','ALL'))then raise exception'Import history client-mutable'"), 'obsolete import policy-presence assertion returned')
  check(runtime.engine === 'supabase-cli-local-postgres', 'runtime engine drift')
  check(runtime.supabaseCliVersion === '2.109.1', 'Supabase CLI pin drift')
  check(runtime.postgresMajor === 17, 'Postgres major drift')
  check(runtime.startup === 'supabase db start', 'database-only startup command drift')
  check(runtime.workdir === 'scripts/p0/ci-runtime', 'CI workdir drift')
  check(runtime.projectId === 'canwin-team-os-4-ci', 'CI project id drift')
  check(exactSet(runtime.allowedHosts, ['127.0.0.1', 'localhost']), 'allowed host boundary drift')
  check(runtime.allowedPort === 54322, 'allowed port drift')
  check(runtime.allowedDatabase === 'postgres', 'allowed database drift')
  check(runtime.allowedUser === 'postgres', 'allowed user drift')
  check(runtime.remoteConnectionsAllowed === false, 'remote connections must remain disabled')
  check(runtime.credentialMode === 'ephemeral-local-defaults', 'credential mode drift')
  check(runtime.testData === 'synthetic-only', 'test data boundary drift')
  check(runtime.cleanup === 'supabase stop --no-backup', 'cleanup contract drift')

  const config = normalizeLf(readFileSync(resolve(repoRoot, runtime.workdir ?? 'missing', 'supabase', 'config.toml'), 'utf8')).trim()
  const expectedConfig = [
    `project_id = "${runtime.projectId}"`,
    '',
    '[db]',
    `port = ${runtime.allowedPort}`,
    'shadow_port = 54320',
    `major_version = ${runtime.postgresMajor}`,
    '',
    '[db.seed]',
    'enabled = false',
  ].join('\n')
  check(config === expectedConfig, 'isolated Supabase config drift')

  const workflow = normalizeLf(readFileSync(resolve(repoRoot, '.github', 'workflows', 'p0-static.yml'), 'utf8'))
  check(workflow.includes('p0-database:'), 'isolated database CI job missing')
  check(workflow.includes('uses: supabase/setup-cli@v1'), 'official Supabase CLI setup action missing')
  check(workflow.includes(`version: ${runtime.supabaseCliVersion}`), 'workflow Supabase CLI pin drift')
  check(workflow.includes(`${runtime.startup} --workdir ${runtime.workdir} --yes`), 'database-only start step missing')
  check(!workflow.includes('--exclude'), 'full-stack container exclusion list is forbidden')
  check(workflow.includes(`--workdir ${runtime.workdir}`), 'isolated workdir missing from workflow')
  check(workflow.includes('node scripts/p0/run-ci-database-gates.mjs'), 'database gate runner missing from workflow')
  check(workflow.includes(`supabase stop --no-backup --workdir ${runtime.workdir} --yes`), 'destructive isolated cleanup step missing')
  check(!/\bsecrets\s*\./i.test(workflow), 'repository secret reference forbidden')
  check(!/--linked\b|supabase\.co|pooler/i.test(workflow), 'remote Supabase boundary forbidden')

  check(boundary.contractAccepted === true, 'CI database contract not accepted')
  check(boundary.actualGithubRunEvidence === 'passed', 'actual GitHub run success evidence missing')
  check(boundary.g0OverallClaim === true, 'G0 success claim missing')
  check(boundary.p1ActualGithubRunEvidence === 'passed', 'P1 successful GitHub run evidence missing')
  check(boundary.ciRepairCandidateLinuxAccepted === true, 'repair candidate Linux acceptance evidence missing')
  check(boundary.ciRepairCandidateWindowsStatic === '16/17', 'repair candidate Windows static count drift')
  check(boundary.portableSelftestRepairPending === false && boundary.portableSelftestRepairImplemented === true, 'portable self-test repair implementation evidence drift')
  check(boundary.ciSecondRepairCandidateLinuxAccepted === true, 'second repair candidate Linux acceptance evidence missing')
  check(boundary.ciSecondRepairCandidateWindowsStatic === '15/17', 'second repair candidate Windows static count drift')
  check(boundary.validatorLineEndingRepairPending === false && boundary.validatorLineEndingRepairImplemented === true, 'validator line-ending repair acceptance drift')
  check(boundary.newIndependentCi === 'passed', 'new independent CI success evidence missing')
  check(boundary.freshCheckoutFailureRunId === '29695919974' && boundary.freshCheckoutFailurePreservedWithoutRerun === true, 'fresh-checkout failure preservation evidence missing')
  check(boundary.rollbackEvidenceLineEndingRepairImplemented === true && boundary.postRepairIndependentCi === 'passed' && boundary.postRepairIndependentCiRunId === '29696529290', 'post-repair independent CI boundary drift')
  check(boundary.postApplyResumePrequalification === 'failed_stop_preserved_acl_repair_pending' && boundary.postApplyCandidateRemoteExecutionAllowed === false && boundary.postApplyResumeRemoteExecutionAllowed === false, 'post-apply resume terminal boundary drift')
  check(boundary.postApplyResumeSignedCiHeadSha === 'a620bb541f4c5eb613413e8b40455b3988ee0cf3' && boundary.postApplyResumeSignedCiRunId === '29699951990' && boundary.postApplyResumeSignedCiLinuxJobId === '88227205377' && boundary.postApplyResumeSignedCiWindowsJobId === '88227205362' && boundary.postApplyResumeSignedCiConclusion === 'success', 'post-apply resume signed CI identity drift')
  check(boundary.postApplyResumeSignedHeadExecutionAllowed === false && boundary.postApplyResumeTrackedDirtyAllowed === false && boundary.postApplyResumeUntrackedAuditEvidenceAllowed === true, 'post-apply resume worktree qualification boundary drift')
  check(boundary.p1MigrationPreviouslyApplied === true && boundary.postApplyResumeVerificationExecuted === true, 'post-apply resume execution boundary drift')
  check(boundary.postApplyResumeFailureRunId === 'p1-resume-20260719T193911279Z-ea6ed9385d' && boundary.postApplyResumeFailurePreserved === true, 'post-apply resume failure preservation boundary drift')
  check(boundary.aclRepairMigrationPath === 'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql' && boundary.aclRepairLocalGates === 'passed' && boundary.aclRepairDatabaseCi === 'prior-failure-preserved-new-candidate-pending', 'ACL repair current boundary drift')
  check(boundary.fullReconciliationExactRows === 71 && boundary.fullReconciliationSqlTests === 27 && boundary.fullReconciliationPerTestSnapshots === 27 && boundary.fullReconciliationSnapshots === 29, 'ACL repair full reconciliation acceptance counts drift')
  check(boundary.fullReconciliationStorageArchives === 2 && boundary.fullReconciliationSignedArtifacts === 6, 'full reconciliation Storage or artifact acceptance counts drift')
  check(boundary.fullReconciliationKeyAmounts === 5 && boundary.fullReconciliationRawLedgers === 9 && boundary.fullReconciliationInventoryMeasures === 3, 'full reconciliation business measure acceptance counts drift')
  check(boundary.fullReconciliationContentFingerprintsRequired === true && boundary.sourceP0CountsOnlyBoundaryRecorded === true, 'full reconciliation fingerprint or legacy P0 boundary missing')
  check(boundary.fixturePatternsCovered === '4/4' && boundary.runnerValidatorAssertions === '100/100', 'runner fixture-pattern or validator assertion evidence drift')
  check(boundary.g1OverallClaim === false, 'G1 must remain unclaimed until real page and account acceptance passes')
  check(boundary.productionReadPerformed === false, 'production read must remain false')
  check(boundary.productionWritePerformed === false, 'production write must remain false')
  check(boundary.repositorySecretsRequired === false, 'repository secrets must not be required')

  const resume = candidate.postApplyResumePrequalification ?? {}
  check(resume.status === 'qualified_remote_enabled', 'post-apply resume prequalification status drift')
  check(resume.accessControlTestPath === 'supabase/tests/access_control_foundation.sql' && resume.accessControlTestExecutionMode === 'rollback_fixture' && resume.accessControlTestSha256Lf === '31fa286b318ad2b24e2d956005c4a5fcc9b0fddfd0269be029330d5c1c3e43f8', 'post-apply access-control test contract drift')
  check(resume.runnerPath === 'scripts/p1/run-isolated-runtime.mjs' && resume.runnerSha256Lf === 'f9d9d6abed29a482757682d25002f2c414a1271e0f7fa2e9360fc62f009ed648', 'post-apply resume runner contract drift')
  check(resume.validatorPath === 'scripts/p1/verify-isolated-runtime-runner.mjs' && resume.validatorSha256Lf === '60a90fc8bf75d44a02c2d824e29b912d14fbbe844af79b0e5a705c77fe59c2af' && resume.validatorAssertions === '100/100' && resume.fixturePatterns === '4/4', 'post-apply resume validator contract drift')
  check(resume.isolatedRuntimeContractPath === 'scripts/p1/isolated-runtime-contract.json' && resume.isolatedRuntimeContractSha256Lf === 'f99e605341b36e2de18779b6dd52a624b1ef421a9b60c4517f59845a7ba22013', 'post-apply isolated runtime contract drift')
  check(resume.accessControlTestSha256Lf === sha256Lf(resolve(repoRoot, resume.accessControlTestPath)), 'post-apply access-control test file SHA drift')
  check(resume.candidateRemoteExecutionAllowed === false && resume.resumeRemoteExecutionAllowed === true && resume.resumeSignedCiHeadSha === 'a620bb541f4c5eb613413e8b40455b3988ee0cf3', 'post-apply resume qualification signature or authorization drift')
  check(resume.resumeSignedCiRunId === '29699951990' && resume.resumeSignedCiLinuxJobId === '88227205377' && resume.resumeSignedCiWindowsJobId === '88227205362' && resume.resumeSignedCiConclusion === 'success', 'post-apply resume signed CI run or job drift')
  check(resume.resumeSignedCiWindowsStatic === '19/19' && resume.resumeSignedCiWindowsLocal === '12/12' && resume.resumeSignedCiLinuxCounts === '70/27/7/11/9/4', 'post-apply resume signed CI count drift')
  check(resume.signedCiHeadExecutionAllowed === false && resume.trackedDirtyAllowed === false && resume.untrackedAuditEvidenceAllowed === true, 'post-apply resume same-head, tracked-dirty, or untracked-audit boundary drift')
  check(resume.dbPushAllowed === false && resume.expectedPersistentRemoteWrites === 0 && resume.migrationPreviouslyApplied === true && resume.resumeVerificationExecuted === false, 'post-apply resume apply/write/execution boundary drift')
  check(resume.productionReadPerformed === false && resume.productionWritePerformed === false, 'post-apply resume production boundary drift')
  const full = resume.fullReconciliation ?? {}
  check(full.exactPostMigrationRows === 70 && full.sqlTests === 27 && full.perTestFullSnapshots === 27 && full.fullSnapshots === 29, 'full reconciliation migration, SQL or snapshot counts drift')
  check(JSON.stringify(full.fullSnapshotPlan) === JSON.stringify({ initial: 1, afterEachSqlTest: 27, finalAfterFreshCredential: 1 }), 'full reconciliation 29-snapshot plan drift')
  check(full.storageArchiveSnapshots === 2 && JSON.stringify(full.storageArchivePlan) === JSON.stringify({ initial: 1, final: 1 }), 'full reconciliation Storage archive plan drift')
  check(full.signedArtifactCount === 6 && Object.keys(full.signedArtifactSha256 ?? {}).length === 6 && Object.values(full.signedArtifactSha256 ?? {}).every((sha) => /^[a-f0-9]{64}$/.test(sha)), 'full reconciliation signed artifact inventory drift')
  check(exactSet(full.keyAmountKeys, ['customerPayments', 'internalPayables', 'salesProfit', 'points', 'laborEarnings']) && full.currency === 'CNY' && full.decimalPrecision === 2, 'full reconciliation five key-amount contract drift')
  check(exactSet(full.rawLedgerKeys, ['customerPaymentGross', 'customerPaymentReversals', 'internalDue', 'internalPaid', 'internalSettlements', 'procurementPayments', 'salesExpenses', 'quarterlyRebates', 'companyExpenses']), 'full reconciliation nine raw-ledger keys drift')
  check(exactSet(full.inventoryKeys, ['onHand', 'reserved', 'shipped']), 'full reconciliation three inventory keys drift')
  check(JSON.stringify(full.auth) === JSON.stringify({ users: 7, identities: 7, profiles: 7, sourceRoleAssignments: 8, authorizedRoleAssignmentsApplied: 2, postOverlayRoleAssignments: 10, orphanProfiles: 0, orphanRoleAssignments: 0, bannedUsers: 7, sessionsRestored: false, sourceJwtSecretCopied: false }), 'full reconciliation Auth/session isolation drift')
  check(JSON.stringify(full.storage) === JSON.stringify({ buckets: 1, objects: 32, bytes: 1700978, aggregateSha256: '12000d53bf395a9637638a372778a61f7a821eea3be622e81bec84051f3b379f' }), 'full reconciliation Storage totals/content drift')
  check(exactSet(full.requiredContentFingerprints, ['publicTableContentMd5', 'auth.usersContentMd5', 'auth.identitiesContentMd5', 'schemaSecurity', 'canonicalSha256']) && full.beforeAfterCanonicalShaMustMatch === true, 'full reconciliation content-fingerprint boundary drift')
  check(JSON.stringify(full.allowedPersistentContentDifferencesFromSealedSource) === JSON.stringify([
    { table: 'profile_access_roles', effect: 'authorized-role-overlay-plus-assignment-kind-backfill', rowDeltaFromSignedManifest: 2 },
    { table: 'feature_flags', effect: 'one-team-os-4-supervisor-row-per-missing-team', rowDeltaFromSignedPreflight: 1 },
  ]), 'full reconciliation authorized difference inventory drift')
  check(full.expectedSchemaAndHistoryDifference === 'exact-signed-P1-migration-only' && full.unknownDifferencesAllowed === false, 'full reconciliation schema/history or unknown-difference boundary drift')
  check(JSON.stringify(full.sourceP0Boundary) === JSON.stringify({ signedP0TableRowCountsAreCountsOnly: true, signedP0TargetAfterSha256IsNull: true, p1InitialAndFinalContentFingerprintsRequired: true }), 'legacy P0 counts-only evidence boundary drift')
  check(full.temporarySessionOnly === true && full.persistentDatabaseWrites === false && full.sessionClosedDropsTemporaryState === true, 'full reconciliation temporary-session boundary drift')
  check(full.validationDatabaseCalls === 0 && full.validationStorageCalls === 0 && exactSet(full.fixturePatterns, ['p1-email', 'access-email', 'd400-profile', 'd510-profile']), 'full reconciliation offline validation or fixture-pattern boundary drift')

  const formalResumeFailure = candidate.formalResumeFailureEvidence ?? {}
  const formalResumeEvidenceDirectory = 'D:/CanWin-Team-OS-4.0-P1-Validation/p1-resume-20260719T193911279Z-ea6ed9385d'
  check(formalResumeFailure.runId === 'p1-resume-20260719T193911279Z-ea6ed9385d' && formalResumeFailure.supervisionHeadSha === 'ea6ed9385de7c3ceff5cba6c6f8539f883bbea1d', 'formal resume failure run or head drift')
  check(formalResumeFailure.evidenceDirectory === formalResumeEvidenceDirectory && formalResumeFailure.preflightPath === `${formalResumeEvidenceDirectory}/preflight.json` && formalResumeFailure.failurePath === `${formalResumeEvidenceDirectory}/failure.json`, 'formal resume failure evidence path drift')
  check(formalResumeFailure.preflightSha256 === 'e0ea653d3a411cc9baafbd4b98e7d6d458b99316e8da93a1db1600a21e2dc36a' && formalResumeFailure.failureSha256 === '576a11005285cd708adca5b3486e0b929ace8d97fc3cc3284d657b57519b91ad', 'formal resume failure evidence SHA drift')
  check(formalResumeFailure.startedAtUtc === '2026-07-19T19:39:11.283Z' && formalResumeFailure.failedAtUtc === '2026-07-19T19:40:00.235Z', 'formal resume failure timestamp drift')
  check(formalResumeFailure.failedStep === 'test:database:supabase/tests/notification_core.sql' && formalResumeFailure.firstFailedSqlTest === 'supabase/tests/notification_core.sql' && formalResumeFailure.firstError === 'Notification worker RPC exposed', 'formal resume first failure drift')
  check(formalResumeFailure.testsPassed === 5 && formalResumeFailure.perTestSnapshotsPassed === 5 && formalResumeFailure.fullReconciliationSnapshotsPassed === 6 && formalResumeFailure.storageArchivesPassed === 1, 'formal resume partial acceptance counts drift')
  check(formalResumeFailure.attempts === 1 && formalResumeFailure.persistentRemoteWrites === 0 && formalResumeFailure.productionReads === 0 && formalResumeFailure.productionWrites === 0, 'formal resume attempt or remote-write boundary drift')
  check(formalResumeFailure.secretsPrinted === 0 && formalResumeFailure.secretsWritten === 0 && formalResumeFailure.retryPerformed === false && formalResumeFailure.remoteCleanupPerformed === false && formalResumeFailure.targetPreserved === true, 'formal resume preserve/secret boundary drift')
  check(JSON.stringify(formalResumeFailure.derivedAudit) === JSON.stringify({ directoryFileInventory: ['preflight.json', 'failure.json'], successEvidencePresent: false, derivation: 'directory inventory; fields are not asserted as native failure.json properties' }), 'formal resume derived directory audit drift')

  const expectedAclFunctions = [
    { identity: 'public.enqueue_wecom_notification_jobs(text, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.claim_wecom_notification_jobs(integer, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.complete_wecom_notification_job(uuid, boolean, text, text, timestamp with time zone)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: ['service_role'] },
    { identity: 'public.manage_profile_access(uuid, text[], uuid[])', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
    { identity: 'public.admin_replace_profile_roles(uuid, text[], uuid)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
    { identity: 'public.admin_replace_supervisor_subordinates(uuid, uuid[], uuid)', revokeRoles: ['PUBLIC', 'anon', 'authenticated'], requiredGrantRoles: [] },
  ]
  const aclRepair = candidate.aclRepairCandidate ?? {}
  check(aclRepair.mode === '--apply-acl-repair' && aclRepair.remoteExecutionAllowed === false && aclRepair.dbPushAllowed === false, 'ACL repair local-only mode drift')
  check(aclRepair.migrationVersion === '20260720015435' && aclRepair.migrationPath === 'supabase/migrations/20260720015435_harden_server_only_rpc_acl.sql', 'ACL repair migration identity drift')
  check(aclRepair.migrationSha256Lf === '1bb13f29fc0f5512bd00115dc1c953a2c3aaa0ec21522b1cc8cbb45a18a5cdc0' && aclRepair.migrationSha256Lf === sha256Lf(resolve(repoRoot, aclRepair.migrationPath)), 'ACL repair migration SHA drift')
  check(aclRepair.preMigrationRows === 70 && aclRepair.postMigrationRows === 71 && aclRepair.expectedMigrationCount === 71 && aclRepair.sqlTestCount === 27, 'ACL repair migration or SQL counts drift')
  check(aclRepair.maxFormalAttempts === 1 && aclRepair.maxDbPushAttempts === 1 && aclRepair.dryRunRequired === true && JSON.stringify(aclRepair.pendingMigrationVersions) === JSON.stringify(['20260720015435']), 'ACL repair attempt or dry-run boundary drift')
  check(aclRepair.signedCiHeadSha === null && aclRepair.signedCiRunId === null && aclRepair.signedCiLinuxJobId === null && aclRepair.signedCiWindowsJobId === null && aclRepair.signedCiConclusion === null, 'unsigned ACL repair candidate must not claim signed CI')
  check(JSON.stringify(aclRepair.functions) === JSON.stringify(expectedAclFunctions), 'ACL repair six-function privilege inventory drift')
  check(aclRepair.targetFunctionCount === 6 && aclRepair.expectedChangedFunctionCount === 4 && JSON.stringify(aclRepair.expectedChangedFunctions) === JSON.stringify(expectedAclFunctions.slice(0, 4).map((entry) => entry.identity)), 'ACL repair target-six changed-four boundary drift')
  const expectedChangedTests = [
    { path: 'supabase/tests/notification_core.sql', sha256Lf: 'a3d87069899b986b191bc21826f5e23c65fe4734066e52adc4e14753c9e6e5a3' },
    { path: 'supabase/tests/team_os_4_p1_access_shell.sql', sha256Lf: 'c598b4e4ed3c7e26d9411cb4084685bea1233f47ae969c2685e048f480dac09e' },
  ]
  check(JSON.stringify(aclRepair.changedTests) === JSON.stringify(expectedChangedTests) && aclRepair.changedTests.every((entry) => entry.sha256Lf === sha256Lf(resolve(repoRoot, entry.path))), 'ACL repair changed-test evidence drift')
  const currentRuntime = aclRepair.currentRuntimeArtifacts ?? {}
  check(JSON.stringify(currentRuntime.contract) === JSON.stringify({ path: 'scripts/p1/isolated-runtime-contract.json', sha256Lf: '0c0ccc0f72775ee1e6c6d46771846de88c5054a20b3f75b30a77db40ced08991' }) && currentRuntime.contract.sha256Lf === sha256Lf(resolve(repoRoot, currentRuntime.contract.path)), 'ACL repair current runtime contract SHA drift')
  check(JSON.stringify(currentRuntime.runner) === JSON.stringify({ path: 'scripts/p1/run-isolated-runtime.mjs', sha256Lf: '690dd490c4c66c84ed1d01654c77cdb6cf8ca068b6625c9f44ed78e32c0098ad' }) && currentRuntime.runner.sha256Lf === sha256Lf(resolve(repoRoot, currentRuntime.runner.path)), 'ACL repair current runner SHA drift')
  check(JSON.stringify(currentRuntime.validator) === JSON.stringify({ path: 'scripts/p1/verify-isolated-runtime-runner.mjs', sha256Lf: 'bc237b9b35ca6954a9c4cd6e905ff7a02608ad3509fcd439ba64a5a4882b8da3', assertions: '63/63' }) && currentRuntime.validator.sha256Lf === sha256Lf(resolve(repoRoot, currentRuntime.validator.path)), 'ACL repair current validator SHA or assertion drift')
  const aclFull = aclRepair.fullReconciliation ?? {}
  check(JSON.stringify(aclFull.expected) === JSON.stringify({ migrationRows: 71 }), 'ACL repair full reconciliation expected rows drift')
  check(JSON.stringify(aclFull.execution) === JSON.stringify({ initialFullBeforeRepair: true, fullAfterEverySqlTest: true, perTestFullSnapshots: 27, finalFullAfterFreshCredential: true, beforeAfterAllowedAclTransitionOnly: true, storageArchiveAtInitialAndFinal: true, temporaryTestSessionsOnly: true, persistentDatabaseWrites: 'exactly-one-signed-acl-and-atomic-compatibility-migration', sessionClosedDropsTemp: true }), 'ACL repair full reconciliation execution plan drift')
  check(aclFull.expectedSchemaAndHistoryDifference === 'exact-signed-P1-plus-ACL-repair-migrations-only', 'ACL repair schema/history difference drift')
  const privateTransition = aclRepair.privateRoutineDefinitionTransition ?? {}
  check(JSON.stringify(privateTransition) === JSON.stringify({ expectedChangedFunctions: ['private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)'], expectedDefinitionChanges: 1, requiredSnapshots: 3, identityChangesAllowed: 0, securityEnvelopeChangesAllowed: 0, unknownChangesAllowed: false }), 'private member-access definition transition drift')
  const atomicCompatibility = aclRepair.atomicLegacyRoleCompatibility ?? {}
  check(atomicCompatibility.status === 'static-passed-prior-database-ci-failed-preserved-new-candidate-pending' && atomicCompatibility.staticPassed === true && atomicCompatibility.databaseCiPassed === null && atomicCompatibility.remoteQualificationAllowed === false, 'atomic compatibility current pending boundary drift')
  check(JSON.stringify(atomicCompatibility.mappingPrecedence) === JSON.stringify([{ condition: 'primary-admin', legacyRole: 'admin' }, { condition: 'additional-supervisor', legacyRole: 'captain' }, { condition: 'primary-finance', legacyRole: 'finance' }, { condition: 'additional-warehouse', legacyRole: 'warehouse' }, { condition: 'fallback', legacyRole: 'member' }]), 'atomic compatibility role mapping drift')
  check(atomicCompatibility.writeFunction === 'private.admin_apply_member_access_v1(uuid, text, text[], uuid[], uuid[], text[], uuid)' && atomicCompatibility.successfulMappingCases === 5 && atomicCompatibility.rollbackControls === 2 && atomicCompatibility.sameTeamStaticGuards === 4 && atomicCompatibility.remoteGateNegativeControls === 5 && atomicCompatibility.atomicRemoteGateNegativeControls === 2 && atomicCompatibility.migrationRewritesExistingProfiles === false, 'atomic compatibility evidence totals or remote locks drift')
  check(atomicCompatibility.sqlTestPath === 'supabase/tests/team_os_4_p1_access_shell.sql' && atomicCompatibility.sqlTestSha256Lf === 'c598b4e4ed3c7e26d9411cb4084685bea1233f47ae969c2685e048f480dac09e' && atomicCompatibility.staticTestSha256Lf === 'ab62a1a9db9a3cb07f9b4246a5c3cb8314c39ff3931e99f520584396bd8ccef3' && atomicCompatibility.appShellAssertionsPassed === 99 && atomicCompatibility.appShellAssertionsExpected === 99, 'atomic compatibility source hashes or app assertions drift')
  const aclCompatibility = aclRepair.applicationCompatibility ?? {}
  check(aclCompatibility.status === 'passed' && aclCompatibility.remoteQualificationAllowed === false && JSON.stringify(aclCompatibility.legacyRpcCallSites) === JSON.stringify([]), 'ACL repair application compatibility status drift')
  check(JSON.stringify(aclCompatibility.resolvedEvidence) === JSON.stringify({ files: ['src/features/access-admin/supabaseDataSource.ts', 'supabase/functions/admin-members/index.ts'], forbiddenRpcNames: ['manage_profile_access', 'admin_replace_profile_roles', 'admin_replace_supervisor_subordinates'], staticCallSitesRemaining: 0, appShellAssertionsPassed: 99, appShellAssertionsExpected: 99, warehouseBackendRelaxed: false, formalStaticGateCoverage: { gate: 16, serial: true, runnerValidatorPassed: true, appShellPassed: true, accessV1BehaviorPassed: true } }), 'ACL repair application compatibility evidence drift')
  check(aclCompatibility.requiredOutcome === 'all-old-role-and-supervisor-writers-replaced-and-accepted' && aclCompatibility.g1BlockedUntilAclAndPageAcceptance === true, 'ACL repair compatibility or G1 safety boundary drift')
  check(JSON.stringify(aclRepair.allowedFullReconciliationDifferences) === JSON.stringify(['migrationHistory.schemaMigrations', 'schemaSecurity.publicRoutinesMd5']) && aclRepair.unknownDifferencesAllowed === false, 'ACL repair reconciliation allowlist drift')

  const repairCi = candidate.repairCiRunEvidence ?? {}
  check(repairCi.runId === '29726897764' && repairCi.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29726897764' && repairCi.headSha === 'e774ead5a2857afb511400a12897e629033cf941' && repairCi.linuxJobId === '88301987239' && repairCi.windowsJobId === '88301987280', 'failed ACL repair CI identity drift')
  check(repairCi.conclusion === 'failure' && repairCi.linuxConclusion === 'failure' && repairCi.windowsConclusion === 'success' && repairCi.failedStep === 'Run database permission and business gates', 'failed ACL repair CI platform result drift')
  check(repairCi.firstFailedSqlTest === 'supabase/tests/team_os_4_p1_access_shell.sql' && repairCi.rootCauseCode === 'p1_audit_expected_aggregate_6_actual_7' && repairCi.rootCauseStatus === 'confirmed' && repairCi.firstError === 'P1 access mutations did not create exact audit evidence: 7', 'failed ACL repair CI root cause drift')
  check(repairCi.migrationsPassed === 71 && repairCi.sqlTestsStarted === 18 && repairCi.sqlTestsPassed === 17 && repairCi.databaseTestsPassed === 7 && repairCi.permissionTestsPassed === 10 && repairCi.businessTestsPassed === 0 && repairCi.catalogAssertionsPassed === 0, 'failed ACL repair CI database counts drift')
  check(repairCi.failedAssertionExpectedAuditRows === 6 && repairCi.failedAssertionActualAuditRows === 7 && JSON.stringify(repairCi.correctedExpectedAuditRowsByAction) === JSON.stringify({ memberAccess: 5, supervisorSystem: 1, supervisorScope: 1 }), 'failed ACL repair audit evidence drift')
  check(repairCi.windowsStaticGatesExpected === 19 && repairCi.windowsStaticGatesPassed === 19 && repairCi.windowsLocalIntegrationStepsExpected === 12 && repairCi.windowsLocalIntegrationStepsPassed === 12, 'failed ACL repair CI Windows success counts drift')
  check(repairCi.cleanupPassed === true && repairCi.repositorySecretsRequired === false && repairCi.productionReadPerformed === false && repairCi.productionWritePerformed === false && repairCi.rerunPerformed === false && repairCi.preservedWithoutRerun === true && repairCi.candidateRemoteExecutionAllowed === false && repairCi.g1OverallClaim === false, 'failed ACL repair CI safety boundary drift')

  const attempts = candidate.formalAttemptHistory ?? []
  check(attempts.length === 25, 'formal attempt history count drift')
  const aclRepairAuditAttempt = attempts[24] ?? {}
  check(JSON.stringify(aclRepairAuditAttempt) === JSON.stringify({ runId: '29726897764', runUrl: 'https://github.com/yccanwin/canwin-team-os/actions/runs/29726897764', jobId: '88301987239', windowsJobId: '88301987280', headSha: 'e774ead5a2857afb511400a12897e629033cf941', conclusion: 'failure', failedStep: 'Run database permission and business gates', rootCauseCode: 'p1_audit_expected_aggregate_6_actual_7', rootCauseStatus: 'confirmed', windowsLocalGatePassed: true, windowsStaticGatesExpected: 19, windowsStaticGatesPassed: 19, windowsLocalIntegrationStepsExpected: 12, windowsLocalIntegrationStepsPassed: 12, databaseStartupPassed: true, baselinePassed: true, migrationsPassed: 71, sqlTestsStarted: 18, sqlTestsPassed: 17, databaseTestsPassed: 7, permissionTestsPassed: 10, businessTestsPassed: 0, firstFailedTest: 'supabase/tests/team_os_4_p1_access_shell.sql', firstFailure: 'P1 access mutations did not create exact audit evidence: 7', failedAssertionExpectedAuditRows: 6, failedAssertionActualAuditRows: 7, catalogAssertionsPassed: 0, cleanupPassed: true, repositorySecretsRequired: false, productionReadPerformed: false, productionWritePerformed: false, rerunOfFailedRun: false, preservedWithoutRerun: true, pageAccountAcceptancePassed: false, g1OverallClaim: false }), 'latest ACL repair audit-count CI attempt drift')
  const failedAttempt = attempts[0] ?? {}
  check(failedAttempt.runId === '29680934378', 'failed run id drift')
  check(failedAttempt.jobId === '88176860842', 'failed job id drift')
  check(failedAttempt.headSha === '9d3b0d2a0c2569367dcfcfb0b41e696b4886d185', 'failed head SHA drift')
  check(failedAttempt.conclusion === 'failure', 'failed attempt conclusion drift')
  check(failedAttempt.failedStep === 'Start isolated local Postgres', 'failed step drift')
  check(failedAttempt.rootCauseCode === 'full_stack_exclusion_name_drift', 'failed root cause drift')
  check(failedAttempt.sqlTestsStarted === false, 'failed attempt must not claim SQL execution')
  check(failedAttempt.cleanupPassed === true, 'failed attempt cleanup evidence missing')
  check(failedAttempt.productionReadPerformed === false, 'failed attempt production read must remain false')
  check(failedAttempt.productionWritePerformed === false, 'failed attempt production write must remain false')
  check(failedAttempt.rerunOfFailedRun === false, 'failed run must not be represented as rerun')
  const testAttempt = attempts[1] ?? {}
  check(testAttempt.runId === '29681166438', 'test run id drift')
  check(testAttempt.jobId === '88177487346', 'test job id drift')
  check(testAttempt.headSha === 'd618e3293e751fa8821df8c38a9147644fd2f6c3', 'test run head SHA drift')
  check(testAttempt.conclusion === 'failure', 'test run conclusion drift')
  check(testAttempt.failedStep === 'Run database permission and business gates', 'test run failed step drift')
  check(testAttempt.rootCauseCode === 'post_chain_test_expected_pre_pilot_flag_state', 'test run root cause drift')
  check(testAttempt.databaseStartupPassed === true, 'database startup success evidence missing')
  check(testAttempt.baselinePassed === true, 'baseline success evidence missing')
  check(testAttempt.migrationsPassed === 69, 'migration success count drift')
  check(testAttempt.sqlTestsStarted === 1 && testAttempt.sqlTestsPassed === 0, 'test execution count drift')
  check(testAttempt.firstFailedTest === 'supabase/tests/access_control_foundation.sql', 'first failed test drift')
  check(testAttempt.cleanupPassed === true, 'test run cleanup evidence missing')
  check(testAttempt.productionReadPerformed === false, 'test run production read must remain false')
  check(testAttempt.productionWritePerformed === false, 'test run production write must remain false')
  check(testAttempt.rerunOfFailedRun === false, 'test run must be a new candidate, not a failed-run rerun')
  const qualificationAttempt = attempts[2] ?? {}
  check(qualificationAttempt.runId === '29681350750', 'qualification run id drift')
  check(qualificationAttempt.jobId === '88177979675', 'qualification job id drift')
  check(qualificationAttempt.headSha === 'b86b6415d4576bf3095382a2c52d65caf16f6bd4', 'qualification run head SHA drift')
  check(qualificationAttempt.conclusion === 'failure', 'qualification run conclusion drift')
  check(qualificationAttempt.failedStep === 'Run database permission and business gates', 'qualification run failed step drift')
  check(qualificationAttempt.rootCauseCode === 'post_chain_test_expected_pre_relaxation_qualification', 'qualification run root cause drift')
  check(qualificationAttempt.databaseStartupPassed === true, 'qualification run database startup evidence missing')
  check(qualificationAttempt.baselinePassed === true, 'qualification run baseline evidence missing')
  check(qualificationAttempt.migrationsPassed === 69, 'qualification run migration count drift')
  check(qualificationAttempt.sqlTestsStarted === 2 && qualificationAttempt.sqlTestsPassed === 1, 'qualification run test count drift')
  check(qualificationAttempt.firstFailedTest === 'supabase/tests/crm_core.sql', 'qualification first failed test drift')
  check(qualificationAttempt.cleanupPassed === true, 'qualification run cleanup evidence missing')
  check(qualificationAttempt.productionReadPerformed === false, 'qualification run production read must remain false')
  check(qualificationAttempt.productionWritePerformed === false, 'qualification run production write must remain false')
  check(qualificationAttempt.rerunOfFailedRun === false, 'qualification run must remain a new candidate')
  const addressAttempt = attempts[3] ?? {}
  check(addressAttempt.runId === '29681529637', 'address run id drift')
  check(addressAttempt.jobId === '88178429672', 'address job id drift')
  check(addressAttempt.headSha === '93383912475c643707c6896e9e630a0a96cdb351', 'address run head SHA drift')
  check(addressAttempt.conclusion === 'failure', 'address run conclusion drift')
  check(addressAttempt.failedStep === 'Run database permission and business gates', 'address run failed step drift')
  check(addressAttempt.rootCauseCode === 'post_chain_test_missing_final_address_column', 'address run root cause drift')
  check(addressAttempt.databaseStartupPassed === true, 'address run database startup evidence missing')
  check(addressAttempt.baselinePassed === true, 'address run baseline evidence missing')
  check(addressAttempt.migrationsPassed === 69, 'address run migration count drift')
  check(addressAttempt.sqlTestsStarted === 2 && addressAttempt.sqlTestsPassed === 1, 'address run test count drift')
  check(addressAttempt.firstFailedTest === 'supabase/tests/crm_core.sql', 'address first failed test drift')
  check(addressAttempt.qualificationAssertionPassed === true, 'address run prior qualification assertion evidence missing')
  check(addressAttempt.cleanupPassed === true, 'address run cleanup evidence missing')
  check(addressAttempt.productionReadPerformed === false, 'address run production read must remain false')
  check(addressAttempt.productionWritePerformed === false, 'address run production write must remain false')
  check(addressAttempt.rerunOfFailedRun === false, 'address run must remain a new candidate')
  const lexicalAttempt = attempts[4] ?? {}
  check(lexicalAttempt.runId === '29681693222', 'lexical run id drift')
  check(lexicalAttempt.jobId === '88178855663', 'lexical job id drift')
  check(lexicalAttempt.headSha === '5c4b42989716dac883f33f7062a49a5b06fb3c65', 'lexical run head SHA drift')
  check(lexicalAttempt.conclusion === 'failure', 'lexical run conclusion drift')
  check(lexicalAttempt.failedStep === 'Run database permission and business gates', 'lexical run failed step drift')
  check(lexicalAttempt.rootCauseCode === 'sql_keyword_dollar_quote_missing_separator', 'lexical run root cause drift')
  check(lexicalAttempt.databaseStartupPassed === true, 'lexical run database startup evidence missing')
  check(lexicalAttempt.baselinePassed === true, 'lexical run baseline evidence missing')
  check(lexicalAttempt.migrationsPassed === 69, 'lexical run migration count drift')
  check(lexicalAttempt.sqlTestsStarted === 3 && lexicalAttempt.sqlTestsPassed === 2, 'lexical run test count drift')
  check(lexicalAttempt.firstFailedTest === 'supabase/tests/customer_import.sql', 'lexical first failed test drift')
  check(lexicalAttempt.classwideAffectedFiles === 14 && lexicalAttempt.classwideOccurrences === 17, 'lexical classwide evidence drift')
  check(lexicalAttempt.cleanupPassed === true, 'lexical run cleanup evidence missing')
  check(lexicalAttempt.productionReadPerformed === false, 'lexical run production read must remain false')
  check(lexicalAttempt.productionWritePerformed === false, 'lexical run production write must remain false')
  check(lexicalAttempt.rerunOfFailedRun === false, 'lexical run must remain a new candidate')
  const importPolicyAttempt = attempts[5] ?? {}
  check(importPolicyAttempt.runId === '29681885277', 'import policy run id drift')
  check(importPolicyAttempt.jobId === '88179367094', 'import policy job id drift')
  check(importPolicyAttempt.headSha === 'acd6e18ddf1a0335940893e7801242e0833525b9', 'import policy run head SHA drift')
  check(importPolicyAttempt.conclusion === 'failure', 'import policy run conclusion drift')
  check(importPolicyAttempt.failedStep === 'Run database permission and business gates', 'import policy run failed step drift')
  check(importPolicyAttempt.rootCauseCode === 'restrictive_all_policy_misclassified_as_write_grant', 'import policy run root cause drift')
  check(importPolicyAttempt.databaseStartupPassed === true, 'import policy run database startup evidence missing')
  check(importPolicyAttempt.baselinePassed === true, 'import policy run baseline evidence missing')
  check(importPolicyAttempt.migrationsPassed === 69, 'import policy run migration count drift')
  check(importPolicyAttempt.sqlTestsStarted === 3 && importPolicyAttempt.sqlTestsPassed === 2, 'import policy run test count drift')
  check(importPolicyAttempt.firstFailedTest === 'supabase/tests/customer_import.sql', 'import policy first failed test drift')
  check(importPolicyAttempt.sqlParsingPassed === true, 'import policy run SQL parsing evidence missing')
  check(importPolicyAttempt.cleanupPassed === true, 'import policy run cleanup evidence missing')
  check(importPolicyAttempt.productionReadPerformed === false, 'import policy run production read must remain false')
  check(importPolicyAttempt.productionWritePerformed === false, 'import policy run production write must remain false')
  check(importPolicyAttempt.rerunOfFailedRun === false, 'import policy run must remain a new candidate')
  const dealPolicyAttempt = attempts[6] ?? {}
  check(dealPolicyAttempt.runId === '29682072414', 'deal policy run id drift')
  check(dealPolicyAttempt.jobId === '88179873895', 'deal policy job id drift')
  check(dealPolicyAttempt.headSha === '28bac3035f30e725ed7d77bab7fe2c319873fa2a', 'deal policy run head SHA drift')
  check(dealPolicyAttempt.conclusion === 'failure', 'deal policy run conclusion drift')
  check(dealPolicyAttempt.failedStep === 'Run database permission and business gates', 'deal policy run failed step drift')
  check(dealPolicyAttempt.rootCauseCode === 'restrictive_all_deal_history_policy_misclassified_as_write_grant', 'deal policy run root cause drift')
  check(dealPolicyAttempt.databaseStartupPassed === true, 'deal policy run database startup evidence missing')
  check(dealPolicyAttempt.baselinePassed === true, 'deal policy run baseline evidence missing')
  check(dealPolicyAttempt.migrationsPassed === 69, 'deal policy run migration count drift')
  check(dealPolicyAttempt.sqlTestsStarted === 4 && dealPolicyAttempt.sqlTestsPassed === 3, 'deal policy run test count drift')
  check(dealPolicyAttempt.firstFailedTest === 'supabase/tests/deal_core.sql', 'deal policy first failed test drift')
  check(dealPolicyAttempt.priorImportPolicyAssertionPassed === true, 'deal policy prior import assertion evidence missing')
  check(dealPolicyAttempt.classwideAffectedFiles === 5 && dealPolicyAttempt.classwideOccurrences === 6, 'deal policy classwide evidence drift')
  check(dealPolicyAttempt.cleanupPassed === true, 'deal policy run cleanup evidence missing')
  check(dealPolicyAttempt.productionReadPerformed === false, 'deal policy run production read must remain false')
  check(dealPolicyAttempt.productionWritePerformed === false, 'deal policy run production write must remain false')
  check(dealPolicyAttempt.rerunOfFailedRun === false, 'deal policy run must remain a new candidate')
  const definitionAttempt = attempts[7] ?? {}
  check(definitionAttempt.runId === '29682375531', 'definition run id drift')
  check(definitionAttempt.jobId === '88180699827', 'definition run job id drift')
  check(definitionAttempt.headSha === '4d32968521acf264aa6079fa160425f01926438f', 'definition run head SHA drift')
  check(definitionAttempt.conclusion === 'failure', 'definition run conclusion drift')
  check(definitionAttempt.failedStep === 'Run database permission and business gates', 'definition run failed step drift')
  check(definitionAttempt.rootCauseCode === 'definition_fragment_whitespace_sensitive', 'definition run root cause drift')
  check(definitionAttempt.databaseStartupPassed === true, 'definition run database startup evidence missing')
  check(definitionAttempt.baselinePassed === true, 'definition run baseline evidence missing')
  check(definitionAttempt.migrationsPassed === 69, 'definition run migration count drift')
  check(definitionAttempt.sqlTestsStarted === 5 && definitionAttempt.sqlTestsPassed === 4, 'definition run test count drift')
  check(definitionAttempt.firstFailedTest === 'supabase/tests/fulfillment_core.sql', 'definition first failed test drift')
  check(definitionAttempt.priorDealCorePassed === true, 'definition run prior deal assertion evidence missing')
  check(definitionAttempt.classwideAffectedFiles === 6 && definitionAttempt.classwideOccurrences === 15, 'definition classwide evidence drift')
  check(definitionAttempt.cleanupPassed === true, 'definition run cleanup evidence missing')
  check(definitionAttempt.productionReadPerformed === false, 'definition run production read must remain false')
  check(definitionAttempt.productionWritePerformed === false, 'definition run production write must remain false')
  check(definitionAttempt.rerunOfFailedRun === false, 'definition run must remain a new candidate')
  const finalDefinitionAttempt = attempts[8] ?? {}
  check(finalDefinitionAttempt.runId === '29682720564', 'final definition run id drift')
  check(finalDefinitionAttempt.jobId === '88181631622', 'final definition run job id drift')
  check(finalDefinitionAttempt.headSha === '6271791cc70bc514ebc627eb4e5ac0100d11ca95', 'final definition run head SHA drift')
  check(finalDefinitionAttempt.conclusion === 'failure', 'final definition run conclusion drift')
  check(finalDefinitionAttempt.failedStep === 'Run database permission and business gates', 'final definition run failed step drift')
  check(finalDefinitionAttempt.rootCauseCode === 'test_expected_foundation_notification_attempt_variable', 'final definition run root cause drift')
  check(finalDefinitionAttempt.databaseStartupPassed === true, 'final definition run database startup evidence missing')
  check(finalDefinitionAttempt.baselinePassed === true, 'final definition run baseline evidence missing')
  check(finalDefinitionAttempt.migrationsPassed === 69, 'final definition run migration count drift')
  check(finalDefinitionAttempt.sqlTestsStarted === 6 && finalDefinitionAttempt.sqlTestsPassed === 5, 'final definition run test count drift')
  check(finalDefinitionAttempt.firstFailedTest === 'supabase/tests/notification_core.sql', 'final definition first failed test drift')
  check(finalDefinitionAttempt.priorFulfillmentPassed === true, 'final definition run prior fulfillment evidence missing')
  check(finalDefinitionAttempt.definitionReferencedObjects === 52 && finalDefinitionAttempt.redefinedReferencedObjects === 28, 'final definition classwide evidence drift')
  check(finalDefinitionAttempt.cleanupPassed === true, 'final definition run cleanup evidence missing')
  check(finalDefinitionAttempt.productionReadPerformed === false, 'final definition run production read must remain false')
  check(finalDefinitionAttempt.productionWritePerformed === false, 'final definition run production write must remain false')
  check(finalDefinitionAttempt.rerunOfFailedRun === false, 'final definition run must remain a new candidate')
  const wrapperDefinitionAttempt = attempts[9] ?? {}
  check(wrapperDefinitionAttempt.runId === '29683060597', 'wrapper definition run id drift')
  check(wrapperDefinitionAttempt.jobId === '88182532072', 'wrapper definition run job id drift')
  check(wrapperDefinitionAttempt.headSha === '0f4e44ef76bf5a44fc771d4c238a3ac4c1b5aecb', 'wrapper definition run head SHA drift')
  check(wrapperDefinitionAttempt.conclusion === 'failure', 'wrapper definition run conclusion drift')
  check(wrapperDefinitionAttempt.failedStep === 'Run database permission and business gates', 'wrapper definition run failed step drift')
  check(wrapperDefinitionAttempt.rootCauseCode === 'wrapper_view_misclassified_as_profit_definition', 'wrapper definition run root cause drift')
  check(wrapperDefinitionAttempt.databaseStartupPassed === true, 'wrapper definition run database startup evidence missing')
  check(wrapperDefinitionAttempt.baselinePassed === true, 'wrapper definition run baseline evidence missing')
  check(wrapperDefinitionAttempt.migrationsPassed === 69, 'wrapper definition run migration count drift')
  check(wrapperDefinitionAttempt.sqlTestsStarted === 7 && wrapperDefinitionAttempt.sqlTestsPassed === 6, 'wrapper definition run test count drift')
  check(wrapperDefinitionAttempt.firstFailedTest === 'supabase/tests/performance_core.sql', 'wrapper definition first failed test drift')
  check(wrapperDefinitionAttempt.priorNotificationPassed === true, 'wrapper definition prior notification evidence missing')
  check(wrapperDefinitionAttempt.classwideAffectedTests === 2, 'wrapper definition classwide evidence drift')
  check(wrapperDefinitionAttempt.cleanupPassed === true, 'wrapper definition run cleanup evidence missing')
  check(wrapperDefinitionAttempt.productionReadPerformed === false, 'wrapper definition run production read must remain false')
  check(wrapperDefinitionAttempt.productionWritePerformed === false, 'wrapper definition run production write must remain false')
  check(wrapperDefinitionAttempt.rerunOfFailedRun === false, 'wrapper definition run must remain a new candidate')
  const overloadAttempt = attempts[10] ?? {}
  check(overloadAttempt.runId === '29683422624', 'overload run id drift')
  check(overloadAttempt.jobId === '88183512644', 'overload run job id drift')
  check(overloadAttempt.headSha === 'c13ce512a9304f5b134fe14f8a08d170bbf3ad12', 'overload run head SHA drift')
  check(overloadAttempt.conclusion === 'failure', 'overload run conclusion drift')
  check(overloadAttempt.failedStep === 'Run database permission and business gates', 'overload run failed step drift')
  check(overloadAttempt.rootCauseCode === 'compatibility_overload_misclassified_as_security_implementation', 'overload run root cause drift')
  check(overloadAttempt.databaseStartupPassed === true, 'overload run database startup evidence missing')
  check(overloadAttempt.baselinePassed === true, 'overload run baseline evidence missing')
  check(overloadAttempt.migrationsPassed === 69, 'overload run migration count drift')
  check(overloadAttempt.sqlTestsStarted === 13 && overloadAttempt.sqlTestsPassed === 12, 'overload run test count drift')
  check(overloadAttempt.databaseTestsPassed === 7 && overloadAttempt.permissionTestsPassed === 5, 'overload run category evidence drift')
  check(overloadAttempt.firstFailedTest === 'supabase/tests/operations_lead_submission.sql', 'overload first failed test drift')
  check(overloadAttempt.overloadLayersAudited === 3, 'overload classwide layer evidence drift')
  check(overloadAttempt.cleanupPassed === true, 'overload run cleanup evidence missing')
  check(overloadAttempt.productionReadPerformed === false, 'overload run production read must remain false')
  check(overloadAttempt.productionWritePerformed === false, 'overload run production write must remain false')
  check(overloadAttempt.rerunOfFailedRun === false, 'overload run must remain a new candidate')
  const orderFixtureAttempt = attempts[11] ?? {}
  check(orderFixtureAttempt.runId === '29684109383', 'order fixture run id drift')
  check(orderFixtureAttempt.jobId === '88185320892', 'order fixture run job id drift')
  check(orderFixtureAttempt.headSha === '11ebcd6d54bef8dc2dc7ae914a899de5dc9875c1', 'order fixture run head SHA drift')
  check(orderFixtureAttempt.conclusion === 'failure', 'order fixture run conclusion drift')
  check(orderFixtureAttempt.failedStep === 'Run database permission and business gates', 'order fixture run failed step drift')
  check(orderFixtureAttempt.rootCauseCode === 'direct_order_fixture_missing_final_required_order_number', 'order fixture run root cause drift')
  check(orderFixtureAttempt.databaseStartupPassed === true, 'order fixture run database startup evidence missing')
  check(orderFixtureAttempt.baselinePassed === true, 'order fixture run baseline evidence missing')
  check(orderFixtureAttempt.migrationsPassed === 69, 'order fixture run migration count drift')
  check(orderFixtureAttempt.sqlTestsStarted === 22 && orderFixtureAttempt.sqlTestsPassed === 21, 'order fixture run test count drift')
  check(orderFixtureAttempt.databaseTestsPassed === 7 && orderFixtureAttempt.permissionTestsPassed === 10 && orderFixtureAttempt.businessTestsPassed === 4, 'order fixture run category evidence drift')
  check(orderFixtureAttempt.firstFailedTest === 'supabase/tests/hardware_inventory_behavior.sql', 'order fixture first failed test drift')
  check(orderFixtureAttempt.classwideAffectedTests === 2, 'order fixture classwide evidence drift')
  check(orderFixtureAttempt.cleanupPassed === true, 'order fixture run cleanup evidence missing')
  check(orderFixtureAttempt.productionReadPerformed === false, 'order fixture run production read must remain false')
  check(orderFixtureAttempt.productionWritePerformed === false, 'order fixture run production write must remain false')
  check(orderFixtureAttempt.rerunOfFailedRun === false, 'order fixture run must remain a new candidate')
  const viewIntervalAttempt = attempts[12] ?? {}
  check(viewIntervalAttempt.runId === '29684566675', 'view interval run id drift')
  check(viewIntervalAttempt.jobId === '88186502776', 'view interval run job id drift')
  check(viewIntervalAttempt.headSha === 'aa71c2d45093dce6bfd37442955d5d28a5bc13fa', 'view interval run head SHA drift')
  check(viewIntervalAttempt.conclusion === 'failure', 'view interval run conclusion drift')
  check(viewIntervalAttempt.failedStep === 'Run database permission and business gates', 'view interval run failed step drift')
  check(viewIntervalAttempt.rootCauseCode === 'view_interval_literal_deparsed_to_canonical_time', 'view interval run root cause drift')
  check(viewIntervalAttempt.databaseStartupPassed === true, 'view interval run database startup evidence missing')
  check(viewIntervalAttempt.baselinePassed === true, 'view interval run baseline evidence missing')
  check(viewIntervalAttempt.migrationsPassed === 69, 'view interval run migration count drift')
  check(viewIntervalAttempt.sqlTestsStarted === 26 && viewIntervalAttempt.sqlTestsPassed === 25, 'view interval run test count drift')
  check(viewIntervalAttempt.databaseTestsPassed === 7 && viewIntervalAttempt.permissionTestsPassed === 10 && viewIntervalAttempt.businessTestsPassed === 8, 'view interval run category evidence drift')
  check(viewIntervalAttempt.firstFailedTest === 'supabase/tests/sales_automation.sql', 'view interval first failed test drift')
  check(viewIntervalAttempt.priorHardwareTestsPassed === 2, 'view interval prior hardware fixture evidence drift')
  check(viewIntervalAttempt.cleanupPassed === true, 'view interval run cleanup evidence missing')
  check(viewIntervalAttempt.productionReadPerformed === false, 'view interval run production read must remain false')
  check(viewIntervalAttempt.productionWritePerformed === false, 'view interval run production write must remain false')
  check(viewIntervalAttempt.rerunOfFailedRun === false, 'view interval run must remain a new candidate')
  const leadColumnAttempt = attempts[13] ?? {}
  check(leadColumnAttempt.runId === '29685099429', 'lead column run id drift')
  check(leadColumnAttempt.jobId === '88187913476', 'lead column run job id drift')
  check(leadColumnAttempt.headSha === '473a69df42cda1bc5c928b894e1624881206c7a3', 'lead column run head SHA drift')
  check(leadColumnAttempt.conclusion === 'failure', 'lead column run conclusion drift')
  check(leadColumnAttempt.failedStep === 'Run database permission and business gates', 'lead column run failed step drift')
  check(leadColumnAttempt.rootCauseCode === 'sales_automation_expected_pre_address_view_columns', 'lead column run root cause drift')
  check(leadColumnAttempt.databaseStartupPassed === true, 'lead column run database startup evidence missing')
  check(leadColumnAttempt.baselinePassed === true, 'lead column run baseline evidence missing')
  check(leadColumnAttempt.migrationsPassed === 69, 'lead column run migration count drift')
  check(leadColumnAttempt.sqlTestsStarted === 26 && leadColumnAttempt.sqlTestsPassed === 25, 'lead column run test count drift')
  check(leadColumnAttempt.databaseTestsPassed === 7 && leadColumnAttempt.permissionTestsPassed === 10 && leadColumnAttempt.businessTestsPassed === 8, 'lead column run category evidence drift')
  check(leadColumnAttempt.firstFailedTest === 'supabase/tests/sales_automation.sql', 'lead column first failed test drift')
  check(leadColumnAttempt.priorViewIntervalAssertionPassed === true, 'lead column prior interval assertion evidence missing')
  check(leadColumnAttempt.classwideExactAssertionsAudited === 2, 'lead column classwide audit evidence drift')
  check(leadColumnAttempt.cleanupPassed === true, 'lead column run cleanup evidence missing')
  check(leadColumnAttempt.productionReadPerformed === false, 'lead column run production read must remain false')
  check(leadColumnAttempt.productionWritePerformed === false, 'lead column run production write must remain false')
  check(leadColumnAttempt.rerunOfFailedRun === false, 'lead column run must remain a new candidate')
  const retiredSignatureAttempt = attempts[14] ?? {}
  check(retiredSignatureAttempt.runId === '29685639756', 'retired signature run id drift')
  check(retiredSignatureAttempt.jobId === '88189304998', 'retired signature run job id drift')
  check(retiredSignatureAttempt.headSha === 'b4315a373963a02f04e26e6494f12633828fbd9b', 'retired signature run head SHA drift')
  check(retiredSignatureAttempt.conclusion === 'failure', 'retired signature run conclusion drift')
  check(retiredSignatureAttempt.failedStep === 'Run database permission and business gates', 'retired signature run failed step drift')
  check(retiredSignatureAttempt.rootCauseCode === 'sales_automation_referenced_retired_five_argument_supervisor_resolution_signature', 'retired signature run root cause drift')
  check(retiredSignatureAttempt.windowsLocalGatePassed === true, 'retired signature Windows gate evidence missing')
  check(retiredSignatureAttempt.databaseStartupPassed === true, 'retired signature database startup evidence missing')
  check(retiredSignatureAttempt.baselinePassed === true, 'retired signature baseline evidence missing')
  check(retiredSignatureAttempt.migrationsPassed === 69, 'retired signature migration count drift')
  check(retiredSignatureAttempt.sqlTestsStarted === 26 && retiredSignatureAttempt.sqlTestsPassed === 25, 'retired signature test count drift')
  check(retiredSignatureAttempt.databaseTestsPassed === 7 && retiredSignatureAttempt.permissionTestsPassed === 10 && retiredSignatureAttempt.businessTestsPassed === 8, 'retired signature category evidence drift')
  check(retiredSignatureAttempt.firstFailedTest === 'supabase/tests/sales_automation.sql', 'retired signature first failed test drift')
  check(retiredSignatureAttempt.priorLeadViewColumnAssertionPassed === true, 'retired signature prior lead-column assertion evidence missing')
  check(retiredSignatureAttempt.retiredFunctionIdentityReferences === 5, 'retired signature affected reference count drift')
  check(retiredSignatureAttempt.classwideFunctionIdentityReferencesAudited === 189, 'retired signature classwide audit evidence drift')
  check(retiredSignatureAttempt.catalogAssertionsStarted === 0, 'retired signature catalog start boundary drift')
  check(retiredSignatureAttempt.cleanupPassed === true, 'retired signature cleanup evidence missing')
  check(retiredSignatureAttempt.productionReadPerformed === false, 'retired signature production read must remain false')
  check(retiredSignatureAttempt.productionWritePerformed === false, 'retired signature production write must remain false')
  check(retiredSignatureAttempt.rerunOfFailedRun === false, 'retired signature run must remain a new candidate')
  const successfulAttempt = attempts[15] ?? {}
  check(successfulAttempt.runId === '29686358159', 'successful run id drift')
  check(successfulAttempt.jobId === '88191171416', 'successful Linux job id drift')
  check(successfulAttempt.windowsJobId === '88191171335', 'successful Windows job id drift')
  check(successfulAttempt.headSha === 'f90fb2ee9dff365a6388049cbe9820e4ac0a771f', 'successful run head SHA drift')
  check(successfulAttempt.conclusion === 'success', 'successful run conclusion drift')
  check(successfulAttempt.windowsLocalGatePassed === true, 'successful Windows gate evidence missing')
  check(successfulAttempt.databaseStartupPassed === true, 'successful database startup evidence missing')
  check(successfulAttempt.baselinePassed === true, 'successful baseline evidence missing')
  check(successfulAttempt.migrationsPassed === 69, 'successful migration count drift')
  check(successfulAttempt.sqlTestsStarted === 26 && successfulAttempt.sqlTestsPassed === 26, 'successful SQL test count drift')
  check(successfulAttempt.databaseTestsPassed === 7 && successfulAttempt.permissionTestsPassed === 10 && successfulAttempt.businessTestsPassed === 9, 'successful category evidence drift')
  check(successfulAttempt.catalogAssertionsPassed === 4, 'successful catalog assertion count drift')
  check(successfulAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK', 'successful marker drift')
  check(successfulAttempt.cleanupPassed === true, 'successful cleanup evidence missing')
  check(successfulAttempt.repositorySecretsRequired === false, 'successful run repository secret boundary drift')
  check(successfulAttempt.productionReadPerformed === false, 'successful run production read must remain false')
  check(successfulAttempt.productionWritePerformed === false, 'successful run production write must remain false')
  check(successfulAttempt.rerunOfFailedRun === false, 'successful run must remain a new candidate')
  const p1FixtureAttempt = attempts[16] ?? {}
  check(p1FixtureAttempt.runId === '29690060130', 'P1 fixture run id drift')
  check(p1FixtureAttempt.jobId === '88201083572', 'P1 fixture Linux job id drift')
  check(p1FixtureAttempt.windowsJobId === '88201083600', 'P1 fixture Windows job id drift')
  check(p1FixtureAttempt.headSha === '0a8fc72e17ee018638f96c6062cdd9a29362e334', 'P1 fixture head SHA drift')
  check(p1FixtureAttempt.conclusion === 'failure', 'P1 fixture run conclusion drift')
  check(p1FixtureAttempt.windowsLocalGatePassed === true, 'P1 fixture Windows gate evidence missing')
  check(p1FixtureAttempt.databaseStartupPassed === true && p1FixtureAttempt.baselinePassed === true, 'P1 fixture database startup or baseline evidence missing')
  check(p1FixtureAttempt.migrationsPassed === 70, 'P1 fixture migration count drift')
  check(p1FixtureAttempt.sqlTestsStarted === 18 && p1FixtureAttempt.sqlTestsPassed === 17, 'P1 fixture test count drift')
  check(p1FixtureAttempt.databaseTestsPassed === 7 && p1FixtureAttempt.permissionTestsPassed === 10 && p1FixtureAttempt.businessTestsPassed === 0, 'P1 fixture category evidence drift')
  check(p1FixtureAttempt.firstFailedTest === 'supabase/tests/team_os_4_p1_access_shell.sql', 'P1 fixture first failed test drift')
  check(p1FixtureAttempt.firstFailure === 'profiles_pkey duplicate after Auth trigger created the profile fixture', 'P1 fixture root cause drift')
  check(p1FixtureAttempt.catalogAssertionsStarted === 0, 'P1 fixture catalog start boundary drift')
  check(p1FixtureAttempt.cleanupPassed === true, 'P1 fixture cleanup evidence missing')
  check(p1FixtureAttempt.repositorySecretsRequired === false, 'P1 fixture repository secret boundary drift')
  check(p1FixtureAttempt.productionReadPerformed === false && p1FixtureAttempt.productionWritePerformed === false, 'P1 fixture production boundary drift')
  check(p1FixtureAttempt.rerunOfFailedRun === false, 'P1 fixture attempt must remain an independent candidate')
  const p1SuccessfulAttempt = attempts[17] ?? {}
  check(p1SuccessfulAttempt.runId === '29691027458', 'successful P1 run id drift')
  check(p1SuccessfulAttempt.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29691027458', 'successful P1 run URL drift')
  check(p1SuccessfulAttempt.jobId === '88203660504', 'successful P1 Linux job id drift')
  check(p1SuccessfulAttempt.windowsJobId === '88203660515', 'successful P1 Windows job id drift')
  check(p1SuccessfulAttempt.headSha === 'ed853ebbab250f562d03f433f4d2df4ada87de4e', 'successful P1 head SHA drift')
  check(p1SuccessfulAttempt.conclusion === 'success', 'successful P1 conclusion drift')
  check(p1SuccessfulAttempt.linuxDurationSeconds === 127 && p1SuccessfulAttempt.windowsDurationSeconds === 97, 'successful P1 job duration drift')
  check(p1SuccessfulAttempt.windowsLocalGatePassed === true, 'successful P1 Windows gate evidence missing')
  check(p1SuccessfulAttempt.windowsStaticGatesPassed === 15 && p1SuccessfulAttempt.windowsLocalIntegrationPassed === 12, 'successful P1 Windows gate counts drift')
  check(p1SuccessfulAttempt.p1AppShellAssertionsPassed === 71, 'successful P1 app-shell assertion count drift')
  check(p1SuccessfulAttempt.frontendModulesBuilt === 1975, 'successful P1 frontend module count drift')
  check(p1SuccessfulAttempt.frontendArtifactFiles === 66, 'successful P1 frontend artifact file count drift')
  check(p1SuccessfulAttempt.frontendArtifactSha256 === '33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b', 'successful P1 frontend artifact hash drift')
  check(p1SuccessfulAttempt.databaseStartupPassed === true && p1SuccessfulAttempt.baselinePassed === true, 'successful P1 database startup or baseline evidence missing')
  check(p1SuccessfulAttempt.migrationsPassed === 70, 'successful P1 migration count drift')
  check(p1SuccessfulAttempt.sqlTestsStarted === 27 && p1SuccessfulAttempt.sqlTestsPassed === 27, 'successful P1 SQL test count drift')
  check(p1SuccessfulAttempt.databaseTestsPassed === 7 && p1SuccessfulAttempt.permissionTestsPassed === 11 && p1SuccessfulAttempt.businessTestsPassed === 9, 'successful P1 test-category evidence drift')
  check(p1SuccessfulAttempt.catalogAssertionsPassed === 4, 'successful P1 catalog assertion count drift')
  check(p1SuccessfulAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK', 'successful P1 marker drift')
  check(p1SuccessfulAttempt.cleanupPassed === true, 'successful P1 cleanup evidence missing')
  check(p1SuccessfulAttempt.repositorySecretsRequired === false, 'successful P1 repository-secret boundary drift')
  check(p1SuccessfulAttempt.productionReadPerformed === false && p1SuccessfulAttempt.productionWritePerformed === false, 'successful P1 production boundary drift')
  check(p1SuccessfulAttempt.rerunOfFailedRun === false, 'successful P1 run must remain an independent candidate')
  check(p1SuccessfulAttempt.pageAccountAcceptancePassed === false, 'successful CI must not claim real page/account acceptance')
  const portableSelftestAttempt = attempts[18] ?? {}
  check(portableSelftestAttempt.runId === '29693556452', 'portable self-test run id drift')
  check(portableSelftestAttempt.jobId === '88210359113' && portableSelftestAttempt.windowsJobId === '88210359107', 'portable self-test job ids drift')
  check(portableSelftestAttempt.headSha === 'b9bcca61b826c641e550c6c070f09c4adc407cbe', 'portable self-test head SHA drift')
  check(portableSelftestAttempt.conclusion === 'failure', 'portable self-test run conclusion drift')
  check(portableSelftestAttempt.failedStep === 'Windows local integration static gate 17', 'portable self-test failed step drift')
  check(portableSelftestAttempt.rootCauseCode === 'postgres_selftest_required_nonportable_fixed_tool_paths_on_github_windows_runner', 'portable self-test root cause drift')
  check(portableSelftestAttempt.windowsLocalGatePassed === false, 'portable self-test Windows run must remain failed')
  check(portableSelftestAttempt.windowsStaticGatesExpected === 17 && portableSelftestAttempt.windowsStaticGatesPassed === 16 && portableSelftestAttempt.windowsStaticGateFailed === 17, 'portable self-test Windows static counts drift')
  check(portableSelftestAttempt.windowsLocalIntegrationStepsExpected === 12 && portableSelftestAttempt.windowsLocalIntegrationStepsStarted === 1 && portableSelftestAttempt.windowsLocalIntegrationStepsPassed === 0 && portableSelftestAttempt.windowsLocalIntegrationStepsNotExecuted === 11, 'portable self-test Windows local stop boundary drift')
  check(portableSelftestAttempt.windowsFailure === 'PG selftest required D:/CanWinP1Postgres18/bin/initdb.exe, pg_ctl.exe and psql.exe on the GitHub runner', 'portable self-test Windows failure drift')
  check(portableSelftestAttempt.ciRepairCandidateLinuxAccepted === true && portableSelftestAttempt.portableSelftestRepairPending === true, 'portable self-test repair acceptance boundary drift')
  check(portableSelftestAttempt.databaseStartupPassed === true && portableSelftestAttempt.baselinePassed === true, 'portable self-test Linux database startup or baseline evidence missing')
  check(portableSelftestAttempt.migrationsPassed === 70 && portableSelftestAttempt.sqlTestsStarted === 27 && portableSelftestAttempt.sqlTestsPassed === 27, 'portable self-test Linux migration or SQL counts drift')
  check(portableSelftestAttempt.databaseTestsPassed === 7 && portableSelftestAttempt.permissionTestsPassed === 11 && portableSelftestAttempt.businessTestsPassed === 9, 'portable self-test Linux category counts drift')
  check(portableSelftestAttempt.catalogAssertionsPassed === 4 && portableSelftestAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK', 'portable self-test Linux catalog or marker evidence missing')
  check(portableSelftestAttempt.cleanupPassed === true, 'portable self-test Linux cleanup evidence missing')
  check(portableSelftestAttempt.repositorySecretsRequired === false && portableSelftestAttempt.productionReadPerformed === false && portableSelftestAttempt.productionWritePerformed === false, 'portable self-test secret or production boundary drift')
  check(portableSelftestAttempt.rerunOfFailedRun === false && portableSelftestAttempt.preservedWithoutRerun === true, 'portable self-test failed run must remain preserved without rerun')
  check(portableSelftestAttempt.pageAccountAcceptancePassed === false, 'portable self-test CI must not claim page/account acceptance')
  const validatorLineEndingAttempt = attempts[19] ?? {}
  check(validatorLineEndingAttempt.runId === '29694104452', 'validator line-ending run id drift')
  check(validatorLineEndingAttempt.jobId === '88211774885' && validatorLineEndingAttempt.windowsJobId === '88211774922', 'validator line-ending job ids drift')
  check(validatorLineEndingAttempt.headSha === '92bbac9c265834d0d4f4c550137f519afe366a03', 'validator line-ending head SHA drift')
  check(validatorLineEndingAttempt.conclusion === 'failure', 'validator line-ending run conclusion drift')
  check(validatorLineEndingAttempt.failedStep === 'Windows local integration static gate 16 p1-isolated-runtime-runner', 'validator line-ending failed step drift')
  check(validatorLineEndingAttempt.rootCauseCode === 'validator_raw_crlf_exact_string_mismatch_for_execute_only_tool_gate', 'validator line-ending root cause drift')
  check(validatorLineEndingAttempt.windowsLocalGatePassed === false, 'validator line-ending Windows run must remain failed')
  check(validatorLineEndingAttempt.windowsStaticGatesExpected === 17 && validatorLineEndingAttempt.windowsStaticGatesPassed === 15 && validatorLineEndingAttempt.windowsStaticGateFailed === 16 && validatorLineEndingAttempt.windowsStaticGate17Executed === false, 'validator line-ending Windows static stop boundary drift')
  check(validatorLineEndingAttempt.windowsLocalIntegrationStepsExpected === 12 && validatorLineEndingAttempt.windowsLocalIntegrationStepsStarted === 1 && validatorLineEndingAttempt.windowsLocalIntegrationStepsPassed === 0 && validatorLineEndingAttempt.windowsLocalIntegrationStepsNotExecuted === 11, 'validator line-ending Windows local stop boundary drift')
  check(validatorLineEndingAttempt.windowsFailure === 'validator compared a raw CRLF exact string for the execute-only tool gate', 'validator line-ending Windows failure drift')
  check(validatorLineEndingAttempt.ciSecondRepairCandidateLinuxAccepted === true && validatorLineEndingAttempt.portableSelftestRepairImplemented === true && validatorLineEndingAttempt.validatorLineEndingRepairPending === true, 'validator line-ending repair boundary drift')
  check(validatorLineEndingAttempt.databaseStartupPassed === true && validatorLineEndingAttempt.baselinePassed === true, 'validator line-ending Linux database startup or baseline evidence missing')
  check(validatorLineEndingAttempt.migrationsPassed === 70 && validatorLineEndingAttempt.sqlTestsStarted === 27 && validatorLineEndingAttempt.sqlTestsPassed === 27, 'validator line-ending Linux migration or SQL counts drift')
  check(validatorLineEndingAttempt.databaseTestsPassed === 7 && validatorLineEndingAttempt.permissionTestsPassed === 11 && validatorLineEndingAttempt.businessTestsPassed === 9, 'validator line-ending Linux category counts drift')
  check(validatorLineEndingAttempt.catalogAssertionsPassed === 4 && validatorLineEndingAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK', 'validator line-ending Linux catalog or marker evidence missing')
  check(validatorLineEndingAttempt.cleanupPassed === true, 'validator line-ending Linux cleanup evidence missing')
  check(validatorLineEndingAttempt.repositorySecretsRequired === false && validatorLineEndingAttempt.productionReadPerformed === false && validatorLineEndingAttempt.productionWritePerformed === false, 'validator line-ending secret or production boundary drift')
  check(validatorLineEndingAttempt.rerunOfFailedRun === false && validatorLineEndingAttempt.preservedWithoutRerun === true, 'validator line-ending failed run must remain preserved without rerun')
  check(validatorLineEndingAttempt.pageAccountAcceptancePassed === false, 'validator line-ending CI must not claim page/account acceptance')
  const independentRepairAttempt = attempts[20] ?? {}
  check(independentRepairAttempt.runId === '29694757727', 'independent repair run id drift')
  check(independentRepairAttempt.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29694757727', 'independent repair run URL drift')
  check(independentRepairAttempt.jobId === '88213478676' && independentRepairAttempt.windowsJobId === '88213478682', 'independent repair job ids drift')
  check(independentRepairAttempt.headSha === '8273f5c69e09de24c9afbf27b010d60f7b7caddf', 'independent repair head SHA drift')
  check(independentRepairAttempt.conclusion === 'success', 'independent repair conclusion drift')
  check(independentRepairAttempt.workflowDurationSeconds === 148 && independentRepairAttempt.linuxDurationSeconds === 142 && independentRepairAttempt.windowsDurationSeconds === 111, 'independent repair duration evidence drift')
  check(independentRepairAttempt.windowsLocalGatePassed === true, 'independent repair Windows local gate evidence missing')
  check(independentRepairAttempt.windowsStaticGatesPassed === 17 && independentRepairAttempt.windowsLocalIntegrationPassed === 12, 'independent repair Windows gate counts drift')
  check(independentRepairAttempt.p1AppShellAssertionsPassed === 71, 'independent repair app-shell assertion count drift')
  check(independentRepairAttempt.frontendModulesBuilt === 1975, 'independent repair frontend module count drift')
  check(independentRepairAttempt.frontendArtifactFiles === 66, 'independent repair frontend artifact file count drift')
  check(independentRepairAttempt.frontendArtifactSha256 === '33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b', 'independent repair frontend artifact hash drift')
  check(independentRepairAttempt.githubUploadedArtifacts === 0, 'independent repair uploaded artifact count drift')
  check(independentRepairAttempt.linuxGithubWarningAnnotations === 1 && independentRepairAttempt.windowsGithubWarningAnnotations === 1, 'independent repair warning annotation count drift')
  check(JSON.stringify(independentRepairAttempt.nonBlockingWarnings) === JSON.stringify([
    'GitHub Actions Node.js 20 action runtime deprecation; actions were forced to Node.js 24',
    'Node.js DEP0040 punycode deprecation',
    'Windows Node.js DEP0169 url.parse deprecation',
  ]), 'independent repair non-blocking warning inventory drift')
  check(independentRepairAttempt.databaseStartupPassed === true && independentRepairAttempt.baselinePassed === true, 'independent repair database startup or baseline evidence missing')
  check(independentRepairAttempt.migrationsPassed === 70 && independentRepairAttempt.sqlTestsStarted === 27 && independentRepairAttempt.sqlTestsPassed === 27, 'independent repair migration or SQL counts drift')
  check(independentRepairAttempt.databaseTestsPassed === 7 && independentRepairAttempt.permissionTestsPassed === 11 && independentRepairAttempt.businessTestsPassed === 9, 'independent repair test-category counts drift')
  check(independentRepairAttempt.catalogAssertionsPassed === 4 && independentRepairAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK', 'independent repair catalog or marker evidence missing')
  check(independentRepairAttempt.cleanupPassed === true, 'independent repair cleanup evidence missing')
  check(independentRepairAttempt.repositorySecretsRequired === false && independentRepairAttempt.productionReadPerformed === false && independentRepairAttempt.productionWritePerformed === false, 'independent repair secret or production boundary drift')
  check(independentRepairAttempt.rerunOfFailedRun === false, 'independent repair must remain a new candidate, not a rerun')
  check(JSON.stringify(independentRepairAttempt.priorFailedRunsPreservedWithoutRerun) === JSON.stringify(['29693556452', '29694104452']), 'prior failed repair runs must remain preserved without rerun')
  check(independentRepairAttempt.isolatedTestProjectPersistentApplyPassed === false && independentRepairAttempt.reconciliationPassed === false && independentRepairAttempt.pageAccountAcceptancePassed === false && independentRepairAttempt.g1OverallClaim === false, 'independent CI must not claim isolated apply, reconciliation, page acceptance or G1')
  const freshCheckoutFailureAttempt = attempts[21] ?? {}
  check(freshCheckoutFailureAttempt.runId === '29695919974', 'fresh-checkout failure run id drift')
  check(freshCheckoutFailureAttempt.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29695919974', 'fresh-checkout failure run URL drift')
  check(freshCheckoutFailureAttempt.jobId === '88216547033' && freshCheckoutFailureAttempt.windowsJobId === '88216547016', 'fresh-checkout failure job ids drift')
  check(freshCheckoutFailureAttempt.headSha === '02f7377071783f2f3213218c6c3c3ace961768bc', 'fresh-checkout failure head SHA drift')
  check(freshCheckoutFailureAttempt.conclusion === 'failure', 'fresh-checkout failure conclusion drift')
  check(freshCheckoutFailureAttempt.workflowDurationSeconds === 142 && freshCheckoutFailureAttempt.linuxDurationSeconds === 137 && freshCheckoutFailureAttempt.windowsDurationSeconds === 57, 'fresh-checkout failure duration drift')
  check(freshCheckoutFailureAttempt.failedStep === 'Windows local integration static gate 6 p1-interface-freeze', 'fresh-checkout failure step drift')
  check(freshCheckoutFailureAttempt.rootCauseCode === 'windows_checkout_crlf_raw_rollback_evidence_sha_mismatch', 'fresh-checkout failure root cause drift')
  check(freshCheckoutFailureAttempt.platformDifference === true && freshCheckoutFailureAttempt.staticSelfTestFailure === true && freshCheckoutFailureAttempt.databaseOrBusinessFailure === false, 'fresh-checkout failure classification drift')
  check(freshCheckoutFailureAttempt.windowsLocalGatePassed === false, 'fresh-checkout Windows local gate must remain failed')
  check(freshCheckoutFailureAttempt.windowsStaticGatesExpected === 19 && freshCheckoutFailureAttempt.windowsStaticGatesPassed === 5 && freshCheckoutFailureAttempt.windowsStaticGateFailed === 6, 'fresh-checkout Windows static stop boundary drift')
  check(freshCheckoutFailureAttempt.windowsLocalIntegrationStepsExpected === 12 && freshCheckoutFailureAttempt.windowsLocalIntegrationStepsStarted === 1 && freshCheckoutFailureAttempt.windowsLocalIntegrationStepsPassed === 0 && freshCheckoutFailureAttempt.windowsLocalIntegrationStepsNotExecuted === 11, 'fresh-checkout Windows local stop boundary drift')
  check(freshCheckoutFailureAttempt.windowsFailure === 'p1-interface-freeze hashed the CRLF checkout bytes instead of normalized UTF-8 LF rollback evidence', 'fresh-checkout Windows failure description drift')
  check(freshCheckoutFailureAttempt.linuxDatabaseAccepted === true && freshCheckoutFailureAttempt.databaseStartupPassed === true && freshCheckoutFailureAttempt.baselinePassed === true, 'fresh-checkout Linux database acceptance evidence missing')
  check(freshCheckoutFailureAttempt.migrationsPassed === 70 && freshCheckoutFailureAttempt.sqlTestsStarted === 27 && freshCheckoutFailureAttempt.sqlTestsPassed === 27, 'fresh-checkout Linux migration or SQL counts drift')
  check(freshCheckoutFailureAttempt.databaseTestsPassed === 7 && freshCheckoutFailureAttempt.permissionTestsPassed === 11 && freshCheckoutFailureAttempt.businessTestsPassed === 9, 'fresh-checkout Linux test-category counts drift')
  check(freshCheckoutFailureAttempt.catalogAssertionsPassed === 4 && freshCheckoutFailureAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK' && freshCheckoutFailureAttempt.cleanupPassed === true, 'fresh-checkout Linux catalog, marker or cleanup evidence missing')
  check(freshCheckoutFailureAttempt.repositorySecretsRequired === false && freshCheckoutFailureAttempt.testProjectRemoteReads === 0 && freshCheckoutFailureAttempt.testProjectRemoteWrites === 0 && freshCheckoutFailureAttempt.productionReadPerformed === false && freshCheckoutFailureAttempt.productionWritePerformed === false, 'fresh-checkout remote or secret boundary drift')
  check(freshCheckoutFailureAttempt.rerunOfFailedRun === false && freshCheckoutFailureAttempt.preservedWithoutRerun === true, 'fresh-checkout failed run must remain preserved without rerun')
  check(freshCheckoutFailureAttempt.rollbackEvidenceLineEndingRepairImplemented === true && freshCheckoutFailureAttempt.postRepairIndependentCi === 'pending', 'fresh-checkout repair or post-repair CI boundary drift')
  check(freshCheckoutFailureAttempt.pageAccountAcceptancePassed === false && freshCheckoutFailureAttempt.g1OverallClaim === false, 'fresh-checkout failure must not claim page acceptance or G1')
  const postRepairAttempt = attempts[22] ?? {}
  check(postRepairAttempt.runId === '29696529290' && postRepairAttempt.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29696529290', 'post-repair independent CI run identity drift')
  check(postRepairAttempt.jobId === '88218121933' && postRepairAttempt.windowsJobId === '88218121940', 'post-repair independent CI job ids drift')
  check(postRepairAttempt.headSha === 'e04dfa3ee8a9f569b97c905c87f760d7b76a6e00' && postRepairAttempt.conclusion === 'success', 'post-repair independent CI result drift')
  check(postRepairAttempt.workflowDurationSeconds === 136 && postRepairAttempt.linuxDurationSeconds === 132 && postRepairAttempt.windowsDurationSeconds === 76, 'post-repair independent CI duration drift')
  check(postRepairAttempt.postRepairIndependentCi === 'passed', 'post-repair independent CI acceptance missing')
  check(postRepairAttempt.windowsLocalGatePassed === true && postRepairAttempt.windowsStaticGatesExpected === 19 && postRepairAttempt.windowsStaticGatesPassed === 19, 'post-repair Windows static evidence drift')
  check(postRepairAttempt.windowsLocalIntegrationStepsExpected === 12 && postRepairAttempt.windowsLocalIntegrationStepsPassed === 12 && postRepairAttempt.windowsP1AppShellAssertionsPassed === 71, 'post-repair Windows local or P1 shell evidence drift')
  check(postRepairAttempt.frontendModulesBuilt === 1975 && postRepairAttempt.frontendArtifactFiles === 66 && postRepairAttempt.frontendArtifactSha256 === '33505fcddc4b814379906406287b1fa715677b1e218497e1fe5a1693f50fc21b' && postRepairAttempt.githubUploadedArtifacts === 0, 'post-repair frontend artifact evidence drift')
  check(postRepairAttempt.realAccountSafetySelfTestPassed === true && postRepairAttempt.realAccountSafetyGuards === 7 && postRepairAttempt.realAccountSafetyNegativeFailureCases === 1 && postRepairAttempt.realAccountFixtureAccounts === 6, 'post-repair real-account safety self-test drift')
  check(postRepairAttempt.realAccountEvidenceSecrets === 0 && postRepairAttempt.realAccountCleanupMode === 'seal-not-delete' && postRepairAttempt.realAccountNetworkConnections === 0, 'post-repair real-account safety boundary drift')
  check(postRepairAttempt.realPageRunnerSelfTestPassed === true && postRepairAttempt.realPageAcceptanceStatus === 'pending' && postRepairAttempt.realPageNetworkConnections === 0, 'post-repair real-page self-test boundary drift')
  check(postRepairAttempt.linuxDatabaseAccepted === true && postRepairAttempt.databaseStartupPassed === true && postRepairAttempt.baselinePassed === true, 'post-repair Linux database acceptance evidence missing')
  check(postRepairAttempt.migrationsPassed === 70 && postRepairAttempt.sqlTestsStarted === 27 && postRepairAttempt.sqlTestsPassed === 27, 'post-repair Linux migration or SQL counts drift')
  check(postRepairAttempt.databaseTestsPassed === 7 && postRepairAttempt.permissionTestsPassed === 11 && postRepairAttempt.businessTestsPassed === 9, 'post-repair Linux test-category counts drift')
  check(postRepairAttempt.catalogAssertionsPassed === 4 && postRepairAttempt.successMarker === 'P0_CI_DATABASE_GATES_OK' && postRepairAttempt.cleanupPassed === true, 'post-repair Linux catalog, marker or cleanup evidence missing')
  check(postRepairAttempt.linuxGithubWarningAnnotations === 1 && postRepairAttempt.windowsGithubWarningAnnotations === 1, 'post-repair warning annotation count drift')
  check(JSON.stringify(postRepairAttempt.nonBlockingWarnings) === JSON.stringify([
    'GitHub Actions Node.js 20 action runtime deprecation; actions were forced to Node.js 24',
    'Node.js DEP0040 punycode deprecation',
    'Windows Node.js DEP0169 url.parse deprecation',
  ]), 'post-repair non-blocking warning inventory drift')
  check(postRepairAttempt.repositorySecretsRequired === false && postRepairAttempt.testProjectRemoteReads === 0 && postRepairAttempt.testProjectRemoteWrites === 0 && postRepairAttempt.productionReadPerformed === false && postRepairAttempt.productionWritePerformed === false, 'post-repair remote or secret boundary drift')
  check(postRepairAttempt.rerunOfFailedRun === false && JSON.stringify(postRepairAttempt.priorFailedRunsPreservedWithoutRerun) === JSON.stringify(['29693556452', '29694104452', '29695919974']), 'post-repair failed-run preservation drift')
  check(postRepairAttempt.isolatedTestProjectPersistentApplyPassed === false && postRepairAttempt.reconciliationPassed === false && postRepairAttempt.pageAccountAcceptancePassed === false && postRepairAttempt.g1OverallClaim === false, 'post-repair CI must not claim isolated apply, reconciliation, page acceptance or G1')
  const resumePrequalificationAttempt = attempts[23] ?? {}
  check(resumePrequalificationAttempt.runId === '29699951990' && resumePrequalificationAttempt.runUrl === 'https://github.com/yccanwin/canwin-team-os/actions/runs/29699951990', 'resume prequalification run identity drift')
  check(resumePrequalificationAttempt.jobId === '88227205377' && resumePrequalificationAttempt.windowsJobId === '88227205362', 'resume prequalification job ids drift')
  check(resumePrequalificationAttempt.headSha === 'a620bb541f4c5eb613413e8b40455b3988ee0cf3' && resumePrequalificationAttempt.conclusion === 'success', 'resume prequalification signature or conclusion drift')
  check(resumePrequalificationAttempt.qualificationScope === 'post_apply_resume_prequalification' && resumePrequalificationAttempt.resumePrequalification === 'qualified_remote_enabled', 'resume prequalification scope or status drift')
  check(resumePrequalificationAttempt.windowsLocalGatePassed === true && resumePrequalificationAttempt.windowsStaticGatesExpected === 19 && resumePrequalificationAttempt.windowsStaticGatesPassed === 19, 'resume prequalification Windows static evidence drift')
  check(resumePrequalificationAttempt.windowsLocalIntegrationStepsExpected === 12 && resumePrequalificationAttempt.windowsLocalIntegrationStepsPassed === 12, 'resume prequalification Windows local evidence drift')
  check(resumePrequalificationAttempt.linuxDatabaseAccepted === true && resumePrequalificationAttempt.migrationsPassed === 70 && resumePrequalificationAttempt.sqlTestsStarted === 27 && resumePrequalificationAttempt.sqlTestsPassed === 27, 'resume prequalification Linux migration or SQL evidence drift')
  check(resumePrequalificationAttempt.databaseTestsPassed === 7 && resumePrequalificationAttempt.permissionTestsPassed === 11 && resumePrequalificationAttempt.businessTestsPassed === 9 && resumePrequalificationAttempt.catalogAssertionsPassed === 4, 'resume prequalification Linux category or catalog evidence drift')
  check(resumePrequalificationAttempt.repositorySecretsRequired === false && resumePrequalificationAttempt.testProjectRemoteReads === 0 && resumePrequalificationAttempt.testProjectRemoteWrites === 0 && resumePrequalificationAttempt.productionReadPerformed === false && resumePrequalificationAttempt.productionWritePerformed === false, 'resume prequalification remote or secret boundary drift')
  check(resumePrequalificationAttempt.resumeVerificationExecuted === false && resumePrequalificationAttempt.pageAccountAcceptancePassed === false && resumePrequalificationAttempt.g1OverallClaim === false, 'resume prequalification must not claim resume execution, page acceptance or G1')
  return failures
}

const failures = validate(contract)
const negativeCases = [
  ['schema version', (value) => { value.schemaVersion = 2 }],
  ['baseline hash', (value) => { value.baseline.sha256Lf = '0'.repeat(64) }],
  ['missing test', (value) => { value.tests.pop() }],
  ['test hash', (value) => { value.tests[0].sha256Lf = '0'.repeat(64) }],
  ['test category', (value) => { value.tests[0].category = 'unknown' }],
  ['fixture mode', (value) => { value.tests[0].executionMode = 'read_only' }],
  ['unseparated DO dollar quote rule', (value) => { value.testSourceRules.doKeywordSeparatedFromDollarQuote = false }],
  ['remote connection', (value) => { value.runtime.remoteConnectionsAllowed = true }],
  ['remote host', (value) => { value.runtime.allowedHosts = ['db.example.com'] }],
  ['remote port', (value) => { value.runtime.allowedPort = 6543 }],
  ['Postgres major', (value) => { value.runtime.postgresMajor = 15 }],
  ['CLI unpinned', (value) => { value.runtime.supabaseCliVersion = 'latest' }],
  ['full stack startup', (value) => { value.runtime.startup = 'supabase start' }],
  ['pre-pilot final state', (value) => { value.historicalChainExpectations.salesOsV3.after69MigrationsEnabled = false }],
  ['pre-relaxation final qualification', (value) => { value.historicalChainExpectations.crmOpportunityQualification.after69RequiredAdvisoryFacts = true }],
  ['pre-address lead view', (value) => { value.historicalChainExpectations.crmLeadsVisible.after69Columns.pop() }],
  ['import direct client write', (value) => { value.historicalChainExpectations.customerImportHistoryAccess.directClientWritePrivilegesAllowed = true }],
  ['policy write assertion source rule', (value) => { value.testSourceRules.policyWriteAssertionsRequirePermissiveFilter = false }],
  ['definition fragment formatting source rule', (value) => { value.testSourceRules.definitionFragmentAssertionsNormalizeFormatting = false }],
  ['final definition CREATE statement source rule', (value) => { value.testSourceRules.requiredDefinitionFragmentsMatchFinalCreateStatement = false }],
  ['definition statement parser source rule', (value) => { value.testSourceRules.definitionStatementParserHandlesQuotedSemicolons = false }],
  ['definition assignment overload source rule', (value) => { value.testSourceRules.definitionReferencesResolveAssignmentsOverloadsAndRenames = false }],
  ['view interval normalization source rule', (value) => { value.testSourceRules.viewIntervalLiteralsNormalizeInputAndCanonicalOutput = false }],
  ['crm lead view exact columns source rule', (value) => { value.testSourceRules.crmLeadsVisibleExactColumnAssertionsMatchFinalContract = false }],
  ['direct deal order fixture source rule', (value) => { value.testSourceRules.directDealOrderFixturesIncludeFinalRequiredOrderNumber = false }],
  ['final function identity source rule', (value) => { value.testSourceRules.functionIdentityReferencesMatchFinalMigrationState = false }],
  ['definition target inventory', (value) => { value.expectedCounts.definitionReferencedObjects = 51 }],
  ['repository secret', (value) => { value.acceptanceBoundary.repositorySecretsRequired = true }],
  ['production write', (value) => { value.acceptanceBoundary.productionWritePerformed = true }],
  ['G0 success evidence erased', (value) => { value.acceptanceBoundary.g0OverallClaim = false }],
  ['P1 CI success erased', (value) => { value.acceptanceBoundary.p1ActualGithubRunEvidence = 'failed_repair_pending' }],
  ['repair Linux acceptance erased', (value) => { value.acceptanceBoundary.ciRepairCandidateLinuxAccepted = false }],
  ['repair Windows static falsely passed', (value) => { value.acceptanceBoundary.ciRepairCandidateWindowsStatic = '17/17' }],
  ['portable repair regressed to pending', (value) => { value.acceptanceBoundary.portableSelftestRepairPending = true }],
  ['second repair Linux acceptance erased', (value) => { value.acceptanceBoundary.ciSecondRepairCandidateLinuxAccepted = false }],
  ['second repair Windows falsely all green', (value) => { value.acceptanceBoundary.ciSecondRepairCandidateWindowsStatic = '17/17' }],
  ['validator line-ending repair regressed to pending', (value) => { value.acceptanceBoundary.validatorLineEndingRepairPending = true }],
  ['new independent CI success erased', (value) => { value.acceptanceBoundary.newIndependentCi = 'pending' }],
  ['fresh-checkout failure preservation erased', (value) => { value.acceptanceBoundary.freshCheckoutFailurePreservedWithoutRerun = false }],
  ['rollback evidence line-ending repair erased', (value) => { value.acceptanceBoundary.rollbackEvidenceLineEndingRepairImplemented = false }],
  ['post-repair CI acceptance erased', (value) => { value.acceptanceBoundary.postRepairIndependentCi = 'pending' }],
  ['post-apply candidate remote enabled', (value) => { value.postApplyResumePrequalification.candidateRemoteExecutionAllowed = true }],
  ['post-apply resume remote authorization erased', (value) => { value.postApplyResumePrequalification.resumeRemoteExecutionAllowed = false }],
  ['post-apply resume signature erased', (value) => { value.postApplyResumePrequalification.resumeSignedCiHeadSha = null }],
  ['post-apply same-head execution allowed', (value) => { value.postApplyResumePrequalification.signedCiHeadExecutionAllowed = true }],
  ['post-apply tracked dirty allowed', (value) => { value.postApplyResumePrequalification.trackedDirtyAllowed = true }],
  ['post-apply untracked audit evidence denied', (value) => { value.postApplyResumePrequalification.untrackedAuditEvidenceAllowed = false }],
  ['post-apply resume falsely executed', (value) => { value.postApplyResumePrequalification.resumeVerificationExecuted = true }],
  ['full reconciliation snapshot count reduced', (value) => { value.postApplyResumePrequalification.fullReconciliation.fullSnapshots = 28 }],
  ['full reconciliation content fingerprints erased', (value) => { value.postApplyResumePrequalification.fullReconciliation.requiredContentFingerprints = [] }],
  ['legacy P0 counts-only boundary erased', (value) => { value.postApplyResumePrequalification.fullReconciliation.sourceP0Boundary.signedP0TableRowCountsAreCountsOnly = false }],
  ['d510 fixture pattern erased', (value) => { value.postApplyResumePrequalification.fullReconciliation.fixturePatterns.pop() }],
  ['ACL repair migration count reverted', (value) => { value.migrations.expectedCount = 70 }],
  ['formal resume failure SHA tampered', (value) => { value.formalResumeFailureEvidence.failureSha256 = '0'.repeat(64) }],
  ['formal resume first error erased', (value) => { value.formalResumeFailureEvidence.firstError = null }],
  ['formal resume partial snapshot count inflated', (value) => { value.formalResumeFailureEvidence.fullReconciliationSnapshotsPassed = 29 }],
  ['ACL repair migration SHA tampered', (value) => { value.aclRepairCandidate.migrationSha256Lf = '0'.repeat(64) }],
  ['ACL repair current runner SHA tampered', (value) => { value.aclRepairCandidate.currentRuntimeArtifacts.runner.sha256Lf = '0'.repeat(64) }],
  ['ACL repair function inventory reduced', (value) => { value.aclRepairCandidate.functions.pop() }],
  ['ACL repair changed-function inventory inflated', (value) => { value.aclRepairCandidate.expectedChangedFunctions.push(value.aclRepairCandidate.functions[4].identity) }],
  ['ACL repair authenticated revoke erased', (value) => { value.aclRepairCandidate.functions[0].revokeRoles.pop() }],
  ['ACL repair service grant erased', (value) => { value.aclRepairCandidate.functions[0].requiredGrantRoles = [] }],
  ['ACL repair full snapshots reduced', (value) => { value.aclRepairCandidate.fullReconciliation.execution.perTestFullSnapshots = 26 }],
  ['private definition transition count erased', (value) => { value.aclRepairCandidate.privateRoutineDefinitionTransition.expectedDefinitionChanges = 0 }],
  ['private definition snapshots reduced', (value) => { value.aclRepairCandidate.privateRoutineDefinitionTransition.requiredSnapshots = 2 }],
  ['atomic database CI falsely accepted', (value) => { value.aclRepairCandidate.atomicLegacyRoleCompatibility.databaseCiPassed = true }],
  ['atomic remote gate negative controls reduced', (value) => { value.aclRepairCandidate.atomicLegacyRoleCompatibility.atomicRemoteGateNegativeControls = 1 }],
  ['ACL repair compatibility call site restored', (value) => { value.aclRepairCandidate.applicationCompatibility.resolvedEvidence.staticCallSitesRemaining = 1 }],
  ['ACL repair compatibility falsely unlocks G1', (value) => { value.aclRepairCandidate.applicationCompatibility.g1BlockedUntilAclAndPageAcceptance = false }],
  ['ACL repair remote execution enabled before CI', (value) => { value.aclRepairCandidate.remoteExecutionAllowed = true }],
  ['ACL repair unknown reconciliation difference allowed', (value) => { value.aclRepairCandidate.unknownDifferencesAllowed = true }],
  ['failed ACL repair CI falsely accepted', (value) => { value.repairCiRunEvidence.conclusion = 'success' }],
  ['failed ACL repair CI audit count rewritten', (value) => { value.repairCiRunEvidence.failedAssertionActualAuditRows = 6 }],
  ['G1 falsely claimed', (value) => { value.acceptanceBoundary.g1OverallClaim = true }],
  ['latest independent CI evidence erased', (value) => { value.formalAttemptHistory.pop() }],
]
let negativePassed = 0
for (const [name, mutate] of negativeCases) {
  const candidate = clone(contract)
  mutate(candidate)
  if (validate(candidate).length > 0) negativePassed += 1
  else failures.push(`negative self-test did not fail: ${name}`)
}

if (failures.length > 0) {
  console.error('P0_CI_DATABASE_CONTRACT_DRIFT')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `P0_CI_DATABASE_CONTRACT_OK baseline=1 migrations=71 tests=${contract.tests.length} database=7 permission=11 business=9 catalog=4 definitions=${contract.expectedCounts.definitionReferencedObjects} redefined=${contract.expectedCounts.redefinedDefinitionReferencedObjects} crmLeadColumnAssertions=${contract.expectedCounts.crmLeadsVisibleExactColumnAssertions} directOrderFixtures=${contract.expectedCounts.directDealOrderFixtureFiles} finalFunctionIdentities=${contract.expectedCounts.finalPublicFunctionIdentities} functionIdentityReferences=${contract.expectedCounts.functionIdentityReferences} negative=${negativePassed}/${negativeCases.length} localOnly=true repositorySecrets=0 productionReads=0 productionWrites=0 actualGithubRun=passed g0=true p1ActualGithubRun=passed historicalResumeCi=70/27 formalResumeFailure=p1-resume-20260719T193911279Z-ea6ed9385d formalResumeSql=5/27 formalResumeSnapshots=6/29 failurePreserved=true aclRepairMigration=20260720015435 aclRepairFunctions=6 aclRepairRemote=false aclRepairCi=prior-failure-preserved,new-candidate-pending aclRepairCiRun=29726897764 nextFullExactRows=71 nextSqlTests=27 nextPerTestFullSnapshots=27 nextFullSnapshots=29 pageAccountAcceptance=false progress=25 g1=false`,
)
