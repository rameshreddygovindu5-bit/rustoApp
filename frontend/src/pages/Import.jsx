import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle, Download, RefreshCw, ChevronRight } from "lucide-react";
import { api } from "../services/api";
import { toast } from "react-toastify";

const STEPS = ["Upload File", "Map Columns", "Preview & Import"];

// Customer fields recognized by /api/import/process. Keep in sync with
// COLUMN_ALIASES in backend/app/routers/import_excel.py — adding a row
// here without a matching alias means the column won't be picked up even
// if the user maps it.
const REQUIRED_FIELDS = [
  { key: "first_name",    label: "First Name",     required: true },
  { key: "last_name",     label: "Last Name",      required: true },
  { key: "phone",         label: "Phone (10-digit Indian mobile)", required: true },
  { key: "email",         label: "Email",          required: false },
  { key: "address",       label: "Address",        required: false },
  { key: "city",          label: "City",           required: false },
  { key: "state",         label: "State",          required: false },
  { key: "id_type",       label: "ID Type",        required: false },
  { key: "id_number",     label: "ID Number",      required: false },
  { key: "date_of_birth", label: "Date of Birth",  required: false },
  { key: "gender",        label: "Gender",         required: false },
  { key: "nationality",   label: "Nationality",    required: false },
];

export default function Import() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [columns, setColumns] = useState([]);
  const [preview, setPreview] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const handleFileDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, []);

  const handleFileSelect = async (f) => {
    const allowed = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel", "text/csv"];
    if (!allowed.includes(f.type) && !f.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error("Only Excel (.xlsx, .xls) and CSV files are supported");
      return;
    }
    setFile(f);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", f);
      const data = await api.postForm("/import/preview", formData);
      setColumns(data.headers);
      setPreview(data.preview_rows.map(row => {
        const obj = {};
        data.headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
      }));
      // Auto-map using backend suggestions if available
      const autoMap = {};
      if (data.suggested_mapping) {
        Object.entries(data.suggested_mapping).forEach(([field, colIdx]) => {
          autoMap[field] = data.headers[colIdx];
        });
      }
      setMapping(autoMap);
      setStep(1);
    } catch {
      toast.error("Failed to parse file");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    const missing = REQUIRED_FIELDS.filter(f => f.required && !mapping[f.key]);
    if (missing.length > 0) {
      toast.error(`Please map required fields: ${missing.map(f => f.label).join(", ")}`);
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Map labels back to indexes for the backend if needed, or just send the labels
      // Backend expects a JSON string mapping field_name to column_index
      const indexMapping = {};
      Object.entries(mapping).forEach(([field, colLabel]) => {
        indexMapping[field] = columns.indexOf(colLabel);
      });
      formData.append("mapping", JSON.stringify(indexMapping));
      const result = await api.postForm("/import/process", formData);
      setImportResult({
        total: result.total_processed,
        success: result.imported,
        skipped: result.duplicates_skipped,
        errors: result.error_details || []
      });
      setStep(2);
      toast.success(`Imported ${result.imported} records successfully!`);
    } catch (err) {
      toast.error(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep(0); setFile(null); setColumns([]); setPreview([]);
    setMapping({}); setImportResult(null);
  };

  const downloadTemplate = async () => {
    try {
      const blob = await api.getBlob("/import/template");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rusto-import-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download template");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-playfair text-2xl font-bold text-navy">Import Customers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bulk import guest records from Excel or CSV. Duplicates are detected by phone number.</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Download size={14} /> Download Template
        </button>
      </div>

      {/* Stepper */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 ${i <= step ? "text-navy" : "text-gray-400"}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  i < step ? "bg-navy border-navy text-white" :
                  i === step ? "border-navy text-navy" :
                  "border-gray-200 text-gray-400"
                }`}>
                  {i < step ? <CheckCircle size={14} /> : i + 1}
                </div>
                <span className="text-sm font-medium hidden sm:block">{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-3 ${i < step ? "bg-navy" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => fileRef.current.click()}
          className={`bg-white rounded-2xl shadow-sm border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
            dragOver ? "border-gold bg-amber-50" : "border-gray-200 hover:border-gold hover:bg-gray-50"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => e.target.files[0] && handleFileSelect(e.target.files[0])}
          />
          {loading ? (
            <div>
              <div className="animate-spin w-12 h-12 border-4 border-gold border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-gray-500">Parsing file...</p>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 bg-navy/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileSpreadsheet size={28} className="text-navy" />
              </div>
              <p className="text-lg font-semibold text-gray-800">Drop your file here</p>
              <p className="text-sm text-gray-500 mt-1">or click to browse</p>
              <p className="text-xs text-gray-400 mt-3">Supports .xlsx, .xls, .csv files</p>
            </>
          )}
        </div>
      )}

      {/* Step 1: Column Mapping */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-700">
              File: <strong>{file?.name}</strong> · {columns.length} columns detected. Map them to the required fields below.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div className="grid grid-cols-3 gap-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <span>System Field</span>
                <span>Required</span>
                <span>Your Column</span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {REQUIRED_FIELDS.map(field => (
                <div key={field.key} className="px-6 py-3 grid grid-cols-3 gap-4 items-center">
                  <span className="text-sm font-medium text-gray-800">{field.label}</span>
                  <span className={`text-xs font-medium ${field.required ? "text-red-600" : "text-gray-400"}`}>
                    {field.required ? "Required" : "Optional"}
                  </span>
                  <select
                    value={mapping[field.key] || ""}
                    onChange={e => setMapping(m => ({ ...m, [field.key]: e.target.value || undefined }))}
                    className={`px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:border-gold bg-white ${
                      field.required && !mapping[field.key]
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200"
                    }`}
                  >
                    <option value="">— Not mapped —</option>
                    {columns.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-navy text-sm">Preview (first {preview.length} rows)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {columns.slice(0, 6).map(c => (
                        <th key={c} className="text-left px-4 py-2 text-gray-500 font-medium">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {columns.slice(0, 6).map(c => (
                          <td key={c} className="px-4 py-2 text-gray-700">{row[c] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex-1 btn-gold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {importing ? (
                <><RefreshCw size={14} className="animate-spin" /> Importing...</>
              ) : (
                <><Upload size={14} /> Import Data</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Results */}
      {step === 2 && importResult && (
        <div className="space-y-4">
          <div className={`rounded-2xl p-6 ${importResult.success > 0 ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${importResult.success > 0 ? "bg-green-500" : "bg-red-500"}`}>
                {importResult.success > 0 ? <CheckCircle size={24} className="text-white" /> : <XCircle size={24} className="text-white" />}
              </div>
              <div>
                <h3 className="font-playfair text-xl font-bold text-gray-900">Import Complete</h3>
                <p className="text-sm text-gray-600">{importResult.total} rows processed</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <ResultStat label="Imported" value={importResult.success} color="green" />
              <ResultStat label="Skipped" value={importResult.skipped} color="amber" />
              <ResultStat label="Errors" value={importResult.errors?.length || 0} color="red" />
            </div>
          </div>

          {importResult.errors?.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-red-50">
                <h3 className="font-semibold text-red-700 text-sm">Error Details ({importResult.errors.length} rows)</h3>
              </div>
              <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {importResult.errors.map((err, i) => (
                  <div key={i} className="px-6 py-3 flex items-start gap-3">
                    <span className="text-xs font-medium text-gray-400 mt-0.5 whitespace-nowrap">Row {err.row}</span>
                    <span className="text-sm text-red-600">{err.reason || err.message || 'Unknown error'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button onClick={reset} className="w-full btn-gold flex items-center justify-center gap-2">
            <Upload size={14} /> Import Another File
          </button>
        </div>
      )}
    </div>
  );
}

function ResultStat({ label, value, color }) {
  const colors = { green: "text-green-700", amber: "text-amber-700", red: "text-red-700" };
  return (
    <div className="text-center">
      <p className={`text-3xl font-playfair font-bold ${colors[color]}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}
