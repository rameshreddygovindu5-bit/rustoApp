import React, { useState, useEffect } from "react";
import {
  Package, Plus, Trash2, Edit2, Save, X, Loader2,
  Coffee, Car, Map, Activity, Utensils, Star
} from "lucide-react";
import { toast } from "react-toastify";
import { rustoListingAPI } from "../services/api";

const BUNDLE_TYPES = [
  { value: "meal",      label: "Meal Package",  icon: Utensils,  color: "text-orange-600", bg: "bg-orange-50" },
  { value: "transport", label: "Transport",     icon: Car,       color: "text-blue-600",   bg: "bg-blue-50" },
  { value: "guide",     label: "Local Guide",   icon: Map,       color: "text-emerald-600",bg: "bg-emerald-50" },
  { value: "activity",  label: "Activity",      icon: Activity,  color: "text-purple-600", bg: "bg-purple-50" },
  { value: "amenity",   label: "Amenity",       icon: Coffee,    color: "text-amber-600",  bg: "bg-amber-50" },
  { value: "other",     label: "Other",         icon: Star,      color: "text-ink-600",    bg: "bg-ink-50" },
];

function typeInfo(t) {
  return BUNDLE_TYPES.find(x => x.value === t) || BUNDLE_TYPES[BUNDLE_TYPES.length - 1];
}

const EMPTY_FORM = { title: "", description: "", price: "", bundle_type: "meal", is_active: true };

export default function LocalBundlesAdmin() {
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);   // null = new, number = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await rustoListingAPI.getBundles();
      setBundles(r.data.bundles || []);
    } catch {
      toast.error("Failed to load bundles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (b) => {
    setEditId(b.bundle_id);
    setForm({ title: b.title, description: b.description || "", price: b.price, bundle_type: b.bundle_type, is_active: b.is_active });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(EMPTY_FORM);
  };

  const save = async () => {
    if (!form.title.trim()) return toast.error("Title required");
    if (form.price === "" || isNaN(parseFloat(form.price))) return toast.error("Valid price required");
    setSaving(true);
    try {
      const body = { ...form, price: parseFloat(form.price) };
      if (editId !== null) {
        await rustoListingAPI.updateBundle(editId, body);
        toast.success("Bundle updated");
      } else {
        await rustoListingAPI.createBundle(body);
        toast.success("Bundle created");
      }
      await load();
      closeForm();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this bundle?")) return;
    try {
      await rustoListingAPI.deleteBundle(id);
      toast.success("Bundle deleted");
      await load();
    } catch {
      toast.error("Delete failed");
    }
  };

  if (loading) return (
    <div className="text-center py-12">
      <Loader2 size={24} className="mx-auto animate-spin text-gold"/>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Package size={22} className="text-gold"/> Local Experiences
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            Create add-on packages customers can book alongside their stay.
          </p>
        </div>
        <button onClick={openNew} className="btn-gold flex items-center gap-1.5">
          <Plus size={15}/> Add Bundle
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card border-2 border-gold/30 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-navy">
              {editId !== null ? "Edit Bundle" : "New Bundle"}
            </h2>
            <button onClick={closeForm} className="p-1 rounded hover:bg-ink-100 text-ink-400">
              <X size={16}/>
            </button>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="label">Title <span className="text-red-500">*</span></span>
              <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))}
                     placeholder="Village Dinner Package" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Description</span>
              <textarea value={form.description}
                        onChange={e => setForm(f => ({...f, description: e.target.value}))}
                        rows={2} placeholder="Authentic home-cooked dinner for two…"
                        className="input-field resize-none"/>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Price (₹) <span className="text-red-500">*</span></span>
                <input value={form.price} type="number" min="0"
                       onChange={e => setForm(f => ({...f, price: e.target.value}))}
                       placeholder="250" className="input-field"/>
              </label>
              <label className="block">
                <span className="label">Type</span>
                <select value={form.bundle_type}
                        onChange={e => setForm(f => ({...f, bundle_type: e.target.value}))}
                        className="input-field">
                  {BUNDLE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={form.is_active}
                     onChange={e => setForm(f => ({...f, is_active: e.target.checked}))}
                     className="w-4 h-4 accent-gold"/>
              <span className="text-sm text-ink-700">Active (visible to customers)</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={closeForm} className="btn-outline text-sm">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-gold flex items-center gap-1.5 text-sm">
              {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
              {editId !== null ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {bundles.length === 0 && !showForm ? (
        <div className="card text-center py-12">
          <Package size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="font-medium text-ink-600 mb-1">No bundles yet</p>
          <p className="text-sm text-ink-400 mb-4">
            Add meal packages, local tours, or transport add-ons to increase revenue.
          </p>
          <button onClick={openNew} className="btn-gold">
            <Plus size={14} className="inline mr-1.5"/>Add your first bundle
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bundles.map(b => {
            const ti = typeInfo(b.bundle_type);
            const Icon = ti.icon;
            return (
              <div key={b.bundle_id}
                   className={`card flex flex-col gap-2 transition-all
                     ${!b.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg ${ti.bg} flex items-center justify-center shrink-0`}>
                      <Icon size={16} className={ti.color}/>
                    </div>
                    <div>
                      <p className="font-semibold text-navy text-sm">{b.title}</p>
                      <p className="text-2xs text-ink-500">{ti.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-navy text-sm">₹{b.price}</span>
                    {!b.is_active && (
                      <span className="text-2xs px-1.5 py-0.5 bg-ink-100 text-ink-500 rounded font-medium">draft</span>
                    )}
                  </div>
                </div>
                {b.description && (
                  <p className="text-xs text-ink-500 leading-relaxed line-clamp-2">{b.description}</p>
                )}
                <div className="flex items-center gap-2 mt-auto pt-1 border-t border-ink-100">
                  <button onClick={() => openEdit(b)}
                          className="flex items-center gap-1 text-xs text-navy hover:text-gold font-medium">
                    <Edit2 size={12}/> Edit
                  </button>
                  <button onClick={() => remove(b.bundle_id)}
                          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium ml-auto">
                    <Trash2 size={12}/> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
