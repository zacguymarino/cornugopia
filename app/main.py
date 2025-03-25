from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import time
import random
import asyncio
import uuid
import redis
import json
from game_state import GameState, Stone

app = FastAPI()

app.mount("/static", StaticFiles(directory="/app/static"), name="static")

templates = Jinja2Templates(directory="/app/templates")

redis_client = redis.Redis(host="redis", port=6379, decode_responses=True)

class CreateGameRequest(BaseModel):
    board_size: int

### STARTUP WORKER ###

@app.on_event("startup")
async def start_disconnect_checker():
    async def disconnect_checker():
        while True:
            now = time.time()

            for game_id, players in list(disconnect_times.items()):
                for player_id, disconnect_time in list(players.items()):
                    if now - disconnect_time > 60:
                        print(f"⏱️ Player {player_id} in game {game_id} has been disconnected for over 60 seconds. Auto-resigning...")

                        game_data = redis_client.get(f"game:{game_id}")
                        if not game_data:
                            continue

                        game = GameState.from_dict(json.loads(game_data))
                        if not game.game_over:
                            game.end_game(reason="resign", resigned_player=player_id)
                            redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
                            redis_client.publish(f"game_updates:{game_id}", json.dumps(game.to_dict()))

                        # Remove the player from disconnect_times after action
                        del disconnect_times[game_id][player_id]

                # If no players left to track, clean up the game entry
                if not disconnect_times[game_id]:
                    del disconnect_times[game_id]

            await asyncio.sleep(5)  # Check every 5 seconds

    asyncio.create_task(disconnect_checker())


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

        if board_size not in [9, 13, 19]:
            raise HTTPException(status_code=400, detail="Invalid board size")

        game_id = str(uuid.uuid4())[:8]
        game = GameState(board_size)

        redis_client.setex(f"game:{game_id}", 300, json.dumps(game.to_dict()))
        return {"game_id": game_id}

    except ValueError:
        print("Error: board_size is not a valid integer")
        raise HTTPException(status_code=400, detail="Invalid board size format")

    except Exception as e:
        print(f"Error in /create_game: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/game/{game_id}/join")
def join_game(game_id: str):
    with redis_client.pipeline() as pipe:  # Start Redis transaction
        try:
            # Watch the key for changes (optimistic locking)
            pipe.watch(f"game:{game_id}")

            # Fetch game state
            game_data = redis_client.get(f"game:{game_id}")
            if not game_data:
                raise HTTPException(status_code=404, detail="Game not found or expired")

            game = GameState.from_dict(json.loads(game_data))

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

        # Determine player's color
        player_color = Stone(game.players[player_id])

        # Attempt to make the move
        if game.is_valid_move(index, player_color):
            game.make_move(index, player_color)
        else:
            raise HTTPException(status_code=400, detail="Invalid move")

        with redis_client.pipeline() as pipe:
            pipe.set(f"game:{game_id}", json.dumps(game.to_dict()))
            pipe.publish(f"game_updates:{game_id}", json.dumps(game.to_dict()))
            pipe.execute()  # Execute both commands atomically

        return {"message": "Move successful"}

    except Exception as e:
        print(f"Error in /move: {e}")
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
disconnect_times = {}

@app.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str, player_id: str = Query(None)):
    await websocket.accept()
    print(f"✅ WebSocket connected for game {game_id} by player {player_id}")

    # Store WebSocket connection
    active_connections.setdefault(game_id, {})[player_id] = websocket
    # Remove any previous disconnect timestamp if reconnecting
    disconnect_times.get(game_id, {}).pop(player_id, None)

    # Subscribe to Redis Pub/Sub for game updates
    pubsub = redis_client.pubsub()
    pubsub.subscribe(f"game_updates:{game_id}")
    print(f"👂 Listening for Redis updates for game {game_id}")

    async def redis_listener():
        try:
            while True:
                message = pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    game_update = message["data"]
                    print(f"📩 Redis sent update: {game_update}")

                    # Send update to all connected players
                    for conn in list(active_connections.get(game_id, {}).values()):
                        try:
                            await conn.send_text(game_update)
                        except Exception as e:
                            print(f"WebSocket send failed: {e}")
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            print(f"🛑 Redis listener cancelled for game {game_id}")
            pubsub.close()

    try:
        task = asyncio.create_task(redis_listener())
        await websocket.receive_text()  # Keep connection open

    except WebSocketDisconnect:
        print(f"❌ WebSocket disconnected for game {game_id}, player {player_id}")

        if player_id and player_id in active_connections.get(game_id, {}):
            del active_connections[game_id][player_id]

        disconnect_times.setdefault(game_id, {})[player_id] = time.time()
        print(f"⏳ Stored disconnect timestamp for {player_id} in game {game_id}")

        if not active_connections[game_id]:
            del active_connections[game_id]

        task.cancel()

# @app.websocket("/ws/{game_id}")
# async def websocket_endpoint(websocket: WebSocket, game_id: str):
#     await websocket.accept()
#     print(f"WebSocket connected for game {game_id}")

#     # Store WebSocket connection
#     if game_id not in active_connections:
#         active_connections[game_id] = set()
#     active_connections[game_id].add(websocket)

#     # Subscribe to Redis Pub/Sub for game updates (NO `await` here)
#     pubsub = redis_client.pubsub()
#     pubsub.subscribe(f"game_updates:{game_id}")
#     print(f"Listening for Redis updates for game {game_id}")

#     async def redis_listener():
#         """Listens for updates from Redis and sends them via WebSockets."""
#         try:
#             while True:
#                 message = pubsub.get_message(ignore_subscribe_messages=True)
#                 if message:
#                     game_update = message["data"]
#                     print(f"Redis sent update: {game_update}")

#                     # Send update to all connected WebSockets
#                     for conn in list(active_connections.get(game_id, [])):
#                         try:
#                             await conn.send_text(game_update)
#                         except Exception as e:
#                             print(f"WebSocket failed: {e}. Removing connection...")
#                             active_connections[game_id].remove(conn)

#                 await asyncio.sleep(0.1)  # Prevent CPU overuse

#         except asyncio.CancelledError:
#             print(f"Stopping Redis listener for game {game_id}")
#             pubsub.close()

#     try:
#         # Start the Redis listener task
#         task = asyncio.create_task(redis_listener())

#         # Wait for WebSocket messages (keeps connection alive)
#         await websocket.receive_text()

#     except WebSocketDisconnect:
#         print(f"WebSocket disconnected for game {game_id}")
#         active_connections[game_id].remove(websocket)
#         if not active_connections[game_id]:  # Remove game if no players are left
#             del active_connections[game_id]
#         task.cancel()  # Stop listening to Redis updates