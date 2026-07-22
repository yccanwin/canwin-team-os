import type { PrimaryRole } from '../../../../packages/team-os-4-domain/src/index'

export interface RoleBusinessLink {
  readonly path: string
  readonly label: string
  readonly description: string
}

const ROLE_BUSINESS_LINKS: Readonly<Record<PrimaryRole, readonly RoleBusinessLink[]>> = {
  sales: [
    { path: '/leads', label: '线索与商机', description: '查看本人负责的真实线索和商机' },
    { path: '/customers', label: '客户与门店', description: '查看客户、品牌、门店和联系人' },
    { path: '/orders', label: '报价与订单', description: '查看报价和订单状态' },
    { path: '/catalog', label: '产品目录', description: '查看当前可销售产品' },
    { path: '/earnings', label: '我的劳动收益', description: '仅查看本人可见收益' },
  ],
  implementation: [
    { path: '/fulfillment', label: '实施履约', description: '查看分配给本人的安装、培训、验收和交接任务' },
    { path: '/earnings', label: '我的服务收益', description: '仅查看本人可见收益' },
  ],
  operations: [
    { path: '/fulfillment', label: '运维服务', description: '查看分配给本人的服务和售后任务' },
    { path: '/cases', label: '案例馆', description: '查看已获授权并公开的案例素材' },
    { path: '/earnings', label: '我的服务收益', description: '仅查看本人可见收益' },
  ],
  finance: [
    { path: '/finance', label: '财务与结算', description: '查看真实收付款、内部款、利润和退款事件' },
    { path: '/earnings', label: '我的劳动收益', description: '仅查看本人可见收益' },
  ],
  admin: [
    { path: '/leads', label: '审批与销售分配', description: '查看公司线索与商机' },
    { path: '/customers', label: '客户、品牌与门店', description: '查看公司客户经营资料' },
    { path: '/catalog', label: '商品与价格', description: '查看产品和价格配置' },
    { path: '/orders', label: '订单与履约', description: '查看报价、订单和交付状态' },
    { path: '/warehouse', label: '仓库处理', description: '查看真实库存和预留情况' },
    { path: '/finance', label: '财务、成本与结算', description: '查看公司财务事件' },
    { path: '/cases', label: '案例审核与发布', description: '查看候选、授权和发布状态' },
  ],
}

export function roleBusinessLinks(role: PrimaryRole): readonly RoleBusinessLink[] {
  return ROLE_BUSINESS_LINKS[role]
}

export function roleBusinessPath(role: PrimaryRole): string {
  return ROLE_BUSINESS_LINKS[role][0].path
}
