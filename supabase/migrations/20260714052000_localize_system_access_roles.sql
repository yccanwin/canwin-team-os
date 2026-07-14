-- Localize system role labels without changing stable role codes or free-text positions.

update public.access_roles as role
set name = labels.name,
    description = labels.description
from (values
  ('owner', '老板（Owner）', '拥有团队全部管理权限'),
  ('admin', '管理员（Administrator）', '管理人员、权限和系统配置'),
  ('supervisor', '销售主管（Sales Supervisor）', '管理销售团队、下属与销售过程'),
  ('sales', '销售（Sales）', '负责线索、客户、商机和成交推进'),
  ('finance', '财务（Finance）', '负责收付款确认、冲销和经营数据'),
  ('warehouse', '仓库（Warehouse）', '负责库存和硬件履约'),
  ('implementation', '实施（Implementation）', '负责安装、培训和实施交付'),
  ('operations', '运维（Operations）', '负责售后承接和持续运营')
) as labels(code, name, description)
where role.code = labels.code
  and role.is_system = true;
