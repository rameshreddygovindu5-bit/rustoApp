from app.database import SessionLocal
from app.models import User, UserRole
db = SessionLocal()
try:
    users = db.query(User).all()
    print(f"Total users found: {len(users)}")
    for u in users:
        val = getattr(u.role, "value", None)
        print(f"ID: {u.user_id}, Username: '{u.username}', Role: '{u.role}', Type: {type(u.role)}, Value: '{val}'")
except Exception as e:
    print(f"Error querying users: {e}")
finally:
    db.close()
