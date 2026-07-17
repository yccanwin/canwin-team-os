import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const component = readFileSync(resolve(root, 'src/features/sales-workbench/CrmCommandCenter.tsx'), 'utf8')
const styles = readFileSync(resolve(root, 'src/features/sales-workbench/sales-workbench.css'), 'utf8')

function requireText(source: string, expected: string, label: string) {
  if (!source.includes(expected)) throw new Error(`${label}: missing ${expected}`)
}

for (const className of [
  'crm-command-center',
  'crm-command-metrics',
  'crm-command-layout',
  'crm-action-panel',
  'crm-action-row',
  'crm-customer-panel',
  'crm-stage-track',
  'crm-next-action',
  'crm-quick-actions',
  'crm-timeline',
  'crm-followup-composer',
]) {
  requireText(component, className, 'command-center markup')
  requireText(styles, `.${className}`, 'command-center styles')
}

requireText(component, 'role="tablist"', 'accessible action switcher')
requireText(component, 'aria-selected=', 'accessible selected tab state')
requireText(styles, 'grid-template-columns:minmax(320px,38fr) minmax(430px,62fr)', 'desktop 38/62 workspace split')
requireText(styles, '@media(max-width:768px)', 'mobile breakpoint')
requireText(styles, 'grid-template-columns:minmax(0,1fr)', 'mobile single-column layout')
requireText(styles, 'overflow-x:clip', 'mobile horizontal overflow protection')
requireText(styles, ':focus-visible', 'keyboard focus treatment')

console.log('CRM command-center UI contract: OK')
