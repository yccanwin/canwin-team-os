import { useState, useEffect } from 'react'
import Modal from '@/components/Modal'
import { useUserStore } from '@/stores/useUserStore'
import type { User } from '@/types'
import { createTeamMember, updateTeamMember } from '@/services/adminMembers'

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
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // 错误
  const [errors, setErrors] = useState<Record<string, string>>({})

  // 回填
  useEffect(() => {
    if (member) {
      queueMicrotask(() => {
        setName(member.name)
        setPosition(member.position)
        setRole(member.role)
        setJoinDate(member.joinDate.split('T')[0])
        setAvatar(member.avatar || '')
      })
    }
  }, [member])

  // 验证
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) newErrors.name = '姓名不能为空'
    if (!position.trim()) newErrors.position = '岗位不能为空'
    if (!joinDate) newErrors.joinDate = '入职时间不能为空'
    if (!isEdit && !email.trim()) newErrors.email = '邮箱不能为空'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // 提交
  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    setSubmitError('')

    const data = {
      name: name.trim(),
      position: position.trim(),
      role,
      joinDate,
      avatarUrl: avatar.trim() || undefined,
      email: email.trim() || undefined,
    }

    try {
      if (isEdit) {
        const saved = await updateTeamMember({ ...data, id: member.id })
        updateUser(member.id, saved)
      } else {
        const saved = await createTeamMember(data)
        addUser(saved)
      }
      onClose()
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '成员保存失败')
    } finally {
      setSubmitting(false)
    }
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
        {!isEdit && (
          <div>
            <label className="block text-sm font-medium text-brand-400 mb-1">
              登录邮箱 <span className="text-expense">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@example.com"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary ${
                errors.email ? 'border-expense' : 'border-gray-300'
              }`}
            />
            {errors.email && <p className="text-xs text-expense mt-1">{errors.email}</p>}
          </div>
        )}

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
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as User['role'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="member">成员</option>
              <option value="captain">队长</option>
              <option value="finance">财务</option>
              <option value="warehouse">仓库负责人</option>
              <option value="admin">管理员</option>
            </select>
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

        {!isEdit && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            系统将向该邮箱发送登录邀请，不再由管理员设置初始密码。
          </p>
        )}

        {submitError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {submitError}
          </p>
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
            disabled={submitting}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-indigo-600 transition-colors disabled:opacity-60"
          >
            {submitting ? '保存中...' : isEdit ? '保存修改' : '添加成员'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
