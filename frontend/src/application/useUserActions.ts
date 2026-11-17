import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AdminUser, Notice, UserForm } from '../domain/types'
import { request } from '../services/apiClient'

type Options = {
  userForm: UserForm
  editingUser: AdminUser | null
  setEditingUser: (user: AdminUser | null) => void
  setUserForm: Dispatch<SetStateAction<UserForm>>
  setUserModal: (open: boolean) => void
  setSaving: (saving: boolean) => void
  setToast: (notice: Notice) => void
  closeDetailLayers: () => void
  loadUsers: () => Promise<unknown>
}

export default function useUserActions({
  userForm, editingUser, setEditingUser, setUserForm, setUserModal,
  setSaving, setToast, closeDetailLayers, loadUsers,
}: Options) {
  const openUserCreate = () => {
    closeDetailLayers()
    setEditingUser(null)
    setUserForm({ username: '', displayName: '', password: '', isActive: true, permissionCodes: ['dashboard.read'], teacherId: null, isLocked: false, lockReason: '', scopeCircleIds: [], scopeTeacherIds: [] })
    setUserModal(true)
  }

  const openUserEdit = (user: AdminUser) => {
    closeDetailLayers()
    setEditingUser(user)
    setUserForm({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      password: '',
      isActive: user.isActive,
      permissionCodes: [...user.permissionCodes],
      teacherId: user.teacherId,
      isLocked: user.isLocked,
      lockReason: user.lockReason ?? '',
      scopeCircleIds: [...(user.scopeCircleIds ?? [])],
      scopeTeacherIds: [...(user.scopeTeacherIds ?? [])],
    })
    setUserModal(true)
  }

  const saveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...userForm,
        password: userForm.password || null,
        teacherId: userForm.teacherId || null,
        isLocked: !!userForm.isLocked,
        lockReason: userForm.isLocked ? userForm.lockReason || null : null,
      }
      if (editingUser) {
        await request(`/api/admin/users/${editingUser.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        await request(`/api/admin/users/${editingUser.id}/access`, {
          method: 'PUT',
          body: JSON.stringify({
            teacherId: payload.teacherId,
            isLocked: payload.isLocked,
            lockReason: payload.lockReason,
            scopeCircleIds: payload.scopeCircleIds,
            scopeTeacherIds: payload.scopeTeacherIds,
          }),
        })
      } else {
        const created = await request<{ id: string }>('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) })
        await request(`/api/admin/users/${created.id}/access`, {
          method: 'PUT',
          body: JSON.stringify({
            teacherId: payload.teacherId,
            isLocked: payload.isLocked,
            lockReason: payload.lockReason,
            scopeCircleIds: payload.scopeCircleIds,
            scopeTeacherIds: payload.scopeTeacherIds,
          }),
        })
      }
      setUserModal(false)
      await loadUsers()
      setToast({ tone: 'success', text: editingUser ? 'تم تحديث الحساب وصلاحياته وحالة الوصول.' : 'تم إنشاء الحساب بالصلاحيات المحددة.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ الحساب.' })
    } finally {
      setSaving(false)
    }
  }

  const deactivateUser = async (user: AdminUser) => {
    if (!window.confirm(`تعطيل حساب «${user.displayName}»؟ لن يستطيع تسجيل الدخول بعد ذلك.`)) return
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE' })
      await loadUsers()
      setToast({ tone: 'success', text: 'تم تعطيل الحساب.' })
    } catch (error) {
      setToast({ tone: 'error', text: error instanceof Error ? error.message : 'تعذر تعطيل الحساب.' })
    }
  }

  return { openUserCreate, openUserEdit, saveUser, deactivateUser }
}
