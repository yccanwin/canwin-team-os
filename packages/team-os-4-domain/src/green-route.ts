export const TEAM_OS_4_GREEN_ROUTE = Object.freeze({
  productVersion: '4.0',
  constructionMode: 'greenfield-replacement',
  program: 'new-independent-program',
  dataStructure: 'new-independent-data-structure',
  legacySystem: '3.0',
  legacySystemMode: 'read-only',
  migrationMode: 'one-time-full-import',
  cutoverMode: 'acceptance-before-switch',
  inPlaceUpgradeAllowed: false,
  dualWriteAllowed: false,
  legacyWritebackAllowed: false,
  executeLegacyMigrationChain: false,
  productionCutoverRequiresAcceptance: true,
} as const)

export type TeamOs4GreenRoute = typeof TEAM_OS_4_GREEN_ROUTE

export const TEAM_OS_4_GREEN_ROUTE_INVARIANTS = Object.freeze([
  '4.0 uses a new independent program',
  '4.0 uses a new independent data structure',
  '3.0 remains read-only',
  'data moves once from the frozen 3.0 source into 4.0',
  '4.0 replaces 3.0 only after acceptance',
  'no in-place upgrade, dual-write, or legacy writeback',
] as const)
