import React, { useState } from 'react'
import { api, customersAPI } from '../../services/api'
import { toast } from 'react-toastify'
import { X, User, Phone, Mail, MapPin, Shield, Calendar, Upload } from 'lucide-react'

const ID_TYPES = [
  { value: 'aadhar', label: 'Aadhar Card', placeholder: '12-digit number', pattern: /^\d{12}$/ },
  { value: 'driving_license', label: 'Driving License', placeholder: 'KA0120XXXXXXXXXXX', pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{11}$/i },
  { value: 'voter_id', label: 'Voter ID', placeholder: 'ABC1234567', pattern: /^[A-Z]{3}\d{7}$/i },
  { value: 'passport', label: 'Passport', placeholder: 'A1234567', pattern: /^[A-Z]\d{7}$/i },
  { value: 'pan', label: 'PAN Card', placeholder: 'ABCDE1234F', pattern: /^[A-Z]{5}\d{4}[A-Z]$/i },
]

export default function AddCustomerModal({ onClose, onSuccess }) {
  const [loading, setLoading] = useState(false)
  const [idFile, setIdFile] = useState(null)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: '',
    id_type: 'aadhar',
    id_number: '',
    nationality: 'Indian',
    gender: '',
    is_vip: false
  })
  const [errors, setErrors] = useState({})

  const validate = () => {
    const errs = {}
    if (!form.first_name || form.first_name.length < 2) errs.first_name = 'Min 2 characters'
    if (!form.last_name || form.last_name.length < 2) errs.last_name = 'Min 2 characters'
    if (!/^\d{10}$/.test(form.phone)) errs.phone = 'Must be 10 digits'
    if (!form.id_type) errs.id_type = 'Select ID type'
    if (!form.id_number) errs.id_number = 'ID number required'
    else {
      const idDef = ID_TYPES.find(t => t.value === form.id_type)
      if (idDef && !idDef.pattern.test(form.id_number.toUpperCase()))
        errs.id_number = `Invalid ${idDef.label} format`
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      const payload = { ...form, gender: form.gender || null }
      const data = await customersAPI.create(payload)
      const newCustomerId = data?.data?.customer_id || data?.customer_id

      // If admin attached an ID image at creation time, upload it now using
      // the dedicated ID-proof endpoint. Failure to upload doesn't roll back
      // the customer record (they can re-upload from the customer panel).
      if (idFile && newCustomerId) {
        try {
          const fd = new FormData()
          fd.append('file', idFile)
          await api.postForm(`/customers/${newCustomerId}/id-proof`, fd)
        } catch (e) {
          toast.warn('Customer created, but ID image upload failed. Use Edit Guest to retry.')
        }
      }

      toast.success('Customer created successfully')
      onSuccess(data)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create customer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-navy p-6 text-white flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold font-playfair text-gold">Register New Guest</h3>
            <p className="text-xs opacity-60 mt-1">Create a permanent customer record</p>
          </div>
          <button onClick={onClose} className="hover:bg-white/10 p-2 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">First Name *</label>
              <div className="relative mt-1">
                <User size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text" required
                  className={`w-full pl-9 pr-4 py-2.5 border ${errors.first_name ? 'border-red-400' : 'border-gray-200'} rounded-xl text-sm focus:border-navy outline-none transition-all`}
                  placeholder="First name"
                  value={form.first_name}
                  onChange={e => setForm({ ...form, first_name: e.target.value })}
                />
              </div>
              {errors.first_name && <p className="text-red-500 text-[10px] mt-1">{errors.first_name}</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Last Name *</label>
              <div className="relative mt-1">
                <User size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text" required
                  className={`w-full pl-9 pr-4 py-2.5 border ${errors.last_name ? 'border-red-400' : 'border-gray-200'} rounded-xl text-sm focus:border-navy outline-none transition-all`}
                  placeholder="Last name"
                  value={form.last_name}
                  onChange={e => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
              {errors.last_name && <p className="text-red-500 text-[10px] mt-1">{errors.last_name}</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Phone *</label>
              <div className="relative mt-1">
                <Phone size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="tel" required maxLength={10}
                  className={`w-full pl-9 pr-4 py-2.5 border ${errors.phone ? 'border-red-400' : 'border-gray-200'} rounded-xl text-sm focus:border-navy outline-none transition-all`}
                  placeholder="10-digit mobile"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })}
                />
              </div>
              {errors.phone && <p className="text-red-500 text-[10px] mt-1">{errors.phone}</p>}
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email</label>
              <div className="relative mt-1">
                <Mail size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="email"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none transition-all"
                  placeholder="guest@email.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">ID Type *</label>
              <div className="relative mt-1">
                <Shield size={14} className="absolute left-3 top-3 text-gray-400" />
                <select
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none appearance-none"
                  value={form.id_type}
                  onChange={e => setForm({ ...form, id_type: e.target.value })}
                >
                  {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">ID Number *</label>
              <div className="relative mt-1">
                <Shield size={14} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text" required
                  className={`w-full pl-9 pr-4 py-2.5 border ${errors.id_number ? 'border-red-400' : 'border-gray-200'} rounded-xl text-sm focus:border-navy outline-none transition-all uppercase`}
                  placeholder={ID_TYPES.find(t => t.value === form.id_type)?.placeholder}
                  value={form.id_number}
                  onChange={e => setForm({ ...form, id_number: e.target.value.toUpperCase() })}
                />
              </div>
              {errors.id_number && <p className="text-red-500 text-[10px] mt-1">{errors.id_number}</p>}
            </div>

            <div className="col-span-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</label>
              <div className="relative mt-1">
                <MapPin size={14} className="absolute left-3 top-3 text-gray-400" />
                <textarea
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none h-20 resize-none transition-all"
                  placeholder="Full address..."
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Nationality</label>
              <input
                type="text"
                className="w-full mt-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none"
                value={form.nationality}
                onChange={e => setForm({ ...form, nationality: e.target.value })}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Gender</label>
              <select
                className="w-full mt-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:border-navy outline-none"
                value={form.gender}
                onChange={e => setForm({ ...form, gender: e.target.value })}
              >
                <option value="">Select</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          {/* ID Proof file upload — same flow as Check-in form so admin can
              capture the ID at customer creation and skip re-upload at first
              check-in. */}
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              ID Proof Image <span className="text-gray-400 font-normal normal-case">(JPG/PNG/PDF, max 5MB — optional, but speeds up first check-in)</span>
            </label>
            <label className="mt-1 flex items-center gap-3 border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-navy transition-colors">
              <Upload size={16} className="text-gray-400" />
              <span className="text-sm text-gray-500 truncate">{idFile ? idFile.name : 'Click to attach ID image'}</span>
              <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf"
                onChange={e => setIdFile(e.target.files[0])} />
            </label>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="is_vip"
              className="w-4 h-4 text-gold border-gray-300 rounded focus:ring-gold"
              checked={form.is_vip}
              onChange={e => setForm({ ...form, is_vip: e.target.checked })}
            />
            <label htmlFor="is_vip" className="text-sm text-gray-700 font-medium cursor-pointer">Mark as VIP Guest ⭐</label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-bold hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-navy text-white rounded-xl font-bold hover:bg-navy-dark transition-all disabled:opacity-50 shadow-lg shadow-navy/10"
            >
              {loading ? "Processing..." : "Create Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
