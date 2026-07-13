import { supabase } from '@/lib/supabase'
import { SalesWorkbench } from './SalesWorkbench'
import { createSupabaseSalesWorkbenchDataSource } from './supabaseDataSource'
import type { LeadReadScope } from './dataSource'
import type { OrderActionSignal } from './types'

const realDataSource = createSupabaseSalesWorkbenchDataSource(supabase)

export interface SalesWorkbenchRealRouteProps {
  leadScope?: LeadReadScope
  salespersonName?: string
  orderSignals?: OrderActionSignal[]
}

/**
 * 真实数据入口：供 App 路由懒加载。
 * 此入口固定关闭 demo 模式，任何读取或写入错误均由工作台明确展示。
 */
export default function SalesWorkbenchRealRoute({
  leadScope = 'mine',
  salespersonName = '销售工作台',
  orderSignals = [],
}: SalesWorkbenchRealRouteProps) {
  return (
    <SalesWorkbench
      dataSource={realDataSource}
      demoMode={false}
      leadScope={leadScope}
      salespersonName={salespersonName}
      orderSignals={orderSignals}
    />
  )
}
