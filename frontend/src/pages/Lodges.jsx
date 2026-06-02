import React, { useState, useEffect } from 'react'
import { Building2, Plus, Edit3, Archive, CheckCircle, XCircle, X } from 'lucide-react'
import { toast } from 'react-toastify'
import { lodgesAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Lodges admin page — super_admin only.
 *
 * From here a super_admin can:
 *   - See every lodge in the system, active or archived
 *   - Create a new lodge (gets seeded settings + becomes selectable in the
 *     header dropdown immediately)
 *   - Edit name / address / phone / email
 *   - Toggle active state (archive = soft-delete; the backend blocks
 *     archiving the only remaining active lodge)
 *
 * Tenant admins (role === 'admin') will hit the ProtectedRoute guard and
 * be redirected to /dashboard before they ever see this page.
 */
export default function Lodges() {
  const { isSuperAdmin } = useAuth()
  const [lodges, setLodges] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)  // {lodge_id, ...} or null

  const fetchLodges = async () => {
    setLoading(true)
    try {
      const res = await lodgesAPI.list()
      setLodges(res.data || [])
    } catch {
      toast.error('Failed to load lodges')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLodges() }, [])

  // Defensive guard. The route-level ProtectedRoute already blocks
  // non-super-admins, so this is belt-and-braces.
  if (!isSuperAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6 animate-fade-in">
        <div className="text-center max-w-sm">
          <Building2 size={48} className="mx-auto text-red-400 mb-4" />
          <h2 className="text-xl font-bold text-navy">Super-admin only</h2>
          <p className="text-gray-500 mt-2">
            Only the super administrator can manage lodges. Tenant admins
            are scoped to their own lodge.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Lodges</h1>
          <p className="text-gray-500 text-sm mt-1">
            Create, edit, and archive lodges. Each lodge has its own customers,
            rooms, bookings, settings, and audit log.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-gold hover:bg-gold/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium shadow-sm"
        >
          <Plus size={16} /> New Lodge
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : lodges.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <Building2 size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No lodges yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Phone</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Email</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lodges.map(l => (
                <tr key={l.lodge_id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{l.code}</td>
                  <td className="px-4 py-3 font-semibold text-navy">{l.name}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-600">{l.phone || '—'}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-600">{l.email || '—'}</td>
                  <td className="px-4 py-3">
                    {l.is_active
                      ? <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-0.5 rounded text-xs"><CheckCircle size={12}/>Active</span>
                      : <span className="inline-flex items-center gap-1 text-gray-500 bg-gray-100 px-2 py-0.5 rounded text-xs"><Archive size={12}/>Archived</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => setEditing(l)}
                        className="text-navy/70 hover:text-navy"
                        title="Edit"
                      >
                        <Edit3 size={16}/>
                      </button>
                      {l.is_active && (
                        <button
                          onClick={async () => {
                            if (!window.confirm(`Archive "${l.name}"? Its data is preserved but it will stop appearing in the active list.`)) return
                            try {
                              await lodgesAPI.archive(l.lodge_id)
                              toast.success('Lodge archived')
                              fetchLodges()
                            } catch (e) {
                              toast.error(e.response?.data?.detail || 'Failed to archive')
                            }
                          }}
                          className="text-red-500 hover:text-red-700"
                          title="Archive"
                        >
                          <Archive size={16}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <LodgeFormModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); fetchLodges() }}
        />
      )}
      {editing && (
        <LodgeFormModal
          lodge={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchLodges() }}
        />
      )}
    </div>
  )
}

/** Modal used for both create and edit. When `lodge` is provided we're
 *  editing — code becomes read-only because it's a stable identifier. */
function LodgeFormModal({ lodge = null, onClose, onSaved }) {
  const isEdit = !!lodge
  const [form, setForm] = useState({
    code: lodge?.code || '',
    name: lodge?.name || '',
    address: lodge?.address || '',
    phone: lodge?.phone || '',
    email: lodge?.email || '',
    is_active: lodge?.is_active ?? true,
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || form.name.trim().length < 2) {
      toast.error('Name is required'); return
    }
    if (!isEdit && !/^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/.test(form.code.trim().toLowerCase())) {
      toast.error('Code must be 3–40 chars, lowercase letters/numbers/_/-')
      return
    }
    setSaving(true)
    try {
      if (isEdit) {
        await lodgesAPI.update(lodge.lodge_id, {
          name: form.name.trim(),
          address: form.address || null,
          phone: form.phone || null,
          email: form.email || null,
          is_active: form.is_active,
        })
        toast.success('Lodge updated')
      } else {
        await lodgesAPI.create({
          code: form.code.trim().toLowerCase(),
          name: form.name.trim(),
          address: form.address || null,
          phone: form.phone || null,
          email: form.email || null,
        })
        toast.success('Lodge created')
      }
      onSaved()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display font-bold text-navy text-lg">
            {isEdit ? `Edit "${lodge.name}"` : 'New Lodge'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20}/>
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
              Code {isEdit && <span className="text-gray-400 normal-case">(immutable)</span>}
            </label>
            <input
              type="text"
              value={form.code}
              onChange={e => set('code', e.target.value)}
              disabled={isEdit}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="e.g. udumulas, rk, sunset_palace"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              3–40 chars, lowercase letters/digits/_/-. Used as the lodge's permanent identifier.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Display name of the lodge"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={e => set('address', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
              />
              <span>Active</span>
              <span className="text-[11px] text-gray-400">(uncheck to archive)</span>
            </label>
          )}
          {!isEdit && (
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded p-3">
              A new lodge starts with copied default settings from the first existing lodge.
              Sensitive credentials (Twilio, SMTP, API keys) are NOT copied — set them up
              afresh under Settings after creating.
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-gold text-white rounded-lg hover:bg-gold/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Lodge'}
          </button>
        </div>
      </form>
    </div>
  )
}
