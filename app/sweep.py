import asyncio
import time
import json

from sqlalchemy import select, delete
from db import async_session
from models import PublicGame

async def sweep_stale_games(
    redis_client,
    sweep_interval_secs: int = 3600,
    stale_threshold_secs: int = 86400,
):
    """
    Periodically:
    1) Delete any Redis `game:<id>` older than `stale_threshold_secs` seconds.
    2) Delete any PublicGame rows whose Redis key no longer exists.

    Args:
        redis_client: A Redis client instance supporting scan_iter, get, delete, exists.
        sweep_interval_secs: How often (in seconds) to run this sweep.
        stale_threshold_secs: Age threshold (in seconds) after which a Redis game is considered stale.
    """
    while True:
        now = time.time()

        # 1) EXPIRE STALE REDIS GAMES
        for redis_key in redis_client.scan_iter(match="game:*"):
            if isinstance(redis_key, bytes):
                key_str = redis_key.decode()
            else:
                key_str = redis_key

            try:
                _, game_id = key_str.split(":", 1)
            except Exception:
                continue

            game_data_raw = redis_client.get(redis_key)
            if not game_data_raw:
                continue

            try:
                game_dict = json.loads(game_data_raw)
            except Exception:
                # Invalid JSON: remove the key outright
                redis_client.delete(f"game:{game_id}")
                redis_client.delete(f"disconnect:{game_id}")
                continue

            # If 'created_at' not set, treat as just-created (so age=0)
            created_ts = game_dict.get("created_at", now - stale_threshold_secs - 1)
            try:
                created_ts = float(created_ts)
            except Exception:
                created_ts = now

            age = now - created_ts

            if age > stale_threshold_secs:
                # Delete stale game from Redis
                redis_client.delete(f"game:{game_id}")
                redis_client.delete(f"disconnect:{game_id}")

        for dis_key in redis_client.scan_iter(match="disconnect:*"):
            key_str = dis_key.decode() if isinstance(dis_key, bytes) else dis_key
            _, game_id = key_str.split(":", 1)
            if not redis_client.exists(f"game:{game_id}"):
                # No corresponding game, so delete this stray disconnect hash
                redis_client.delete(f"disconnect:{game_id}")

        # 2) REMOVE ORPHANED PUBLICGAME ROWS
        async with async_session() as session:
            result = await session.execute(select(PublicGame.id))
            public_ids = [row[0] for row in result.all()]

            for pub_id in public_ids:
                if not redis_client.exists(f"game:{pub_id}"):
                    await session.execute(
                        delete(PublicGame).where(PublicGame.id == pub_id)
                    )

            await session.commit()

        # Sleep until the next sweep
        await asyncio.sleep(sweep_interval_secs)
