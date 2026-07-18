# P0 前端机器清单运行说明

本清单只冻结当前源码事实，不修改路由、页面、上传行为、数据库或 Storage。

在仓库根目录运行：

```powershell
node scripts/p0/verify-frontend-inventory.mjs
```

通过时输出：

```text
P0_FRONTEND_INVENTORY_OK routes=36 section48=22 fileInputs=7 storageNamespaces=7 avatarUrl=1 bulkImport=1
```

脚本会静态核对：

- `src/App.tsx` 的 36 个显式 Route 及对应页面标记；
- 总方案 4.8 的 22 行处理映射；
- 全仓 7 个 `<input type="file">` 的文件、序号与 `accept`；
- 7 个通过公共媒体 helper 使用的 Storage namespace；
- 头像 URL 写入口和不走媒体 Storage 的 `bulk_import` 豁免。

任一数量、路径、入口或标记漂移时，脚本输出 `P0_FRONTEND_INVENTORY_DRIFT`、列出差异并返回非零退出码。应先人工核对业务边界，再更新清单；不得为让核验通过而删除旧路由、放宽上传或提前施工 P1 UI。

提交前再运行：

```powershell
git diff --check
```
