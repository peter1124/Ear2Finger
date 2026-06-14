import os
import platform
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health_check(request: Request):
    """Health check endpoint"""
    last_active = getattr(request.app.state, "last_active_time", 0.0)
    return {
        "status": "healthy",
        "service": "Ear2Finger API",
        "last_active": last_active
    }


@router.get("/system/performance")
def system_performance():
    """System performance and recommendations endpoint"""
    cores = os.cpu_count() or 1
    is_low_performance = cores < 4
    if cores < 4:
        recommended_quality = "64"
    elif cores < 8:
        recommended_quality = "128"
    else:
        recommended_quality = "192"

    return {
        "cpu_cores": cores,
        "is_low_performance": is_low_performance,
        "recommended_quality": recommended_quality,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "release": platform.release(),
        "system": platform.system()
    }

