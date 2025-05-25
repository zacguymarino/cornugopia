# admin_settings.py

import os
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, validator

from db import async_session
from models import SiteSettings

#
#  ── HTTP BASIC SECURITY ─────────────────────────────────────────────────────────
#

security = HTTPBasic()

ADMIN_USER = os.getenv("ADMIN_USER")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD")

def get_current_admin(credentials: HTTPBasicCredentials = Depends(security)):
    """
    HTTP Basic dependency that checks against ADMIN_USER/PASS.
    """
    correct_user = secrets.compare_digest(credentials.username, ADMIN_USER or "")
    correct_pass = secrets.compare_digest(credentials.password, ADMIN_PASS or "")
    if not (correct_user and correct_pass):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)]
)

templates = Jinja2Templates(directory="/app/templates")

#
#  ── PAYLOAD MODEL ───────────────────────────────────────────────────────────────
#

class SettingsPayload(BaseModel):
    snackbar_active: bool
    snackbar_message: str
    snackbar_timeout_seconds: int

    sponsor_active: bool
    sponsor_image_desktop: Optional[str] = None
    sponsor_image_mobile: Optional[str] = None
    sponsor_target_url: Optional[str] = None

#
#  ── ROUTES ─────────────────────────────────────────────────────────────────────
#

@router.get("", response_class=HTMLResponse)
async def admin_dashboard(
    request: Request,
    username: str = Depends(get_current_admin),
):
    # load or create the single settings row
    async with async_session() as session:  # type: AsyncSession
        settings = await session.get(SiteSettings, 1)
        if not settings:
            settings = SiteSettings(id=1)
            session.add(settings)
            await session.commit()
            await session.refresh(settings)

    return templates.TemplateResponse(
        "admin_dashboard.html",
        {
            "request": request,
            "admin": username,
            "settings": settings,   # now available to your template
        }
    )

# @router.get(
#     "/settings"
# )
# async def get_settings():
#     """Load (or create) the singleton SiteSettings row and return it."""
#     async with async_session() as session:
#         settings = await session.get(SiteSettings, 1)
#         if not settings:
#             settings = SiteSettings(id=1)
#             session.add(settings)
#             await session.commit()
#             await session.refresh(settings)

#     return {
#         "snackbar_active":          settings.snackbar_active,
#         "snackbar_message":         settings.snackbar_message,
#         "snackbar_timeout_seconds": settings.snackbar_timeout_seconds,
#         "sponsor_active":           settings.sponsor_active,
#         "sponsor_image_desktop":    settings.sponsor_image_desktop,
#         "sponsor_image_mobile":     settings.sponsor_image_mobile,
#         "sponsor_target_url":       settings.sponsor_target_url,
#         "updated_at":               settings.updated_at.isoformat()       if settings.updated_at       else None,
#     }

@router.post(
    "/settings",
)
async def post_settings(payload: SettingsPayload):
    """Upsert the singleton SiteSettings row with incoming JSON."""
    async with async_session() as session:
        settings = await session.get(SiteSettings, 1)
        if not settings:
            settings = SiteSettings(id=1)
            session.add(settings)

        # apply updates
        settings.snackbar_active          = payload.snackbar_active
        settings.snackbar_message         = payload.snackbar_message
        settings.snackbar_timeout_seconds = payload.snackbar_timeout_seconds

        settings.sponsor_active           = payload.sponsor_active
        settings.sponsor_image_desktop    = payload.sponsor_image_desktop
        settings.sponsor_image_mobile     = payload.sponsor_image_mobile
        settings.sponsor_target_url       = payload.sponsor_target_url

        await session.commit()
        await session.refresh(settings)

    return {"success": True}
