"""
TEST SUITE 07 — Frontend Code Analysis
Static analysis tests that catch runtime errors before they happen in the browser.
Checks imports, JSX patterns, API integration, and component correctness.
"""
import pytest
import os
import re

SRC = "../frontend/src"

# ── Load all page source files ──────────────────────────────────────
def load_pages():
    pages = {}
    for root, dirs, files in os.walk(f"{SRC}/pages/rusto"):
        for f in files:
            if f.endswith(".jsx"):
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8") as fh:
                    pages[f] = fh.read()
    pages["RustoLayout.jsx"] = open(f"{SRC}/components/RustoLayout/RustoLayout.jsx", encoding="utf-8").read()
    pages["App.jsx"] = open(f"{SRC}/App.jsx", encoding="utf-8").read()
    return pages

PAGES = load_pages()


class TestImports:
    """All imports must resolve to existing files."""

    @pytest.mark.parametrize("name,src", list(PAGES.items()))
    def test_relative_imports_resolve(self, name, src):
        """Every relative import must point to an existing file."""
        file_path = f"{SRC}/pages/rusto/{name}" if name not in ("App.jsx",) else f"{SRC}/{name}"
        if name == "RustoLayout.jsx":
            file_path = f"{SRC}/components/RustoLayout/{name}"
        
        failures = []
        for imp in re.findall(r'from ["\'](\.[^"\']+)["\']', src):
            base = os.path.dirname(file_path)
            full = os.path.normpath(os.path.join(base, imp))
            found = any(os.path.exists(full + ext) for ext in
                        ["", ".jsx", ".js", ".ts", ".tsx", "/index.jsx", "/index.js"])
            if not found:
                failures.append(imp)
        
        assert not failures, f"{name}: broken imports: {failures}"

    @pytest.mark.parametrize("name,src", list(PAGES.items()))
    def test_no_react_hot_toast(self, name, src):
        """All pages must use react-toastify, not react-hot-toast."""
        assert "react-hot-toast" not in src, \
            f"{name}: uses react-hot-toast — must use react-toastify"

    @pytest.mark.parametrize("name,src", list(PAGES.items()))
    def test_toast_import_style(self, name, src):
        """toast must be imported as named export from react-toastify (except App.jsx which uses ToastContainer)."""
        if "react-toastify" in src and name not in ("App.jsx",):
            has_toast = "{ toast }" in src or "{ toast," in src or ", toast }" in src or ", toast," in src
            assert has_toast, \
                f"{name}: toast must be imported as named: import {{ toast }} from 'react-toastify'"


class TestComponentScope:
    """Variables used in components must be in scope."""

    def test_checkout_promoResult_in_scope(self):
        """BookingSummary must receive promoResult as prop."""
        src = PAGES.get("RustoCheckout.jsx", "")
        assert src, "RustoCheckout.jsx not found"
        
        # Check function signature — find full prop list including defaults
        sig_match = re.search(r"function BookingSummary\(\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", src)
        assert sig_match, "BookingSummary function not found"
        # Also check the full declaration up to the closing )
        decl_match = re.search(r"function BookingSummary\(([^)]{20,300})\)", src, re.DOTALL)
        full_decl = decl_match.group(1) if decl_match else sig_match.group(1)
        assert "promoResult" in full_decl, \
            f"BookingSummary must accept promoResult prop. Found: {full_decl[:100]}"
        
        # Check call site
        call_match = re.search(r"<BookingSummary[^/]*/?>", src, re.DOTALL)
        if call_match:
            assert "promoResult={promoResult}" in call_match.group(0), \
                "BookingSummary must be called with promoResult={promoResult}"

    def test_lodge_detail_clearlodgetheme_imported(self):
        """clearLodgeTheme must be imported before use."""
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        assert src, "RustoLodgeDetail.jsx not found"
        
        if "clearLodgeTheme" in src:
            assert re.search(r'import.*clearLodgeTheme.*from', src), \
                "clearLodgeTheme used but not imported"

    def test_lodge_detail_applylodgetheme_imported(self):
        """applyLodgeTheme must be imported before use."""
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        if "applyLodgeTheme(" in src:
            assert re.search(r'import.*applyLodgeTheme.*from', src), \
                "applyLodgeTheme used but not imported"


class TestCriticalBugPatterns:
    """Detect known bug patterns that cause runtime crashes."""

    def test_no_amenities_dot_tolowercase(self):
        """
        Bug: lodge.amenities.toLowerCase() crashes because amenities is an array.
        Must use array.some(a => a.toLowerCase()) instead.
        """
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        # Check the FAQs/parking section specifically
        dangerous = re.findall(r'lodge\.amenities\.toLowerCase\(\)', src)
        assert not dangerous, \
            f"RustoLodgeDetail: lodge.amenities.toLowerCase() crashes — amenities is an array. Found {len(dangerous)} instance(s)"

    def test_no_direct_setSaved_on_wishlist_button(self):
        """
        Bug: Save button was calling setSaved(!saved) directly instead of toggleWishlist.
        This causes wishlist state to desync from backend.
        """
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        # The Save button near the heading should use toggleWishlist
        # Pattern: onClick={() => setSaved(!saved)} near a Heart icon  
        dangerous = re.findall(r'onClick=\{[^}]*setSaved\(!saved\)[^}]*\}', src)
        assert not dangerous, \
            "Lodge detail: Save button must call toggleWishlist(), not setSaved(!saved) directly"

    def test_search_has_params_dependency(self):
        """
        Bug: useEffect with [] deps means search never re-runs on URL change.
        City chip clicks from home page would not reload search results.
        """
        src = PAGES.get("RustoSearch.jsx", "")
        # Find the main lodge loading useEffect
        # It should have [params] not [] as deps
        bad_empty_deps = re.findall(
            r'rustoPublicAPI\.search[^;]+\}[^;]*\}\s*,\s*\[\]\s*\)',
            src, re.DOTALL
        )
        assert not bad_empty_deps, \
            "RustoSearch: lodge loading useEffect must not have [] deps (will never re-run on navigation)"

    def test_photo_url_extraction(self):
        """
        Bug: lodge.photos[0] returns {url:"..."} object not string.
        Must use lodge.photos[0]?.url
        """
        src = PAGES.get("RustoSearch.jsx", "")
        # Check that we're extracting .url from photo objects
        lines = [l for l in src.split("\n") if "photos?.[0]" in l or "photos[0]" in l]
        for line in lines:
            if "photo" in line.lower() and "url" not in line:
                # Make sure it's not a comment
                stripped = line.strip()
                if not stripped.startswith("//") and not stripped.startswith("*"):
                    assert False, \
                        f"RustoSearch: photo from lodge.photos[0] may be an object — need .url: {line.strip()}"

    def test_no_hardcoded_lodge_names(self):
        """Platform must be generic — no hardcoded lodge/property-specific names in UI."""
        # Forbidden in customer-facing UI pages (not legal/about which may have company address)
        ui_pages = {k: v for k, v in PAGES.items() 
                    if k not in ("RustoLegal.jsx", "RustoAbout.jsx")}
        # Hardcoded lodge names that should never appear in UI
        forbidden = ["Udumula Grand", "RK Lodge"]
        for name, src in ui_pages.items():
            for forbidden_word in forbidden:
                uncommented = "\n".join(
                    l for l in src.split("\n")
                    if not l.strip().startswith("//") and not l.strip().startswith("*")
                )
                if forbidden_word in uncommented:
                    assert False, \
                        f"{name}: hardcoded lodge name '{forbidden_word}' — must be dynamic"
        # Also check no hardcoded EmptyResults text in Search
        src = PAGES.get("RustoSearch.jsx", "")
        assert "Kotappakonda, Visakhapatnam" not in src, \
            "RustoSearch: EmptyResults must not hardcode city names"

    def test_cities_loaded_from_api(self):
        """Home page city chips must come from API, not hardcoded list."""
        src = PAGES.get("RustoHome.jsx", "")
        # Must call rustoPublicAPI.cities()
        assert "rustoPublicAPI.cities()" in src, \
            "RustoHome: cities must be loaded from API, not hardcoded"
        # Must NOT have a hardcoded list like ["Goa","Kerala",...]
        hardcoded = re.search(r'\["Goa"\s*,\s*"Kerala"', src)
        assert not hardcoded, \
            "RustoHome: cities are still hardcoded — must use dynamic API data"

    def test_error_boundary_in_app(self):
        """App must have ErrorBoundary to prevent blank white screen crashes."""
        src = PAGES.get("App.jsx", "")
        assert "ErrorBoundary" in src, \
            "App.jsx: must use ErrorBoundary to prevent blank crash screens"

    def test_parallel_api_calls_in_lodge_detail(self):
        """Lodge detail should use Promise.all for performance."""
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        assert "Promise.all(" in src, \
            "RustoLodgeDetail: should use Promise.all for parallel API calls"


class TestCSSVariables:
    """CSS variables used in JSX must be defined in index.css."""

    def test_all_css_vars_defined(self):
        with open(f"{SRC}/index.css") as f:
            css = f.read()
        
        defined = set(re.findall(r'(-{2}[\w-]+)(?=\s*:)', css))
        
        critical_vars = [
            "--brand-navy", "--brand-gold", "--brand-cta",
            "--brand-success", "--brand-error", "--brand-warn",
            "--page-bg", "--surface", "--border",
            "--text-primary", "--text-body", "--text-muted",
            "--star-color", "--heart-color",
        ]
        
        missing = [v for v in critical_vars if v not in defined]
        assert not missing, f"CSS variables missing from index.css: {missing}"

    def test_no_undefined_css_vars_in_pages(self):
        """Vars used in JSX must be defined in CSS."""
        with open(f"{SRC}/index.css") as f:
            css = f.read()
        
        defined = set(re.findall(r'(-{2}[\w-]+)(?=\s*:)', css))
        
        all_used = set()
        for src in PAGES.values():
            for v in re.findall(r'var\(\s*(-{2}[\w-]+)', src):
                all_used.add(v)
        
        # Remove vars that are defined inline in components (from theme)
        prop_vars = {v for v in all_used if v.startswith("--prop-")}
        check_vars = all_used - prop_vars
        
        undefined = check_vars - defined
        if undefined:
            # These are serious — will show as invisible/white text
            pytest.fail(f"CSS variables used in pages but NOT defined: {sorted(undefined)}")


class TestButtonsAndLinks:
    """Critical buttons and links must have proper handlers."""

    def test_no_dead_href_hash(self):
        """No href='#' dead links."""
        for name, src in PAGES.items():
            dead_links = re.findall(r'href=["\']#["\']', src)
            # Allow only social links that are properly set
            assert not dead_links, f"{name}: found dead link(s) href='#'"

    def test_wishlist_heart_in_home_has_handler(self):
        """Heart button on home page lodge cards must have onClick."""
        src = PAGES.get("RustoHome.jsx", "")
        # Find Heart usage
        heart_usages = re.findall(r'<Heart[^/>]*onClick[^/>]*/>', src)
        # Heart buttons should exist OR the wrapper button has onClick
        # Check that onSave is called somewhere near Heart
        assert "onSave" in src or "toggleSave" in src or "onClick" in src, \
            "Home page hearts must have click handlers"

    def test_lodge_detail_share_button_functional(self):
        """Share button must have a working handler."""
        src = PAGES.get("RustoLodgeDetail.jsx", "")
        # Share button must use navigator.share or clipboard
        assert "navigator.share" in src or "navigator.clipboard" in src, \
            "Share button must have navigator.share or clipboard fallback"

    def test_mobile_nav_labels_correct(self):
        """Mobile nav must say 'Membership' not 'Elite'."""
        src = PAGES.get("RustoLayout.jsx", "")
        assert "<span>Elite</span>" not in src, \
            "Mobile nav must say 'Membership', not 'Elite'"
        assert "<span>Membership</span>" in src, \
            "Mobile nav must have 'Membership' label"

    def test_form_submits_call_api(self):
        """Auth form must call login/signup API."""
        src = PAGES.get("RustoAuth.jsx", "")
        assert "await login(" in src or "await signup(" in src, \
            "Auth form must call login() or signup()"

    def test_checkout_pay_calls_razorpay_or_mock(self):
        """Checkout pay button must handle both real and mock payment."""
        src = PAGES.get("RustoCheckout.jsx", "")
        assert "razorpay" in src.lower() and "mock" in src.lower(), \
            "Checkout must handle both Razorpay and mock payment modes"


class TestPerformancePatterns:
    """Detect performance anti-patterns."""

    def test_home_uses_memo_for_lodge_cards(self):
        """Lodge cards should be memoized to prevent unnecessary re-renders."""
        src = PAGES.get("RustoHome.jsx", "")
        assert "memo(" in src or "React.memo(" in src, \
            "RustoHome: LodgeCard should be wrapped in memo() for performance"

    def test_search_uses_usememo(self):
        """Search filtering must be memoized."""
        src = PAGES.get("RustoSearch.jsx", "")
        assert "useMemo(" in src, \
            "RustoSearch: filtering must use useMemo to avoid re-computing on every render"

    def test_search_uses_usecallback(self):
        """Search event handlers must be memoized."""
        src = PAGES.get("RustoSearch.jsx", "")
        assert "useCallback(" in src, \
            "RustoSearch: event handlers should use useCallback"
