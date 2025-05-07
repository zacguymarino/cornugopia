from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import time
import asyncio
import uuid
import redis
import json
from game_state import GameState, Stone
from game_helper import do_join
from timers import record_disconnect_time, clear_disconnect_time, clear_all_disconnects, start_timer_for_game, start_join_timeout_for_game, join_timeout_tasks
from better_profanity import profanity
from db import async_session
from models import PublicGame
from redis_client import redis_client

app = FastAPI()

app.mount("/static", StaticFiles(directory="/app/static"), name="static")

templates = Jinja2Templates(directory="/app/templates")

profanity.load_censor_words()

class CreateGameRequest(BaseModel):
    board_size: int

### ROUTES ###

@app.get("/")
def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/game/{game_id}")
def get_game(request: Request, game_id: str):
    game_data = redis_client.get(f"game:{game_id}")
    if not game_data:
        raise HTTPException(status_code=404, detail="Game not found")

    return templates.TemplateResponse("game.html", {"request": request, "game_id": game_id})


### ENDPOINTS ###

@app.post("/create_game")
async def create_game(request: Request):
    try:
        data = await request.json()
        board_size = int(data.get("board_size"))
        incoming_player_id = data.get("player_id")
        time_control = data.get("time_control", "none")
        komi = float(data.get("komi", 6.5))
        rule_set = data.get("rule_set", "japanese")
        color_preference = data.get("color_preference", "random")
        allow_handicaps = data.get("allow_handicaps", False)
        byo_yomi_periods = int(data.get("byo_yomi_periods", 0))
        byo_yomi_time = int(data.get("byo_yomi_time", 0))
        game_type = data.get("game_type", "private")
        creator_rank = data.get("creator_rank", None)

        if board_size not in [9, 13, 19]:
            raise HTTPException(status_code=400, detail="Invalid board size")

        if rule_set not in ["japanese", "chinese"]:
            raise HTTPException(status_code=400, detail="Invalid rule set")

        valid_times = {"none", "300", "600", "900", "1800", "3600", "7200", "15"}
        if time_control not in valid_times:
            raise HTTPException(status_code=400, detail="Invalid time control setting")

        if komi < 0.5 or komi > 50:
            raise HTTPException(status_code=400, detail="Invalid komi value")

        if color_preference not in ["random", "black", "white"]:
            raise HTTPException(status_code=400, detail="Invalid color preference")

        if byo_yomi_periods not in [0, 1, 2, 3, 4, 5]:
            raise HTTPException(status_code=400, detail="Invalid byo-yomi periods")

        if byo_yomi_time < 0 or byo_yomi_time > 60 or byo_yomi_time % 5 != 0:
            raise HTTPException(status_code=400, detail="Invalid byo-yomi time")

        if game_type not in ["private", "public"]:
            raise HTTPException(status_code=400, detail="Invalid game type")

        # Assign or reuse player_id
        player_id = incoming_player_id or str(uuid.uuid4())[:8]

        # Create a new game with time control
        game_id = str(uuid.uuid4())[:8]
        game = GameState(board_size, time_control=time_control, komi=komi, rule_set=rule_set)

        # Set internal fields for game
        game.game_type = game_type
        game.set_created_by(player_id)
        game.set_color_preference(color_preference)
        game.set_colors_randomized(color_preference == "random")
        game.set_allow_handicaps(allow_handicaps)
        game.byo_yomi_periods = byo_yomi_periods
        game.byo_yomi_time = byo_yomi_time

        # Store game in Redis
        redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
        # Start join timer coroutine
        start_join_timeout_for_game(game_id, redis_client, timeout_seconds=600)


        if game_type == "public":
            if allow_handicaps and not creator_rank:
                raise HTTPException(status_code=400, detail="Estimated rank is required for handicap games")

            do_join(game_id, player_id, creator_rank)

            async with async_session() as session:
                new_game = PublicGame(
                    id=game_id,
                    board_size=board_size,
                    created_by=player_id,
                    rule_set=rule_set,
                    komi=komi,
                    time_control=time_control,
                    byo_yomi_periods=byo_yomi_periods,
                    byo_yomi_time=byo_yomi_time,
                    color_preference=color_preference,
                    allow_handicaps=allow_handicaps
                )
                session.add(new_game)
                await session.commit()

        return {
            "game_id": game_id,
            "player_id": player_id
        }

    except ValueError:
        print("Error: board_size is not a valid integer")
        raise HTTPException(status_code=400, detail="Invalid board size format")

    except Exception as e:
        print(f"Error in /create_game: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/game/{game_id}/join")
async def join_game(game_id: str, request: Request):
    data = await request.json()
    player_id = do_join(
        game_id,
        incoming_player_id=data.get("player_id"),
        estimated_rank=data.get("estimated_rank")
    )
    return {"message": "Joined successfully", "player_id": player_id}

@app.post("/game/{game_id}/move")
async def make_move(game_id: str, request: Request):
    try:
        data = await request.json()
        player_id = data.get("player_id")
        index = data.get("index")

        # Validate request
        if not player_id or index is None:
            raise HTTPException(status_code=400, detail="Missing player_id or index")

        # Fetch game from Redis
        game_data = redis_client.get(f"game:{game_id}")
        if not game_data:
            raise HTTPException(status_code=404, detail="Game not found")

        game = GameState.from_dict(json.loads(game_data))

        # Validate player
        if player_id not in game.players:
            raise HTTPException(status_code=403, detail="You are not part of this game")

        # Validate both players are connected
        if index != -2:
            if len(game.players) < 2:
                raise HTTPException(status_code=400, detail="Waiting for the second player to join")

        # Determine player's color
        player_color = Stone(game.players[player_id])

        # Attempt to make the move
        if game.is_valid_move(index, player_color):
            game.make_move(index, player_color)
            game.moves.append({
                "index": index,
                "color": player_color.value,
                "timestamp": time.time()
            })
            #Reset byo-yomi if needed
            if game.byo_yomi_periods > 0:
                game.byo_yomi_time_left[player_id] = game.byo_yomi_time
        else:
            raise HTTPException(status_code=400, detail="Invalid move")

        with redis_client.pipeline() as pipe:
            pipe.set(f"game:{game_id}", json.dumps(game.to_dict()))
            pipe.publish(
                f"game_updates:{game_id}",
                json.dumps({
                    "type": "game_state",
                    "payload": game.to_dict()
                })
            )
            pipe.execute()  # Execute both commands atomically

        #Handle game over
        if game.game_over:
            clear_all_disconnects(game_id, redis_client)

        return {"message": "Move successful"}

    except Exception as e:
        print(f"Error in /move: {e}")
        traceback.print_exc()  # Show full stack trace
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/game/{game_id}/state")
async def get_game_state(game_id: str):
    game_data = redis_client.get(f"game:{game_id}")
    if not game_data:
        raise HTTPException(status_code=404, detail="Game not found")

    game = GameState.from_dict(json.loads(game_data))
    return game.to_dict()

###################################################
### Websocket endpoint and connection functions ###
###################################################

def add_active_connection(game_id: str, player_id: str):
    redis_client.sadd(f"ws_connections:{game_id}", player_id)

def remove_active_connection(game_id: str, player_id: str):
    redis_client.srem(f"ws_connections:{game_id}", player_id)

def get_active_connections(game_id: str) -> set:
    return redis_client.smembers(f"ws_connections:{game_id}")

# Store process-local connected players
local_sockets = {}  # Key: (game_id, player_id), Value: websocket instance

@app.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, player_id: str = Query(None)):
    connection_id = str(uuid.uuid4())
    await websocket.accept()
    print(f"WebSocket connected for game {game_id} by player {player_id}")

    # Start timer coroutine
    start_timer_for_game(game_id, redis_client)

    #Handle disconnect tracking on websocket connection
    clear_disconnect_time(game_id, player_id, redis_client)

    # Notify others that this player reconnected
    reconnect_notice = {
        "type": "reconnect_notice",
        "player_id": player_id
    }
    redis_client.publish(f"game_updates:{game_id}", json.dumps(reconnect_notice))

    # Store local WebSocket connection
    local_sockets[(game_id, player_id)] = websocket
    add_active_connection(game_id, player_id)

    # Subscribe to Redis Pub/Sub for game updates
    pubsub = redis_client.pubsub()
    pubsub.subscribe(f"game_updates:{game_id}")
    print(f"Listening for Redis updates for game {game_id}")

    async def redis_listener():
        try:
            while True:
                message = pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    raw = message["data"]
                    parsed = json.loads(raw)

                    # Skip echo of this client's own message
                    if parsed.get("type") == "chat" and parsed.get("source") == connection_id:
                        continue

                    # Send update to all connected players
                    for (gid, pid), conn in list(local_sockets.items()):
                        if gid == game_id:
                            try:
                                await conn.send_text(json.dumps(parsed))
                            except Exception as e:
                                print(f"WebSocket send failed: {e}")
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            print(f"Redis listener cancelled for game {game_id}")
            pubsub.close()

    try:
        task = asyncio.create_task(redis_listener())
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)

                # Handle dead stone toggling & seki eyes for japanese scoring
                if message["type"] == "toggle_dead_stone":
                    group = message.get("group", [])
                    pid = message["player_id"]

                    # Fetch current game
                    game_data = redis_client.get(f"game:{game_id}")
                    if not game_data:
                        continue

                    game = GameState.from_dict(json.loads(game_data))
                    color = game.players.get(pid)

                    if color == Stone.BLACK.value:
                        dead_list = set(game.dead_black or [])
                    else:
                        dead_list = set(game.dead_white or [])

                    group_set = set(group)
                    if group_set.issubset(dead_list):
                        # If all in group are already dead, remove them
                        dead_list -= group_set
                    else:
                        # Otherwise, add them
                        dead_list |= group_set

                    if color == Stone.BLACK.value:
                        game.dead_black = list(dead_list)
                    else:
                        game.dead_white = list(dead_list)

                    # Save updated game back to Redis
                    redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))

                    # Broadcast the toggle to the other player
                    payload = {
                        "type": "toggle_dead_stone",
                        "index": list(group_set),
                        "player_id": pid,
                        "payload": game.to_dict()
                    }
                    redis_client.publish(f"game_updates:{game_id}", json.dumps(payload))

                elif message["type"] == "finalize_score":
                    pid = message["player_id"]
                    game_data = redis_client.get(f"game:{game_id}")
                    if not game_data:
                        continue

                    game = GameState.from_dict(json.loads(game_data))

                    if not hasattr(game, "finalized_players"):
                        game.finalized_players = []

                    if pid not in game.finalized_players:
                        game.finalized_players.append(pid)
                        print(f"Player {pid} finalized their score in game {game_id}")

                    # Check if both players finalized and selections match
                    if (
                        set(game.dead_black or []) == set(game.dead_white or []) and
                        len(game.finalized_players) == 2
                    ):
                        agreed = set(game.dead_black or [])

                        # Split agreed into stones and excluded points
                        removed_stones = []
                        excluded_points = []

                        for idx in agreed:
                            color = game.board_state[idx]
                            if color in (Stone.BLACK.value, Stone.WHITE.value):
                                removed_stones.append((idx, color))
                                game.board_state[idx] = Stone.EMPTY.value
                            elif color == Stone.EMPTY.value:
                                excluded_points.append(idx)
                            # Increase captured count based on the color
                            if color == Stone.BLACK.value:
                                game.captured_white += 1
                            elif color == Stone.WHITE.value:
                                game.captured_black += 1

                        # Save for frontend review
                        game.agreed_dead = [
                            {"index": idx, "color": color}
                            for idx, color in removed_stones
                        ]
                        game.excluded_points = excluded_points

                        # Score the game based on rule set
                        rule_set = getattr(game, "rule_set", "japanese").lower()
                        if rule_set == "japanese":
                            game.final_score = game.score_game(excluded=excluded_points)
                        else:
                            game.final_score = game.score_game()  # No exclusions for Chinese rules

                        game.game_over = True
                        game.in_scoring_phase = False
                        game.game_over_reason = "double_pass"

                        # Determine winner
                        black_score, white_score = game.final_score
                        if black_score != white_score:
                            winner_color = Stone.BLACK if black_score > white_score else Stone.WHITE
                            for player_id, stone in game.players.items():
                                if stone == winner_color.value:
                                    game.winner = player_id
                                    break
                        else:
                            game.winner = None

                    # Broadcast update
                    redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
                    redis_client.publish(
                        f"game_updates:{game_id}",
                        json.dumps({
                            "type": "game_state",
                            "payload": game.to_dict()
                        })
                    )
                elif message["type"] == "chat":
                    player_id = message["player_id"]
                    text = message["text"].strip()

                    if text:
                        # Determine player's stone color
                        game_data = redis_client.get(f"game:{game_id}")
                        if not game_data:
                            continue
                        game = GameState.from_dict(json.loads(game_data))
                        color = game.players.get(player_id)

                        color_label = "Black" if color == Stone.BLACK.value else "White"

                        censoredText = profanity.censor(text)
                        redis_client.publish(
                            f"game_updates:{game_id}",
                            json.dumps({
                                "type": "chat",
                                "sender": color_label,
                                "text": censoredText,
                                "source": connection_id
                            })
                        )
            except Exception as e:
                print(f"Error handling WebSocket message: {e}")

    except WebSocketDisconnect:
        if player_id:
            local_sockets.pop((game_id, player_id), None)
            remove_active_connection(game_id, player_id)

        record_disconnect_time(game_id, player_id, redis_client)

        # Notify remaining player(s) that this player disconnected
        disconnect_notice = {
            "type": "disconnect_notice",
            "disconnected_player": player_id,
            "timestamp": time.time(),
            "timeout_seconds": 60
        }
        redis_client.publish(f"game_updates:{game_id}", json.dumps(disconnect_notice))

        task.cancel()

### DEBUG ROUTES ###
@app.get("/debug/redis")
def debug_redis_state():
    keys = redis_client.keys("*")
    redis_snapshot = {}

    for key in keys:
        key_type = redis_client.type(key)

        if key_type == "string":
            redis_snapshot[key] = redis_client.get(key)

        elif key_type == "hash":
            redis_snapshot[key] = redis_client.hgetall(key)

        elif key_type == "list":
            redis_snapshot[key] = redis_client.lrange(key, 0, -1)

        elif key_type == "set":
            redis_snapshot[key] = list(redis_client.smembers(key))

        elif key_type == "zset":
            redis_snapshot[key] = redis_client.zrange(key, 0, -1, withscores=True)

        else:
            redis_snapshot[key] = f"<Unsupported type: {key_type}>"

    redis_snapshot["join_timeout_tasks"] = list(join_timeout_tasks.keys())

    return JSONResponse(content=redis_snapshot)
