# P0 页面与媒体处置交叉合同

## 当前结论

`frontend-disposition-crosscheck.json` 是 P0 静态候选合同，不是 P1 页面完成，也不是生产 Storage 切换许可。

它把以下四组已有事实做成一一对应的机器合同：

- 当前源码 `36/36` 条显式路由；
- 总方案 4.8 节 `22/22` 个页面处理项；
- 当前源码 `7/7` 个 `<input type="file">`；
- 当前源码 `7/7` 个 Storage 命名空间。

每项都有明确候选动作和理由。路由保留兼容地址，不授权直接删除；旧媒体入口与命名空间只记录未来关闭候选，不修改生产权限。

## 孤儿项处理

- 36 条路由逐条回连到 4.8 映射；`/notifications-v3` 是唯一不在 4.8 表内的附加路由，并保留“消息在顶栏”的解释。
- 7 个文件入口逐条关联页面和 Storage；客户 XLSX/CSV 导入是唯一不进入媒体 Storage 的明确豁免。
- `personal-goals/updates` 没有当前文件入口，但仍由 `src/services/personalGoals.ts` 暴露潜在写能力，因此通过非文件写入口单独回连，不能当成无引用命名空间忽略。
- 头像 URL 是数据库字段写入口，不虚构 Storage 命名空间；候选动作仍是关闭新写、保留历史显示。

## 本地机械校验

在仓库根目录运行：

```powershell
node scripts/p0/verify-frontend-disposition-crosscheck.mjs
```

成功摘要应为：

```text
P0_FRONTEND_DISPOSITION_CROSSCHECK_OK routes=36 section48=22 fileInputs=7 storageNamespaces=7 nonFileWrites=2 orphans=0 candidateAccepted=0
```

校验器会同时读取总方案、03/04 清单、`frontend-inventory.json`、P1 导航合同及当前源码。任何数量、路径、动作、列举关系或源码入口漂移都会失败。

## 尚未完成

- 未完成五主岗位、附加职能和主管开关的逐页运行时验收；
- 未执行旧深链、移动端和只读页面回归；
- 未盘点或修改生产 Storage 对象、策略与权限；
- 未完成数据库与文件分别备份恢复；
- 未实现或验收 `case.logo`、`case.miniprogram_code` 两个最终槽位。

以上证据通过前，本合同必须保持 `p0_candidate_not_accepted`，不能用于报告 P1 UI 完成或生产媒体清理完成。
