import { useState, useEffect, useRef } from "react";
import { Save, Upload, Eye, EyeOff, Hotel, Bell, IndianRupee, Settings as SettingsIcon, RefreshCw, CheckCircle, AlertTriangle, Wifi, Sparkles, X } from "lucide-react";
import { api } from "../services/api";
import { toast } from "react-toastify";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { agentAPI } from "../services/agent";

const SETTING_GROUPS = [
  { id: "hotel", label: "Hotel Info", icon: <Hotel size={16} /> },
  { id: "tariff", label: "Tariff & GST", icon: <IndianRupee size={16} /> },
  { id: "alerts", label: "Alerts & Notifications", icon: <Bell size={16} /> },
  { id: "agent", label: "AI Agent", icon: <Sparkles size={16} /> },
  { id: "system", label: "System", icon: <SettingsIcon size={16} /> },
];

export default function Settings() {
  const { refreshSettings } = useSettings();
  const { user, isAdmin } = useAuth();

  const [activeGroup, setActiveGroup] = useState("hotel");
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [testingAlert, setTestingAlert] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const logoRef = useRef();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await api.get("/settings");
      const mapped = {};
      data.forEach(s => { mapped[s.setting_key] = s.setting_value; });
      setSettings(mapped);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
    setChanged(c => ({ ...c, [key]: value }));
  };

  const handleReview = () => {
    if (Object.keys(changed).length === 0 && !logoFile) {
      toast.info("No changes to save");
      return;
    }
    setShowPreview(true);
  };

  const processSave = async () => {
    setShowPreview(false);
    setSaving(true);
    try {
      // Save logo first if changed
      if (logoFile) {
        const formData = new FormData();
        // Backend accepts both 'logo' and 'file'; we send the documented name.
        formData.append("logo", logoFile);
        await api.postForm("/settings/logo", formData);
        setLogoFile(null);
      }
      // Save settings
      if (Object.keys(changed).length > 0) {
        await api.put("/settings", { settings: changed });
        setChanged({});
      }
      await refreshSettings();
      toast.success("Settings saved successfully!");
      fetchSettings();
    } catch (err) {
      // Surface the real error so admin can see if e.g. tariff value is invalid.
      const msg = err?.message || err?.data?.detail || "Failed to save settings";
      toast.error(typeof msg === "string" ? msg : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestAlert = async (channel) => {
    setTestingAlert(channel);
    try {
      await api.post("/settings/test-alert", { channel });
      toast.success(`Test ${channel} sent! Check your ${channel === "email" ? "inbox" : "phone"}.`);
    } catch (err) {
      toast.error(err.message || `Test ${channel} failed`);
    } finally {
      setTestingAlert(null);
    }
  };

  const handleLogoChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setLogoFile(f);
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result);
    reader.readAsDataURL(f);
  };

  const s = (key) => settings[key] || "";
  const bool = (key) => settings[key] === "true" || settings[key] === true;

  const hasChanges = Object.keys(changed).length > 0 || !!logoFile;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-xl sm:text-2xl font-bold text-navy">Settings</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Configure hotel, billing, and notification preferences</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {hasChanges && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl">
              <AlertTriangle size={12} /> Unsaved
            </span>
          )}
          <button
            onClick={handleReview}
            disabled={saving || !isAdmin}
            className="flex-1 sm:flex-none btn-gold flex items-center justify-center gap-2 disabled:opacity-60 text-sm py-2.5 sm:py-2"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving..." : "Review & Save"}
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <AlertTriangle size={16} className="text-amber-600" />
          <p className="text-sm text-amber-700">You have read-only access. Contact an admin to change settings.</p>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5" style={{ minHeight: "60vh" }}>
        {/* Sidebar / Tabs */}
        <div className="w-full lg:w-48 flex-shrink-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto no-scrollbar lg:overflow-hidden flex lg:flex-col">
            {SETTING_GROUPS.map(g => (
              <button
                key={g.id}
                onClick={() => setActiveGroup(g.id)}
                className={`flex-1 lg:flex-none flex items-center justify-center lg:justify-start gap-3 px-4 py-3 text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap ${
                  activeGroup === g.id
                    ? "bg-navy text-white"
                    : "text-gray-700 hover:bg-gray-50 border-b lg:border-b-0 lg:border-r border-gray-50"
                }`}
              >
                <span className={activeGroup === g.id ? "text-gold" : "text-gray-400"}>{g.icon}</span>
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          {loading ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
              <div className="space-y-4 animate-pulse">
                {Array(5).fill(0).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded-xl" />)}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Hotel Info */}
              {activeGroup === "hotel" && (
                <div className="p-6 space-y-6">
                  <SectionHeader title="Hotel Information" desc="Branding details shown throughout the system" />

                  {/* Logo Upload */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Hotel Logo</label>
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                      <div className="w-24 h-24 rounded-2xl border-2 border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
                        {logoPreview ? (
                          <img src={logoPreview} alt="logo preview" className="w-full h-full object-contain" />
                        ) : s("logo_path") ? (
                          <img src={`/api/${s("logo_path")}`} alt="logo" className="w-full h-full object-contain" />
                        ) : (
                          <Hotel size={32} className="text-gray-300" />
                        )}
                      </div>
                      {isAdmin && (
                        <div className="text-center sm:text-left">
                          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                          <button
                            onClick={() => logoRef.current.click()}
                            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <Upload size={14} /> Upload Logo
                          </button>
                          <p className="text-[10px] sm:text-xs text-gray-400 mt-1.5 uppercase font-bold">PNG, JPG up to 2MB</p>
                          {logoFile && <p className="text-xs text-green-600 mt-1">✓ {logoFile.name} ready</p>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <SettingInput label="Hotel Name" value={s("hotel_name")} onChange={v => updateSetting("hotel_name", v)} disabled={!isAdmin} />
                    <SettingInput label="Tagline" value={s("hotel_tagline")} onChange={v => updateSetting("hotel_tagline", v)} disabled={!isAdmin} />
                    <SettingInput label="Phone" value={s("hotel_phone")} onChange={v => updateSetting("hotel_phone", v)} disabled={!isAdmin} />
                    <SettingInput label="Email" type="email" value={s("hotel_email")} onChange={v => updateSetting("hotel_email", v)} disabled={!isAdmin} />
                    <SettingInput label="Address" value={s("hotel_address")} onChange={v => updateSetting("hotel_address", v)} disabled={!isAdmin} className="sm:col-span-2" />
                    <SettingInput label="City" value={s("hotel_city")} onChange={v => updateSetting("hotel_city", v)} disabled={!isAdmin} />
                    <SettingInput label="GSTIN" value={s("gstin")} onChange={v => updateSetting("gstin", v)} disabled={!isAdmin} />
                  </div>
                </div>
              )}

              {/* Tariff & GST */}
              {activeGroup === "tariff" && (
                <div className="p-6 space-y-6">
                  <SectionHeader title="Tariff & GST Configuration" desc="Room pricing and tax settings" />
                  <div className="grid grid-cols-2 gap-5">
                    <SettingInput label="Deluxe AC Rate (₹/night)" type="number" value={s("tariff_deluxe_ac")} onChange={v => updateSetting("tariff_deluxe_ac", v)} disabled={!isAdmin} />
                    <SettingInput label="AC Rate (₹/night)" type="number" value={s("tariff_ac")} onChange={v => updateSetting("tariff_ac", v)} disabled={!isAdmin} />
                    <SettingInput label="Non-AC Rate (₹/night)" type="number" value={s("tariff_non_ac")} onChange={v => updateSetting("tariff_non_ac", v)} disabled={!isAdmin} />
                    <SettingInput label="House (301) Rate (₹/night)" type="number" value={s("tariff_house")} onChange={v => updateSetting("tariff_house", v)} disabled={!isAdmin} />
                  </div>
                  <div className="border-t border-gray-100 pt-5 space-y-4">
                    <SectionHeader title="GST Settings" desc="Goods and Services Tax configuration" />
                    <ToggleSetting
                      label="Enable GST"
                      desc="Apply GST on tariffs above ₹1000/night"
                      value={bool("gst_enabled")}
                      onChange={v => updateSetting("gst_enabled", String(v))}
                      disabled={!isAdmin}
                    />
                    {bool("gst_enabled") && (
                      <div className="grid grid-cols-1 xs:grid-cols-2 gap-4 sm:gap-5 pl-4 border-l-2 border-gray-100">
                        <SettingInput label="GST Rate (%)" type="number" value={s("gst_rate")} onChange={v => updateSetting("gst_rate", v)} disabled={!isAdmin} />
                        <SettingInput label="GST Threshold (₹)" type="number" value={s("gst_threshold")} onChange={v => updateSetting("gst_threshold", v)} disabled={!isAdmin} />
                      </div>
                    )}
                  </div>
                  <div className="border-t border-gray-100 pt-5">
                    <ToggleSetting
                      label="Checkout Time (24h)"
                      desc="Standard checkout hour"
                      value={null}
                      disabled={!isAdmin}
                    >
                      <SettingInput label="Checkout Hour" type="number" value={s("checkout_hour")} onChange={v => updateSetting("checkout_hour", v)} disabled={!isAdmin} />
                    </ToggleSetting>
                  </div>
                </div>
              )}

              {/* Alerts */}
              {activeGroup === "alerts" && (
                <div className="p-6 space-y-6">
                  <SectionHeader title="Alerts & Notifications" desc="Configure SMS and Email notification channels" />

                  {/* SMS Config */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">SMS Alerts (Twilio)</h4>
                        <p className="text-xs text-gray-400">Send SMS notifications to guests</p>
                      </div>
                      <ToggleSwitch value={bool("sms_enabled")} onChange={v => updateSetting("sms_enabled", String(v))} disabled={!isAdmin} />
                    </div>
                    {bool("sms_enabled") && (
                      <div className="pl-4 border-l-2 border-blue-100 grid grid-cols-2 gap-4">
                        <SettingInput label="Twilio Account SID" value={s("twilio_account_sid")} onChange={v => updateSetting("twilio_account_sid", v)} disabled={!isAdmin} />
                        <SecretInput label="Auth Token" settingKey="twilio_auth_token" value={s("twilio_auth_token")} onChange={v => updateSetting("twilio_auth_token", v)} showSecrets={showSecrets} setShowSecrets={setShowSecrets} disabled={!isAdmin} />
                        <SettingInput label="Twilio From Number" value={s("sms_from_number")} onChange={v => updateSetting("sms_from_number", v)} disabled={!isAdmin} />
                        {/* Test SMS is sent to this number. Required for the
                            "Test SMS" button — without it the test fails with
                            "No admin_phone configured". */}
                        <SettingInput label="Test Recipient Phone" value={s("admin_phone")} onChange={v => updateSetting("admin_phone", v)} disabled={!isAdmin} />
                        <div className="col-span-2 flex items-center gap-3">
                          <button
                            onClick={() => handleTestAlert("sms")}
                            disabled={testingAlert === "sms" || !s("admin_phone")}
                            title={!s("admin_phone") ? "Enter a Test Recipient Phone first" : "Send a test SMS"}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm hover:bg-blue-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {testingAlert === "sms" ? <RefreshCw size={14} className="animate-spin" /> : <Wifi size={14} />}
                            Test SMS
                          </button>
                          <p className="text-xs text-gray-400">A test SMS goes to the Test Recipient Phone above.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Email Config */}
                  <div className="border-t border-gray-100 pt-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-800">Email Alerts (SMTP)</h4>
                        <p className="text-xs text-gray-400">Send email notifications to guests</p>
                      </div>
                      <ToggleSwitch value={bool("email_enabled")} onChange={v => updateSetting("email_enabled", String(v))} disabled={!isAdmin} />
                    </div>
                    {bool("email_enabled") && (
                      <div className="pl-4 border-l-2 border-purple-100 grid grid-cols-2 gap-4">
                        <SettingInput label="SMTP Host" value={s("smtp_host")} onChange={v => updateSetting("smtp_host", v)} disabled={!isAdmin} />
                        <SettingInput label="SMTP Port" type="number" value={s("smtp_port")} onChange={v => updateSetting("smtp_port", v)} disabled={!isAdmin} />
                        <SettingInput label="SMTP Username" value={s("smtp_username")} onChange={v => updateSetting("smtp_username", v)} disabled={!isAdmin} />
                        <SettingInput label="SMTP Password" type="password" value={s("smtp_password")} onChange={v => updateSetting("smtp_password", v)} disabled={!isAdmin} />
                        <SettingInput label="From Name" value={s("email_from_name")} onChange={v => updateSetting("email_from_name", v)} disabled={!isAdmin} />
                        <SettingInput label="From Email" type="email" value={s("email_from_address")} onChange={v => updateSetting("email_from_address", v)} disabled={!isAdmin} />
                        {/* Test email is sent to this address. */}
                        <SettingInput label="Test Recipient Email" type="email" value={s("admin_email")} onChange={v => updateSetting("admin_email", v)} disabled={!isAdmin} />
                        <div className="flex items-end col-span-2">
                          <button
                            onClick={() => handleTestAlert("email")}
                            disabled={testingAlert === "email" || !s("admin_email")}
                            title={!s("admin_email") ? "Enter a Test Recipient Email first" : "Send a test email"}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-xl text-sm hover:bg-purple-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {testingAlert === "email" ? <RefreshCw size={14} className="animate-spin" /> : <Wifi size={14} />}
                            Send Test Email
                          </button>
                          <p className="text-xs text-gray-400 ml-3">A test email goes to the Test Recipient Email above.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Notification schedule */}
                  <div className="border-t border-gray-100 pt-5 space-y-4">
                    <SectionHeader title="Notification Schedule" desc="When automated alerts are sent" />
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <SettingInput label="Checkout Reminder (hour)" type="number" value={s("checkout_reminder_hour")} onChange={v => updateSetting("checkout_reminder_hour", v)} disabled={!isAdmin} />
                      <SettingInput label="Overdue Alert (hour)" type="number" value={s("overdue_alert_hour")} onChange={v => updateSetting("overdue_alert_hour", v)} disabled={!isAdmin} />
                      <SettingInput label="Daily Summary (hour)" type="number" value={s("daily_summary_hour")} onChange={v => updateSetting("daily_summary_hour", v)} disabled={!isAdmin} />
                    </div>
                    <ToggleSetting
                      label="Daily Summary Report"
                      desc="Send daily occupancy & revenue summary"
                      value={bool("daily_summary_enabled")}
                      onChange={v => updateSetting("daily_summary_enabled", String(v))}
                      disabled={!isAdmin}
                    />
                  </div>
                </div>
              )}

              {/* AI Agent */}
              {activeGroup === "agent" && (
                <AIAgentSection
                  s={s} bool={bool} updateSetting={updateSetting}
                  showSecrets={showSecrets} setShowSecrets={setShowSecrets}
                  isAdmin={isAdmin}
                />
              )}

              {/* System */}
              {activeGroup === "system" && (
                <div className="p-6 space-y-6">
                  <SectionHeader title="System Configuration" desc="Backup, security, and operational settings" />
                  <div className="grid grid-cols-2 gap-5">
                    <SettingInput label="Max Login Attempts" type="number" value={s("max_login_attempts")} onChange={v => updateSetting("max_login_attempts", v)} disabled={!isAdmin} />
                    <SettingInput label="Lockout Duration (min)" type="number" value={s("lockout_duration_minutes")} onChange={v => updateSetting("lockout_duration_minutes", v)} disabled={!isAdmin} />
                    <SettingInput label="Session Timeout (min)" type="number" value={s("session_timeout_minutes")} onChange={v => updateSetting("session_timeout_minutes", v)} disabled={!isAdmin} />
                    <SettingInput label="DB Backup Hour" type="number" value={s("backup_hour")} onChange={v => updateSetting("backup_hour", v)} disabled={!isAdmin} />
                  </div>
                  <div className="border-t border-gray-100 pt-5 space-y-4">
                    <ToggleSetting
                      label="Premium Dark Theme"
                      desc="Sync entire application (consumer site + back-office) to desaturated misty glassmorphism by default"
                      value={settings.premium_theme_enabled !== "false"}
                      onChange={v => updateSetting("premium_theme_enabled", String(v))}
                      disabled={!isAdmin}
                    />
                    <ToggleSetting
                      label="Enable DB Backups"
                      desc="Automatically backup database daily"
                      value={bool("backup_enabled")}
                      onChange={v => updateSetting("backup_enabled", String(v))}
                      disabled={!isAdmin}
                    />
                    <ToggleSetting
                      label="Maintenance Mode"
                      desc="Temporarily disable new check-ins"
                      value={bool("maintenance_mode")}
                      onChange={v => updateSetting("maintenance_mode", String(v))}
                      disabled={!isAdmin}
                    />
                  </div>
                  {/* Change Password */}
                  <div className="border-t border-gray-100 pt-5">
                    <ChangePasswordSection />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-navy text-white px-6 py-4 flex items-center justify-between">
              <h3 className="font-playfair text-lg font-bold">Review Settings Changes</h3>
              <button onClick={() => setShowPreview(false)} className="text-white/70 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 max-h-64 overflow-y-auto">
                {logoFile && (
                  <div className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
                    <span className="text-xs font-semibold text-gray-500">Logo</span>
                    <span className="text-sm font-bold text-navy">New logo selected</span>
                  </div>
                )}
                {Object.entries(changed).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
                    <span className="text-xs font-semibold text-gray-500 uppercase">{k.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-bold text-navy max-w-[200px] truncate">{v.toString()}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowPreview(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={processSave} disabled={saving} className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  {saving ? "Saving..." : "✅ Confirm & Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, desc }) {
  return (
    <div>
      <h3 className="font-semibold text-navy">{title}</h3>
      {desc && <p className="text-xs text-gray-500 mt-0.5">{desc}</p>}
    </div>
  );
}

function SettingInput({ label, type = "text", value, onChange, disabled, className = "" }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  );
}

function SecretInput({ label, settingKey, value, onChange, showSecrets, setShowSecrets, disabled }) {
  const show = showSecrets[settingKey];
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white disabled:bg-gray-50"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={() => setShowSecrets(s => ({ ...s, [settingKey]: !s[settingKey] }))}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function ToggleSetting({ label, desc, value, onChange, disabled, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          {desc && <p className="text-xs text-gray-400">{desc}</p>}
        </div>
        {onChange && <ToggleSwitch value={value} onChange={onChange} disabled={disabled} />}
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 disabled:opacity-50 ${
        value ? "bg-navy" : "bg-gray-200"
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
        value ? "translate-x-5" : "translate-x-0"
      }`} />
    </button>
  );
}

function ChangePasswordSection() {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [changing, setChanging] = useState(false);

  const handleChange = async () => {
    if (form.new_password !== form.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.new_password.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    setChanging(true);
    try {
      await api.post("/auth/change-password", {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      toast.success("Password changed successfully!");
      setForm({ current_password: "", new_password: "", confirm: "" });
    } catch (err) {
      toast.error(err.message || "Failed to change password");
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Change Password" desc="Update your login credentials" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Current Password</label>
          <input
            type="password"
            value={form.current_password}
            onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">New Password</label>
          <input
            type="password"
            value={form.new_password}
            onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Confirm New</label>
          <input
            type="password"
            value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
          />
        </div>
      </div>
      <button
        onClick={handleChange}
        disabled={changing || !form.current_password || !form.new_password}
        className="px-5 py-2 bg-navy text-white text-sm rounded-xl hover:bg-navy/90 transition-colors disabled:opacity-60 flex items-center gap-2"
      >
        {changing ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        {changing ? "Changing..." : "Change Password"}
      </button>
    </div>
  );
}

// ─── AI Agent Section ───────────────────────────────────────────────
function AIAgentSection({ s, bool, updateSetting, showSecrets, setShowSecrets, isAdmin }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentAPI.status()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  const refreshStatus = async () => {
    setLoading(true);
    try {
      const st = await agentAPI.status();
      setStatus(st);
      toast.success("Status refreshed");
    } catch {
      toast.error("Failed to fetch status");
    } finally {
      setLoading(false);
    }
  };

  const provider = status?.provider || "unknown";
  const providerLabel = ({
    anthropic: "Anthropic Claude",
    openai: "OpenAI",
    heuristic: "Basic mode (no LLM)",
  })[provider] || provider;
  const providerColor = ({
    anthropic: "bg-purple-50 text-purple-700 border-purple-200",
    openai: "bg-emerald-50 text-emerald-700 border-emerald-200",
    heuristic: "bg-amber-50 text-amber-800 border-amber-200",
  })[provider] || "bg-gray-50 text-gray-600 border-gray-200";

  return (
    <div className="p-6 space-y-6">
      <SectionHeader
        title="AI Agent"
        desc="Operational assistant that performs check-ins, lookups, room management, and more in plain English."
      />

      {/* Live status */}
      <div className={`p-4 rounded-xl border-2 ${providerColor} flex items-start justify-between gap-4`}>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider opacity-70 font-semibold mb-1">
            Currently using
          </div>
          <div className="text-lg font-bold">
            {loading ? "Checking..." : providerLabel}
          </div>
          {status?.model && (
            <div className="text-xs font-mono mt-1 opacity-80">{status.model}</div>
          )}
          {status && (
            <div className="text-xs mt-2 opacity-70">
              {status.tools_available} tools available · confirmation mode:{" "}
              <strong>{status.confirmation_mode}</strong>
            </div>
          )}
          {provider === "heuristic" && (
            <div className="text-xs mt-2 leading-snug">
              No LLM key found. Add an Anthropic or OpenAI key below for full
              natural-language conversation. The agent will still work with
              basic slash commands and quick actions.
            </div>
          )}
        </div>
        <button
          onClick={refreshStatus}
          disabled={loading}
          className="p-2 hover:bg-white/50 rounded-lg transition disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <ToggleSetting
        label="Enable AI Agent"
        desc="Show the AI assistant button to all users"
        value={bool("agent_enabled")}
        onChange={v => updateSetting("agent_enabled", String(v))}
        disabled={!isAdmin}
      />

      {/* Provider selection */}
      <div className="border-t border-gray-100 pt-5">
        <h4 className="text-sm font-semibold text-navy mb-3">LLM Provider</h4>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Provider
            </label>
            <select
              value={s("agent_provider") || "auto"}
              onChange={e => updateSetting("agent_provider", e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white disabled:bg-gray-50"
            >
              <option value="auto">Auto (prefer Anthropic, fall back to OpenAI)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="openai">OpenAI</option>
              <option value="heuristic">Basic mode (no LLM key needed)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Confirmation Mode
            </label>
            <select
              value={s("agent_confirmation_mode") || "writes_only"}
              onChange={e => updateSetting("agent_confirmation_mode", e.target.value)}
              disabled={!isAdmin}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold bg-white disabled:bg-gray-50"
            >
              <option value="all">Confirm everything (paranoid)</option>
              <option value="writes_only">Confirm writes (default)</option>
              <option value="high_risk">Only high-risk (checkout, cancel)</option>
              <option value="none">Skip all confirmations (fastest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Anthropic */}
      <div className="border-t border-gray-100 pt-5">
        <h4 className="text-sm font-semibold text-purple-700 mb-3 flex items-center gap-2">
          <Sparkles size={14} /> Anthropic Claude
          {status?.anthropic_key_configured && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-normal">
              ✓ key configured
            </span>
          )}
        </h4>
        <div className="grid grid-cols-2 gap-5">
          <SecretInput
            label="Anthropic API Key"
            settingKey="agent_anthropic_key"
            value={s("agent_anthropic_key")}
            onChange={v => updateSetting("agent_anthropic_key", v)}
            showSecrets={showSecrets}
            setShowSecrets={setShowSecrets}
            disabled={!isAdmin}
          />
          <SettingInput
            label="Anthropic Model"
            value={s("agent_anthropic_model")}
            onChange={v => updateSetting("agent_anthropic_model", v)}
            disabled={!isAdmin}
          />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Recommended: <code className="bg-gray-100 px-1 rounded">claude-sonnet-4-6</code> (or <code className="bg-gray-100 px-1 rounded">claude-opus-4-7</code> for higher quality).
          Get a key at console.anthropic.com.
        </p>
      </div>

      {/* OpenAI */}
      <div className="border-t border-gray-100 pt-5">
        <h4 className="text-sm font-semibold text-emerald-700 mb-3 flex items-center gap-2">
          <Sparkles size={14} /> OpenAI
          {status?.openai_key_configured && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-normal">
              ✓ key configured
            </span>
          )}
        </h4>
        <div className="grid grid-cols-2 gap-5">
          <SecretInput
            label="OpenAI API Key"
            settingKey="agent_openai_key"
            value={s("agent_openai_key")}
            onChange={v => updateSetting("agent_openai_key", v)}
            showSecrets={showSecrets}
            setShowSecrets={setShowSecrets}
            disabled={!isAdmin}
          />
          <SettingInput
            label="OpenAI Model"
            value={s("agent_openai_model")}
            onChange={v => updateSetting("agent_openai_model", v)}
            disabled={!isAdmin}
          />
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          Used as a fallback if Anthropic is unavailable. Recommended:
          <code className="bg-gray-100 px-1 rounded ml-1">gpt-4o-mini</code> (cheap),
          or <code className="bg-gray-100 px-1 rounded">gpt-4o</code> (higher quality).
        </p>
      </div>

      {/* Quick reference */}
      <div className="border-t border-gray-100 pt-5">
        <h4 className="text-sm font-semibold text-navy mb-2">What can the agent do?</h4>
        <ul className="text-xs text-gray-600 space-y-1 leading-relaxed list-disc pl-5">
          <li>Natural-language check-ins ("Check in Ravi Kumar to room 102 for 3 nights")</li>
          <li>Checkouts with auto-invoice generation</li>
          <li>Customer search by name/phone, full stay history</li>
          <li>Room status & housekeeping ("Mark room 105 clean")</li>
          <li>Booking creation & cancellation</li>
          <li>Live dashboard, overdue list, upcoming arrivals</li>
          <li>Revenue reports for any date range</li>
          <li>Custom SMS/email alerts to specific guests</li>
          {isAdmin && <li>Agency partner management (admin only)</li>}
        </ul>
      </div>
    </div>
  );
}
