import Modal from '../common/Modal'
import Field from '../common/Field'
import { permissionGroups, knownPermissionNames } from '../../domain/permissions'
import ModalActions from '../common/ModalActions'
import type { Gender } from '../../domain/types'
import { genderLabels } from '../../domain/labels'
import type { DarApplicationContext } from '../../application/useDarApplication'

type Props = { ctx: DarApplicationContext }

export default function UserDialog({ ctx }: Props) {
  const editing = ctx.editingUser
  const form = ctx.userForm
  const update = (patch: Partial<typeof form>) => ctx.setUserForm((current) => ({ ...current, ...patch }))
  const activeTeachers = ctx.teachers.filter((teacher) => teacher.status === 'active' || teacher.id === form.teacherId)
  const showScope = form.permissionCodes.some((code) => code.startsWith('supervisor.'))
    || form.scopeCircleIds.length > 0 || form.scopeTeacherIds.length > 0

  return (
    <Modal
      title={editing ? 'تعديل الحساب والصلاحيات' : 'إنشاء حساب جديد'}
      subtitle="كل حساب يأخذ الصلاحيات التي تحددها فقط. يمكن ربط حساب المعلمة بسجل معلمة واحد."
      wide
      close={() => !ctx.saving && ctx.setUserModal(false)}
    >
      <form onSubmit={ctx.saveUser}>
        <div className="form-grid">
          <Field label="اسم المستخدم *">
            <input required minLength={3} maxLength={100} autoComplete="off" value={form.username} onChange={(event) => update({ username: event.target.value })} />
          </Field>
          <Field label="اسم العرض *">
            <input required maxLength={160} value={form.displayName} onChange={(event) => update({ displayName: event.target.value })} />
          </Field>
          <Field label="الجنس">
            <select value={form.gender ?? ''} onChange={(event) => update({ gender: event.target.value as '' | Gender })}>
              <option value="">غير محدد</option>
              {Object.entries(genderLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={`كلمة المرور ${editing ? '(اتركها فارغة دون تغيير)' : '(6 أحرف على الأقل)'} *`} wide={!editing}>
            <input
              type="password"
              autoComplete="new-password"
              required={!editing}
              minLength={6}
              maxLength={200}
              value={form.password}
              onChange={(event) => update({ password: event.target.value })}
            />
            {editing && <small className="sub-cell password-reset-hint">اترك الحقل فارغًا دون تغيير. لو نسيت المعلمة كلمة المرور، اكتب كلمة مرور جديدة من 6 أحرف على الأقل.</small>}
          </Field>

          <Field label="ربط بمعلمة" wide>
            <select value={form.teacherId ?? ''} onChange={(event) => update({ teacherId: event.target.value || null })}>
              <option value="">بدون ربط</option>
              {activeTeachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>{teacher.fullName} — {teacher.teacherCode}</option>
              ))}
            </select>
            <small className="sub-cell">الربط يسمح لحساب المعلمة بالدخول إلى بوابة المعلمة ورؤية حلقاتها فقط. المعلمة لا تربط نفسها؛ المدير فقط.</small>
          </Field>

          {editing && (
            <Field label="حالة الحساب">
              <select value={form.isActive ? 'active' : 'inactive'} onChange={(event) => update({ isActive: event.target.value === 'active' })}>
                <option value="active">نشط</option>
                <option value="inactive">معطّل</option>
              </select>
            </Field>
          )}

          {editing && (
            <Field label="قفل الدخول" wide>
              <span className="lock-toggle-row">
                <input type="checkbox" checked={!!form.isLocked} onChange={(event) => update({ isLocked: event.target.checked })} />
                <span>قفل الحساب مؤقتًا (يمنع الدخول والتصرفات فورًا)</span>
              </span>
              {form.isLocked && (
                <input
                  required
                  maxLength={300}
                  placeholder="سبب القفل — يظهر في سجل التدقيق"
                  value={form.lockReason ?? ''}
                  onChange={(event) => update({ lockReason: event.target.value })}
                />
              )}
            </Field>
          )}

          {showScope && (
            <Field label="نطاق الإشراف" wide>
              <div className="scope-grid">
                <label>
                  الحلقات
                  <select
                    multiple
                    size={6}
                    value={form.scopeCircleIds}
                    onChange={(event) => update({ scopeCircleIds: Array.from(event.target.selectedOptions, (option) => option.value) })}
                  >
                    {ctx.circles.map((circle) => <option key={circle.id} value={circle.id}>{circle.name}</option>)}
                  </select>
                </label>
                <label>
                  المعلمات
                  <select
                    multiple
                    size={6}
                    value={form.scopeTeacherIds}
                    onChange={(event) => update({ scopeTeacherIds: Array.from(event.target.selectedOptions, (option) => option.value) })}
                  >
                    {ctx.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.fullName}</option>)}
                  </select>
                </label>
              </div>
              <small className="sub-cell">بدون تحديد = كل الحلقات والمعلمات. استخدم Ctrl لتحديد أكثر من عنصر. الحفظ يطبق النطاق فورًا.</small>
            </Field>
          )}
        </div>

        <div className="permission-editor">
          <div className="permission-editor-heading">
            <strong>الصلاحيات</strong>
            <div>
              <button type="button" className="text-link" onClick={() => update({ permissionCodes: ctx.permissions.map((permission) => permission.code) })}>تحديد الكل</button>
              <span>·</span>
              <button type="button" className="text-link" onClick={() => update({ permissionCodes: [] })}>إلغاء الكل</button>
            </div>
          </div>
          <div className="permission-groups">
            {permissionGroups.map((group) => (
              <fieldset key={group.label} className="permission-group">
                <legend>{group.label}</legend>
                {group.codes.map((code) => (
                  <label key={code} className="permission-option">
                    <input
                      type="checkbox"
                      checked={form.permissionCodes.includes(code)}
                      onChange={(event) => update({
                        permissionCodes: event.target.checked
                          ? [...form.permissionCodes, code]
                          : form.permissionCodes.filter((item) => item !== code),
                      })}
                    />
                    <span>{knownPermissionNames[code] ?? code}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </div>

        <ModalActions saving={ctx.saving} onCancel={() => ctx.setUserModal(false)} saveLabel={editing ? 'حفظ التعديلات' : 'إنشاء الحساب'} />
      </form>
    </Modal>
  )
}
