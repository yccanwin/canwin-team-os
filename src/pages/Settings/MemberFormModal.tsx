import { useState, useEffect } from 'react'
import Modal from '@/components/Modal'
import { useUserStore } from '@/stores/useUserStore'
import type { User } from '@/types'

interface MemberFormModalProps {
  isOpen: boolean
  onClose: () => void
  member?: User  // 编辑时传入
}

export default function MemberFormModal({
  isOpen,
  onClose,
  member,
}: MemberFormModalProps) {
  const addUser = useUserStore((s) => s.addUser)
  const updateUser = useUserStore((s) => s.updateUser)

  const isEdit = !!member

  // 表单字段
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [role, setRole] = useState<User['role']>('member')
  const [joinDate, setJoinDate] = useState(new Date().toISOString().split('T')[0])
  const [avatar, setAvatar] = useState('')
  const [password, setPassword] = useState('')

  // 错误
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 回填
  useEffect(() => {
    if (member) {
      setName(member.name)
      setPosition(member.position)
      setRole(member.role)
      setJoinDate(member.joinDate.split('T')[0])
      setAvatar(member.avatar || '')
      setPassword(member.switchPassword || '')
    }
  }, [member])

  // 验证
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '姓名不能为空'
    if (!position.trim()) newErrors.position = '岗位不能为空'
    if (!joinDate) newErrors.joinDate = '入职时间不能为空'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 提交
  const handleSubmit = () => {
    if (!validate()) return

    const data = {
      name: name.trim(),
      position: position.trim(),
      role,
      joinDate: new Date(joinDate).toISOString(),
      xp: isEdit ? (member?.xp ?? 0) : 0,
      level: isEdit ? (member?.level ?? 1) : 1,
      badges: isEdit ? (member?.badges ?? []) : [],
      avatar: avatar.trim() || undefined,
      switchPassword: isEdit ? (password.trim() || undefined) : undefined,
    }

    if (isEdit) {
      updateUser(member.id, data)
    } else {
      addUser(data)
    }

    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? '编辑成员' : '新增成员'}
      size="md"
    >
      <div className="space-y-4">
        {/* 姓名 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            姓名 <span className="text-expense">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：张三"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.name ? 'border-expense' : 'border-gray-300'
            }`}
          />
          {errors.name && (
            <p className="text-xs text-expense mt-1">{errors.name}</p>
          )}
        </div>

        {/* 岗位 */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            岗位 <span className="text-expense">*</span>
          </label>
          <input
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="如：销售主管"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
              errors.position ? 'border-expense' : 'border-gray-300'
            }`}
          />
          {errors.position && (
            <p className="text-xs text-expense mt-1">{errors.position}</p>
          )}
        </div>

        {/* 角色 + 入职时间 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              角色 <span className="text-expense">*</span>
            </label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setRole('captain')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  role === 'captain'
                    ? 'bg-primary text-white'
                    : 'bg-white text-brand-400 hover:bg-brand-50'
                }`}
              >
                队长
              </button>
              <button
                type="button"
                onClick={() => setRole('member')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  role === 'member'
                    ? 'bg-primary text-white'
                    : 'bg-white text-brand-400 hover:bg-brand-50'
                }`}
              >
                成员
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              入职时间 <span className="text-expense">*</span>
            </label>
            <input
              type="date"
              value={joinDate}
              onChange={(e) => setJoinDate(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                errors.joinDate ? 'border-expense' : 'border-gray-300'
              }`}
            />
            {errors.joinDate && (
              <p className="text-xs text-expense mt-1">
                {errors.joinDate}
              </p>
            )}
          </div>
        </div>

        {/* 头像 URL */}
        <div>
          <label className="block text-sm font-medium text-brand-400 mb-1">
            头像 URL
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="https://... （可选，留空则显示首字母）"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-semibold">
              {avatar ? (
                <img
                  src={avatar}
                  alt=""
                  className="w-full h-full rounded-full object-cover"
                  onError={(e) => {
                    // 图片加载失败，显示首字母
                    ;(e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                name.charAt(0) || '?'
              )}
            </div>
          </div>
        </div>

        {/* 切换密码（仅编辑时显示） */}
        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              切换密码
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="password"
                maxLength={4}
                value={password}
                onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
                placeholder="留空则无密码 / 输入4位数字设置密码"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              {password && (
                <button
                  type="button"
                  onClick={() => setPassword('')}
                  className="px-3 py-2 text-xs text-expense hover:bg-red-50 rounded-lg transition-colors"
                >
                  清除密码
                </button>
              )}
            </div>
            <p className="text-xs text-brand-300 mt-1">
              {password
                ? `已设置 ${password.length} 位密码，切换到此成员时将需要密码验证`
                : '未设置密码，任何人可直接切换到此成员'}
            </p>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm font-medium text-brand-400 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors"
          >
            {isEdit ? '保存修改' : '添加成员'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
