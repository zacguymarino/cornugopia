from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import traceback
import time
import random
import asyncio
import uuid
import redis
import json
from game_state import GameState, Stone
from timers import record_disconnect_time, clear_disconnect_time, clear_all_disconnects, start_timer_for_game

app = FastAPI()

app.mount("/static", StaticFiles(directory="/app/static"), name="static")

templates = Jinja2Templates(directory="/app/templates")

redis_client = redis.Redis(host="redis", port=6379, decode_responses=True)

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
        komi = float(data.get("komi", 7.5))

        if board_size not in [9, 13, 19]:
            raise HTTPException(status_code=400, detail="Invalid board size")

        valid_times = {"none", "300", "600", "900", "15"}
        if time_control not in valid_times:
            raise HTTPException(status_code=400, detail="Invalid time control setting")

        if komi < 0.5 or komi > 50:
            raise HTTPException(status_code=400, detail="Invalid komi value")

        # Assign or reuse player_id
        player_id = incoming_player_id or str(uuid.uuid4())[:8]

        # Create a new game with time control
        game_id = str(uuid.uuid4())[:8]
        game = GameState(board_size, time_control=time_control, komi=komi)

        # Store game in Redis
        redis_client.setex(f"game:{game_id}", 120, json.dumps(game.to_dict()))

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
    with redis_client.pipeline() as pipe:  # Start Redis transaction
        try:
            # Request data
            data = await request.json()
            incoming_player_id = data.get("player_id")

            # Watch the key for changes (optimistic locking)
            pipe.watch(f"game:{game_id}")

            # Fetch game state
            game_data = redis_client.get(f"game:{game_id}")
            if not game_data:
                raise HTTPException(status_code=404, detail="Game not found or expired")

            game = GameState.from_dict(json.loads(game_data))

            if incoming_player_id in game.players:
                return {
                    "message": "Reconnected successfully",
                    "player_id": incoming_player_id
                }

            if len(game.players) >= 2:
                raise HTTPException(status_code=400, detail="Game is full")

            # Generate a unique player ID
            player_id = str(uuid.uuid4())[:8]
            if len(game.players) == 0:
                # First player, randomly assign color
                player_color = random.choice([Stone.BLACK, Stone.WHITE])
                game.players[player_id] = player_color.value
            else:
                # Second player gets the remaining color
                existing_color = list(game.players.values())[0]
                player_color = Stone.BLACK if existing_color == Stone.WHITE.value else Stone.WHITE
                game.players[player_id] = player_color.value

            # If both players joined and time control is enabled, initialize time_left
            if game.time_control != "none" and len(game.players) == 2:
                try:
                    default_time = int(game.time_control)
                except ValueError:
                    default_time = 300  # Fallback to 5 minutes

                for pid in game.players:
                    if pid not in game.time_left:
                        game.time_left[pid] = default_time

            # Start transaction and attempt to store updated data
            pipe.multi()
            pipe.set(f"game:{game_id}", json.dumps(game.to_dict()))
            pipe.execute()  # Executes transaction

            return {"message": "Joined successfully", "player_id": player_id}

        except redis.WatchError:
            print("Race condition detected! Retrying join request...")
            raise HTTPException(status_code=409, detail="Conflict: Game state changed. Try again.")

        finally:
            pipe.reset()  # Always reset the pipeline

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


### Websocket endpoint ###

# Store connected players
active_connections = {}

@app.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, player_id: str = Query(None)):
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

    # Store WebSocket connection
    active_connections.setdefault(game_id, {})[player_id] = websocket

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

                    # Send update to all connected players
                    for conn in list(active_connections.get(game_id, {}).values()):
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
        #await websocket.receive_text()  # Keep connection open
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)

                # --- Handle dead stone toggling ---
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

                        # Store the agreed dead groups for frontend display
                        game.agreed_dead = []
                        for idx in agreed:
                            color = game.board_state[idx]
                            game.agreed_dead.append({
                                "index": idx,
                                "color": color
                            })
                            game.board_state[idx] = Stone.EMPTY.value  # remove from board

                        game.final_score = game.score_game()
                        game.game_over = True
                        game.in_scoring_phase = False  # Exit scoring phase
                        game.game_over_reason = "double_pass"

                        # Determine winner from score
                        black_score, white_score = game.final_score
                        if black_score != white_score:
                            winner_color = Stone.BLACK if black_score > white_score else Stone.WHITE
                            for player_id, stone in game.players.items():
                                if stone == winner_color.value:
                                    game.winner = player_id
                                    break
                        else:
                            game.winner = None  # Tie

                    # Save updated state and broadcast
                    redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
                    redis_client.publish(
                        f"game_updates:{game_id}",
                        json.dumps({
                            "type": "game_state",
                            "payload": game.to_dict()
                        })
                    )

            except Exception as e:
                print(f"Error handling WebSocket message: {e}")

    except WebSocketDisconnect:
        if player_id and player_id in active_connections.get(game_id, {}):
            del active_connections[game_id][player_id]

        record_disconnect_time(game_id, player_id, redis_client)

        # Notify remaining player(s) that this player disconnected
        disconnect_notice = {
            "type": "disconnect_notice",
            "disconnected_player": player_id,
            "timestamp": time.time(),
            "timeout_seconds": 60  # or whatever you use in track_game()
        }
        redis_client.publish(f"game_updates:{game_id}", json.dumps(disconnect_notice))

        if not active_connections[game_id]:
            del active_connections[game_id]

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

    return JSONResponse(content=redis_snapshot)
