import asyncio
import time
import json

from typing import Dict
from game_state import GameState

# Track running timers
timer_tasks: Dict[str, asyncio.Task] = {}
join_timeout_tasks: Dict[str, asyncio.Task] = {}


def start_timer_for_game(game_id: str, redis_client):
    if game_id not in timer_tasks:
        timer_tasks[game_id] = asyncio.create_task(track_game(game_id, redis_client))


def stop_timer_for_game(game_id: str):
    task = timer_tasks.pop(game_id, None)
    if task:
        task.cancel()


def record_disconnect_time(game_id: str, player_id: str, redis_client):
    redis_client.hset(f"disconnect:{game_id}", player_id, time.time())


def clear_disconnect_time(game_id: str, player_id: str, redis_client):
    redis_client.hdel(f"disconnect:{game_id}", player_id)


def clear_all_disconnects(game_id: str, redis_client):
    redis_client.delete(f"disconnect:{game_id}")

def start_join_timeout_for_game(game_id: str, redis_client, timeout_seconds: int = 600):
    if game_id not in join_timeout_tasks:
        task = asyncio.create_task(join_timeout_check(game_id, redis_client, timeout_seconds))
        join_timeout_tasks[game_id] = task


async def track_game(game_id: str, redis_client):
    print(f"Started tracking timer for game {game_id}")
    try:
        while True:
            now = time.time()
            players = redis_client.hgetall(f"disconnect:{game_id}")
            game_data = redis_client.get(f"game:{game_id}")
            if not game_data:
                print(f"Game {game_id} not found. Cleaning up timer task.")
                break

            game = GameState.from_dict(json.loads(game_data))

            # Cancel join timeout task once a player joins
            if len(game.players) >= 1 and game_id in join_timeout_tasks:
                task = join_timeout_tasks.pop(game_id)
                task.cancel()

            # Game is finished and not in review: cleanup when both disconnected
            if game.game_over and not game.in_scoring_phase:
                await handle_post_game_disconnect_cleanup(game_id, redis_client, game)
                await asyncio.sleep(1)
                continue

            # Handle disconnection timeout logic
            await handle_disconnection_timeouts(game_id, redis_client, game, now)

            # Handle active gameplay time controls
            if not game.game_over and not game.in_scoring_phase and game.time_control != "none" and len(game.players) == 2:
                await handle_time_controls(game_id, redis_client, game)

            await asyncio.sleep(1)

    except asyncio.CancelledError:
        print(f"Timer task cancelled for game {game_id}")
    finally:
        timer_tasks.pop(game_id, None)

async def join_timeout_check(game_id: str, redis_client, timeout_seconds: int):
    try:
        print(f"Started join timeout for game {game_id} with {timeout_seconds} seconds")
        await asyncio.sleep(timeout_seconds)

        game_data = redis_client.get(f"game:{game_id}")
        if not game_data:
            return

        game = GameState.from_dict(json.loads(game_data))
        if len(game.players) == 0:
            print(f"Game {game_id} was never joined. Cleaning up after timeout.")
            redis_client.delete(f"game:{game_id}")

    except asyncio.CancelledError:
        # Join timeout was cancelled because someone joined
        print(f"Join timeout for game {game_id} was cancelled.")
    finally:
        join_timeout_tasks.pop(game_id, None)

async def handle_post_game_disconnect_cleanup(game_id, redis_client, game):
    players = redis_client.hgetall(f"disconnect:{game_id}")
    if len(players) >= len(game.players):
        print(f"All players disconnected from finished game {game_id}. Cleaning up...")
        redis_client.delete(f"game:{game_id}")
        redis_client.delete(f"disconnect:{game_id}")
        raise asyncio.CancelledError


async def handle_disconnection_timeouts(game_id, redis_client, game, now):
    disconnects = redis_client.hgetall(f"disconnect:{game_id}")
    for player_id, disconnect_time_str in disconnects.items():
        disconnect_time = float(disconnect_time_str)
        if now - disconnect_time > 60:
            print(f"Player {player_id} timed out (disconnect) in game {game_id}")
            game.end_game(reason="resign", resigned_player=player_id)
            save_and_broadcast(game_id, redis_client, game)


async def handle_time_controls(game_id, redis_client, game):
    current_player = next((pid for pid, color in game.players.items() if color == game.current_turn.value), None)
    if not current_player:
        return

    # Ensure timers are initialized
    if current_player not in game.time_left:
        try:
            game.time_left[current_player] = int(game.time_control)
        except ValueError:
            game.time_left[current_player] = 300

    if game.byo_yomi_periods > 0:
        if current_player not in game.byo_yomi_time_left:
            game.byo_yomi_time_left[current_player] = game.byo_yomi_time
        if current_player not in game.periods_left:
            game.periods_left[current_player] = game.byo_yomi_periods

    if game.time_left[current_player] > 0:
        game.time_left[current_player] = max(0, game.time_left[current_player] - 1)
        if game.time_left[current_player] == 0 and game.byo_yomi_periods == 0:
            print(f"Player {current_player} ran out of main time (no byo-yomi) in game {game_id}")
            game.end_game(reason="timeout", resigned_player=current_player)
            save_and_broadcast(game_id, redis_client, game)
            return

    else:
        # Byo-yomi logic
        game.byo_yomi_time_left[current_player] -= 1
        if game.byo_yomi_time_left[current_player] <= 0:
            game.periods_left[current_player] -= 1
            if game.periods_left[current_player] <= 0:
                print(f"Player {current_player} ran out of byo-yomi in game {game_id}")
                game.end_game(reason="timeout", resigned_player=current_player)
                save_and_broadcast(game_id, redis_client, game)
                return
            else:
                game.byo_yomi_time_left[current_player] = game.byo_yomi_time

    save_and_broadcast(game_id, redis_client, game)


def save_and_broadcast(game_id, redis_client, game):
    game_json = json.dumps(game.to_dict())
    redis_client.set(f"game:{game_id}", game_json)
    redis_client.publish(f"game_updates:{game_id}", json.dumps({
        "type": "game_state",
        "payload": game.to_dict()
}))
