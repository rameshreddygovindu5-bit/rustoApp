import urllib.request
import urllib.parse
import json

BASE_URL = "http://localhost:8000/api"

def make_request(path, method="GET", body=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    data = None
    if body:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode())
        except Exception:
            err_body = e.read().decode()
        return e.code, err_body
    except Exception as e:
        return 0, str(e)

def run_tests():
    print("=========================================")
    print("Rusto E2E Flow Testing Script")
    print("=========================================\n")
    
    # 1. Test Login
    print("1. Testing Authentication Flow...")
    login_payload = {
        "username": "admin",
        "password": "Admin@1234"
    }
    status, res = make_request("/auth/login", method="POST", body=login_payload)
    if status == 200 and "token" in res:
        token = res["token"]
        print(f"   [SUCCESS] Logged in successfully. Token: {token[:15]}...")
    else:
        print(f"   [FAILED] Login failed. Status: {status}, Response: {res}")
        return
        
    # 2. Get Me (Profile)
    print("\n2. Testing Profile Flow...")
    status, res = make_request("/auth/me", token=token)
    if status == 200:
        print(f"   [SUCCESS] Profile retrieved. Username: '{res['username']}', Role: '{res['role']}'")
    else:
        print(f"   [FAILED] Profile retrieval failed. Status: {status}, Response: {res}")
        
    # 3. Get Dashboard
    print("\n3. Testing PMS Dashboard Stats Flow...")
    status, res = make_request("/reports/dashboard", token=token)
    if status == 200:
        print("   [SUCCESS] Dashboard statistics loaded successfully.")
        print(f"             Rooms Occupied: {res['kpis']['occupied_rooms']}, Available: {res['kpis']['available_rooms']}, Total: {res['kpis']['total_rooms']}")
    else:
        print(f"   [FAILED] Dashboard stats failed. Status: {status}, Response: {res}")
        
    # 4. Get Rooms
    print("\n4. Testing Room Management Flow...")
    status, res = make_request("/rooms", token=token)
    if status == 200:
        print(f"   [SUCCESS] Rooms list retrieved successfully. Total count: {len(res)}")
    else:
        print(f"   [FAILED] Rooms list failed. Status: {status}, Response: {res}")
        
    # 5. Get Customers
    print("\n5. Testing Customer Management Flow...")
    status, res = make_request("/customers", token=token)
    if status == 200:
        print(f"   [SUCCESS] Customers list retrieved successfully. Total count: {len(res)}")
    else:
        print(f"   [FAILED] Customers list failed. Status: {status}, Response: {res}")
        
    # 6. Get Checkins
    print("\n6. Testing Check-in Flow...")
    status, res = make_request("/checkins", token=token)
    if status == 200:
        print(f"   [SUCCESS] Check-ins list retrieved successfully. Total count: {len(res)}")
    else:
        print(f"   [FAILED] Check-ins list failed. Status: {status}, Response: {res}")

    # 7. Get Bookings
    print("\n7. Testing Bookings Flow...")
    status, res = make_request("/bookings", token=token)
    if status == 200:
        print(f"   [SUCCESS] Bookings list retrieved successfully. Total count: {len(res)}")
    else:
        print(f"   [FAILED] Bookings list failed. Status: {status}, Response: {res}")
        
    # 8. Get Billing Invoices
    print("\n8. Testing Billing & Invoice Flow...")
    status, res = make_request("/billing/invoices", token=token)
    if status == 200:
        print(f"   [SUCCESS] Billing invoices retrieved successfully. Total count: {len(res)}")
    else:
        print(f"   [FAILED] Billing invoices failed. Status: {status}, Response: {res}")

    # 9. Get Public Cities
    print("\n9. Testing Public Marketplace Cities Flow...")
    status, res = make_request("/rusto/public/cities")
    if status == 200:
        print(f"   [SUCCESS] Public cities list retrieved successfully. Cities: {res}")
    else:
        print(f"   [FAILED] Public cities list failed. Status: {status}, Response: {res}")

    print("\n=========================================")
    print("Testing Completed Successfully!")
    print("=========================================")

if __name__ == "__main__":
    run_tests()
