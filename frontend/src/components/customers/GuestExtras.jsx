import React, { useEffect, useState, useRef } from "react";
import { Upload, FileText, Trash2, Plus, X, Download, Tag } from "lucide-react";
import { toast } from "react-toastify";
import { guestDocumentsAPI, guestPreferencesAPI } from "../../services/api";

/**
 * GuestExtras — Documents + Preferences strip for a customer detail panel.
 *
 * Stacks two cards:
 *   1. Preferences — quick-add chips like "ground floor", "extra pillows"
 *   2. Documents — list of uploaded ID proofs / passports with file links
 *
 * Loads its data on mount; lets the parent stay dumb. We don't refresh
 * external state on changes because there's no shared list — the parent
 * cares only about the customer record, not its attachments.
 */
const PREF_CATEGORIES = [
  { value: "room",    label: "Room",    color: "bg-blue-50 text-blue-700 ring-blue-200" },
  { value: "dining",  label: "Dining",  color: "bg-amber-50 text-amber-700 ring-amber-200" },
  { value: "service", label: "Service", color: "bg-purple-50 text-purple-700 ring-purple-200" },
  { value: "general", label: "General", color: "bg-ink-100 text-ink-700 ring-ink-200" },
];

const DOC_TYPES = [
  { value: "id_proof",    label: "ID Proof"   },
  { value: "passport",    label: "Passport"   },
  { value: "visa",        label: "Visa"       },
  { value: "signed_form", label: "Signed Form"},
  { value: "other",       label: "Other"      },
];

export default function GuestExtras({ customerId }) {
  return (
    <div className="space-y-6">
      <PreferencesCard customerId={customerId}/>
      <DocumentsCard customerId={customerId}/>
    </div>
  );
}

function PreferencesCard({ customerId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ preference: "", category: "general" });

  const load = async () => {
    setLoading(true);
    try {
      const res = await guestPreferencesAPI.list(customerId);
      setItems(res.data || []);
    } catch { /* silent — first-time customers have none */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  const add = async () => {
    if (!draft.preference.trim()) return;
    try {
      await guestPreferencesAPI.add({
        customer_id: customerId,
        preference: draft.preference.trim(),
        category: draft.category,
      });
      setDraft({ preference: "", category: "general" });
      setAdding(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save preference");
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Remove this preference?")) return;
    try { await guestPreferencesAPI.remove(id); load(); }
    catch { toast.error("Failed to remove"); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-ivory-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold text-navy flex items-center gap-2">
          <Tag size={18} className="text-gold"/> Preferences
        </h3>
        {!adding && (
          <button onClick={() => setAdding(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-navy/5 text-navy hover:bg-navy/10 font-medium flex items-center gap-1">
            <Plus size={12}/> Add
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-ink-50 rounded-xl p-3 mb-3 space-y-2">
          <div className="flex gap-2">
            <select value={draft.category} onChange={e => setDraft({...draft, category: e.target.value})}
                    className="px-2 py-1.5 border border-ink-200 rounded text-sm bg-white">
              {PREF_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input value={draft.preference}
                   onChange={e => setDraft({...draft, preference: e.target.value})}
                   placeholder="e.g. Ground floor, extra pillows"
                   onKeyDown={e => e.key === "Enter" && add()}
                   autoFocus
                   className="flex-1 px-3 py-1.5 border border-ink-200 rounded text-sm"/>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setDraft({preference: "", category: "general"}); }}
                    className="text-xs px-3 py-1 text-ink-500 hover:bg-ink-100 rounded">Cancel</button>
            <button onClick={add} className="text-xs px-3 py-1 bg-navy text-white rounded font-medium">Save</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-400">Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-ink-400 text-sm">No preferences recorded yet. Add one to remember what this guest likes.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(p => {
            const meta = PREF_CATEGORIES.find(c => c.value === p.category) || PREF_CATEGORIES[3];
            return (
              <span key={p.preference_id}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${meta.color} group`}>
                <span className="text-2xs uppercase tracking-eyebrow opacity-60 font-bold">{meta.label}</span>
                <span>{p.preference}</span>
                <button onClick={() => remove(p.preference_id)}
                        className="opacity-40 group-hover:opacity-100 hover:text-red-600 transition-opacity">
                  <X size={12}/>
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DocumentsCard({ customerId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState("id_proof");
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try { const res = await guestDocumentsAPI.list(customerId); setItems(res.data || []); }
    catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [customerId]);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("File exceeds 5 MB limit"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("customer_id", customerId);
      fd.append("doc_type", docType);
      fd.append("file", file);
      await guestDocumentsAPI.upload(fd);
      toast.success("Document uploaded");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (doc) => {
    try {
      const res = await guestDocumentsAPI.download(doc.document_id);
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.mime_type }));
      const a = document.createElement("a");
      a.href = url; a.download = doc.file_name; a.click();
      window.URL.revokeObjectURL(url);
    } catch { toast.error("Download failed"); }
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return;
    try { await guestDocumentsAPI.delete(doc.document_id); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed"); }
  };

  const fmtSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-ivory-100 p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="font-display text-lg font-semibold text-navy flex items-center gap-2">
          <FileText size={18} className="text-gold"/> Documents
        </h3>
        <div className="flex items-center gap-2">
          <select value={docType} onChange={e => setDocType(e.target.value)}
                  className="text-xs px-2 py-1.5 border border-ink-200 rounded bg-white">
            {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                 onChange={e => upload(e.target.files?.[0])}
                 className="hidden" id="guest-doc-upload"/>
          <label htmlFor="guest-doc-upload"
                 className="text-xs px-3 py-1.5 rounded-lg bg-navy/5 text-navy hover:bg-navy/10 font-medium flex items-center gap-1 cursor-pointer">
            <Upload size={12}/> {uploading ? "Uploading…" : "Upload"}
          </label>
        </div>
      </div>
      <p className="text-2xs text-ink-400 mb-3">JPG / PNG / WEBP / PDF · max 5 MB</p>

      {loading ? (
        <div className="text-sm text-ink-400">Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-ink-400 text-sm">No documents uploaded yet. Add an ID proof or passport scan for compliance.</p>
      ) : (
        <div className="space-y-2">
          {items.map(d => (
            <div key={d.document_id} className="flex items-center justify-between p-3 bg-ink-50 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white border border-ink-200 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-ink-500"/>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-navy truncate">{d.file_name}</div>
                  <div className="text-2xs uppercase tracking-eyebrow text-ink-500 font-semibold">
                    {DOC_TYPES.find(t => t.value === d.doc_type)?.label || d.doc_type} · {fmtSize(d.file_size_bytes)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => download(d)} className="p-1.5 text-ink-500 hover:text-navy hover:bg-white rounded"
                        title="Download">
                  <Download size={14}/>
                </button>
                <button onClick={() => remove(d)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-white rounded"
                        title="Delete">
                  <Trash2 size={14}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
