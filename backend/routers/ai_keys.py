"""Per-user AI API key management (multiple keys per provider)."""
from datetime import datetime
from typing import List, Optional
from uuid import uuid4
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import User, UserConfig, get_db

AI_PROVIDER_KEYS = {"gemini"}

router = APIRouter()
logger = logging.getLogger("ai_keys")


class APIKeyHint(BaseModel):
  id: str
  provider: str
  last4: str
  created_at: datetime
  is_active: bool


class ListKeysResponse(BaseModel):
  provider: str
  ai_provider: Optional[str]
  keys: List[APIKeyHint]


def _canonical_key(provider: str) -> str:
  return f"{provider}_api_key"


def _normalize_provider(provider: str) -> str:
  provider_norm = provider.strip().lower()
  if provider_norm not in AI_PROVIDER_KEYS:
    raise HTTPException(
      status_code=400,
      detail=f"Invalid provider '{provider}'. Must be one of: {sorted(AI_PROVIDER_KEYS)}.",
    )
  return provider_norm


def _get_ai_provider(db: Session, user_id: int) -> Optional[str]:
  row = (
    db.query(UserConfig)
    .filter(UserConfig.user_id == user_id, UserConfig.key == "ai_provider")
    .first()
  )
  return row.value if row and row.value else None


def _ensure_legacy_migrated(
  db: Session, user_id: int, provider: str
) -> None:
  """If the user only has a single legacy provider_api_key row, mirror it into a managed key row."""
  canonical = _canonical_key(provider)
  canonical_row = (
    db.query(UserConfig)
    .filter(UserConfig.user_id == user_id, UserConfig.key == canonical)
    .first()
  )
  if not canonical_row or not canonical_row.value:
    return

  # If there is already at least one managed key row, nothing to do
  existing_managed = (
    db.query(UserConfig)
    .filter(
      UserConfig.user_id == user_id,
      UserConfig.key.like(f"{canonical}:%"),
    )
    .first()
  )
  if existing_managed:
    return

  # Create a managed row mirroring the canonical value
  managed_key = f"{canonical}:{uuid4().hex}"
  db.add(
    UserConfig(
      user_id=user_id,
      key=managed_key,
      value=canonical_row.value,
    )
  )
  db.flush()


@router.get("/user/ai-keys", response_model=ListKeysResponse)
async def list_ai_keys(
    provider: str = Query(..., description="AI provider: gemini"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List configured API keys for the given provider, without exposing full key values.

    Only keys for the *globally selected* provider (ai_provider) are marked is_active,
    ensuring at most one active key across all providers.
    """
    provider_norm = _normalize_provider(provider)
    logger.info(
        "ai_keys.list_ai_keys: user_id=%s provider=%s",
        current_user.id,
        provider_norm,
    )
    canonical = _canonical_key(provider_norm)

    # One-time migration for any legacy single-key storage
    _ensure_legacy_migrated(db, current_user.id, provider_norm)

    canonical_row = (
        db.query(UserConfig)
        .filter(UserConfig.user_id == current_user.id, UserConfig.key == canonical)
        .first()
    )
    active_value = canonical_row.value if canonical_row and canonical_row.value else None

    current_ai_provider = _get_ai_provider(db, current_user.id)

    managed_rows = (
        db.query(UserConfig)
        .filter(
            UserConfig.user_id == current_user.id,
            UserConfig.key.like(f"{canonical}:%"),
        )
        .all()
    )
    logger.info(
        "ai_keys.list_ai_keys: user_id=%s provider=%s managed_count=%s has_canonical=%s",
        current_user.id,
        provider_norm,
        len(managed_rows),
        bool(canonical_row),
    )

    hints: List[APIKeyHint] = []
    for row in managed_rows:
        # Managed key rows have key format "<provider>_api_key:<uuid>"; we
        # identify them by their primary-key id when activating/deleting.
        raw_val = row.value or ""
        last4 = raw_val[-4:] if raw_val else ""
        hints.append(
            APIKeyHint(
                id=str(row.id),
                provider=provider_norm,
                last4=last4,
                created_at=row.created_at,
                is_active=bool(
                    current_ai_provider == provider_norm
                    and active_value
                    and raw_val
                    and active_value == raw_val
                ),
            )
        )

    return ListKeysResponse(
        provider=provider_norm,
        ai_provider=current_ai_provider,
        keys=hints,
    )


class AddAPIKeyBody(BaseModel):
  provider: str
  key: str
  make_active: bool = True


@router.post("/user/ai-keys", response_model=APIKeyHint)
async def add_ai_key(
  body: AddAPIKeyBody,
  db: Session = Depends(get_db),
  current_user: User = Depends(get_current_user),
):
  """Add a new API key for a provider and optionally mark it active.

  The full key is stored server-side but only a short hint (last4) is ever returned to clients.
  """
  provider_norm = _normalize_provider(body.provider)
  key = body.key.strip()
  if not key:
    raise HTTPException(status_code=400, detail="key must be a non-empty string")

  canonical = _canonical_key(provider_norm)

  # Create managed key entry
  key_id = uuid4().hex
  managed_key_name = f"{canonical}:{key_id}"
  managed_row = UserConfig(
    user_id=current_user.id,
    key=managed_key_name,
    value=key,
  )
  db.add(managed_row)

  # Ensure we have an ai_provider set to this provider if none exists yet
  if _get_ai_provider(db, current_user.id) is None:
    db.add(
      UserConfig(
        user_id=current_user.id,
        key="ai_provider",
        value=provider_norm,
      )
    )

  # Update canonical active value if requested or if none exists yet
  canonical_row = (
    db.query(UserConfig)
    .filter(UserConfig.user_id == current_user.id, UserConfig.key == canonical)
    .first()
  )
  if body.make_active or not (canonical_row and canonical_row.value):
    if canonical_row:
      canonical_row.value = key
    else:
      db.add(
        UserConfig(
          user_id=current_user.id,
          key=canonical,
          value=key,
        )
      )

  db.commit()
  db.refresh(managed_row)

  logger.info(
    "ai_keys.add_ai_key: user_id=%s provider=%s created_row_id=%s key_last4=%s",
    current_user.id,
    provider_norm,
    managed_row.id,
    key[-4:] if key else "",
  )

  return APIKeyHint(
    id=key_id,
    provider=provider_norm,
    last4=key[-4:] if key else "",
    created_at=managed_row.created_at,
    is_active=True if body.make_active else False,
  )


@router.post("/user/ai-keys/{key_id}/activate")
async def activate_ai_key(
    key_id: str,
    provider: Optional[str] = Query(
        None, description="AI provider for this key (optional hint, not required)"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark one of the stored keys as the globally active key.

    We try the hinted provider first (if given), but will fall back to
    searching all providers so activation still works if the hint is wrong.
    """

    def find_row() -> tuple[str, str, UserConfig]:
        """Look up the managed row and resolve its provider using the DB id."""
        try:
            row_id = int(key_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid key id")

        row = (
            db.query(UserConfig)
            .filter(
                UserConfig.user_id == current_user.id,
                UserConfig.id == row_id,
            )
            .first()
        )
        if not row or not row.value:
            logger.warning(
                "ai_keys.activate_ai_key: user_id=%s key_id=%s row_not_found",
                current_user.id,
                key_id,
            )
            raise HTTPException(status_code=404, detail="API key not found")

        # Infer provider from the key prefix, e.g. "gemini_api_key:..."
        provider_norm: Optional[str] = None
        for p in AI_PROVIDER_KEYS:
            prefix = f"{_canonical_key(p)}:"
            if row.key.startswith(prefix):
                provider_norm = p
                break
        if provider_norm is None:
            logger.error(
                "ai_keys.activate_ai_key: user_id=%s key_id=%s could_not_infer_provider key=%s",
                current_user.id,
                key_id,
                row.key,
            )
            raise HTTPException(status_code=400, detail="Could not infer provider for this key")

        canonical = _canonical_key(provider_norm)
        return provider_norm, canonical, row

    provider_norm, canonical, managed_row = find_row()

    logger.info(
        "ai_keys.activate_ai_key: user_id=%s key_id=%s provider=%s row_id=%s",
        current_user.id,
        key_id,
        provider_norm,
        managed_row.id,
    )

    canonical_row = (
        db.query(UserConfig)
        .filter(UserConfig.user_id == current_user.id, UserConfig.key == canonical)
        .first()
    )
    if canonical_row:
        canonical_row.value = managed_row.value
    else:
        db.add(
            UserConfig(
                user_id=current_user.id,
                key=canonical,
                value=managed_row.value,
            )
        )

    # Ensure ai_provider points at this provider
    ai_provider_row = (
        db.query(UserConfig)
        .filter(
            UserConfig.user_id == current_user.id,
            UserConfig.key == "ai_provider",
        )
        .first()
    )
    if ai_provider_row:
        ai_provider_row.value = provider_norm
    else:
        db.add(
            UserConfig(
                user_id=current_user.id,
                key="ai_provider",
                value=provider_norm,
            )
        )

    db.commit()
    return {"message": "Active API key updated"}


@router.delete("/user/ai-keys/{key_id}")
async def delete_ai_key(
  key_id: str,
  provider: Optional[str] = Query(None, description="AI provider for this key (optional hint, not required)"),
  db: Session = Depends(get_db),
  current_user: User = Depends(get_current_user),
):
  """Delete a stored key. If it was active, fall back to another key or clear the active slot.

  We try the hinted provider first (if any), then search all providers as a fallback.
  """

  def find_row() -> tuple[str, str, UserConfig]:
    try:
      row_id = int(key_id)
    except ValueError:
      raise HTTPException(status_code=400, detail="Invalid key id")

    row = (
      db.query(UserConfig)
      .filter(
        UserConfig.user_id == current_user.id,
        UserConfig.id == row_id,
      )
      .first()
    )
    if not row:
      logger.warning(
        "ai_keys.delete_ai_key: user_id=%s key_id=%s row_not_found",
        current_user.id,
        key_id,
      )
      raise HTTPException(status_code=404, detail="API key not found")

    # Infer provider from the key prefix, e.g. "gemini_api_key:..."
    provider_norm: Optional[str] = None
    for p in AI_PROVIDER_KEYS:
      prefix = f"{_canonical_key(p)}:"
      if row.key.startswith(prefix):
        provider_norm = p
        break
    if provider_norm is None:
      logger.error(
        "ai_keys.delete_ai_key: user_id=%s key_id=%s could_not_infer_provider key=%s",
        current_user.id,
        key_id,
        row.key,
      )
      raise HTTPException(status_code=400, detail="Could not infer provider for this key")

    canonical = _canonical_key(provider_norm)
    return provider_norm, canonical, row

  provider_norm, canonical, managed_row = find_row()

  logger.info(
    "ai_keys.delete_ai_key: user_id=%s key_id=%s provider=%s row_id=%s",
    current_user.id,
    key_id,
    provider_norm,
    managed_row.id,
  )

  # Check if this key is currently active
  canonical_row = (
    db.query(UserConfig)
    .filter(UserConfig.user_id == current_user.id, UserConfig.key == canonical)
    .first()
  )
  was_active = bool(
    canonical_row
    and canonical_row.value
    and managed_row.value
    and canonical_row.value == managed_row.value
  )

  db.delete(managed_row)

  if was_active:
    # Find another key for this provider to promote, if any
    replacement = (
      db.query(UserConfig)
      .filter(
        UserConfig.user_id == current_user.id,
        UserConfig.key.like(f"{canonical}:%"),
      )
      .first()
    )
    if replacement and replacement.value:
      if canonical_row:
        canonical_row.value = replacement.value
      else:
        db.add(
          UserConfig(
            user_id=current_user.id,
            key=canonical,
            value=replacement.value,
          )
        )
    else:
      # No remaining keys; clear canonical
      if canonical_row:
        canonical_row.value = None

  db.commit()
  return {"message": "API key deleted"}


# NOTE: override legacy helper with a no-op to avoid SQLite locking from
# writes inside GET handlers. The original implementation above remains in
# the file but this definition is the one actually used at runtime.
def _ensure_legacy_migrated(db: Session, user_id: int, provider: str) -> None:  # type: ignore[override]
  """No-op placeholder; GET /user/ai-keys is now read-only."""
  return

