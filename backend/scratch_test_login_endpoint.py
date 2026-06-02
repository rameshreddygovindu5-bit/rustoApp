from app.database import SessionLocal
from app.models import User
from app.auth import verify_password, create_access_token
import enum
import json
from decimal import Decimal

# Test JSON response rendering logic
class EnumSafeJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, enum.Enum):
            return obj.value
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)

db = SessionLocal()
try:
    user = db.query(User).filter(User.username == "admin").first()
    if user:
        token = create_access_token({
            "sub": str(user.user_id),
            "role": getattr(user.role, "value", user.role),
            "lodge_id": user.lodge_id,
        })
        lodge_info = None
        if user.lodge:
            lodge_info = {
                "lodge_id": user.lodge.lodge_id,
                "code": user.lodge.code,
                "name": user.lodge.name,
            }
        response_dict = {
            "token": token,
            "user": {
                "user_id": user.user_id,
                "username": user.username,
                "full_name": user.full_name,
                "role": getattr(user.role, "value", user.role),
                "email": user.email,
                "lodge_id": user.lodge_id,
                "lodge": lodge_info,
            }
        }
        print("Response dict constructed successfully:")
        print(response_dict)
        # Try to serialize
        serialized = json.dumps(response_dict, cls=EnumSafeJSONEncoder)
        print("Serialized JSON successfully:")
        print(serialized)
    else:
        print("admin user not found!")
except Exception as e:
    print(f"Error: {e}")
finally:
    db.close()
