"""Housekeeping router — daily cleaning workflow.

Endpoints:
  GET    /api/housekeeping/tasks            — list tasks (filter by status/room/assignee)
  GET    /api/housekeeping/tasks/{id}       — single task
  POST   /api/housekeeping/tasks            — admin creates a task
  PATCH  /api/housekeeping/tasks/{id}/start — housekeeper starts work
  PATCH  /api/housekeeping/tasks/{id}/complete — housekeeper finishes
  PATCH  /api/housekeeping/tasks/{id}/inspect — supervisor inspects (pass/fail)
  PATCH  /api/housekeeping/tasks/{id}/assign — admin reassigns a task
  GET    /api/housekeeping/stats            — summary counts for dashboard widget
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..models import (HousekeepingTask, HousekeepingStatus, HousekeepingTaskType,
                      Room, User)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/housekeeping", tags=["housekeeping"])


def _to_dict(t: HousekeepingTask) -> dict:
    return {
        "task_id": t.task_id,
        "room_id": t.room_id,
        "room_number": t.room.room_number if t.room else None,
        "task_type": getattr(t.task_type, "value", t.task_type),
        "status": getattr(t.status, "value", t.status),
        "assigned_to": t.assigned_to,
        "assignee_name": t.assignee.full_name if t.assignee else None,
        "notes": t.notes,
        "completion_notes": t.completion_notes,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "inspected_by": t.inspected_by,
        "inspected_at": t.inspected_at.isoformat() if t.inspected_at else None,
        "triggered_by_checkin_id": t.triggered_by_checkin_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


@router.get("/tasks")
def list_tasks(status: Optional[str] = Query(None),
               room_id: Optional[int] = None,
               assigned_to: Optional[int] = None,
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.lodge_id == lodge_id)
         .order_by(HousekeepingTask.created_at.desc()))
    if status:
        q = q.filter(HousekeepingTask.status == status)
    if room_id:
        q = q.filter(HousekeepingTask.room_id == room_id)
    if assigned_to:
        q = q.filter(HousekeepingTask.assigned_to == assigned_to)
    return [_to_dict(t) for t in q.limit(500).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Counts for the dashboard housekeeping widget."""
    base = (db.query(HousekeepingTask.status, func.count(HousekeepingTask.task_id))
            .filter(HousekeepingTask.lodge_id == lodge_id)
            .group_by(HousekeepingTask.status))
    counts = {getattr(s, "value", s): 0 for s in HousekeepingStatus}
    for status_val, n in base.all():
        counts[getattr(status_val, "value", status_val)] = n
    return {"by_status": counts}


@router.get("/tasks/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_db),
             current_user=Depends(get_current_user),
             lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.task_id == task_id,
                 HousekeepingTask.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    return _to_dict(t)


class TaskCreate(BaseModel):
    room_id: int
    task_type: str = "checkout_clean"
    notes: Optional[str] = None
    assigned_to: Optional[int] = None


@router.post("/tasks")
def create_task(body: TaskCreate, request: Request,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    # Validate room belongs to this lodge — prevents cross-lodge task creation.
    room = (db.query(Room)
            .filter(Room.room_id == body.room_id,
                    Room.lodge_id == lodge_id).first())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found in this lodge")
    if body.task_type not in {t.value for t in HousekeepingTaskType}:
        raise HTTPException(status_code=400, detail="Invalid task_type")
    # Same applies to the assignee — must be a user in this lodge.
    if body.assigned_to:
        assignee = (db.query(User)
                    .filter(User.user_id == body.assigned_to,
                            User.lodge_id == lodge_id).first())
        if not assignee:
            raise HTTPException(status_code=400, detail="Assignee not in this lodge")

    task = HousekeepingTask(
        lodge_id=lodge_id, room_id=body.room_id,
        task_type=body.task_type,
        status=HousekeepingStatus.pending,
        notes=body.notes, assigned_to=body.assigned_to,
        created_by=current_user.user_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    try:
        log_audit(db, "housekeeping.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="housekeeping_task", entity_id=task.task_id,
                  lodge_id=lodge_id,
                  details={"room_id": body.room_id, "task_type": body.task_type},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(task)


class TaskAssign(BaseModel):
    assigned_to: int


@router.patch("/tasks/{task_id}/assign")
def assign_task(task_id: int, body: TaskAssign, request: Request,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.task_id == task_id,
                 HousekeepingTask.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    assignee = (db.query(User)
                .filter(User.user_id == body.assigned_to,
                        User.lodge_id == lodge_id).first())
    if not assignee:
        raise HTTPException(status_code=400, detail="Assignee not in this lodge")
    t.assigned_to = body.assigned_to
    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "housekeeping.assigned",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="housekeeping_task", entity_id=t.task_id,
                  lodge_id=lodge_id,
                  details={"assigned_to": body.assigned_to,
                           "assignee_name": assignee.full_name},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)


@router.patch("/tasks/{task_id}/start")
def start_task(task_id: int, request: Request,
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    """Housekeeper marks 'started'. If unassigned, auto-claim it for this user."""
    t = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.task_id == task_id,
                 HousekeepingTask.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status != HousekeepingStatus.pending:
        raise HTTPException(status_code=400,
                            detail=f"Cannot start a task in '{t.status.value}' state")
    if t.assigned_to is None:
        t.assigned_to = current_user.user_id
    t.status = HousekeepingStatus.in_progress
    t.started_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "housekeeping.started",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="housekeeping_task", entity_id=t.task_id,
                  lodge_id=lodge_id,
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)


class TaskComplete(BaseModel):
    completion_notes: Optional[str] = None


@router.patch("/tasks/{task_id}/complete")
def complete_task(task_id: int, body: TaskComplete, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.task_id == task_id,
                 HousekeepingTask.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status not in (HousekeepingStatus.in_progress, HousekeepingStatus.pending):
        raise HTTPException(status_code=400,
                            detail=f"Cannot complete a task in '{t.status.value}' state")
    t.status = HousekeepingStatus.completed
    t.completed_at = datetime.utcnow()
    if body.completion_notes:
        t.completion_notes = body.completion_notes
    # When the cleaning task that was triggered by a checkout completes,
    # flip the room's housekeeping_clean flag back to True so the room
    # becomes available for the next guest. Without this the room stays
    # "dirty" until a manual update.
    if t.room_id:
        # Defence-in-depth: scope to the housekeeping task's own lodge
        # rather than blindly trusting t.room_id (FK guards integrity,
        # but never rely on that in cross-tenant code paths).
        room = (db.query(Room)
                  .filter(Room.room_id == t.room_id,
                          Room.lodge_id == t.lodge_id).first())
        if room:
            room.housekeeping_clean = True
    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "housekeeping.completed",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="housekeeping_task", entity_id=t.task_id,
                  lodge_id=lodge_id,
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)


class TaskInspect(BaseModel):
    passed: bool
    notes: Optional[str] = None


@router.patch("/tasks/{task_id}/inspect")
def inspect_task(task_id: int, body: TaskInspect, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_admin),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    """Supervisor inspection. If `passed=False`, the task rolls back to
    pending and a quality note is recorded so the housekeeper sees what
    needs redoing."""
    t = (db.query(HousekeepingTask)
         .filter(HousekeepingTask.task_id == task_id,
                 HousekeepingTask.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    if t.status != HousekeepingStatus.completed:
        raise HTTPException(status_code=400,
                            detail="Inspection only applies to completed tasks")
    t.inspected_by = current_user.user_id
    t.inspected_at = datetime.utcnow()
    if not body.passed:
        t.status = HousekeepingStatus.inspection_failed
        if body.notes:
            t.completion_notes = (t.completion_notes or "") + f"\n[Inspection failed: {body.notes}]"
        # Reset room as dirty until re-cleaned + passed.
        if t.room_id:
            room = db.query(Room).filter(Room.room_id == t.room_id).first()
            if room:
                room.housekeeping_clean = False
    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "housekeeping.inspected",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="housekeeping_task", entity_id=t.task_id,
                  lodge_id=lodge_id,
                  details={"passed": body.passed},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)
