from app.database import SessionLocal
from app.models import User
from app.auth import verify_password
db = SessionLocal()
try:
    print("Testing admin...")
    admin = db.query(User).filter(User.username == "admin").first()
    if admin:
        ok = verify_password("Admin@1234", admin.password_hash)
        print(f"Password 'Admin@1234' matches? {ok}")
    else:
        print("admin user not found!")

    print("Testing superadmin...")
    sa = db.query(User).filter(User.username == "superadmin").first()
    if sa:
        ok = verify_password("superadmin123", sa.password_hash)
        print(f"Password 'superadmin123' matches? {ok}")
    else:
        print("superadmin user not found!")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
