export interface NumericMeasure {
  name: string
  source: string
  target: string
}

export interface CategoryEvidence {
  category: string
  sourceCount: number
  targetCount: number
  measures?: readonly NumericMeasure[]
}

export interface ReconciliationEvidence {
  entities: readonly CategoryEvidence[]
  criticalAmounts: readonly NumericMeasure[]
  inventory: readonly CategoryEvidence[]
  auth: readonly CategoryEvidence[]
  storage: readonly CategoryEvidence[]
}

export interface ReconciliationDifference {
  section: keyof ReconciliationEvidence
  category: string
  field: string
  source: string | number
  target: string | number
}

const REQUIRED_SECTIONS: readonly (keyof ReconciliationEvidence)[] = [
  'entities', 'criticalAmounts', 'inventory', 'auth', 'storage',
]

function compareMeasure(section: keyof ReconciliationEvidence, category: string, measure: NumericMeasure): ReconciliationDifference | null {
  return measure.source === measure.target ? null : {
    section,
    category,
    field: measure.name,
    source: measure.source,
    target: measure.target,
  }
}

export function reconcileMigration(evidence: ReconciliationEvidence): ReconciliationDifference[] {
  const differences: ReconciliationDifference[] = []
  for (const section of REQUIRED_SECTIONS) {
    if (evidence[section].length === 0) {
      differences.push({ section, category: '*', field: 'coverage', source: 'required', target: 'missing' })
    }
  }

  for (const section of ['entities', 'inventory', 'auth', 'storage'] as const) {
    const seen = new Set<string>()
    for (const category of evidence[section]) {
      if (!category.category.trim() || seen.has(category.category)) {
        differences.push({ section, category: category.category || '*', field: 'unique-category', source: 'required', target: 'invalid' })
      }
      seen.add(category.category)
      if (!Number.isSafeInteger(category.sourceCount) || category.sourceCount < 0 || !Number.isSafeInteger(category.targetCount) || category.targetCount < 0) {
        differences.push({ section, category: category.category, field: 'count-validity', source: category.sourceCount, target: category.targetCount })
      }
      if (category.sourceCount !== category.targetCount) differences.push({
        section,
        category: category.category,
        field: 'count',
        source: category.sourceCount,
        target: category.targetCount,
      })
      for (const measure of category.measures ?? []) {
        const difference = compareMeasure(section, category.category, measure)
        if (difference) differences.push(difference)
      }
    }
  }

  for (const measure of evidence.criticalAmounts) {
    const difference = compareMeasure('criticalAmounts', 'financial', measure)
    if (difference) differences.push(difference)
  }
  return differences
}

export function assertMigrationReconciled(evidence: ReconciliationEvidence): void {
  const differences = reconcileMigration(evidence)
  if (differences.length) throw new Error(`migration reconciliation failed: ${JSON.stringify(differences)}`)
}

// A single grand total is intentionally unsupported: callers must supply every
// entity, financial measure, inventory class, auth class and storage disposition.
