import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, Star, Ban, Phone, MapPin, Calendar, ChevronRight, X, Shield, AlertTriangle, Eye, RefreshCw, Edit2, LogOut, Upload } from "lucide-react";
import { api, customersAPI } from "../services/api";
import { toast } from "react-toastify";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatDate } from "../utils/datetime";

import AddCustomerModal from "../components/customers/AddCustomerModal";
import GuestSearchInput from "../components/GuestSearchInput";
import GuestExtras from "../components/customers/GuestExtras";

export default function Customers() {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('search') || "";
  });
  const [filter, setFilter] = useState("all"); // all, staying, vip, blacklisted
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [checkoutTarget, setCheckoutTarget] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutData, setCheckoutData] = useState({
    additional_charges: 0,
    discount: 0,
    payment_mode: "cash",
    deposit_refunded: 0
  });
  const pageSize = 20;
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: pageSize, search });
      if (filter === "vip") params.set("is_vip", "true");
      if (filter === "blacklisted") params.set("blacklisted", "true");
      if (filter === "staying") params.set("staying", "true");
      const data = await api.get(`/customers?${params}`);
      setCustomers(data.data || []);
      setTotal(data.total || 0);
    } catch {
      toast.error("Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, [page, search, filter]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Refetch when the AI agent creates/edits a customer or flips a VIP flag.
  useEffect(() => {
    const onAgentChange = () => fetchCustomers();
    window.addEventListener('lms:agent:data_changed', onAgentChange);
    return () => window.removeEventListener('lms:agent:data_changed', onAgentChange);
  }, [fetchCustomers]);

  const fetchHistory = async (customerId) => {
    setHistoryLoading(true);
    try {
      const data = await api.get(`/customers/${customerId}/history`);
      setHistory(data);
    } catch {
      toast.error("Failed to load stay history");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSelect = (customer) => {
    setSelected(customer);
    fetchHistory(customer.customer_id);
  };

  const handleToggleVIP = async () => {
    if (!isAdmin) return;
    setActionLoading(true);
    try {
      const updated = await api.patch(`/customers/${selected.customer_id}/vip`, { is_vip: !selected.is_vip });
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.customer_id === updated.customer_id ? updated : c));
      toast.success(`${updated.first_name} ${updated.is_vip ? "marked as VIP ⭐" : "removed from VIP"}`);
    } catch {
      toast.error("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleBlacklist = async (reason = "") => {
    if (!isAdmin) return;
    setActionLoading(true);
    try {
      const updated = await api.patch(`/customers/${selected.customer_id}/blacklist`, {
        is_blacklisted: !selected.blacklisted,
        blacklist_reason: reason,
      });
      setSelected(updated);
      setCustomers(prev => prev.map(c => c.customer_id === updated.customer_id ? updated : c));
      toast.success(`${updated.first_name} ${updated.blacklisted ? "blacklisted 🚫" : "removed from blacklist"}`);
    } catch {
      toast.error("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col lg:flex-row h-full gap-4 animate-fade-in" style={{ height: "calc(100vh - 80px)" }}>
      {/* Left Panel */}
      <div className={`${selected && !isDesktop ? 'hidden' : 'flex'} w-full lg:w-96 flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex-shrink-0`}>
        {/* Search & Filter */}
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-playfair font-bold text-navy">Guests</h3>
            <button 
              onClick={() => setShowAdd(true)}
              className="bg-gold text-navy text-[10px] font-bold px-2 py-1 rounded-lg hover:bg-gold/90 transition-colors flex items-center gap-1"
            >
              + NEW CUSTOMER
            </button>
          </div>
          <GuestSearchInput
            value={search}
            onChange={v => { setSearch(v); setPage(1); }}
            onSelect={(customer) => { setSearch(customer.phone); setPage(1); }}
            placeholder="Search by name, phone, city..."
          />
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {[["all", "All"], ["staying", "Staying"], ["vip", "VIP"], ["blacklisted", "Blacklisted"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => { setFilter(val); setPage(1); }}
                className={`flex-1 py-1.5 px-3 whitespace-nowrap text-xs font-medium rounded-lg transition-colors ${
                  filter === val ? "bg-navy text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{total} customers found</span>
            <button onClick={fetchCustomers} className="flex items-center gap-1 hover:text-navy">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>


        {/* Customer List */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {loading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="p-4 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-200 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                    <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))
          ) : customers.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <User size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No customers found</p>
            </div>
          ) : (
            customers.map(c => (
              <button
                key={c.customer_id}
                onClick={() => handleSelect(c)}
                className={`w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                  selected?.customer_id === c.customer_id ? "bg-blue-50 border-l-2 border-l-navy" : ""
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${
                  c.blacklisted ? "bg-red-500" : c.is_vip ? "bg-gold" : "bg-navy"
                }`}>
                  {c.first_name?.[0]}{c.last_name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.first_name} {c.last_name}</p>
                    {c.current_stay && <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0 animate-pulse" title="Currently Staying" />}
                    {c.is_vip && <Star size={12} className="text-gold fill-gold flex-shrink-0" />}
                    {c.blacklisted && <Ban size={12} className="text-red-500 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-gray-500">{c.phone}</p>
                  <p className="text-xs text-gray-400">{c.total_visits || 0} stays · {c.city || "—"}</p>
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </button>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-gray-100 flex items-center justify-between">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Prev
            </button>
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Right Panel — Customer Detail */}
      <div className={`${!selected && !isDesktop ? 'hidden' : ''} flex-1 overflow-y-auto`}>
        {!selected ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Eye size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">Select a customer to view profile</p>
              <p className="text-sm mt-1">Search by name or phone number on the left</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mobile back button */}
            {!isDesktop && (
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-2 text-sm text-navy font-medium hover:text-gold transition-colors mb-2"
              >
                ← Back to list
              </button>
            )}
            {/* Profile Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-navy to-navy/80 p-6 text-white">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white ${
                      selected.blacklisted ? "bg-red-500" : selected.is_vip ? "bg-gold" : "bg-white/20"
                    }`}>
                      {selected.first_name?.[0]}{selected.last_name?.[0]}
                    </div>
                    <div>
                      <h2 className="font-playfair text-2xl font-bold">
                        {selected.first_name} {selected.last_name}
                      </h2>
                      <div className="flex items-center gap-2 mt-1">
                        {selected.is_vip && (
                          <span className="flex items-center gap-1 bg-gold text-navy text-xs font-bold px-2 py-0.5 rounded-full">
                            <Star size={10} className="fill-navy" /> VIP Guest
                          </span>
                        )}
                        {selected.blacklisted && (
                          <span className="flex items-center gap-1 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                            <Ban size={10} /> Blacklisted
                          </span>
                        )}
                        {!selected.is_vip && !selected.is_blacklisted && (
                          <span className="text-white/60 text-xs">Regular Guest</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-playfair text-white font-bold">{selected.total_visits || 0}</p>
                    <p className="text-xs text-white/60">Total Stays</p>
                  </div>
                </div>
              </div>

              {/* Live Stay Card — Appears only if guest is currently in-house.
                  R3: a guest may now hold multiple rooms simultaneously, so we
                  iterate over current_stays. We fall back to current_stay
                  (singular) for old API consumers. */}
              {(() => {
                const stays = selected.current_stays && selected.current_stays.length > 0
                  ? selected.current_stays
                  : (selected.current_stay ? [selected.current_stay] : []);
                if (stays.length === 0) return null;
                return (
                  <div className="mx-6 mt-4 space-y-2">
                    <p className="text-xs font-bold text-green-700 uppercase tracking-wider">
                      Currently Occupying ({stays.length} room{stays.length !== 1 ? 's' : ''})
                    </p>
                    {stays.map((stay) => (
                      <div
                        key={stay.checkin_id}
                        className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-500"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-12 h-12 bg-green-600 rounded-xl flex flex-col items-center justify-center text-white shadow-lg shadow-green-100 flex-shrink-0">
                            <span className="text-[9px] font-bold uppercase opacity-80">Room</span>
                            <span className="text-base font-bold">{stay.room_number}</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-green-800 font-semibold truncate">
                              Since {formatDateTime(stay.checkin_datetime)}
                            </p>
                            {stay.expected_checkout && (
                              <p className="text-[11px] text-green-700">
                                Expected out: {formatDateTime(stay.expected_checkout)}
                              </p>
                            )}
                            {stay.tariff_per_night && (
                              <p className="text-[11px] text-gray-600">
                                ₹{Number(stay.tariff_per_night).toLocaleString('en-IN')}/night
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setCheckoutTarget({ ...stay, customer: selected })}
                          className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all shadow shadow-red-100 flex items-center gap-1.5 text-sm flex-shrink-0"
                        >
                          <LogOut size={14} /> Checkout
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="p-4 sm:p-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <DetailItem icon={<Phone size={14} />} label="Phone" value={selected.phone} />
                <DetailItem icon={<User size={14} />} label="ID Type" value={selected.id_type || "—"} />
                <DetailItem icon={<Shield size={14} />} label="ID Number" value={selected.id_number || "—"} />
                <DetailItem icon={<MapPin size={14} />} label="City" value={selected.city || "—"} />
                <DetailItem icon={<MapPin size={14} />} label="State" value={selected.state || "—"} />
                <DetailItem icon={<Calendar size={14} />} label="First Visit" value={selected.created_at ? formatDate(selected.created_at) : "—"} />
              </div>

              {/* ID image preview / viewer — admin needs to verify the image
                  on file matches the typed ID number. */}
              {selected.id_proof_path && (
                <div className="mx-4 sm:mx-6 mb-4 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-700">
                      <Shield size={14} className="text-green-600" />
                      <span className="font-semibold">ID image on file</span>
                      <span className="text-gray-400 truncate max-w-[200px]">
                        {selected.id_proof_path.split('/').pop()}
                      </span>
                    </div>
                    <a
                      href={`/uploads/${selected.id_proof_path}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-navy hover:underline inline-flex items-center gap-1"
                    >
                      <Eye size={12} /> View
                    </a>
                  </div>
                </div>
              )}

              {selected.blacklisted && selected.blacklist_reason && (
                <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-700">Blacklist Reason</p>
                    <p className="text-xs text-red-600">{selected.blacklist_reason}</p>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="px-6 pb-6 flex gap-3 flex-wrap">
                {/* Check In — available to ALL roles (reception staff need this) */}
                {!selected.current_stay && !selected.blacklisted && (
                  <button
                    onClick={() => {
                      // Navigate to /checkins with ?customer=ID — Checkins.jsx
                      // will load the guest and open the CheckinModal pre-filled.
                      navigate(`/checkins?customer=${selected.customer_id}`)
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-navy text-white rounded-xl text-sm font-bold hover:bg-navy/90 transition-colors"
                  >
                    <LogOut size={14} className="rotate-180" /> Check In
                  </button>
                )}
                {selected.current_stay && (
                  <span className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-xl text-sm font-medium">
                    ✓ Currently checked in
                  </span>
                )}
                {/* Edit — available to all roles too */}
                <button
                  onClick={() => setShowEdit(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-navy border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  <Edit2 size={14} /> Edit Guest
                </button>
                {/* VIP / Blacklist — admin-only */}
                {isAdmin && (
                  <>
                    <button
                      onClick={handleToggleVIP}
                      disabled={actionLoading || selected.blacklisted}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                        selected.is_vip
                          ? "bg-gold/20 text-gold hover:bg-gold/30"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Star size={14} className={selected.is_vip ? "fill-gold text-gold" : ""} />
                      {selected.is_vip ? "Remove VIP" : "Mark as VIP"}
                    </button>
                    <BlacklistButton
                      customer={selected}
                      onToggle={handleToggleBlacklist}
                      loading={actionLoading}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Documents + Preferences (v2.5) */}
            <GuestExtras customerId={selected.customer_id}/>

            {/* Stay History */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-playfair text-lg font-semibold text-navy mb-4">Stay History</h3>
              {historyLoading ? (
                <div className="space-y-3">
                  {Array(3).fill(0).map((_, i) => (
                    <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No stay history found</p>
              ) : (
                <div className="space-y-3">
                  {history.map(stay => (
                    <div key={stay.checkin_id} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-lg font-bold text-navy">{stay.room_number}</p>
                          <p className="text-xs text-gray-500">Room</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">
                            {formatDateTime(stay.checkin_datetime)} →{" "}
                            {stay.actual_checkout
                              ? formatDateTime(stay.actual_checkout)
                              : (stay.expected_checkout
                                  ? `${formatDateTime(stay.expected_checkout)} (expected)`
                                  : "Ongoing")}
                          </p>
                          <p className="text-xs text-gray-500">{stay.nights} night(s) · ₹{stay.tariff_per_night}/night</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-600">
                          {stay.total_amount ? `₹${stay.total_amount.toLocaleString("en-IN")}` : "—"}
                        </p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          stay.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {stay.status === "active" ? "Staying" : "Checked Out"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showEdit && selected && (
        <EditCustomerModal
          customer={selected}
          onClose={() => setShowEdit(false)}
          onSuccess={(updated) => {
            setSelected(updated);
            setCustomers(prev => prev.map(c => c.customer_id === updated.customer_id ? updated : c));
            setShowEdit(false);
          }}
        />
      )}

      {/* Checkout Modal */}
      {checkoutTarget && (
        <CheckoutModal
          target={checkoutTarget}
          data={checkoutData}
          setData={setCheckoutData}
          loading={checkingOut}
          onClose={() => setCheckoutTarget(null)}
          onConfirm={async () => {
            setCheckingOut(true);
            try {
              await api.put(`/checkins/${checkoutTarget.checkin_id}/checkout`, checkoutData);
              toast.success("Checkout successful!");
              setCheckoutTarget(null);
              fetchCustomers(); // Refresh list to update stay status
              if (selected) handleSelect(selected); // Refresh detail
            } catch (err) {
              toast.error(err.message || "Checkout failed");
            } finally {
              setCheckingOut(false);
            }
          }}
        />
      )}

      {showAdd && (
        <AddCustomerModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            setShowAdd(false);
            fetchCustomers();
          }}
        />
      )}
    </div>
  );
}

function DetailItem({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gold mt-0.5">{icon}</span>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-800">{value}</p>
      </div>
    </div>
  );
}

function BlacklistButton({ customer, onToggle, loading }) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");

  if (customer.blacklisted) {
    return (
      <button
        onClick={() => onToggle("")}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
      >
        <Ban size={14} />
        Remove Blacklist
      </button>
    );
  }

  if (showReason) {
    return (
      <div className="flex items-center gap-2 flex-1">
        <input
          autoFocus
          type="text"
          placeholder="Enter reason for blacklisting..."
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="flex-1 text-sm px-3 py-2 border border-red-300 rounded-xl focus:outline-none focus:border-red-500"
        />
        <button
          onClick={() => { onToggle(reason); setShowReason(false); setReason(""); }}
          disabled={loading}
          className="px-3 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          onClick={() => setShowReason(false)}
          className="px-3 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm hover:bg-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowReason(true)}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
    >
      <Ban size={14} />
      Blacklist
    </button>
  );
}

function EditCustomerModal({ customer, onClose, onSuccess }) {
  // R6: lock removed — all fields editable for any customer regardless of
  // stay history. Reception staff need to be able to fix typos in names,
  // update phone numbers, correct ID details, and re-upload ID images.
  const [form, setForm] = useState({
    first_name: customer.first_name || "",
    last_name: customer.last_name || "",
    phone: customer.phone || "",
    email: customer.email || "",
    nationality: customer.nationality || "Indian",
    gender: customer.gender || "",
    address: customer.address || "",
    id_type: customer.id_type || "aadhar",
    id_number: customer.id_number || "",
  });
  const [step, setStep] = useState('form');
  const [loading, setLoading] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [idFile, setIdFile] = useState(null);

  // Track what changed vs. the original record (for "discard?" prompt and
  // for sending only the changed fields on PUT).
  const dirty = (
    form.first_name !== (customer.first_name || "") ||
    form.last_name !== (customer.last_name || "") ||
    form.phone !== (customer.phone || "") ||
    form.email !== (customer.email || "") ||
    form.nationality !== (customer.nationality || "Indian") ||
    form.gender !== (customer.gender || "") ||
    form.address !== (customer.address || "") ||
    form.id_type !== (customer.id_type || "aadhar") ||
    form.id_number !== (customer.id_number || "") ||
    !!idFile
  );

  const attemptClose = () => {
    if (loading) return;
    if (dirty || step === 'preview') setShowCloseConfirm(true);
    else onClose();
  };

  // ESC closes (with confirm if dirty)
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); attemptClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, loading, step]);

  const validateForm = () => {
    if (!form.first_name || form.first_name.length < 2) {
      toast.error("First name must be at least 2 characters"); return false;
    }
    if (!form.last_name || form.last_name.length < 2) {
      toast.error("Last name must be at least 2 characters"); return false;
    }
    if (!/^\d{10}$/.test(form.phone)) {
      toast.error("Phone must be 10 digits"); return false;
    }
    if (!form.id_number) {
      toast.error("ID number is required"); return false;
    }
    return true;
  };

  const handleReview = (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setStep('preview');
  };

  const processSubmit = async () => {
    setLoading(true);
    try {
      // Send all editable fields (R6: no field-locking).
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        email: form.email || null,
        address: form.address || null,
        nationality: form.nationality || "Indian",
        gender: form.gender === "" ? null : form.gender,
        id_type: form.id_type,
        id_number: form.id_number,
      };
      await customersAPI.update(customer.customer_id, payload);

      // Then upload the new ID file if one was picked.
      if (idFile) {
        const fd = new FormData();
        fd.append("file", idFile);
        await api.postForm(`/customers/${customer.customer_id}/id-proof`, fd);
      }

      toast.success("Guest details updated");
      onSuccess({ ...customer, ...payload });
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Update failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
      onClick={(e) => e.target === e.currentTarget && attemptClose()}
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="bg-navy text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <h3 className="font-playfair text-lg font-bold">
            {step === 'form' ? 'Edit Guest Details' : 'Review Changes'}
          </h3>
          <button type="button" onClick={attemptClose} aria-label="Close" title="Close (Esc)"
            className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-1.5 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
        {step === 'form' ? (
        <form onSubmit={handleReview} className="p-6 space-y-4">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">First Name</label>
              <input type="text" required
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.first_name}
                onChange={e => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Last Name</label>
              <input type="text" required
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.last_name}
                onChange={e => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          {/* Phone + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Phone</label>
              <input type="tel" required maxLength={10}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
              <input type="email"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          {/* ID Type + Number */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">ID Type</label>
              <select
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.id_type}
                onChange={e => setForm({ ...form, id_type: e.target.value })}>
                <option value="aadhar">Aadhar Card</option>
                <option value="driving_license">Driving License</option>
                <option value="voter_id">Voter ID</option>
                <option value="passport">Passport</option>
                <option value="pan">PAN Card</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">ID Number</label>
              <input type="text"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm uppercase focus:outline-none focus:border-gold"
                value={form.id_number}
                onChange={e => setForm({ ...form, id_number: e.target.value.toUpperCase() })} />
            </div>
          </div>
          {/* ID Proof file upload */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">
              Replace ID Proof <span className="text-gray-400 font-normal">(JPG/PNG/PDF, max 5MB)</span>
            </label>
            <label className="mt-1 flex items-center gap-3 border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-navy transition-colors">
              <Upload size={16} className="text-gray-400" />
              <span className="text-sm text-gray-500 truncate">
                {idFile ? idFile.name : (customer.id_proof_path ? 'Replace existing ID image' : 'Upload ID image')}
              </span>
              <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.pdf"
                onChange={e => setIdFile(e.target.files[0])} />
            </label>
            {customer.id_proof_path && !idFile && (
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-green-600">✓ ID image already on file</p>
                <a href={`/uploads/${customer.id_proof_path}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] font-bold text-navy hover:underline">View existing →</a>
              </div>
            )}
          </div>
          {/* Nationality + Gender */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Nationality</label>
              <input type="text"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.nationality}
                onChange={e => setForm({ ...form, nationality: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase">Gender</label>
              <select
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold"
                value={form.gender}
                onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
          {/* Address */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Address</label>
            <textarea rows={2}
              className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gold resize-none"
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={attemptClose}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!dirty}
              className="flex-1 py-2.5 bg-navy text-white rounded-xl text-sm font-bold hover:bg-navy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              Review Changes ➔
            </button>
          </div>
          <p className="text-[10px] text-gray-400 text-center -mt-1">
            Tip: Press <kbd className="px-1 py-0.5 bg-gray-100 border rounded">Esc</kbd> or click outside to close.
          </p>
        </form>
        ) : (
        <div className="p-6 space-y-5">
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-3">
            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Changes to Save</p>
            <div className="grid grid-cols-2 gap-y-4">
              <div>
                <p className="text-xs text-gray-400">Name</p>
                <p className="text-sm font-semibold text-gray-800">{form.first_name} {form.last_name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Phone</p>
                <p className="text-sm font-semibold text-gray-800">{form.phone}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm font-semibold text-gray-800">{form.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">ID</p>
                <p className="text-sm font-semibold text-gray-800">{form.id_type.toUpperCase()} {form.id_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Nationality</p>
                <p className="text-sm font-semibold text-gray-800">{form.nationality}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Gender</p>
                <p className="text-sm font-semibold text-gray-800">{form.gender || 'Not specified'}</p>
              </div>
            </div>
            {form.address && (
              <div className="pt-2 border-t border-gray-200">
                <p className="text-xs text-gray-400">Address</p>
                <p className="text-sm font-semibold text-gray-800">{form.address}</p>
              </div>
            )}
            {idFile && (
              <p className="text-[11px] text-blue-700 bg-blue-50 px-2 py-1.5 rounded border-t border-gray-200">
                📎 New ID image will be uploaded: <strong>{idFile.name}</strong>
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('form')} disabled={loading}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              ← Back to Edit
            </button>
            <button type="button" onClick={processSubmit} disabled={loading}
              className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors disabled:opacity-50">
              {loading ? "Saving…" : "✅ Confirm & Save"}
            </button>
          </div>
        </div>
        )}
        </div>
      </div>

      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setShowCloseConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-playfair text-lg font-bold text-navy">Discard changes?</h3>
            <p className="text-sm text-gray-600 mt-2">Your edits to this guest profile will be lost. Close anyway?</p>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowCloseConfirm(false)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">
                Keep Editing
              </button>
              <button type="button" onClick={() => { setShowCloseConfirm(false); onClose(); }}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700">
                Discard &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function CheckoutModal({ target, data, setData, loading, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogOut size={28} className="text-red-600" />
          </div>
          <h3 className="font-playfair text-xl font-bold text-gray-900">Confirm Checkout</h3>
          <p className="text-sm text-gray-500 mt-2">
            Checkout <strong>{target.customer?.first_name}</strong> from Room <strong>{target.room_number}</strong>?
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Addl. Charges (₹)</label>
              <input
                type="number"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:border-red-500 outline-none"
                value={data.additional_charges}
                onChange={e => setData({ ...data, additional_charges: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Discount (₹)</label>
              <input
                type="number"
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:border-red-500 outline-none"
                value={data.discount}
                onChange={e => setData({ ...data, discount: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Payment Method</label>
            <select
              className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:border-red-500 outline-none"
              value={data.payment_mode}
              onChange={e => setData({ ...data, payment_mode: e.target.value })}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI / PhonePe</option>
              <option value="online">Online Transfer</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 font-bold hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all disabled:opacity-50 shadow-lg shadow-red-100"
          >
            {loading ? "Processing..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
