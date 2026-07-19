# P0-04 图片入口与 Storage 策略清理清单

> 状态：P0 图片/Storage 清理方案已由监理冻结；1 bucket、32 objects、1,700,978 bytes 已完成独立备份恢复和聚合校验，运行态两槽策略及攻击矩阵留待后续门禁。
> 生产保护：3.0 施工期不提前撤销生产 Storage 权限。

## 4.0 最终允许范围

| 逻辑槽位 | 数量 | 大小 | MIME | 写入者 | 发布规则 |
| --- | ---: | ---: | --- | --- | --- |
| `case.logo` | 1 | 压缩后 ≤ 200KB | PNG/JPEG/WebP | 仅管理员 | 私有草稿；授权+审核后复制公开副本 |
| `case.miniprogram_code` | 1 | ≤ 300KB | PNG/JPEG/WebP | 仅管理员 | 私有草稿；授权+审核后复制公开副本 |

SVG、GIF 和其他格式一律拒绝。销售、实施、运维只能补充结构化文字，不可上传图片。

## 当前文件选择入口

仓内共有 7 个 `<input type="file">`：6 个媒体/附件入口需要关闭新写，1 个客户数据导入需要单列豁免。

| 当前入口 | 当前能力 | 当前 Storage 路径 | 4.0 处理 |
| --- | --- | --- | --- |
| 团队相册 | `/photos` 及文化中心上传团队照片 | `photos` | 下线新写；历史只读/归档 |
| 成就/案例 Logo | 上传 Logo | `achievements/icons` | 迁移候选；改为管理员专用 `case.logo` |
| 成就/案例普通图片 | 最多 3 张 | `achievements/images` | 关闭；不能冒充展示码槽 |
| 资产图片 | 最多 3 张 | `assets` | 关闭新写；历史只读 |
| 时间轴图片 | 最多 9 张 | `timeline` | 关闭新写；必要内容转结构化事实 |
| 时间轴附件 | 最多 5 个 PDF/DOC/DOCX | `timeline/attachments` | 关闭新写；历史只读 |
| 客户 XLSX/CSV 导入 | 管理员结构化数据导入，不进 Storage | 无 | `bulk_import` 豁免；桌面管理员专用 |

## 非 file-input 写入口

| 入口 | 当前事实 | 4.0 处理 |
| --- | --- | --- |
| 头像 URL | 管理员可写 `profiles.avatar_url` | 移除写入口，历史只读 |
| 个人目标进展图 | UI 当前不上传，但服务层仍有 `personal-goals/updates` 写能力 | 撤销上传能力，历史只读 |
| 收据/交付照片 | 当前未发现文件入口；财务仅凭证号，售后已有“不重复上传照片”文案 | 保持无上传，增加负向测试 |

## 当前 Storage 命名空间

`photos`、`achievements/icons`、`achievements/images`、`assets`、`timeline`、`timeline/attachments`、`personal-goals/updates`。

这些命名空间当前都基于前端拼接的固定团队值和 folder。4.0 必须改为服务器根据会话公司和允许槽位派生路径，前端不得传任意 folder。

## 当前策略风险

- 所有写入共用私有桶 `canwin-media`；私有 signed URL 读取是可复用基础。
- 当前桶仍允许 JPEG/PNG/WebP/GIF/PDF/DOC/DOCX，单对象上限 5MB，范围远大于 4.0。
- 最新“非照片”写策略仍允许任一 active team member 写入第二段不等于 `photos` 的路径，覆盖 achievements/assets/timeline/attachments/personal-goals。
- 相册表和 Storage 仍有 active member 写入、上传者或 captain 编辑/删除策略。
- 现有 Logo 入口不是管理员专用，也没有 200KB 与固定路径的三层约束。
- 小程序展示码上传槽当前不存在；不能把普通成就图片改名冒充。
- 数据落点包括 `profiles.avatar_url`、`assets.image_url`、`photos.image_url`、`goal_updates.image_url`，以及 achievements/timeline description JSON 中的媒体信息。

## 冻结接口

### MediaSlotPolicy

默认拒绝；只允许 `case.logo` 和 `case.miniprogram_code`。服务端验证管理员身份、槽位、数量、MIME、字节数和业务案例归属，再签发一次性上传意图与私有路径。

### CasePublishProjection

仅有效客户展示授权 + 管理员审核通过后，生成脱敏公开投影并复制两张公开副本。授权撤回、下架或归档时，公开投影立即不可见，并删除公开副本和记录审计。

### LegacyMediaMode

`photos/achievements.images/assets/timeline/attachments/goal_update/avatar` 统一停止新写；禁止申请新上传意图。旧页面可直接关闭，但历史对象、元数据、SHA256、归档位置和孤儿对象处理必须分别列单并验证可恢复。

### BulkImport

XLSX/CSV 客户导入归类为结构化管理员工具，不使用媒体 Storage，不受两个案例图片槽约束，但必须单独通过回滚与冲突测试。

## 测试环境清理顺序

1. 导出桶、对象、路径、大小、MIME、所有者和校验和清单。
2. 建立数据库与文件分离备份，并在独立项目恢复。
3. 关闭旧媒体入口，使用清单和受控恢复工具验证历史对象仍可恢复；不要求旧页面继续提供读取。
4. 新增两个案例槽和默认拒绝策略。
5. 运行管理员允许、五岗位拒绝、第三张图、超限、非法格式、任意路径、覆盖/删除越权测试。
6. 验证发布复制、撤权下线和公开副本删除。
7. 只有测试证据通过后，才形成未来生产切换方案；施工期不改生产策略。

## 已取得的恢复证据

- 成功加密备份包：`D:\CanWin-Team-OS-4.0-Recovery\canwin-team-os-4-p0-20260719T074943659Z-c11fca6bd1`。
- manifest SHA256：`f4174b91f51f63e37b42e9d907aea0f72aa907ec31694041081ee06c2f6d20b2`。
- 正式封闭恢复 1/1 成功；数据库、Auth 与 Storage 分项状态均为 `succeeded`。
- Storage 恢复证据覆盖 1 bucket、32 objects、1,700,978 bytes，内容聚合 SHA256 一致；真实用户全部禁登，未开放预览或外发。
- 以上证明历史文件可独立恢复，不代表旧上传入口已关闭，也不代表未来生产 Storage 策略已变更。

## P1/P6 仍缺运行态证据

- 对象路径与数据库引用的孤儿分类，以及正式切换前的最新策略漂移复核。
- 合法两槽和非法攻击矩阵的隔离环境结果。
- 旧页面实际关闭后，历史媒体对象、元数据和签名读取能力的回归验证。
- 发布复制、授权撤回、下架以及公开副本删除的端到端证据。
