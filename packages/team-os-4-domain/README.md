# Team OS 4.0 Domain

Team OS 4.0 的独立领域常量与类型包。它只描述 4.0 的业务身份和绿色替代路线，不依赖 3.0 的 `src`、数据库结构或 Supabase 客户端。

边界：

- 五个主岗位固定为销售、实施、运维、财务、管理员。
- 仓库和主管是附加职能，不是第六、第七个主岗位。
- 3.0 是只读迁移源；4.0 使用全新程序和独立数据结构。
- 数据只允许一次性搬家，不允许原库升级、双写或回写 3.0。
- 完成验收后才能切换到 4.0。

验证：

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run typecheck --prefix packages/team-os-4-domain
```
