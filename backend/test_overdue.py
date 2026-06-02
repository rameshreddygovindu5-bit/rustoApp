import requests

url = "http://127.0.0.1:8000/api/auth/login"
data = {"username": "admin", "password": "Admin@1234"}
r = requests.post(url, json=data)
token = r.json().get("token")

headers = {"Authorization": f"Bearer {token}"}
r2 = requests.get("http://127.0.0.1:8000/api/checkins?status=overdue", headers=headers)
print(r2.status_code)
print(r2.text)
