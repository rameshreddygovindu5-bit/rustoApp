from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://lms:lms_password@db:5432/lodge_lms")

if DATABASE_URL.startswith("sqlite"):
    # SQLite has a single-writer model. The agent's SSE stream opens a separate
    # SessionLocal() that lives for the whole stream, while FastAPI deps open
    # their own sessions — without WAL + a busy_timeout the second writer hits
    # "database is locked" instantly. Switching to WAL lets readers and one
    # writer proceed concurrently; busy_timeout makes contending writers wait.
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def _sqlite_on_connect(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA synchronous=NORMAL;")
            cur.execute("PRAGMA busy_timeout=30000;")  # 30s
            cur.execute("PRAGMA foreign_keys=ON;")
        finally:
            cur.close()
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
