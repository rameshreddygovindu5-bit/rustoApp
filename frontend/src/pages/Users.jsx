import { useState, useEffect } from "react";
import { User, Shield, Phone, Mail, Clock, RefreshCw, UserPlus, Ban, CheckCircle, X, Key, Settings2 } from "lucide-react";
import { authAPI } from "../services/api";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";

export default function Users() {
  const { user: currentUser, isAdmin } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pinModal, setPinModal] = useState(null); // {user} when open

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await authAPI.listUsers();
      setUsers(response.data || []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (user) => {
    if (user.user_id === currentUser.user_id) {
      toast.warning("You cannot deactivate yourself");
      return;
    }
    try {
      await authAPI.toggleUser(user.user_id);
      toast.success(`User ${user.username} ${user.is_active ? "deactivated" : "activated"}`);
      fetchUsers();
    } catch {
      toast.error("Action failed");
    }
  };

  // Derive the current 2FA mode from the user record.
  const loginModeOf = (u) =>
    !u.require_login_otp ? "password" : (u.has_static_pin ? "pin" : "sms");

  const handleSetMode = async (user, mode) => {
    if (mode === loginModeOf(user)) return;
    if (mode === "pin") {
      // Needs a PIN — open the modal; PIN save enables OTP mode too.
      setPinModal(user);
      return;
    }
    try {
      const wantOtp = mode === "sms";
      if (wantOtp !== !!user.require_login_otp) {
        await authAPI.setUserOtpSetting(user.user_id, wantOtp);
      }
      if (user.has_static_pin) {
        await authAPI.setUserStaticPin(user.user_id, null); // clear stale PIN
      }
      toast.success(mode === "sms"
        ? `SMS OTP enabled for ${user.username}. A code is sent on each login (to their phone if set, else admin phone).`
        : `${user.username} now logs in with password only.`);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update login security");
    }
  };

  const handleSetStaticPin = async (user, pin) => {
    try {
      await authAPI.setUserStaticPin(user.user_id, pin || null);
      if (pin && !user.require_login_otp) {
        // Static PIN only takes effect when the OTP challenge is required.
        await authAPI.setUserOtpSetting(user.user_id, true);
      }
      toast.success(pin
        ? `Static PIN set for ${user.username}. They can use this PIN instead of SMS OTP.`
        : `Static PIN cleared for ${user.username}.`);
      setPinModal(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to set static PIN");
    }
  };

  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6 animate-fade-in">
        <div className="text-center max-w-sm">
          <Shield size={48} className="mx-auto text-red-400 mb-4" />
          <h2 className="text-xl font-bold text-navy">Access Restricted</h2>
          <p className="text-ink-500 mt-2">Only administrators can manage staff accounts. Please contact your manager if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-navy">Staff Management</h1>
          <p className="text-xs sm:text-sm text-ink-500 mt-0.5">Manage system users and access levels</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={fetchUsers} className="p-2.5 border border-ink-200 rounded-xl text-ink-600 hover:bg-ink-50 transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex-1 sm:flex-none btn-gold flex items-center justify-center gap-2 text-sm py-2.5 sm:py-2">
            <UserPlus size={16} /> Add Staff
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-ink-100 overflow-hidden">
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-ink-50 border-b border-ink-100">
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">Contact</th>
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">Last Login</th>
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-ink-500 uppercase tracking-wider px-4 py-3">OTP Login</th>
                <th className="text-right text-xs font-semibold text-ink-500 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {loading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(6).fill(0).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-ink-100 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-ink-400 text-sm">No users found</td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.user_id} className="hover:bg-ink-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                          u.role === 'admin' || u.role === 'super_admin' || u.role === 'app_owner' ? 'bg-gold text-navy-dark' :
                          u.role === 'lodge_owner' ? 'bg-sage text-white' :
                          u.role === 'vendor' ? 'bg-purple-600 text-white' :
                          'bg-navy text-gold'
                        }`}>
                          {u.full_name?.[0] || u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-navy">{u.full_name || u.username}</p>
                          <p className="text-xs text-ink-400">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${{
                          super_admin:  'bg-purple-100 text-purple-700',
                          app_owner:    'bg-navy/10 text-navy',
                          admin:        'bg-amber-100 text-amber-700',
                          lodge_owner:  'bg-green-100 text-green-700',
                          staff:        'bg-blue-100 text-blue-700',
                          vendor:       'bg-violet-100 text-violet-700',
                        }[u.role] || 'bg-ink-100 text-ink-600'}`}>
                        {({
                          super_admin: 'Super Admin',
                          app_owner:   'App Owner',
                          admin:       'Admin',
                          lodge_owner: 'Owner',
                          staff:       'Staff',
                          vendor:      'Vendor',
                        })[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        {u.email && <p className="text-xs text-ink-600 flex items-center gap-1.5"><Mail size={10} /> {u.email}</p>}
                        {u.phone && <p className="text-xs text-ink-600 flex items-center gap-1.5"><Phone size={10} /> {u.phone}</p>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-ink-500">
                      {u.last_login ? new Date(u.last_login).toLocaleString("en-IN") : "Never"}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                        {u.is_active ? <CheckCircle size={10} /> : <Ban size={10} />}
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {u.role === 'staff' ? (
                        <div className="flex flex-col gap-1">
                          <select
                            value={loginModeOf(u)}
                            onChange={e => handleSetMode(u, e.target.value)}
                            title="Second factor required after password at each login"
                            className={`text-xs font-semibold px-2 py-1.5 rounded-lg border focus:outline-none focus:border-gold cursor-pointer ${
                              loginModeOf(u) === 'password'
                                ? 'text-ink-500 border-ink-200 bg-white'
                                : loginModeOf(u) === 'sms'
                                  ? 'text-green-700 border-green-200 bg-green-50'
                                  : 'text-amber-700 border-amber-200 bg-amber-50'
                            }`}
                          >
                            <option value="password">Password only</option>
                            <option value="sms">SMS OTP</option>
                            <option value="pin">Static PIN</option>
                          </select>
                          {loginModeOf(u) === 'pin' && (
                            <button
                              onClick={() => setPinModal(u)}
                              title="Change or clear the static PIN"
                              className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-1 rounded-lg ring-1 ring-amber-200 justify-center"
                            >
                              <Key size={9}/> Change PIN
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-ink-300 italic">N/A</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleToggleStatus(u)}
                        disabled={u.user_id === currentUser.user_id}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                          u.is_active 
                            ? "text-red-600 hover:bg-red-50 disabled:opacity-30" 
                            : "text-green-600 hover:bg-green-50"
                        }`}
                      >
                        {u.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && <AddUserModal onClose={() => setShowAddModal(false)} onSuccess={() => { setShowAddModal(false); fetchUsers(); }} />}
      {pinModal && <StaticPinModal user={pinModal} onClose={() => setPinModal(null)} onSave={handleSetStaticPin} />}
    </div>
  );
}

function AddUserModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({ username: "", password: "", full_name: "", role: "staff", email: "", phone: "", require_login_otp: false });
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);

  const handleReview = (e) => {
    e.preventDefault();
    setStep('preview');
  };

  const processSubmit = async () => {
    setLoading(true);
    try {
      await authAPI.createUser(form);  // form includes require_login_otp
      toast.success("User created successfully!");
      onSuccess();
    } catch (err) {
      toast.error(err.message || "Failed to create user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold">
            {step === 'form' ? 'Add New Staff Member' : 'Review Staff Details'}
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        
        {step === 'form' ? (
        <form onSubmit={handleReview} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase">Username</label>
              <input
                required
                className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase">Password</label>
              <input
                required
                type="password"
                className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase">Full Name</label>
            <input
              required
              className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase">Role</label>
            <select
              className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
            >
              <option value="staff">Staff</option>
              <option value="lodge_owner">Lodge Owner</option>
              <option value="admin">Lodge Admin</option>
            </select>
          </div>
          {form.role === 'staff' && (
            <div className="flex items-center justify-between p-3 bg-ink-50 rounded-xl border border-ink-100">
              <div>
                <p className="text-xs font-bold text-ink-700">Require OTP on login</p>
                <p className="text-[10px] text-ink-400 mt-0.5">Sends OTP to admin phone on each staff login</p>
              </div>
              <button type="button"
                      onClick={() => setForm(f => ({...f, require_login_otp: !f.require_login_otp}))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.require_login_otp ? 'bg-green-500' : 'bg-ink-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.require_login_otp ? 'translate-x-5' : 'translate-x-0.5'}`}/>
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase">Email</label>
              <input
                type="email"
                className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase">Phone</label>
              <input
                className="w-full mt-1 px-3 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 text-sm"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-ink-200 rounded-xl text-sm font-medium hover:bg-ink-50">Cancel</button>
            <button type="submit" className="flex-1 py-2.5 bg-navy text-white rounded-xl text-sm font-bold hover:bg-navy/90">
              Review Details ➔
            </button>
          </div>
        </form>
        ) : (
        <div className="p-6 space-y-5">
          <div className="bg-ink-50 rounded-xl p-5 border border-ink-100 space-y-3">
            <p className="text-xs text-ink-500 font-bold uppercase tracking-wider">Staff Account Summary</p>
            <div className="grid grid-cols-2 gap-y-4">
              <div>
                <p className="text-xs text-ink-400">Username</p>
                <p className="text-sm font-semibold text-ink-800">@{form.username}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Role</p>
                <p className="text-sm font-semibold text-ink-800 capitalize">{form.role}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Full Name</p>
                <p className="text-sm font-semibold text-ink-800">{form.full_name}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">Phone</p>
                <p className="text-sm font-semibold text-ink-800">{form.phone || '—'}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-ink-200">
              <p className="text-xs text-ink-400">Email</p>
              <p className="text-sm font-semibold text-ink-800">{form.email || '—'}</p>
            </div>
            <div className="pt-2 border-t border-ink-200">
              <p className="text-xs text-red-400">Password</p>
              <p className="text-sm font-semibold text-ink-800">******** (Hidden for security)</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('form')} disabled={loading} className="flex-1 py-2.5 border border-ink-200 rounded-xl text-sm font-medium hover:bg-ink-50 transition-colors">
              ← Back to Edit
            </button>
            <button type="button" onClick={processSubmit} disabled={loading} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50">
              {loading ? "Creating..." : "✅ Confirm & Create"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function StaticPinModal({ user, onClose, onSave }) {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pin && (pin.length < 4 || !/^\d+$/.test(pin))) {
      alert('PIN must be 4–8 digits'); return;
    }
    setLoading(true);
    await onSave(user, pin || null);
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="font-display text-base font-bold flex items-center gap-2">
              <Key size={16} className="text-gold"/> Staff Login PIN
            </h3>
            <p className="text-xs text-white/60 mt-0.5">@{user.username}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18}/></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            <p className="font-bold mb-1">📌 Static PIN — admin-set alternative to SMS OTP</p>
            <p>When set, the staff member can enter this PIN at the OTP step instead of waiting for the SMS. Useful when SMS is not configured or unreliable.</p>
            <p className="mt-1 text-amber-600">The PIN is permanent until you change or clear it. Share it securely with the staff member in person.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-600 mb-1.5">PIN (4–8 digits)</label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8}
              placeholder="e.g. 1234  (leave blank to clear)"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="w-full px-4 py-3 border border-ink-200 rounded-xl text-center text-2xl font-mono tracking-[0.3em] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              autoFocus
            />
            <p className="text-[10px] text-ink-400 mt-1 text-center">
              {pin ? `${pin.length} digit${pin.length !== 1 ? 's' : ''}` : 'Blank = clear existing PIN'}
            </p>
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={onClose}
                    className="flex-1 py-2.5 border border-ink-200 rounded-xl text-sm font-medium hover:bg-ink-50">
              Cancel
            </button>
            {pin && (
              <button type="submit" disabled={loading}
                      className="flex-1 py-2.5 bg-gold text-navy-dark rounded-xl text-sm font-bold hover:bg-gold-dark disabled:opacity-50">
                {loading ? '...' : 'Set PIN'}
              </button>
            )}
            <button type="submit" disabled={loading}
                    onClick={() => setPin('')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 ${
                      pin ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-gold text-navy-dark hover:bg-gold-dark'
                    }`}>
              {loading ? '...' : pin ? 'Clear PIN' : 'Save (no PIN)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
