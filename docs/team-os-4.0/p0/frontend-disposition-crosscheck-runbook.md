# P0 页面与媒体处置交叉合同

## 当前结论

`frontend-disposition-crosscheck.json` 是 P0 静态候选合同，不是 P1 页面完成，也不是生产 Storage 切换许可。

它把以下四组已有事实做成一一对应的机器合同：

- 当前源码 `36/36` 条显式路由；
- 总方案 4.8 节 `22/22` 个页面处理项；
- 当前源码 `7/7` 个 `<input type="file">`；
- 当前源码 `7/7` 个 Storage 命名空间。

每项都有明确候选动作和理由。路由保留兼容地址，不授权直接删除；旧媒体入口与命名空间只记录未来关闭候选，不修改生产权限。

每个 4.8 页面项、路由、文件入口、Storage 命名空间和非文件写入口都必须逐项保持 `acceptanceStatus=candidate_unaccepted`。校验器运行时动态统计各组 `accepted` 数量，任何一项静态改成已验收都会失败。

## 路由兼容与访问边界

- 36 条路由逐条保存 P1 导航合同的完整 `compatibilityState`、`hiddenFromDefaultNavigation`、`readOnly`、`writeMode` 和 canonical target；`retain_rebuild`、`retain_compatibility`、`retain_restrict_admin`、`retain_topbar_compatibility` 不得压成一个不可追溯状态。
- 全部路由候选都要求登录并拒绝匿名访问，实际授权仍由服务器和数据库负责。
- `/finance` 仅财务和管理员；系统设置与客户导入的主岗位仅管理员；客户导入、目录和权限配置仅桌面端。
- `/asset-center` 的主岗位边界是管理员；仓库附加职能只能进入分配范围内的 inventory 视图，不能获得商品、资产或系统设置管理权。
- `/management-v3` 的主岗位边界是管理员；主管例外必须同时满足主管开关开启和已分配范围。

这些都是机器候选边界，不是 403 验收结果。六身份直连 API、匿名拒绝、旧深链和界面可见性仍需运行时证据。

## 两个媒体槽与旧命名空间

| 槽位 | 数量 | 大小 | MIME | 写入与发布 |
| --- | ---: | ---: | --- | --- |
| `case.logo` | 1 | ≤ 204800 bytes | PNG/JPEG/WebP；拒绝 SVG/GIF | 仅管理员私有草稿；有效展示授权 + 管理员审核后复制公开投影副本 |
| `case.miniprogram_code` | 1 | ≤ 307200 bytes | PNG/JPEG/WebP；拒绝 SVG/GIF | 仅管理员私有草稿；有效展示授权 + 管理员审核后复制公开投影副本 |

- `achievement-logo` 是唯一可核对后迁移到 `case.logo` 的旧入口。
- `achievement-images` 不得映射或改名为 `case.miniprogram_code`；小程序码当前没有旧入口迁移来源。
- 7 个旧命名空间候选均为 `newWrite=deny`、`anonymous=deny`，但生产策略没有在本工单修改，运行时策略状态保持 `pending`。

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
P0_FRONTEND_DISPOSITION_CROSSCHECK_OK assertions=<动态计数> routes=36 section48=22 fileInputs=7 storageNamespaces=7 nonFileWrites=2 mediaSlots=2 orphans=0 acceptedPages=0 acceptedRoutes=0 acceptedFileInputs=0 acceptedNamespaces=0 acceptedNonFileWrites=0 acceptedMediaSlots=0 acceptedTotal=0 candidateTotal=<动态计数> runtimePending=<动态计数>
```

校验器会同时读取总方案、03/04 清单、`frontend-inventory.json`、P1 导航合同及当前源码。任何数量、路径、动作、列举关系或源码入口漂移都会失败。

## 尚未完成

- 未完成五主岗位、附加职能和主管开关的逐页运行时验收；
- 未执行旧深链、移动端和只读页面回归；
- 未执行角色越权与匿名访问的 403 矩阵；
- 未盘点或修改生产 Storage 对象、策略与权限；
- 未证明旧命名空间的新写与匿名访问已被运行时策略拒绝；
- 未完成数据库与文件分别备份恢复；
- 未实现或验收 `case.logo`、`case.miniprogram_code` 两个最终槽位及发布复制、撤权删除流程。

以上证据通过前，本合同必须保持 `p0_candidate_not_accepted`，不能用于报告 P1 UI 完成或生产媒体清理完成。
