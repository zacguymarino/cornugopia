import asyncio
import time
import json

from typing import Dict
from game_state import GameState  # Adjust path if needed

# Running timer coroutines per game
timer_tasks: Dict[str, asyncio.Task] = {}

async def track_game(game_id: str, redis_client):
    """
    Coroutine to track disconnect timers for a specific game.
    Will later be expanded to handle time controls too.
    """
    print(f"Started tracking timer for game {game_id}")
    try:
        while True:
            now = time.time()
            players = redis_client.hgetall(f"disconnect:{game_id}")

            game_data = redis_client.get(f"game:{game_id}")
            if not game_data:
                print(f"Game {game_id} not found in Redis. Stopping timer.")
                break  # Exit if the game no longer exists

            game = GameState.from_dict(json.loads(game_data))

            if game.game_over and not game.in_scoring_phase:
                # Game is over – wait until both players are disconnected
                if len(players) >= len(game.players):
                    print(f"All players disconnected from finished game {game_id}. Cleaning up...")
                    redis_client.delete(f"game:{game_id}")
                    redis_client.delete(f"disconnect:{game_id}")
                    break  # Exit coroutine after full cleanup

                # Game is over, but someone is still reviewing
                await asyncio.sleep(1)
                continue

            # Game is NOT over – check for disconnection timeouts
            for player_id, disconnect_time_str in players.items():
                disconnect_time = float(disconnect_time_str)

                if now - disconnect_time > 60:
                    print(f"Player {player_id} timed out in game {game_id}")
                    
                    game.end_game(reason="resign", resigned_player=player_id)
                    redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
                    redis_client.publish(f"game_updates:{game_id}", json.dumps({
                        "type": "game_state",
                        "payload": game.to_dict()
                    }))

            # Time control logic
            if game.time_control != "none" and len(game.players) == 2 and not game.in_scoring_phase:
                current_player = next(
                    (pid for pid, color in game.players.items() if color == game.current_turn.value),
                    None
                )
                
                if current_player:
                    # Initialize time_left dict if missing
                    if current_player not in game.time_left:
                        try:
                            default_time = int(game.time_control)
                        except ValueError:
                            default_time = 300  # Fallback to 5 minutes
                        game.time_left[current_player] = default_time

                    # Tick down 1 second per loop
                    game.time_left[current_player] = max(0, game.time_left[current_player] - 1)

                    if game.time_left[current_player] <= 0:
                        print(f"Player {current_player} ran out of time in game {game_id}")
                        game.end_game(reason="timeout", resigned_player=current_player)

                        redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))
                        redis_client.publish(f"game_updates:{game_id}", json.dumps({
                            "type": "game_state",
                            "payload": game.to_dict()
                        }))

                # Save updated time if game is still active
                redis_client.set(f"game:{game_id}", json.dumps(game.to_dict()))

                # Always publish, even if no timeout occurred
                redis_client.publish(f"game_updates:{game_id}", json.dumps({
                    "type": "game_state",
                    "payload": game.to_dict()
                }))

            await asyncio.sleep(1)

    except asyncio.CancelledError:
        print(f"Timer task cancelled for game {game_id}")

    finally:
        timer_tasks.pop(game_id, None)


def start_timer_for_game(game_id: str, redis_client):
    """Starts a coroutine to track a game's timers if not already running."""
    if game_id not in timer_tasks:
        timer_tasks[game_id] = asyncio.create_task(track_game(game_id, redis_client))


def stop_timer_for_game(game_id: str):
    """Cancels the timer coroutine for a game."""
    task = timer_tasks.pop(game_id, None)
    if task:
        task.cancel()


def record_disconnect_time(game_id: str, player_id: str, redis_client):
    redis_client.hset(f"disconnect:{game_id}", player_id, time.time())


def clear_disconnect_time(game_id: str, player_id: str, redis_client):
    redis_client.hdel(f"disconnect:{game_id}", player_id)

def clear_all_disconnects(game_id: str, redis_client):
    redis_client.delete(f"disconnect:{game_id}")
