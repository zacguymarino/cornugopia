from game_state import Stone, GameState
import json
import random
import uuid
import redis
from fastapi import HTTPException
from redis_client import redis_client
from sqlalchemy import delete
from db import async_session
from models import PublicGame

#########################
### JOIN GAME UTILITY ###
#########################

def do_join(game_id: str, incoming_player_id: str | None = None, estimated_rank: str | None = None) -> str:
    """
    Core join logic: slots a player into the GameState in Redis,
    applies handicaps, publishes updates, and returns the final player_id.
    Raises HTTPException on any error (404, full game, missing rank, etc.).
    """
    key = f"game:{game_id}"
    pipe = redis_client.pipeline()
    try:
        pipe.watch(key)

        raw = redis_client.get(key)
        if not raw:
            raise HTTPException(404, "Game not found or expired")

        game = GameState.from_dict(json.loads(raw))

        # Re-connect case
        if incoming_player_id and incoming_player_id in game.players:
            return incoming_player_id

        # Full game?
        if len(game.players) >= 2:
            raise HTTPException(400, "Game is full")

        # New player ID
        player_id = incoming_player_id or str(uuid.uuid4())[:8]

        # Handicap rank required?
        if getattr(game, "allow_handicaps", False) and not estimated_rank:
            raise HTTPException(400, "Estimated rank is required for handicap games")

        # Slot color for first vs second
        if len(game.players) == 0:
            # first slot
            if game.color_preference == "random":
                color = random.choice([Stone.BLACK, Stone.WHITE])
                game.players[player_id] = color.value
            else:
                pref = Stone.BLACK.value if game.color_preference == "black" else Stone.WHITE.value
                game.players[player_id] = pref
        else:
            # second slot
            existing_id = next(iter(game.players))
            existing_color = game.players[existing_id]
            new_color = Stone.BLACK if existing_color == Stone.WHITE.value else Stone.WHITE
            game.players[player_id] = new_color.value

        # Apply handicap stones if needed
        if getattr(game, "allow_handicaps", False):
            if not getattr(game, "estimated_ranks", None):
                game.estimated_ranks = {}
            game.estimated_ranks[player_id] = estimated_rank

            if len(game.players) == 2 and len(game.estimated_ranks) == 2:
                # finalize handicap logic exactly as before...
                pids = list(game.players.keys())
                r1 = rank_to_number(game.estimated_ranks[pids[0]])
                r2 = rank_to_number(game.estimated_ranks[pids[1]])
                if r1 is None or r2 is None:
                    raise HTTPException(400, "Invalid rank provided")
                diff = abs(r1 - r2)
                game.handicap_stones = min(diff, 9)

                # assign weaker player Black
                if r1 > r2:
                    game.players[pids[0]] = Stone.WHITE.value
                    game.players[pids[1]] = Stone.BLACK.value
                else:
                    game.players[pids[0]] = Stone.BLACK.value
                    game.players[pids[1]] = Stone.WHITE.value

                place_handicap_stones(game)

        # Initialize time_left if time control and second joined
        if game.time_control != "none" and len(game.players) == 2:
            try:
                default_time = int(game.time_control)
            except:
                default_time = 300
            for pid in game.players:
                game.time_left.setdefault(pid, default_time)

        # Commit atomically
        pipe.multi()
        pipe.set(key, json.dumps(game.to_dict()))
        pipe.execute()

        # Publish to subscribers if game is now full
        if len(game.players) == 2:
            redis_client.publish(
                f"game_updates:{game_id}",
                json.dumps({"type": "game_state", "payload": game.to_dict()})
            )

        return player_id

    except redis.WatchError:
        raise HTTPException(409, "Conflict: Game state changed. Try again.")
    finally:
        pipe.reset()

###########################
### Remove Game From DB ###
###########################
async def remove_public_game(game_id: str):
    async with async_session() as session:
        await session.execute(
            delete(PublicGame).where(PublicGame.id == game_id)
        )
        await session.commit()

########################
### Handicap Utility ###
########################
def place_handicap_stones(game):

    star_points_by_size = {
        9: [(2, 6), (6, 2), (2, 2), (6, 6), (2, 4), (6, 4), (4, 2), (4, 6), (4, 4)],  # Corrected
        13: [(3, 9), (9, 3), (3, 3), (9, 9), (3, 6), (9, 6), (6, 3), (6, 9), (6, 6)],
        19: [(3, 15), (15, 3), (3, 3), (15, 15), (3, 9), (15, 9), (9, 3), (9, 15), (9, 9)]
    }

    size = game.board_size
    if size not in star_points_by_size:
        return  # Unknown board size, do nothing

    # Correct order of stone placement based on number of stones
    order_for_stones = [
        [0, 1],                      # 2 stones
        [0, 1, 2],                   # 3 stones
        [0, 1, 2, 3],                # 4 stones
        [0, 1, 2, 3, 8],             # 5 stones (center added)
        [0, 1, 2, 3, 4, 5],          # 6 stones (left middle and right middle)
        [0, 1, 2, 3, 4, 5, 8],       # 7 stones (6 plus center)
        [0, 1, 2, 3, 4, 5, 6, 7],    # 8 stones (6 plus top middle and bottom middle)
        [0, 1, 2, 3, 4, 5, 6, 7, 8], # 9 stones (all star points)
    ]

    num_stones = min(game.handicap_stones, 9)

    if num_stones < 2:
        return  # Handicap usually starts at 2 stones minimum

    selected_indices = order_for_stones[num_stones - 2]  # 2 stones => index 0

    star_points = star_points_by_size[size]

    game.handicap_placements = []

    for idx in selected_indices:
        x, y = star_points[idx]
        index = y * size + x  # (row * board_size + column)
        game.board_state[index] = Stone.BLACK.value
        game.handicap_placements.append(index)

    # After placing handicap stones, it becomes White's turn
    game.current_turn = Stone.WHITE

###############################
### Rank Conversion Utility ###
###############################

RANK_TO_NUMBER = {}

# Fill in kyu ranks (30k to 1k → 0 to 29)
for i in range(30, 0, -1):
    RANK_TO_NUMBER[f"{i}k"] = 30 - i

# Fill in dan ranks (1d to 9d → 30 to 38)
for i in range(1, 10):
    RANK_TO_NUMBER[f"{i}d"] = 29 + i  # 1d -> 30, 2d -> 31, ..., 9d -> 38

# Fill in pro dan ranks (1p to 9p → 39 to 47)
for i in range(1, 10):
    RANK_TO_NUMBER[f"{i}p"] = 38 + i  # 1p -> 39, 2p -> 40, ..., 9p -> 47

def rank_to_number(rank: str) -> int:
    rank = rank.strip().lower()
    return RANK_TO_NUMBER.get(rank)