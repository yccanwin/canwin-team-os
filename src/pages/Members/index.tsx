import { Link } from 'react-router-dom'
import { roleLabel } from '@/services/profile'
import { useUserStore } from '@/stores/useUserStore'

export default function MembersPage() {
  const users = useUserStore((s) => s.users)

  return (
    <div className="px-3 py-4 lg:px-6">
      <div className="mb-5">
        <h1 className="font-heading text-lg font-semibold text-brand-400">团队成员</h1>
        <p className="mt-1 text-sm text-brand-300">查看成员角色、协作说明和每周休息日。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((user) => (
          <section key={user.id} className="rounded-card bg-white p-5 shadow-card">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-base font-semibold text-white">
                {user.name.slice(0, 1)}
              </div>
              <div>
                <h2 className="font-heading text-base font-semibold text-brand-400">{user.name}</h2>
                <p className="text-xs text-brand-300">{roleLabel(user.role)} · {user.position || '未填写岗位'}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <InfoRow label="休息日" value={user.restDays?.length ? user.restDays.join('、') : '未设置'} />
              <InfoRow label="沟通偏好" value={user.communicationPreference || '未填写'} />
              <InfoRow label="最近状态" value={user.mood || '未填写'} />
              <InfoRow label="注意事项" value={user.taboos || '未填写'} />
              <InfoRow label="协作备注" value={user.notes || '未填写'} />
            </div>
            <Link
              to={`/profile?id=${user.id}`}
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 transition hover:bg-cyan-100"
            >
              查看成员档案
            </Link>
          </section>
        ))}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-brand-200">{label}</span>
      <span className="text-brand-400">{value}</span>
    </div>
  )
}
