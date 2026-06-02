import { useState, useEffect } from "react";
import { User, Shield, Phone, Mail, Clock, RefreshCw, UserPlus, Ban, CheckCircle, X } from "lucide-react";
import { authAPI } from "../services/api";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";

export default function Users() {
  const { user: currentUser, isAdmin } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

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

  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-6 animate-fade-in">
        <div className="text-center max-w-sm">
          <Shield size={48} className="mx-auto text-red-400 mb-4" />
          <h2 className="text-xl font-bold text-navy">Access Restricted</h2>
          <p className="text-gray-500 mt-2">Only administrators can manage staff accounts. Please contact your manager if you need access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-xl sm:text-2xl font-bold text-navy">Staff Management</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Manage system users and access levels</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button onClick={fetchUsers} className="p-2.5 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => setShowAddModal(true)} className="flex-1 sm:flex-none btn-gold flex items-center justify-center gap-2 text-sm py-2.5 sm:py-2">
            <UserPlus size={16} /> Add Staff
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">User</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Contact</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Last Login</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(6).fill(0).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 bg-gray-100 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">No users found</td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${u.role === 'admin' || u.role === 'super_admin' ? 'bg-gold' : 'bg-navy'}`}>
                          {u.full_name?.[0] || u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{u.full_name || u.username}</p>
                          <p className="text-xs text-gray-400">@{u.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        u.role === 'super_admin'
                          ? 'bg-purple-100 text-purple-700'
                          : u.role === 'admin'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                      }`}>
                        {u.role === 'super_admin' ? 'super admin' : u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        {u.email && <p className="text-xs text-gray-600 flex items-center gap-1.5"><Mail size={10} /> {u.email}</p>}
                        {u.phone && <p className="text-xs text-gray-600 flex items-center gap-1.5"><Phone size={10} /> {u.phone}</p>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-500">
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
    </div>
  );
}

function AddUserModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({ username: "", password: "", full_name: "", role: "staff", email: "", phone: "" });
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);

  const handleReview = (e) => {
    e.preventDefault();
    setStep('preview');
  };

  const processSubmit = async () => {
    setLoading(true);
    try {
      await authAPI.createUser(form);
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
          <h3 className="font-playfair text-lg font-bold">
            {step === 'form' ? 'Add New Staff Member' : 'Review Staff Details'}
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        
        {step === 'form' ? (
        <form onSubmit={handleReview} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Username</label>
              <input
                required
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Password</label>
              <input
                required
                type="password"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Full Name</label>
            <input
              required
              className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Role</label>
            <select
              className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
            >
              <option value="staff">Staff</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
              <input
                type="email"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Phone</label>
              <input
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
            <button type="submit" className="flex-1 py-2.5 bg-navy text-white rounded-xl text-sm font-bold hover:bg-navy/90">
              Review Details ➔
            </button>
          </div>
        </form>
        ) : (
        <div className="p-6 space-y-5">
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-3">
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Staff Account Summary</p>
            <div className="grid grid-cols-2 gap-y-4">
              <div>
                <p className="text-xs text-gray-400">Username</p>
                <p className="text-sm font-semibold text-gray-800">@{form.username}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Role</p>
                <p className="text-sm font-semibold text-gray-800 capitalize">{form.role}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Full Name</p>
                <p className="text-sm font-semibold text-gray-800">{form.full_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="text-sm font-semibold text-gray-800">{form.phone || '—'}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-400">Email</p>
              <p className="text-sm font-semibold text-gray-800">{form.email || '—'}</p>
            </div>
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs text-red-400">Password</p>
              <p className="text-sm font-semibold text-gray-800">******** (Hidden for security)</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('form')} disabled={loading} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
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
