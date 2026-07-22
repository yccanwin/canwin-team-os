const execute = process.argv.includes('--execute')

export const SCALE_ACCEPTANCE_PLAN = Object.freeze({
  workItemCount: 100_000,
  requiredIndexes: Object.freeze([
    'work_items_generation_identity',
    'work_items_assignee_status_due_idx',
  ]),
  evidence: Object.freeze([
    'dataset-manifest',
    'query-plan',
    'stable-sort',
    'response-percentiles',
  ]),
})

if (!execute) {
  console.log('TEAM_OS_4_G2_SCALE_PENDING workItems=100000 remoteCalls=0 queryPlan=not-run stableSort=not-run accepted=false')
} else {
  throw new Error('G2 scale execution adapter is not authorized or configured')
}
