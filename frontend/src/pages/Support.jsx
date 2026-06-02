import React, { useState, useEffect, useRef } from "react";
import { LifeBuoy, Plus, MessageSquare, Send, X, CheckCircle2,
         Clock, AlertCircle, Hash, Building2, User, RefreshCw,
         ArrowLeft, Sparkles, Search, Copy, Check, RotateCcw,
         HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "react-toastify";
import { supportAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = [
  { value: "technical", label: "Technical", icon: "🔧" },
  { value: "billing", label: "Billing", icon: "💰" },
  { value: "feature_request", label: "Feature Request", icon: "💡" },
  { value: "account", label: "Account", icon: "👤" },
  { value: "other", label: "Other", icon: "📋" },
];

const PRIORITIES = [
  { value: "low", label: "Low", cls: "bg-ink-100 text-ink-700" },
  { value: "normal", label: "Normal", cls: "bg-blue-50 text-blue-700" },
  { value: "high", label: "High", cls: "bg-amber-50 text-amber-700" },
  { value: "urgent", label: "Urgent", cls: "bg-red-50 text-red-700" },
];

const STATUS_CFG = {
  open:            { label: "Open",            cls: "bg-amber-50  text-amber-800  ring-amber-200",  icon: <AlertCircle size={11}/> },
  awaiting_lodge:  { label: "Awaiting Lodge",  cls: "bg-blue-50   text-blue-800   ring-blue-200",   icon: <Clock size={11}/> },
  resolved:        { label: "Resolved",        cls: "bg-green-50  text-green-800  ring-green-200",  icon: <CheckCircle2 size={11}/> },
  closed:          { label: "Closed",          cls: "bg-ink-100   text-ink-700    ring-ink-200",    icon: <X size={11}/> },
};

// 10 functional categories listed by user
const FEATURE_CATEGORIES = {
  all: { label: "All Categories", color: "bg-ink-100 text-ink-700" },
  reservations: { label: "Reservations", color: "bg-blue-900/10 text-blue-700 border-blue-200/50" },
  "front-desk": { label: "Front Desk", color: "bg-green-900/10 text-green-700 border-green-200/50" },
  operations: { label: "Operations", color: "bg-purple-900/10 text-purple-700 border-purple-200/50" },
  "guest-experience": { label: "Guest Experience", color: "bg-pink-900/10 text-pink-700 border-pink-200/50" },
  marketplace: { label: "Marketplace", color: "bg-yellow-900/10 text-yellow-700 border-yellow-200/50" },
  communications: { label: "Communications", color: "bg-teal-900/10 text-teal-700 border-teal-200/50" },
  AI: { label: "AI Concierge", color: "bg-indigo-900/10 text-indigo-700 border-indigo-200/50" },
  analytics: { label: "Analytics", color: "bg-rose-900/10 text-rose-700 border-rose-200/50" },
  configuration: { label: "Configuration", color: "bg-orange-900/10 text-orange-700 border-orange-200/50" },
  platform: { label: "Platform", color: "bg-cyan-900/10 text-cyan-700 border-cyan-200/50" },
};

// 15 detailed feature cards
const FEATURES = [
  {
    id: 1,
    title: "Advance Reservation System",
    category: "reservations",
    description: "Standard front-desk booking reservation flow with automatic tariff/nights total calculation.",
    endpoint: "POST /api/bookings",
    payload: `{\n  "rooms_count": 1,\n  "checkin_date": "2026-06-02",\n  "checkout_date": "2026-06-05",\n  "advance_amount": 2000,\n  "advance_payment_mode": "cash"\n}`,
    steps: [
      {
        title: "Create a booking",
        desc: "Navigate to Bookings → New Booking. Enter guest name, phone, check-in date, rooms count, room type, and tariff. The system computes total automatically (rooms × nights × tariff).",
        code: "POST /api/bookings"
      },
      {
        title: "Collect advance payment",
        desc: "Enter the advance amount and select payment mode (cash, card, UPI). The booking status becomes partial or paid based on advance vs total.",
        code: "advance_amount <= total_amount"
      },
      {
        title: "Convert to check-in",
        desc: "When the guest arrives, click 'Check In Guest' on the booking row. The check-in form pre-fills all details including the advance. The booking transitions to checked_in.",
        code: "GET /api/bookings/{id}/checkin-prefill\nPUT /api/bookings/{id}/mark-checked-in"
      },
      {
        title: "Checkout & invoice",
        desc: "At checkout the advance is automatically credited as 'Advance Adjusted' line on the invoice, reducing the balance due. Booking becomes completed once all rooms check out.",
        code: "booking.status → completed"
      }
    ],
    note: "Advance is separate from the refundable security deposit. Both are tracked independently on the invoice."
  },
  {
    id: 2,
    title: "Log incoming OTA booking",
    category: "reservations",
    description: "When an OTA sends a booking confirmation via email/extranet, log details for reconciliation.",
    endpoint: "POST /api/ota",
    payload: `{\n  "channel": "booking_com",\n  "external_id": "BK-827364",\n  "guest_name": "Jane Smith",\n  "total_amount": 7500,\n  "commission_pct": 15\n}`,
    steps: [
      {
        title: "Log incoming OTA booking",
        desc: "Open OTA Reservations → New. Enter the external confirmation ID, channel, guest details, arrival/departure, and commission %.",
        code: "POST /api/ota"
      },
      {
        title: "Understand the commission math",
        desc: "Commission field auto-computes commission_amount = total × commission_pct ÷ 100. This appears in the stats panel so finance can reconcile what's owed to the OTA at month-end.",
        code: "commission_amount = total * commission_pct / 100"
      },
      {
        title: "Link to internal booking",
        desc: "Once you assign a room and create the standard booking, link it to the OTA record via the booking_id field. This prevents duplicate room allocation.",
        code: "PUT /api/ota/{id}\n{ \"booking_id\": 123 }"
      },
      {
        title: "Track by channel",
        desc: "The stats panel shows count, revenue, and commission totals by channel. Use this to see which OTA drives the most volume vs highest commission cost.",
        code: "GET /api/ota/stats\n→ {by_channel: {booking_com: {...}}}"
      }
    ],
    note: "OTA tradeoff: at 17–30% commission, the math rarely favors upgrades or perks for OTA bookers — hotels have fewer tools and less incentive. Direct bookers cost nothing in commission, making upgrades structurally profitable. Encourage direct by offering a small direct-booking discount on your public booking page."
  },
  {
    id: 3,
    title: "Create or find a guest",
    category: "guest-experience",
    description: "Search guest directory profiles, track check-in documentation and preferences for compliance.",
    endpoint: "POST /api/customers",
    payload: `{\n  "name": "Rohan Sharma",\n  "phone": "+919876543210",\n  "id_type": "aadhaar",\n  "id_number": "999988887777"\n}`,
    steps: [
      {
        title: "Create or find a guest",
        desc: "Search the guest by phone on the Customers page. If new, the Add Customer modal opens. Capturing phone + ID type is essential for police record compliance and guest preference history.",
        code: "POST /api/customers"
      },
      {
        title: "Open the check-in form",
        desc: "Go to Check-ins → New Check-in. Select the guest, room, tariff, check-in date/time, and expected checkout. For advance bookings, use ?booking=ID to pre-fill everything.",
        code: "POST /api/checkins\n{customer_id, room_id, tariff_id, booking_id, advance_paid}"
      },
      {
        title: "During the stay",
        desc: "The Room Detail panel shows the running bill. Staff can add folio charges (food, laundry, transport). The agent can also add charges conversationally.",
        code: "POST /api/folio/{checkin_id}/charge\n{description, amount}"
      },
      {
        title: "Checkout & print invoice",
        desc: "Click Checkout on the checkin row. Select payment mode and amount. The PDF invoice is auto-generated with GST breakdown, advance adjusted, and security deposit refunded.",
        code: "PUT /api/checkins/{id}/checkout\nGET /api/checkins/{id}/invoice"
      }
    ],
    note: "Police C-Form compliance requires guest documentation (ID scans, visa/passport numbers) for all foreign national travelers."
  },
  {
    id: 4,
    title: "Cash Drawer Shift Handovers",
    category: "front-desk",
    description: "Reconcile opening cash against expected invoice sales and expense payouts during cashier shifts.",
    endpoint: "POST /api/shifts/open",
    payload: `{\n  "opening_balance": 5000.0\n}`,
    steps: [
      {
        title: "Open cash shift drawer",
        desc: "Before taking desk duties, the cashier counts initial cash in the drawer and opens a shift session.",
        code: "POST /api/shifts/open"
      },
      {
        title: "Track live totals",
        desc: "Query active shift metrics to inspect live expected drawer balance, tracking cash check-ins vs cash expenses.",
        code: "GET /api/shifts/current"
      },
      {
        title: "Close shift handover",
        desc: "Count physical cash drawer at handover. Open Shift Close modal and submit closing_balance and notes.",
        code: "POST /api/shifts/close"
      },
      {
        title: "Inspect discrepancy stats",
        desc: "System auto-computes: opening_balance + cash_in - cash_out. Any variance registers as a discrepancy.",
        code: "discrepancy = closing_balance - expected"
      }
    ],
    note: "Shift drawer balances are crucial to run correct night audit reports and prevent financial leaks."
  },
  {
    id: 5,
    title: "Daily Night Audit Roll",
    category: "front-desk",
    description: "Advance the hotel date, check in pending arrivals, resolve no-shows, and lock the daily ledger.",
    endpoint: "POST /api/night-audit/run",
    payload: `{}`,
    steps: [
      {
        title: "Run pre-flight checks",
        desc: "Check active check-ins, unassigned rooms, and pending reservations. Trigger audit initialization.",
        code: "GET /api/night-audit/status"
      },
      {
        title: "Initiate daily rollover",
        desc: "Run rollover to post daily room charges automatically, close folio logs, and advance business calendar date.",
        code: "POST /api/night-audit/run"
      },
      {
        title: "Resolve no-shows",
        desc: "Auto-cancel bookings with status pending that exceeded arrival hours, converting them to no_show.",
        code: "booking.status -> no_show"
      },
      {
        title: "Download manager reports",
        desc: "Fetch rolled summary sheets, audit logs, occupancy trends, and tax records for general manager review.",
        code: "GET /api/night-audit/status"
      }
    ],
    note: "Night audits lock previous business day edits, ensuring strict compliance with financial audit practices."
  },
  {
    id: 6,
    title: "Housekeeping & Clean Desk",
    category: "operations",
    description: "Manage real-time cleaning schedules, change room cleanliness status and assign tasks.",
    endpoint: "GET /api/housekeeping/status",
    payload: `{}`,
    steps: [
      {
        title: "List dirty room schedules",
        desc: "Attendants load dirty room lists containing departure times, guest names, and room codes.",
        code: "GET /api/housekeeping/status"
      },
      {
        title: "Assign cleaning tasks",
        desc: "Assign staff to rooms to update tracking logs. Update room status to cleaning.",
        code: "PUT /api/rooms/{id}/status"
      },
      {
        title: "Complete clean verification",
        desc: "Once cleaning finishes, log completion payload to update status to clean and vacant.",
        code: "PUT /api/housekeeping/{room_id}/clean\n{ \"status\": \"clean\" }"
      },
      {
        title: "Release room for check-in",
        desc: "Frontend synchronizes immediately, allowing receptionists to select room on active check-in form.",
        code: "room.clean_status -> clean"
      }
    ],
    note: "Checked-out rooms are marked dirty by default to prevent check-ins on uncleaned rooms."
  },
  {
    id: 7,
    title: "Room Maintenance & Out of Order",
    category: "operations",
    description: "Track physical room repairs, set out-of-service flags and record task costs.",
    endpoint: "POST /api/maintenance",
    payload: `{\n  "room_id": 5,\n  "issue_type": "plumbing",\n  "description": "Leaky faucet in bathroom"\n}`,
    steps: [
      {
        title: "Create repair ticket",
        desc: "Submit room repairs logs specifying room, repair severity, issue description, and target completion.",
        code: "POST /api/maintenance"
      },
      {
        title: "Set out-of-service status",
        desc: "Flagging room status as maintenance blocks it on tape charts, avoiding reservation overlaps.",
        code: "room.status -> out_of_order"
      },
      {
        title: "Update technician reports",
        desc: "Track assignment logs, repair costs, and inventory components used to execute repair.",
        code: "GET /api/maintenance/{id}"
      },
      {
        title: "Recommission room status",
        desc: "Technician resolves maintenance ticket, automatically resetting room back to clean status.",
        code: "PUT /api/maintenance/{id}/resolve"
      }
    ],
    note: "Maintenance costs are factored in room yield ROI dashboard reports at analytics panels."
  },
  {
    id: 8,
    title: "Stay Folio Ancillary Extras",
    category: "guest-experience",
    description: "Charge guest folios for ancillary services like restaurant food, laundry, tours, and transport.",
    endpoint: "POST /api/folio/{checkin_id}/charge",
    payload: `{\n  "description": "Room Service - Dinner",\n  "amount": 1250\n}`,
    steps: [
      {
        title: "Find guest check-in folio",
        desc: "Navigate to Check-ins, select the guest, and launch their active stay billing panel.",
        code: "GET /api/checkins/{id}"
      },
      {
        title: "Post folio extra item",
        desc: "Submit restaurant meals, transport, or laundry charges to the active stay portfolio.",
        code: "POST /api/folio/{checkin_id}/charge"
      },
      {
        title: "Add conversational charges",
        desc: "Let staff or the AI concierge add charges conversationally by stating room number and charge details.",
        code: "POST /api/folio/{checkin_id}/charge\n(AI Assistant Context)"
      },
      {
        title: "Invoice reconciliation",
        desc: "Added folio lines are dynamically appended to the tax invoice, updating outstanding check-out balances.",
        code: "GET /api/checkins/{id}/invoice"
      }
    ],
    note: "Confirm charge slips are signed by the guests before adding folio items to their rooms."
  },
  {
    id: 9,
    title: "Loyalty Points & Guest Rewards",
    category: "guest-experience",
    description: "Reward guest checkout invoices with loyalty balance credits and track points ledger.",
    endpoint: "GET /api/loyalty/balance",
    payload: `{}`,
    steps: [
      {
        title: "Inspect guest loyalty score",
        desc: "System retrieves active customer loyalty balances and tiers (Silver, Gold, Platinum) by phone number.",
        code: "GET /api/loyalty/balance?phone=..."
      },
      {
        title: "Earn rewards on checkout",
        desc: "Settling invoices calculates and grants rewards points (typically 5% of base room invoice).",
        code: "POST /api/loyalty/earn"
      },
      {
        title: "Redeem loyalty points credit",
        desc: "Guests can apply their points balances during check-ins to deduct balances from room tariffs.",
        code: "POST /api/loyalty/redeem"
      },
      {
        title: "Inspect points history ledgers",
        desc: "Audit points ledger trends to check points earned, redeemed, and expired states.",
        code: "GET /api/loyalty/ledger"
      }
    ],
    note: "Loyalty point redemption limits are configured globally under System Settings → Settings."
  },
  {
    id: 10,
    title: "Local Experiences Marketplace",
    category: "marketplace",
    description: "Cross-sell guided tours, spa treatments, and car rentals through local vendor partnerships.",
    endpoint: "GET /api/bundles",
    payload: `{}`,
    steps: [
      {
        title: "Load local packages",
        desc: "System queries local experiences database to pull partner tour programs, packages, and pricing.",
        code: "GET /api/bundles"
      },
      {
        title: "Attach experience stay",
        desc: "Register a tour booking to the guest's folio using package ID and check-in ID details.",
        code: "POST /api/bundles/book\n{ \"checkin_id\": 1, \"bundle_id\": 2 }"
      },
      {
        title: "Reconcile split payments",
        desc: "Commission rules split invoice earnings: 80% to tour provider, 20% to lodge.",
        code: "Invoice.commission_split"
      },
      {
        title: "Export vendor invoices",
        desc: "Export monthly ledger details to verify partner distributions and payouts.",
        code: "GET /api/bundles/partner-ledger"
      }
    ],
    note: "Check local vendor liability waivers prior to booking high-risk adventure experiences."
  },
  {
    id: 11,
    title: "Alerts & Messaging Queue",
    category: "communications",
    description: "Send text and email notifications for bookings, and manage failed queue retries.",
    endpoint: "POST /api/alerts/custom",
    payload: `{\n  "type": "sms",\n  "recipient": "+919876543210",\n  "body": "Your booking is confirmed!"\n}`,
    steps: [
      {
        title: "Trigger template messages",
        desc: "Scheduler handles transactional events (booking updates, arrivals) and queues alerts.",
        code: "GET /api/alerts/logs"
      },
      {
        title: "Send custom messages",
        desc: "Raise manual overrides to text or email guests directly using the custom alert route.",
        code: "POST /api/alerts/custom"
      },
      {
        title: "Review alert errors",
        desc: "Review failed notifications containing gateway error logs (Twilio code, SMTP timeouts).",
        code: "alert.status -> failed"
      },
      {
        title: "Retry failed alerts",
        desc: "Re-send failed alert notifications using bulk retry to clean up backlog logs.",
        code: "POST /api/alerts/retry-failed"
      }
    ],
    note: "Ensure correct test phone recipient values are saved under Settings → Alerts before testing notifications."
  },
  {
    id: 12,
    title: "AI Concierge & Chat Assistant",
    category: "AI",
    description: "Sleek conversational assistant generating day-by-day itineraries linking to live properties.",
    endpoint: "POST /api/agent/chat",
    payload: `{\n  "message": "Plan a 3-day trip in Goa"\n}`,
    steps: [
      {
        title: "Submit guest messages",
        desc: "Submit guest questions to the bot endpoint, fetching matching recommendations.",
        code: "POST /api/agent/chat"
      },
      {
        title: "Parse featured inventories",
        desc: "AI identifies destination cities and queries database to match with featured live lodges.",
        code: "AI parses city suggestions"
      },
      {
        title: "Generate travel itineraries",
        desc: "AI returns travel plans highlighting real lodging profiles and starting tariffs.",
        code: "AI appends Elite Match blocks"
      },
      {
        title: "Direct link checkout",
        desc: "Chat interface parses markdown link syntax and renders React links for direct checkout.",
        code: "renderChatMessage(text)"
      }
    ],
    note: "AI Concierge focuses guest recommendations on zero-commission direct-booking discount offers."
  },
  {
    id: 13,
    title: "Platform Subscription Billing",
    category: "platform",
    description: "Manage subscription billing, process invoices, and handle delinquencies.",
    endpoint: "POST /api/billing/webhook",
    payload: `{}`,
    steps: [
      {
        title: "Razorpay billing webhook",
        desc: "Receive payment webhook updates to update active subscription states and log payments.",
        code: "POST /api/billing/webhook"
      },
      {
        title: "Assess delinquency lockout",
        desc: "Checks subscription limits. Deactivates logins if payments are overdue.",
        code: "GET /api/billing/check-delinquency"
      },
      {
        title: "Subscription ledger logs",
        desc: "Let lodge admins download monthly invoices and billing history logs.",
        code: "GET /api/billing/invoices"
      },
      {
        title: "Upgrades & proration calculator",
        desc: "Upgrade active plan tiers. The system computes prorated credits for invoice deductions.",
        code: "POST /api/billing/upgrade"
      }
    ],
    note: "Delinquency blocks access to the management console. Direct public booking pages remain active."
  },
  {
    id: 14,
    title: "Manager Reports & Performance Analytics",
    category: "analytics",
    description: "Reconcile daily financial metrics, occupancy ratios, reviews, and channel revenue shares.",
    endpoint: "GET /api/analytics/summary",
    payload: `{}`,
    steps: [
      {
        title: "Track revenue performance",
        desc: "Aggregates daily gross revenues, average room rates (ADR), and revenue per room (RevPAR).",
        code: "GET /api/analytics/summary"
      },
      {
        title: "Monitor occupancy trends",
        desc: "Monitor occupancy trends to compare performance across weeks or seasons.",
        code: "GET /api/analytics/occupancy"
      },
      {
        title: "Channel performance index",
        desc: "Analyze booking shares: track direct reservations vs OTA reservations.",
        code: "GET /api/ota/stats"
      },
      {
        title: "Review analytics feedback",
        desc: "Track guest satisfaction index ratings and response times on feedback reports.",
        code: "GET /api/feedback/stats"
      }
    ],
    note: "Analytics dashboards refresh automatically during rollover. Customize date range filters for audits."
  },
  {
    id: 15,
    title: "Dynamic Rate Plans & Promos",
    category: "configuration",
    description: "Configure dynamic rate policies and campaign promo coupon parameters.",
    endpoint: "POST /api/rate-plans",
    payload: `{\n  "room_type_id": 1,\n  "base_tariff": 6500,\n  "weekend_markup": 15\n}`,
    steps: [
      {
        title: "Configure rate plans",
        desc: "Create rates for room categories including markup settings for weekends and seasons.",
        code: "POST /api/rate-plans"
      },
      {
        title: "Generate promotional coupon",
        desc: "Generate active campaign coupons detailing discount percentages, caps, and dates.",
        code: "POST /api/promos"
      },
      {
        title: "Validate coupon eligibility",
        desc: "Validate coupon parameters against check-in dates and room counts.",
        code: "GET /api/promos/validate/{code}"
      },
      {
        title: "Apply ledger deduction",
        desc: "Checkout updates invoice ledger, adding promotional discount lines to deduct total dues.",
        code: "discount_adjusted line on invoice"
      }
    ],
    note: "Promos are checked in real-time. Avoid overlapping active promo dates to prevent double discounts."
  }
];

export default function Support() {
  const { user, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("features");
  
  // Ticket-related states
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: "", category: "", priority: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);     // full ticket with messages
  const [showCreate, setShowCreate] = useState(false);

  // Features-related states
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [expandedCards, setExpandedCards] = useState({});
  const [checkedSteps, setCheckedSteps] = useState(() => {
    try {
      const saved = localStorage.getItem("rusto_checked_steps");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Persist checkboxes
  useEffect(() => {
    localStorage.setItem("rusto_checked_steps", JSON.stringify(checkedSteps));
  }, [checkedSteps]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [listR, statsR] = await Promise.all([
        supportAPI.list({
          ...(filter.status   ? { status:   filter.status }   : {}),
          ...(filter.category ? { category: filter.category } : {}),
          ...(filter.priority ? { priority: filter.priority } : {}),
        }),
        supportAPI.stats(),
      ]);
      setTickets(listR.data || []);
      setStats(statsR.data || {});
    } catch (e) {
      toast.error("Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    if (activeTab === "tickets") {
      refresh(); 
    }
    /* eslint-disable-next-line */ 
  }, [activeTab, filter.status, filter.category, filter.priority]);

  // Load full ticket when selected.
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    let cancelled = false;
    supportAPI.get(selectedId).then(r => { if (!cancelled) setSelected(r.data); })
      .catch(() => toast.error("Failed to load ticket"));
    return () => { cancelled = true; };
  }, [selectedId]);

  // Feature actions
  const toggleExpand = (id) => {
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleStepCheck = (cardId, stepIndex) => {
    const key = `${cardId}-${stepIndex}`;
    setCheckedSteps(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleResetProgress = () => {
    if (window.confirm("Are you sure you want to reset all checklist progress?")) {
      setCheckedSteps({});
      toast.info("Checklist progress reset");
    }
  };

  const copyText = (e, text) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  // Filter features
  const filteredFeatures = FEATURES.filter(f => {
    const matchCat = activeCategory === "all" || f.category === activeCategory;
    const matchSearch = searchQuery.trim() === "" ||
      f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.endpoint.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.steps.some(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()) || s.desc.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCat && matchSearch;
  });

  // Calculate Progress Stats
  const totalSteps = FEATURES.length * 4;
  const checkedCount = Object.values(checkedSteps).filter(Boolean).length;
  const progressPct = totalSteps > 0 ? Math.round((checkedCount / totalSteps) * 100) : 0;

  // Dynamic counts per category
  const categoryCounts = FEATURES.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, { all: FEATURES.length });

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <LifeBuoy size={22} className="text-gold"/>
            Reach Out & Learn
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Review detailed API endpoints, operational checklists, or contact our support desk.
          </p>
        </div>
        
        {activeTab === "tickets" && !isSuperAdmin && (
          <button onClick={() => setShowCreate(true)} className="btn-gold flex items-center gap-1.5 shadow-gold">
            <Plus size={14}/> New Ticket
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ink-100 mb-6 bg-white rounded-xl shadow-sm p-1">
        <button
          onClick={() => setActiveTab("features")}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all flex-1 md:flex-none ${
            activeTab === "features"
              ? "bg-navy text-white shadow-md"
              : "text-ink-600 hover:text-navy hover:bg-ink-50"
          }`}
        >
          <Sparkles size={14} className={activeTab === "features" ? "text-gold" : "text-ink-400"} />
          API & Features Guide
        </button>
        <button
          onClick={() => setActiveTab("tickets")}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg transition-all flex-1 md:flex-none ${
            activeTab === "tickets"
              ? "bg-navy text-white shadow-md"
              : "text-ink-600 hover:text-navy hover:bg-ink-50"
          }`}
        >
          <MessageSquare size={14} className={activeTab === "tickets" ? "text-gold" : "text-ink-400"} />
          {isSuperAdmin ? "Support Tickets Inbox" : "Reach Support Desk"}
        </button>
      </div>

      {/* TAB CONTENT 1: Features & API checklists */}
      {activeTab === "features" && (
        <div className="space-y-6">
          {/* Progress Tracker Card */}
          <div className="bg-gradient-to-br from-navy to-navy-dark rounded-2xl p-6 text-white border border-white/10 shadow-lux relative overflow-hidden">
            <div className="absolute top-[-50%] right-[-20%] w-96 h-96 rounded-full bg-gold/10 blur-[100px] pointer-events-none" />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest font-bold text-gold flex items-center gap-1">
                  <Sparkles size={10} className="animate-pulse" /> Verification Progress Tracker
                </span>
                <h2 className="font-display text-xl font-bold text-white">LMS Integration Checklist</h2>
                <p className="text-white/70 text-xs max-w-xl">
                  Measure your operational readiness. Verify key API endpoints and backend checklists, check them off as you test.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-2xs text-white/50 block uppercase font-semibold">Verified Steps</span>
                  <span className="text-2xl font-bold text-gold">{checkedCount} <span className="text-sm font-normal text-white/60">/ {totalSteps}</span></span>
                </div>
                <button
                  onClick={handleResetProgress}
                  disabled={checkedCount === 0}
                  className="p-2 border border-white/15 hover:border-white/30 rounded-xl bg-white/5 text-white/80 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
                  title="Reset All Checklist Progress"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-5 relative z-10">
              <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-gold via-amber-400 to-gold h-full rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(212,175,55,0.4)]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between items-center text-[10px] text-white/40 mt-2 font-mono">
                <span>0% SET UP</span>
                <span className="text-gold font-semibold">{progressPct}% COMPLETION</span>
                <span>100% READY</span>
              </div>
            </div>
          </div>

          {/* Filtering and Search Section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-ink-100 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" size={16} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search endpoints, parameters or instructions..."
                className="w-full pl-9 pr-4 py-2 border border-ink-200 rounded-xl text-sm focus:outline-none focus:border-gold transition-colors bg-ink-50/50"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-navy"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="text-xs text-ink-500 font-medium">
              Showing {filteredFeatures.length} of {FEATURES.length} Feature Guides
            </div>
          </div>

          {/* Category Filter Pills (Horizontal Scroll) */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-none">
            {Object.entries(FEATURE_CATEGORIES).map(([key, meta]) => {
              const isActive = activeCategory === key;
              const count = categoryCounts[key] || 0;
              return (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    isActive
                      ? "bg-navy border-navy text-white shadow-sm"
                      : "bg-white border-ink-200 text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  <span>{meta.label}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-3xs ${
                    isActive ? "bg-white/20 text-white" : "bg-ink-100 text-ink-500"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Feature Grid List */}
          {filteredFeatures.length === 0 ? (
            <div className="bg-white rounded-2xl border border-ink-100 p-12 text-center shadow-sm">
              <HelpCircle size={40} className="mx-auto text-ink-300 mb-3" />
              <h3 className="font-display font-bold text-navy text-base">No matching guides found</h3>
              <p className="text-ink-500 text-xs mt-1">Try modifying your search queries or clearing the filters.</p>
              <button 
                onClick={() => { setSearchQuery(""); setActiveCategory("all"); }}
                className="mt-4 px-4 py-2 bg-navy text-white text-xs font-bold rounded-xl"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredFeatures.map((f) => {
                const isExpanded = !!expandedCards[f.id];
                const catMeta = FEATURE_CATEGORIES[f.category] || FEATURE_CATEGORIES.all;
                
                // Checked count in this card
                const stepCountChecked = [0, 1, 2, 3].filter(idx => !!checkedSteps[`${f.id}-${idx}`]).length;

                return (
                  <div 
                    key={f.id} 
                    className={`bg-white rounded-2xl border transition-all duration-300 shadow-sm relative overflow-hidden ${
                      isExpanded 
                        ? "border-gold/50 shadow-md ring-1 ring-gold/15" 
                        : "border-ink-100 hover:border-gold/30 hover:shadow-md"
                    }`}
                  >
                    {/* Top border decoration for luxury feel */}
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-gold/50 via-amber-400/30 to-gold/50 opacity-50" />

                    {/* Card Header (Interactive) */}
                    <div 
                      onClick={() => toggleExpand(f.id)}
                      className="p-5 cursor-pointer select-none flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded border ${catMeta.color}`}>
                            {catMeta.label}
                          </span>
                          {stepCountChecked === 4 && (
                            <span className="flex items-center gap-0.5 text-[10px] text-green-600 font-bold bg-green-50 px-1.5 py-0.5 rounded border border-green-200">
                              <CheckCircle2 size={10} /> Verified
                            </span>
                          )}
                          {stepCountChecked > 0 && stepCountChecked < 4 && (
                            <span className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              {stepCountChecked}/4 Steps
                            </span>
                          )}
                        </div>
                        <h3 className="font-display font-bold text-navy text-base">{f.title}</h3>
                        <p className="text-ink-500 text-xs leading-relaxed line-clamp-2">{f.description}</p>
                      </div>
                      <div className="p-1 text-ink-400 hover:text-navy transition-colors self-center">
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </div>
                    </div>

                    {/* Card Expand Drawer */}
                    {isExpanded && (
                      <div className="border-t border-ink-100 bg-ink-50/30 p-5 space-y-4 animate-fade-in">
                        {/* API Endpoint and copy bar */}
                        <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-ink-100">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-2xs font-mono font-bold px-2 py-1 bg-navy text-white rounded">API</span>
                            <span className="font-mono text-xs text-navy font-semibold truncate">{f.endpoint}</span>
                          </div>
                          <button
                            onClick={(e) => copyText(e, f.endpoint)}
                            className="p-1.5 text-ink-500 hover:text-gold hover:bg-gold/10 rounded-lg transition-all"
                            title="Copy Endpoint"
                          >
                            <Copy size={13} />
                          </button>
                        </div>

                        {/* Implementation steps checklists */}
                        <div className="space-y-3">
                          <h4 className="text-2xs uppercase tracking-wider font-bold text-ink-500">Implementation Checklist</h4>
                          
                          <div className="space-y-2">
                            {f.steps.map((s, idx) => {
                              const stepKey = `${f.id}-${idx}`;
                              const isChecked = !!checkedSteps[stepKey];
                              return (
                                <div 
                                  key={idx}
                                  onClick={() => handleStepCheck(f.id, idx)}
                                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all ${
                                    isChecked 
                                      ? "bg-green-50/40 border-green-200" 
                                      : "bg-white border-ink-100 hover:border-ink-200"
                                  }`}
                                >
                                  <div className="mt-0.5 flex-shrink-0">
                                    <div className={`w-4.5 h-4.5 rounded border flex items-center justify-center transition-all ${
                                      isChecked 
                                        ? "bg-green-600 border-green-600 text-white" 
                                        : "border-ink-300 bg-white"
                                    }`}>
                                      {isChecked && <Check size={10} strokeWidth={3} />}
                                    </div>
                                  </div>
                                  <div className="flex-1 space-y-1.5 min-w-0">
                                    <div className="flex justify-between items-center gap-2">
                                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                                        isChecked ? "text-green-700" : "text-ink-400"
                                      }`}>
                                        Step {idx + 1}: {s.title}
                                      </span>
                                      {s.code && (
                                        <button
                                          onClick={(e) => copyText(e, s.code)}
                                          className="p-1 text-ink-400 hover:text-gold rounded transition-colors"
                                          title="Copy Code Pattern"
                                        >
                                          <Copy size={10} />
                                        </button>
                                      )}
                                    </div>
                                    <p className="text-ink-600 text-xs leading-relaxed">{s.desc}</p>
                                    
                                    {s.code && (
                                      <pre className="p-2 bg-ink-900 text-gold-light font-mono text-[10px] rounded-lg overflow-x-auto border border-ink-800 shadow-inner">
                                        {s.code}
                                      </pre>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Optional Payload Details */}
                        {f.payload && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-2xs uppercase tracking-wider font-bold text-ink-500">Sample Payload</span>
                              <button
                                onClick={(e) => copyText(e, f.payload)}
                                className="p-1 text-ink-400 hover:text-gold rounded transition-colors"
                                title="Copy Payload"
                              >
                                <Copy size={11} />
                              </button>
                            </div>
                            <pre className="p-3 bg-ink-900 text-white font-mono text-[10px] rounded-xl overflow-x-auto border border-ink-800 shadow-inner">
                              {f.payload}
                            </pre>
                          </div>
                        )}

                        {/* Operational Note Alert block */}
                        {f.note && (
                          <div className="bg-amber-50/50 border-l-4 border-gold p-3.5 rounded-r-xl flex gap-2.5 items-start">
                            <HelpCircle className="text-gold mt-0.5 flex-shrink-0" size={14} />
                            <div>
                              <h5 className="font-bold text-navy text-2xs uppercase tracking-wider mb-0.5">Operational Note</h5>
                              <p className="text-navy text-2xs leading-relaxed">{f.note}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 2: Support Inbox & Tickets system */}
      {activeTab === "tickets" && (
        <div className="space-y-5">
          {/* Stat chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {["open", "awaiting_lodge", "resolved", "closed"].map(s => {
              const cfg = STATUS_CFG[s];
              return (
                <button key={s}
                        onClick={() => setFilter(f => ({ ...f, status: f.status === s ? "" : s }))}
                        className={`p-3 rounded-xl border transition-all text-left ${
                          filter.status === s
                            ? "border-gold shadow-soft bg-gold-50"
                            : "border-ink-100 bg-white hover:border-ink-300"
                        }`}>
                  <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-600 flex items-center gap-1">
                    {cfg.icon} {cfg.label}
                  </div>
                  <div className="font-display text-2xl font-bold text-navy mt-0.5">{stats[s] || 0}</div>
                </button>
              );
            })}
          </div>

          {/* Optional category + priority filters (super-admin uses heavily) */}
          {isSuperAdmin && (
            <div className="flex flex-wrap gap-2">
              <select value={filter.category} onChange={e => setFilter(f => ({...f, category: e.target.value}))}
                      className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white">
                <option value="">All categories</option>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
              <select value={filter.priority} onChange={e => setFilter(f => ({...f, priority: e.target.value}))}
                      className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm bg-white">
                <option value="">All priorities</option>
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          )}

          {/* Two-pane layout: list | thread */}
          <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
            {/* List */}
            <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-ink-400">Loading…</div>
              ) : tickets.length === 0 ? (
                <div className="p-12 text-center">
                  <MessageSquare size={36} className="mx-auto text-ink-300 mb-3"/>
                  <p className="text-ink-500 text-sm">No tickets here.</p>
                  {!isSuperAdmin && (
                    <button onClick={() => setShowCreate(true)} className="btn-gold mt-4 inline-flex items-center gap-1.5">
                      <Plus size={14}/> Raise your first ticket
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-ink-100 max-h-[70vh] overflow-y-auto">
                  {tickets.map((t, i) => (
                    <button key={t.ticket_id}
                            onClick={() => setSelectedId(t.ticket_id)}
                            style={{ animationDelay: `${i * 25}ms` }}
                            className={`w-full text-left p-4 hover:bg-gold/5 transition-colors animate-slide-up ${
                              selectedId === t.ticket_id ? "bg-gold/10 border-l-4 border-gold" : "border-l-4 border-transparent"
                            }`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-2xs font-mono text-ink-400">{t.ticket_ref}</span>
                        <StatusPill status={t.status}/>
                      </div>
                      <h3 className="font-semibold text-navy text-sm line-clamp-1">{t.subject}</h3>
                      <div className="flex items-center gap-2 mt-1.5 text-2xs text-ink-500 flex-wrap">
                        {isSuperAdmin && t.lodge_name && (
                          <span className="flex items-center gap-1"><Building2 size={10}/> {t.lodge_name}</span>
                        )}
                        <PriorityPill priority={t.priority}/>
                        <span className="text-ink-400">·</span>
                        <span>{new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Thread */}
            <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden min-h-[400px]">
              {selected
                ? <TicketThread ticket={selected} isSuperAdmin={isSuperAdmin}
                                currentUserId={user?.user_id}
                                onClose={() => setSelectedId(null)}
                                onUpdated={(t) => { setSelected(t); refresh(); }}/>
                : (
                  <div className="h-full flex items-center justify-center p-12 text-center">
                    <div>
                      <MessageSquare size={48} className="mx-auto text-ink-200 mb-3"/>
                      <p className="text-ink-400">Select a ticket to view the conversation.</p>
                    </div>
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* Create ticket modal */}
      {showCreate && (
        <CreateTicketModal onClose={() => setShowCreate(false)}
                            onCreated={(t) => { setShowCreate(false); setSelectedId(t.ticket_id); refresh(); }}/>
      )}
    </div>
  );
}


// ── Sub-components ────────────────────────────────────────────────

function StatusPill({ status }) {
  const cfg = STATUS_CFG[status] || { label: status, cls: "bg-ink-100 text-ink-700 ring-ink-200" };
  return (
    <span className={`badge ring-1 ring-inset ${cfg.cls} flex-shrink-0`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function PriorityPill({ priority }) {
  const cfg = PRIORITIES.find(p => p.value === priority);
  if (!cfg || priority === "normal") return null;
  return (
    <span className={`text-2xs font-bold uppercase px-1.5 py-0.5 rounded ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function TicketThread({ ticket, isSuperAdmin, currentUserId, onClose, onUpdated }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [ticket.messages?.length]);

  const send = async (statusChange = null) => {
    if (!reply.trim() && !statusChange) return;
    setSending(true);
    try {
      const r = await supportAPI.reply(ticket.ticket_id, {
        body: reply.trim() || (statusChange === "resolved" ? "Marking as resolved." : "Status update."),
        ...(statusChange ? { status_change: statusChange } : {}),
      });
      onUpdated(r.data);
      setReply("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reply failed");
    } finally {
      setSending(false);
    }
  };

  const changePriority = async (priority) => {
    try {
      const r = await supportAPI.update(ticket.ticket_id, { priority });
      onUpdated(r.data);
      toast.success(`Priority set to ${priority}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Update failed");
    }
  };

  const isClosed = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <div className="flex flex-col h-full max-h-[70vh]">
      {/* Header */}
      <div className="p-4 border-b border-ink-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <button onClick={onClose} className="lg:hidden btn-icon -ml-1">
              <ArrowLeft size={16}/>
            </button>
            <span className="text-2xs font-mono text-ink-400">{ticket.ticket_ref}</span>
            <StatusPill status={ticket.status}/>
          </div>
          <h2 className="font-display text-lg font-bold text-navy">{ticket.subject}</h2>
          <div className="flex items-center gap-3 text-xs text-ink-500 mt-1 flex-wrap">
            {isSuperAdmin && ticket.lodge_name && (
              <span className="flex items-center gap-1"><Building2 size={11}/> {ticket.lodge_name}</span>
            )}
            <span className="flex items-center gap-1"><User size={11}/> {ticket.raised_by_full_name || ticket.raised_by_username}</span>
            {isSuperAdmin && (
              <select value={ticket.priority}
                      onChange={e => changePriority(e.target.value)}
                      className="text-2xs border border-ink-200 rounded px-1.5 py-0.5 bg-white">
                {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            )}
            {!isSuperAdmin && <PriorityPill priority={ticket.priority}/>}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-ink-50/30">
        {(ticket.messages || []).map(m => {
          const own = m.author_user_id === currentUserId;
          const fromSuper = m.author_role === "super_admin";
          return (
            <div key={m.message_id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-soft animate-slide-up ${
                own
                  ? "bg-navy text-white"
                  : fromSuper
                    ? "bg-gradient-to-br from-gold-50 to-white border border-gold/30 text-navy"
                    : "bg-white border border-ink-200 text-navy"
              }`}>
                <div className={`text-2xs font-bold uppercase tracking-eyebrow mb-1 ${own ? "text-white/60" : "text-ink-500"}`}>
                  {m.author_full_name || m.author_username}
                  {fromSuper && " · Support"}
                </div>
                <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                <div className={`text-2xs mt-1 ${own ? "text-white/40" : "text-ink-400"}`}>
                  {new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  {m.status_change && (
                    <span className={`ml-2 font-semibold ${own ? "text-gold-light" : "text-gold-700"}`}>
                      · status → {m.status_change}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef}/>
      </div>

      {/* Reply box */}
      {!isClosed ? (
        <div className="p-3 border-t border-ink-100 bg-white">
          <div className="flex gap-2">
            <textarea value={reply} onChange={e => setReply(e.target.value)}
                      placeholder="Type your reply..."
                      rows={2}
                      className="input-field flex-1 resize-none"
                      onKeyDown={e => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                      }}/>
            <div className="flex flex-col gap-2">
              <button onClick={() => send()} disabled={sending || !reply.trim()}
                      className="btn-gold flex items-center justify-center gap-1.5 w-24">
                <Send size={14}/> Reply
              </button>
              <button onClick={() => send("resolved")} disabled={sending}
                      className="btn-outline border-green-300 text-green-700 hover:bg-green-50 hover:border-green-500 text-xs">
                Resolve
              </button>
            </div>
          </div>
          <p className="text-2xs text-ink-400 mt-1.5">Ctrl/Cmd+Enter to send</p>
        </div>
      ) : (
        <div className="p-4 border-t border-ink-100 bg-ink-50 text-center">
          <p className="text-sm text-ink-600 mb-2">
            This ticket is {ticket.status}.
          </p>
          {(isSuperAdmin || ticket.status === "resolved") && (
            <button onClick={async () => {
              try {
                const r = await supportAPI.update(ticket.ticket_id, { status: "open" });
                onUpdated(r.data);
                toast.success("Ticket reopened");
              } catch { toast.error("Failed to reopen"); }
            }} className="btn-outline text-sm">
              Reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    subject: "", description: "", category: "technical", priority: "normal",
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.subject.trim().length < 3 || form.description.trim().length < 10) {
      toast.error("Subject (3+ chars) and description (10+ chars) required");
      return;
    }
    setSubmitting(true);
    try {
      const r = await supportAPI.create(form);
      toast.success(`Ticket ${r.data.ticket_ref} raised`);
      onCreated(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
            className="modal-box max-w-lg">
        <div className="p-5 border-b border-ink-100 flex justify-between items-center">
          <h2 className="font-display text-lg font-bold text-navy">Raise a Support Ticket</h2>
          <button type="button" onClick={onClose} className="btn-icon"><X size={18}/></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Category</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {CATEGORIES.map(c => (
                <button key={c.value} type="button"
                        onClick={() => setForm(f => ({...f, category: c.value}))}
                        className={`p-2 rounded-lg border-2 text-center text-xs transition-all ${
                          form.category === c.value
                            ? "border-gold bg-gold-50 text-navy font-semibold"
                            : "border-ink-200 hover:border-ink-300 text-ink-600"
                        }`}>
                  <div className="text-xl mb-0.5">{c.icon}</div>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button key={p.value} type="button"
                        onClick={() => setForm(f => ({...f, priority: p.value}))}
                        className={`flex-1 py-1.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                          form.priority === p.value
                            ? "border-navy bg-navy text-white"
                            : "border-ink-200 text-ink-600 hover:border-ink-300"
                        }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Subject *</label>
            <input type="text" value={form.subject}
                   onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                   placeholder="One-line summary of the issue"
                   maxLength={200}
                   className="input-field"/>
          </div>
          <div>
            <label className="label">Description *</label>
            <textarea rows={6} value={form.description}
                      onChange={e => setForm(f => ({...f, description: e.target.value}))}
                      placeholder="Describe the issue in detail. Include steps to reproduce, error messages, and what you expected to happen."
                      maxLength={10000}
                      className="input-field"/>
            <div className="text-2xs text-ink-400 mt-1 text-right">
              {form.description.length}/10000
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-gold">
            {submitting ? "Submitting..." : "Submit Ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}
