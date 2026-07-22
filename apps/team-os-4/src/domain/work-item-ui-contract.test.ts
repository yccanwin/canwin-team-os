import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const actions = read('WorkItemActionPanel.tsx')
const filters = read('WorkItemFilterPanel.tsx')

for (const [name, source] of [['actions', actions], ['filters', filters]] as const) {
  assert.ok(!source.includes('\uFFFD'), `${name} contains invalid UTF-8 replacement characters`)
  assert.ok(!source.includes('complete_reminder'), `${name} uses obsolete command action`)
}
for (const text of ['继续处理', '标记等待', '完成提醒', '进入业务办理', '等待原因']) assert.ok(actions.includes(text))
for (const text of ['筛选视图', '状态（可多选）', '岗位（可多选）', '保存当前筛选', '清除筛选']) assert.ok(filters.includes(text))
for (const testId of ['complete-reminder', 'open-business-action', 'work-item-waiting-reason']) assert.ok(actions.includes(`data-testid="${testId}"`))
for (const testId of ['work-item-search', 'work-item-filter-apply', 'work-item-filter-clear', 'work-item-filter-save']) assert.ok(filters.includes(`data-testid="${testId}"`))

console.log('TEAM_OS_4_WORK_ITEM_UI_OK utf8=valid filters=covered actions=covered command=complete')
