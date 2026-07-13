import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, SearchCheck, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { createCustomerImportDataSource } from './customerImportDataSource'
import { customerImportFields, downloadCustomerImportTemplate, parseCustomerImportFile } from './customerImportFile'
import type { CustomerImportRowInput } from './customerImportTypes'
import './customer-import.css'

const dataSource = createCustomerImportDataSource(supabase)
const statusText: Record<string, string> = { staged: '待预检', precheck_failed: '预检未通过', dry_run_ready: '可确认导入', committed: '已导入', committed_with_errors: '部分失败', rolled_back: '已回滚', rollback_conflict: '回滚有冲突' }
function maskPhone(value: unknown) { const phone = String(value ?? ''); return phone.length > 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone }

export default function CustomerImportRealRoute() {
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof dataSource.load>> | null>(null)
  const [rows, setRows] = useState<CustomerImportRowInput[]>([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async (batchId?: string | null) => setSnapshot(await dataSource.load(batchId)), [])
  useEffect(() => { queueMicrotask(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '读取导入记录失败')) }) }, [load])
  const selected = useMemo(() => snapshot?.batches.find((batch) => batch.id === snapshot.selectedBatchId) ?? null, [snapshot])
  const chooseFile = async (file?: File) => {
    if (!file) return
    setError(''); setNotice('')
    try { setRows(await parseCustomerImportFile(file)); setFileName(file.name) }
    catch (reason) { setRows([]); setFileName(''); setError(reason instanceof Error ? reason.message : '文件解析失败') }
  }
  const precheck = async () => {
    setBusy(true); setError(''); setNotice('')
    try { const batchId = await dataSource.stage(fileName, rows); await dataSource.precheck(batchId); await load(batchId); setNotice('服务端预检完成，尚未写入任何正式客户数据。') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '预检失败') }
    finally { setBusy(false) }
  }
  const commit = async () => {
    if (!selected || !window.confirm(`确认导入 ${selected.rowCount} 行客户数据？此操作会写入正式数据。`)) return
    setBusy(true); setError(''); setNotice('')
    try { await dataSource.commit(selected.id); await load(selected.id); setNotice('导入执行完成，请核对逐行结果。') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败') }
    finally { setBusy(false) }
  }
  return <section className="ci-shell">
    <header className="ci-hero"><div><span>系统设置 · 数据迁移</span><h1>旧客户导入</h1><p>仅接收团队提供的 Excel/CSV。先预检、再确认；不连接或采集客如云后台。</p></div><button onClick={downloadCustomerImportTemplate}><Download size={17} />下载标准模板</button></header>
    <div className="ci-layout"><main>
      <article className="ci-card"><div className="ci-title"><FileSpreadsheet size={20} /><div><h2>1. 选择文件</h2><p>支持 .xlsx / .csv，单批 1–500 行。</p></div></div><label className="ci-drop"><Upload size={24} /><strong>{fileName || '选择或拖入客户文件'}</strong><span>{rows.length ? `已解析 ${rows.length} 行，仍未上传` : '文件仅在点击预检后上传'}</span><input type="file" accept=".xlsx,.csv" onChange={(event) => void chooseFile(event.target.files?.[0])} /></label></article>
      <article className="ci-card"><div className="ci-title"><SearchCheck size={20} /><div><h2>2. 服务端试导入</h2><p>校验区域、负责人、SKU、日期，并对电话、品牌和门店去重。</p></div></div><button className="ci-primary" disabled={busy || !rows.length} onClick={() => void precheck()}>{busy ? '处理中…' : '上传并开始预检'}</button>{notice && <div className="ci-notice">{notice}</div>}{error && <div className="ci-error">{error}</div>}</article>
      {selected && <article className="ci-card"><div className="ci-title"><CheckCircle2 size={20} /><div><h2>3. 预检结果</h2><p>{selected.sourceName} · {statusText[selected.status] ?? selected.status}</p></div></div><div className="ci-summary"><div><strong>{selected.rowCount}</strong><span>总行数</span></div><div className={selected.blockingErrorCount ? 'bad' : ''}><strong>{selected.blockingErrorCount}</strong><span>错误行</span></div><div><strong>{Number(selected.report?.created ?? 0)}</strong><span>计划新增</span></div><div><strong>{Number(selected.report?.updated ?? 0)}</strong><span>计划更新</span></div></div><div className="ci-table-wrap"><table><thead><tr><th>行</th><th>品牌 / 门店</th><th>区域</th><th>负责人</th><th>SKU / 到期日</th><th>联系人</th><th>计划 / 结果</th><th>错误</th></tr></thead><tbody>{snapshot?.rows.map((row) => <tr key={row.id} className={row.validationErrors.length ? 'has-error' : ''}><td>{row.rowNumber}</td><td><strong>{String(row.rawData.brand_name ?? '')}</strong><span>{String(row.rawData.store_name ?? '')}</span></td><td>{String(row.rawData.region_code ?? '')}</td><td>{String(row.rawData.owner_name ?? row.rawData.owner_profile_id ?? '')}</td><td><strong>{String(row.rawData.current_product_sku ?? '')}</strong><span>{String(row.rawData.expires_on ?? '')}</span></td><td><strong>{String(row.rawData.contact_name ?? '')}</strong><span>{maskPhone(row.rawData.contact_phone)}</span></td><td>{row.resultStatus !== 'pending' ? row.resultStatus : row.plannedAction}</td><td>{row.validationErrors.map((item) => typeof item === 'string' ? item : item.message ?? item.code).join('；') || row.errorMessage || '—'}</td></tr>)}</tbody></table></div><div className="ci-confirm"><div>{selected.blockingErrorCount ? <><AlertTriangle size={18} />请修正全部错误后重新上传。</> : '预检通过。确认前不会写入正式数据。'}</div><button className="ci-primary" disabled={busy || selected.status !== 'dry_run_ready' || selected.blockingErrorCount > 0} onClick={() => void commit()}>确认导入正式数据</button></div></article>}
    </main><aside><article className="ci-card"><h2>字段说明</h2><div className="ci-fields">{customerImportFields.map(([name, detail]) => <div key={name}><strong>{name}</strong><span>{detail}</span></div>)}</div></article><article className="ci-card"><h2>最近批次</h2><div className="ci-batches">{snapshot?.batches.map((batch) => <button key={batch.id} className={batch.id === snapshot.selectedBatchId ? 'active' : ''} onClick={() => void load(batch.id)}><strong>{batch.sourceName}</strong><span>{statusText[batch.status] ?? batch.status} · {batch.rowCount}行</span></button>)}</div></article></aside></div>
  </section>
}

