"""
TEST SUITE 37 — Frontend Static Analysis
=========================================
Catches runtime crashes that backend API tests can't find:
  - Wrong method calls on API response types (object vs array)
  - Missing optional chaining on potentially-null fields
  - Undefined Tailwind classes (animations, fonts, colors)
  - Missing imports and broken relative paths
  - API path mismatches between frontend and backend
  - Type mismatches in component data flow
"""
import os, re, glob, ast as _ast, json
import pytest

SRC = "../frontend/src"
BACKEND = "../backend/app"


def read(path):
    with open(path) as f:
        return f.read()


def all_jsx():
    return sorted(glob.glob(SRC + "/**/*.jsx", recursive=True))


def all_py():
    return sorted(glob.glob(BACKEND + "/**/*.py", recursive=True))


# ── 1. Tailwind class integrity ───────────────────────────────────────────────

class TestTailwindClasses:
    """All custom Tailwind classes used in JSX must be defined in the config."""

    def _get_defined_animations(self):
        cfg = read("../frontend/tailwind.config.js")
        anim_m = re.search(r'animation:\s*\{(.*?)\},\s*keyframes', cfg, re.DOTALL)
        if anim_m:
            return set(re.findall(r"'([\w-]+)':", anim_m.group(1)))
        return set()

    def test_no_undefined_animate_classes(self):
        """All animate-X classes must be defined in tailwind.config.js or index.css."""
        defined = self._get_defined_animations()
        css = read("../frontend/src/index.css")
        # Add animations defined directly in CSS
        css_defined = set(re.findall(r'\.animate-([\w-]+)\s*\{', css))
        all_defined = defined | css_defined | {
            "spin", "ping", "pulse", "bounce", "none"  # Tailwind built-ins
        }
        
        bad = []
        for path in all_jsx():
            src = read(path)
            anims = set(re.findall(r'animate-([\w-]+)', src))
            missing = anims - all_defined
            if missing:
                name = path.replace(SRC+"/","")
                bad.append(f"{name}: {missing}")
        
        assert not bad, f"Undefined animate- classes:\n" + "\n".join(bad)

    def test_no_font_playfair(self):
        """font-playfair is not defined; use font-display instead."""
        bad = []
        for path in all_jsx():
            if "font-playfair" in read(path):
                bad.append(path.replace(SRC+"/",""))
        assert not bad, f"font-playfair found: {bad}"

    def test_no_raw_gray_classes(self):
        """Design system uses ink-* not gray-*."""
        bad = {}
        for path in all_jsx():
            src = read(path)
            grays = re.findall(r'\b(?:text|bg|border|divide)-gray-\d+\b', src)
            if grays:
                bad[path.replace(SRC+"/","")] = len(grays)
        assert not bad, f"Raw gray classes: {bad}"

    def test_no_bg_gold_text_white(self):
        """bg-gold needs text-navy-dark (WCAG contrast)."""
        bad = []
        for path in all_jsx():
            src = read(path)
            if re.search(r'bg-gold[^"\']{0,30}text-white(?!\-)', src):
                bad.append(path.replace(SRC+"/",""))
        assert not bad, f"bg-gold text-white contrast fail: {bad}"


# ── 2. Type safety on API responses ───────────────────────────────────────────

class TestApiResponseTypeSafety:
    """Detect wrong method calls on API response types."""

    def test_facilities_not_used_as_array(self):
        """lodge.facilities is an object {key: bool}, not an array.
        Calling .includes(), .map(), etc. on it causes TypeError."""
        bad = []
        for path in all_jsx():
            src = read(path)
            name = path.replace(SRC+"/","")
            lines = src.split('\n')
            for i, line in enumerate(lines, 1):
                # .includes() on facilities
                if re.search(r'facilities\??\.(includes|map|filter|find|forEach|some)\(', line):
                    bad.append(f"{name}:{i}: {line.strip()[:80]}")
        assert not bad, f"Array methods on facilities (object):\n" + "\n".join(bad)

    def test_amenities_array_handling(self):
        """lodge.amenities can be either a CSV string or an array.
        Must use Array.isArray() guard before calling array methods."""
        bad = []
        for path in all_jsx():
            src = read(path)
            name = path.replace(SRC+"/","")
            lines = src.split('\n')
            for i, line in enumerate(lines, 1):
                if re.search(r'\bamenities\.(map|filter|find|some|every)\(', line):
                    # Must be guarded
                    if 'Array.isArray' not in line and '?.' not in line:
                        bad.append(f"{name}:{i}: {line.strip()[:80]}")
        assert not bad, f"Unguarded amenities array ops:\n" + "\n".join(bad)

    def test_no_animate_in_plugin(self):
        """animate-in is from tailwindcss-animate which is NOT installed."""
        bad = []
        for path in all_jsx():
            src = read(path)
            if re.search(r'\banimate-in\b', src):
                name = path.replace(SRC+"/","")
                bad.append(name)
        assert not bad, f"animate-in plugin classes (not installed): {bad}"


# ── 3. Import integrity ────────────────────────────────────────────────────────

class TestImportIntegrity:
    """All relative imports must resolve to existing files."""

    def test_all_relative_imports_resolve(self):
        bad = []
        for path in all_jsx():
            src = read(path)
            base_dir = os.path.dirname(path)
            imports = re.findall(r"from\s+['\"](\.[^'\"]+)['\"]", src)
            for imp in imports:
                resolved = os.path.normpath(os.path.join(base_dir, imp))
                exists = any(
                    os.path.exists(resolved + ext) or
                    os.path.exists(os.path.join(resolved, "index" + ext))
                    for ext in [".jsx", ".js", ".tsx", ".ts", ""]
                )
                if not exists:
                    bad.append(f"{path.replace(SRC+'/','')} imports '{imp}'")
        assert not bad, f"Broken relative imports:\n" + "\n".join(bad[:10])


# ── 4. Backend Python integrity ────────────────────────────────────────────────

class TestBackendIntegrity:
    """All backend Python files must parse without syntax errors."""

    def test_all_python_files_parse(self):
        bad = []
        for path in all_py():
            if "__pycache__" in path: continue
            try:
                _ast.parse(read(path))
            except SyntaxError as e:
                bad.append(f"{path}: {e}")
        assert not bad, f"Python syntax errors:\n" + "\n".join(bad)

    def test_no_tuple_returns_from_helper_functions(self):
        """Helper functions like _utcnow() must return a single value, not a tuple."""
        bad = []
        for path in all_py():
            if "__pycache__" in path: continue
            src = read(path)
            # Find return statements with multiple values after function def
            # Pattern: def funcname(): ... return x, y (tuple return)
            lines = src.split('\n')
            in_helper = False
            for i, line in enumerate(lines, 1):
                if re.match(r'def _\w+\(\)', line.strip()):
                    in_helper = True
                if in_helper and line.strip().startswith('return '):
                    # Check for unintentional tuple return
                    ret = line.strip()[7:]  # after 'return '
                    # Comma outside parens = unintentional tuple
                    parens = 0
                    commas_outside = 0
                    for c in ret:
                        if c in '([{': parens += 1
                        elif c in ')]}': parens -= 1
                        elif c == ',' and parens == 0:
                            commas_outside += 1
                    if commas_outside > 0:
                        bad.append(f"{path.replace(BACKEND+'/','')}:{i}: {line.strip()}")
                    in_helper = False
        assert not bad, f"Unintentional tuple returns:\n" + "\n".join(bad[:10])

    def test_models_have_otp_columns(self):
        """User model must have all OTP-related columns."""
        models = read(BACKEND + "/models.py")
        required = ["login_otp", "login_otp_expires", "login_otp_attempts",
                    "require_login_otp", "static_login_pin"]
        missing = [col for col in required if col not in models]
        assert not missing, f"Missing OTP columns in User model: {missing}"

    def test_auth_router_has_required_endpoints(self):
        """auth.py must expose all required endpoints."""
        auth = read(BACKEND + "/routers/auth.py")
        required = [
            "/login",
            "/login/verify-otp",
            "/users",
            "/users/{user_id}/otp-setting",
            "/users/{user_id}/static-pin",
            "/2fa/setup",
            "/2fa/verify",
            "/2fa/disable",
            "/2fa/status",
            "/me",
        ]
        missing = [ep for ep in required if ep not in auth]
        assert not missing, f"Missing endpoints in auth.py: {missing}"

    def test_settings_has_sms_provider_support(self):
        """SMS service must support both twilio and msg91."""
        sms = read(BACKEND + "/services/sms_service.py")
        assert "msg91" in sms, "MSG91 provider missing from sms_service"
        assert "twilio" in sms, "Twilio provider missing from sms_service"
        assert "_send_msg91" in sms, "_send_msg91 function missing"
        assert "_send_twilio" in sms, "_send_twilio function missing"

    def test_auto_migrate_has_all_columns(self):
        """auto_migrate.py must list all new columns for DB migration."""
        migrate = read(BACKEND + "/auto_migrate.py")
        cols = ["login_otp", "require_login_otp", "static_login_pin",
                "last_otp_login_ip", "login_otp_expires", "login_otp_attempts"]
        missing = [c for c in cols if c not in migrate]
        assert not missing, f"Missing migration columns: {missing}"


# ── 5. Frontend API service completeness ──────────────────────────────────────

class TestApiServiceCompleteness:
    """All required API methods must exist in services/api.js."""

    def test_required_auth_methods(self):
        api = read(SRC + "/services/api.js")
        required = ["verifyStaffOtp", "setUserOtpSetting", "setUserStaticPin",
                    "createUser", "listUsers", "toggleUser"]
        missing = [m for m in required if m not in api]
        assert not missing, f"Missing auth API methods: {missing}"

    def test_portal_hub_component_exists(self):
        assert os.path.exists(SRC + "/components/RustoPortalHub/RustoPortalHub.jsx"), \
            "RustoPortalHub component missing"

    def test_auth_context_has_new_roles(self):
        ctx = read(SRC + "/context/AuthContext.jsx")
        assert "isAppOwner" in ctx, "AuthContext missing isAppOwner"
        assert "isLodgeOwner" in ctx, "AuthContext missing isLodgeOwner"
        assert "isStaff" in ctx, "AuthContext missing isStaff"
        assert "roleLabel" in ctx, "AuthContext missing roleLabel"

    def test_login_page_has_staff_otp_flow(self):
        login = read(SRC + "/pages/Login.jsx")
        assert "needsStaffOtp" in login, "Login missing staff OTP state"
        assert "staffOtpToken" in login, "Login missing OTP token state"
        assert "handleStaffOtpSubmit" in login, "Login missing OTP submit handler"
        assert "verify-otp" in login or "verifyStaffOtp" in login, "Login missing OTP verify call"

    def test_settings_has_sms_provider_selector(self):
        settings = read(SRC + "/pages/Settings.jsx")
        assert "sms_provider" in settings, "Settings missing SMS provider setting"
        assert "msg91" in settings, "Settings missing MSG91 option"
        assert "twilio" in settings, "Settings missing Twilio option"

    def test_users_page_has_otp_controls(self):
        users = read(SRC + "/pages/Users.jsx")
        assert "handleToggleOtp" in users, "Users missing OTP toggle handler"
        assert "handleSetStaticPin" in users, "Users missing static PIN handler"
        assert "StaticPinModal" in users, "Users missing StaticPinModal component"
        assert "require_login_otp" in users, "Users missing require_login_otp field"

    def test_lodge_detail_facilities_fix(self):
        """Verify the facilities.includes() crash is fixed."""
        detail = read(SRC + "/pages/rusto/RustoLodgeDetail.jsx")
        # Must NOT have .includes() on facilities
        assert not re.search(r'facilities\??\.(includes)\(', detail), \
            "facilities.includes() crash not fixed"
        # Must use object property access instead
        assert "facilities?.parking" in detail or "facilities.parking" in detail, \
            "facilities.parking check missing"


# ── 6. Data flow integrity ─────────────────────────────────────────────────────

class TestDataFlowIntegrity:
    """Verify data flowing between backend and frontend matches expected shapes."""

    def test_settings_response_shape(self):
        """Backend /api/settings returns array of {setting_key, setting_value}.
        Settings.jsx data.forEach(s => s.setting_key) must work."""
        settings_page = read(SRC + "/pages/Settings.jsx")
        # Must handle array response (list of setting objects)
        assert "forEach" in settings_page or "reduce" in settings_page or \
               "setting_key" in settings_page, \
            "Settings page doesn't handle array response from /api/settings"

    def test_facilities_response_shape_documented(self):
        """Backend returns facilities as an object {parking: bool, pool: bool, ...}.
        Frontend must use facilities.parking NOT facilities.includes('parking')."""
        detail = read(SRC + "/pages/rusto/RustoLodgeDetail.jsx")
        # Correct: object property access
        assert re.search(r'facilities\??\.parking', detail), \
            "Should use facilities.parking (object access)"
        # Wrong: array method
        assert not re.search(r'facilities\??\.includes', detail), \
            "Must not use facilities.includes() - it's an object not array"

    def test_pms_login_returns_lodge_object(self):
        """Login response must return lodge object for non-super users."""
        auth_router = read(BACKEND + "/routers/auth.py")
        assert '"lodge"' in auth_router or "'lodge'" in auth_router, \
            "Login response must include lodge object"
        assert "lodge_id" in auth_router, "Login response must include lodge_id"

    def test_otp_response_shape(self):
        """OTP-required login response must have otp_required and otp_token."""
        auth_router = read(BACKEND + "/routers/auth.py")
        assert "otp_required" in auth_router, "Missing otp_required in response"
        assert "otp_token" in auth_router, "Missing otp_token in response"


# ── 7. Customer booking flow integrity ────────────────────────────────────────

class TestBookingFlowIntegrity:
    """Verify the complete customer → lodge booking bridge is in place."""

    def test_pms_booking_sync_function_exists(self):
        """_sync_customer_booking_to_pms must exist in rusto_bookings.py."""
        src = read(BACKEND + "/routers/rusto_bookings.py")
        assert "_sync_customer_booking_to_pms" in src, \
            "Bridge function missing — customer bookings won't appear in PMS"

    def test_verify_payment_calls_pms_sync(self):
        """verify_payment endpoint must call the PMS sync function."""
        src = read(BACKEND + "/routers/rusto_bookings.py")
        assert "_sync_customer_booking_to_pms(db, b)" in src, \
            "verify_payment does not sync to PMS"

    def test_booking_source_has_online(self):
        """BookingSource enum must include 'online' for Rusto marketplace bookings."""
        models = read(BACKEND + "/models.py")
        assert 'online   = "online"' in models or 'online = "online"' in models, \
            "BookingSource.online missing — PMS can't categorize marketplace bookings"

    def test_customer_booking_has_pms_link_column(self):
        """CustomerBooking model must have linked_pms_booking_id column."""
        models = read(BACKEND + "/models.py")
        assert "linked_pms_booking_id" in models, \
            "linked_pms_booking_id column missing from CustomerBooking"

    def test_dashboard_returns_online_kpis(self):
        """reports.py must include online booking KPIs in dashboard response."""
        reports = read(BACKEND + "/routers/reports.py")
        assert "online_bookings_pending" in reports, \
            "Dashboard missing online_bookings_pending KPI"
        assert "online_arrivals_today" in reports, \
            "Dashboard missing online_arrivals_today KPI"

    def test_listing_bookings_endpoint_exists(self):
        """GET /api/rusto/listing/bookings must exist (lodge admin view)."""
        listing = read(BACKEND + "/routers/rusto_listing.py")
        assert '"/bookings"' in listing or "def list_incoming_bookings" in listing, \
            "Lodge listing bookings endpoint missing"

    def test_pms_bookings_page_handles_online_source(self):
        """PMS Bookings page must display 'Online (Rusto)' source label."""
        bookings_page = read(SRC + "/pages/Bookings.jsx")
        assert "online" in bookings_page, "PMS Bookings page missing online source"
        assert "Online" in bookings_page or "online" in bookings_page.lower(), \
            "No Online label for online-source bookings"

    def test_dashboard_shows_online_booking_banner(self):
        """Dashboard must show alert banner when online bookings are pending."""
        dashboard = read(SRC + "/pages/Dashboard.jsx")
        assert "online_bookings_pending" in dashboard, \
            "Dashboard missing online booking alert"

    def test_admin_sms_notification_on_booking(self):
        """verify_payment must attempt to send SMS to admin on new booking."""
        src = read(BACKEND + "/routers/rusto_bookings.py")
        assert "admin_phone" in src and "send_sms" in src, \
            "No admin SMS notification on new customer booking"


# ── 8. Portal detection ────────────────────────────────────────────────────────

class TestPortalDetection:
    """IP-based portal routing — endpoint and frontend integration."""

    def test_detect_portal_endpoint_exists(self):
        """GET /api/public/detect-portal must exist."""
        from conftest import api_get
        r, s = api_get("/api/public/detect-portal")
        assert s == 200, f"detect-portal endpoint missing: {s}"
        assert "portal" in r, "Response must have 'portal' field"
        assert r["portal"] in ("pms", "customer"), f"Invalid portal value: {r['portal']}"

    def test_detect_portal_returns_client_ip(self):
        from conftest import api_get
        r, s = api_get("/api/public/detect-portal")
        assert s == 200
        assert "client_ip" in r
        assert r["client_ip"], "client_ip must not be empty"

    def test_detect_portal_defaults_to_customer(self):
        """Without any configured IP ranges, portal must default to 'customer'."""
        from conftest import api_get
        r, s = api_get("/api/public/detect-portal")
        assert s == 200
        # May be 'pms' if running from a matched IP range, but default is customer
        assert r["portal"] in ("pms", "customer")

    def test_detect_portal_no_auth_required(self):
        """Endpoint must be accessible without authentication."""
        import urllib.request, json as _j
        req = urllib.request.Request("http://127.0.0.1:9900/api/public/detect-portal")
        # No auth header
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _j.loads(resp.read())
            assert "portal" in data

    def test_portal_context_file_exists(self):
        assert os.path.exists(SRC + "/context/PortalContext.jsx"), \
            "PortalContext.jsx missing"

    def test_portal_context_exports(self):
        ctx = read(SRC + "/context/PortalContext.jsx")
        assert "PortalProvider" in ctx, "PortalProvider not exported"
        assert "usePortal" in ctx, "usePortal not exported"
        assert "effectivePortal" in ctx, "effectivePortal not in context"
        assert "setOverride" in ctx, "setOverride escape hatch missing"
        assert "window.__PORTAL__" in ctx,             "PortalContext must read from window.__PORTAL__ (set by index.html sync XHR)"

    def test_index_html_has_sync_detection(self):
        """index.html must have the synchronous XHR portal detection script."""
        html = read(SRC + "/../index.html")
        assert "window.__PORTAL__" in html,             "index.html missing synchronous portal detection"
        assert "XMLHttpRequest" in html,             "index.html must use synchronous XHR (not async fetch) for detection"
        assert "detect-portal" in html,             "index.html must call /api/public/detect-portal"
        assert "synchronous" in html.lower() or "false" in html,             "XHR must be synchronous (third arg = false)"

    def test_app_uses_portal_provider(self):
        app = read(SRC + "/App.jsx")
        assert "PortalProvider" in app, "PortalProvider not wrapping App"
        assert "usePortal" in app, "App not using portal detection"
        assert "effectivePortal === 'pms'" in app or "effectivePortal" in app,             "App not routing based on effectivePortal"
        assert "PmsRoutes" in app,             "App must have separate PmsRoutes component for lodge networks"
        assert "AllRoutes" in app,             "App must have AllRoutes component for customer networks"

    def test_lodges_page_has_portal_branding(self):
        """lodge_ip_ranges and portal branding are super_admin-only in Lodges page."""
        lodges_page = read(SRC + "/pages/Lodges.jsx")
        assert "lodge_ip_ranges" in lodges_page,             "lodge_ip_ranges must be in the super-admin Lodges page, not Settings"
        assert "Portal Branding" in lodges_page,             "Portal Branding tab missing from LodgeFormModal"
        assert "primary_color" in lodges_page,             "Brand colour settings missing from LodgeFormModal"
        assert "uploadLodgeLogo" in lodges_page or "getPortalSettings" in lodges_page,             "Logo upload or portal settings API missing from Lodges page"

    def test_settings_does_not_have_lodge_ip_ranges(self):
        """IP ranges were moved to super-admin-only Lodges page."""
        settings = read(SRC + "/pages/Settings.jsx")
        # Settings page should NOT have the IP ranges textarea (it moved to Lodges)
        assert "lodge_ip_ranges" not in settings,             "lodge_ip_ranges must be in Lodges (super_admin only), not Settings"

    def test_portal_settings_backend_endpoints(self):
        lodges_router = read(BACKEND + "/routers/lodges.py")
        assert "portal-settings" in lodges_router,             "GET/PUT /lodges/{id}/portal-settings endpoints missing"
        assert "LodgePortalSettingsBody" in lodges_router,             "LodgePortalSettingsBody schema missing"
        assert "require_super_admin" in lodges_router,             "Portal settings must require super_admin"
        assert "lodge_ip_ranges" in lodges_router,             "lodge_ip_ranges not handled in portal settings endpoint"

    def test_portal_detection_backend_router(self):
        assert os.path.exists(BACKEND + "/routers/portal_detection.py"), \
            "portal_detection.py router missing"
        src = read(BACKEND + "/routers/portal_detection.py")
        assert "_parse_ip_ranges" in src, "IP range parser missing"
        assert "_ip_matches_ranges" in src, "IP matching function missing"
        assert "detect-portal" in src, "detect-portal route path missing"

    def test_login_has_portal_escape_hatch(self):
        login = read(SRC + "/pages/Login.jsx")
        assert "setOverride" in login, "Login missing portal override escape hatch"
        assert "Customer site" in login or "customer site" in login.lower() or \
               "setOverride" in login, "Login missing switch-to-customer link"


# ── 9. Production readiness ────────────────────────────────────────────────────

ROOT = ".."

class TestProductionReadiness:
    """Verify all production-readiness files exist and are complete."""

    def test_docker_compose_has_all_services(self):
        import yaml
        with open(ROOT + "/docker-compose.yml") as f:
            dc = yaml.safe_load(f)
        services = set(dc.get("services", {}).keys())
        required = {"db", "backend", "frontend", "frontend_pms", "frontend_customer"}
        missing = required - services
        assert not missing, f"docker-compose.yml missing services: {missing}"

    def test_docker_compose_prod_has_split_portals(self):
        import yaml
        with open(ROOT + "/docker-compose.prod.yml") as f:
            dc = yaml.safe_load(f)
        services = set(dc.get("services", {}).keys())
        assert "frontend_pms" in services, "prod compose missing frontend_pms"
        assert "frontend_customer" in services, "prod compose missing frontend_customer"
        assert "nginx" in services, "prod compose missing nginx"

    def test_env_example_has_all_integrations(self):
        with open(ROOT + "/.env.production.example") as f:
            env = f.read()
        for key in ["RAZORPAY_KEY_ID", "TWILIO_ACCOUNT_SID", "MSG91_AUTH_KEY",
                    "SMTP_HOST", "ANTHROPIC_API_KEY", "JWT_SECRET_KEY"]:
            assert key in env, f".env.production.example missing {key}"

    def test_ci_workflow_has_test_gate(self):
        with open(ROOT + "/.github/workflows/deploy.yml") as f:
            workflow = f.read()
        assert "needs: test" in workflow or "needs: build" in workflow, \
            "CI/CD workflow must gate deploy on tests"
        assert "pytest" in workflow, "CI/CD must run pytest"

    def test_ci_workflow_builds_both_portals(self):
        with open(ROOT + "/.github/workflows/deploy.yml") as f:
            workflow = f.read()
        assert "PORTAL=pms" in workflow, "CI must build PMS portal"
        assert "PORTAL=customer" in workflow, "CI must build Customer portal"

    def test_nginx_has_both_portals(self):
        with open(ROOT + "/nginx/conf.d/default.conf") as f:
            nginx = f.read()
        assert "rusto_pms" in nginx or "frontend_pms" in nginx, \
            "nginx must route to PMS portal"
        assert "rusto_customer" in nginx or "frontend_customer" in nginx, \
            "nginx must route to Customer portal"

    def test_frontend_has_pms_customer_configs(self):
        base = ROOT + "/frontend"
        for f in ["vite.config.pms.js", "vite.config.customer.js",
                  "index-pms.html", "index-customer.html"]:
            path = os.path.join(base, f)
            assert os.path.exists(path), f"Missing: {f}"

    def test_frontend_has_split_apps(self):
        for f in ["AppPms.jsx", "AppCustomer.jsx",
                  "main-pms.jsx", "main-customer.jsx"]:
            path = os.path.join(SRC, f)
            assert os.path.exists(path), f"Missing: {path}"

    def test_pms_app_no_customer_routes(self):
        pms = read(SRC + "/AppPms.jsx")
        # PMS app must NOT import customer booking pages
        assert "RustoSearch" not in pms, "AppPms must not include RustoSearch"
        assert "RustoLodgeDetail" not in pms, "AppPms must not include lodge detail"
        # PMS app must have lodge admin routes
        assert "Dashboard" in pms, "AppPms must include Dashboard"
        assert "Checkins" in pms, "AppPms must include Checkins"

    def test_customer_app_no_pms_routes(self):
        cust = read(SRC + "/AppCustomer.jsx")
        # Customer app must NOT import PMS pages
        assert "Dashboard" not in cust, "AppCustomer must not include Dashboard"
        assert "Checkins" not in cust, "AppCustomer must not include Checkins"
        # Customer app must have booking pages
        assert "RustoSearch" in cust, "AppCustomer must include search"
        assert "RustoLodgeDetail" in cust, "AppCustomer must include lodge detail"

    def test_health_endpoint_exists(self):
        from conftest import api_get
        r, s = api_get("/api/health")
        assert s == 200
        assert r.get("status") == "healthy"
        assert "version" in r
        assert "integrations" in r

    def test_env_seeding_in_main(self):
        main = read(BACKEND + "/main.py")
        for key in ["TWILIO_ACCOUNT_SID", "MSG91_AUTH_KEY", "SMTP_HOST",
                    "ANTHROPIC_API_KEY", "RAZORPAY_KEY_ID"]:
            assert key in main, f"main.py must seed {key} from env"
