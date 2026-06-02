import sqlite3
conn = sqlite3.connect("lodge_lms.db")
cursor = conn.cursor()
try:
    cursor.execute("SELECT user_id, username, role FROM users")
    rows = cursor.fetchall()
    print("Raw rows in users table:")
    for r in rows:
        print(f"ID: {r[0]}, Username: '{r[1]}', Role: '{r[2]}' (Type: {type(r[2])})")
except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
