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
