from app.database import SessionLocal
from app import models
db = SessionLocal()
try:
    print("--- DB Status ---")
    print(f"Lodges: {db.query(models.Lodge).count()}")
    for l in db.query(models.Lodge).all():
        print(f"  Lodge ID: {l.lodge_id}, Name: {l.name}, Code: {l.code}")
        
    print(f"Users: {db.query(models.User).count()}")
    for u in db.query(models.User).all():
        print(f"  User ID: {u.user_id}, Username: '{u.username}', Role: '{u.role}', Lodge ID: {u.lodge_id}")

    print(f"Rooms: {db.query(models.Room).count()}")
    for r in db.query(models.Room).limit(5).all():
        print(f"  Room ID: {r.room_id}, Lodge ID: {r.lodge_id}, Room Number: {r.room_number}, status: {r.status}")
        
    print(f"Customers: {db.query(models.Customer).count()}")
    print(f"Checkins: {db.query(models.Checkin).count()}")
    print(f"Bookings: {db.query(models.Booking).count()}")
    print(f"Invoices: {db.query(models.Invoice).count()}")
finally:
    db.close()
