
import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'app'))
from app.database import SessionLocal
from app.routers.reports import get_dashboard_data
from unittest.mock import MagicMock

db = SessionLocal()
try:
    data = get_dashboard_data(db=db, current_user=MagicMock(), lodge_id=1)
    print(data['kpis'])
finally:
    db.close()
