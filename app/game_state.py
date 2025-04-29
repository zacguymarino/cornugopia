from enum import Enum
import copy

class Stone(Enum):
    EMPTY = 0
    BLACK = 1
    WHITE = 2

class GameState:
    def __init__(self, board_size: int, time_control="none", komi=6.5, rule_set="japanese"):
        self.board_size = board_size
        self.players = {}
        self.board_state = [Stone.EMPTY.value] * (board_size * board_size)  # 1D board
        self.previous_state = copy.deepcopy(self.board_state)
        self.two_moves_ago_state = copy.deepcopy(self.board_state)
        self.current_turn = Stone.BLACK
        self.consecutive_passes = 0 
        self.captured_black = 0
        self.captured_white = 0
        self.game_over = False
        self.winner = None
        self.final_score = None
        self.game_over_reason = None
        self.resigned_player = None
        self.white_score = 0
        self.black_score = 0
        self.in_scoring_phase = False
        self.dead_black = []
        self.dead_white = []
        self.finalized_players = []
        self.time_control = time_control
        self.time_left = {}
        self.periods_left = {}
        self.byo_yomi_periods = 0
        self.byo_yomi_time = 0
        self.byo_yomi_time_left = {}
        self.komi = komi
        self.moves = []
        self.agreed_dead = []
        self.excluded_points = []
        self.rule_set = rule_set
        self.created_by = None
        self.color_preference = "random"
        self.colors_randomized = False
        self.allow_handicaps = False
        self.handicap_stones = None
        self.handicap_placements = []
        self.estimated_ranks = {}

    def set_colors_randomized(self, randomized: bool):
        self.colors_randomized = bool(randomized)

    def set_created_by(self, player_id: str):
        self.created_by = player_id

    def set_color_preference(self, preference: str):
        if preference in ["black", "white", "random"]:
            self.color_preference = preference

    def set_allow_handicaps(self, allow: bool):
        self.allow_handicaps = allow

    def mark_group_as_dead(self, index: int):
        color = self.board_state[index]
        if color == Stone.EMPTY.value:
            return  # Nothing to mark

        group = self.get_connected_group(index, color)
        for i in group:
            self.board_state[i] = Stone.EMPTY.value  # Remove the stones as if they were captured
            if color == Stone.BLACK.value:
                self.captured_white += 1
            else:
                self.captured_black += 1

    def get_connected_group(self, start: int, color: int) -> set:
        visited = set()
        stack = [start]

        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)

            for neighbor in self.get_adjacent_indices(current):
                if self.board_state[neighbor] == color:
                    stack.append(neighbor)

        return visited

    def finalize_score(self):
        self.in_scoring_phase = False
        self.final_score = self.score_game()
        black_score, white_score = self.final_score

        winner_color = (
            Stone.BLACK if black_score > white_score
            else Stone.WHITE if white_score > black_score
            else None
        )

        if winner_color:
            for pid, color_val in self.players.items():
                if color_val == winner_color.value:
                    self.winner = pid
                    break
        else:
            self.winner = None

        self.game_over = True
        self.game_over_reason = "scored"

    def check_capture(self, index: int, color: Stone):
        opponent = Stone.BLACK if color == Stone.WHITE else Stone.WHITE

        for neighbor in self.get_adjacent_indices(index):
            if self.board_state[neighbor] == opponent.value:
                group = set()
                if self.count_liberties(neighbor, group, opponent) == 0:
                    self.remove_group(group)

    def remove_group(self, group: set):
        for index in group:
            if self.board_state[index] == Stone.BLACK.value:
                self.captured_black += 1
            elif self.board_state[index] == Stone.WHITE.value:
                self.captured_white += 1
            self.board_state[index] = Stone.EMPTY.value  # Remove stones

    def end_game(self, reason="double_pass", resigned_player=None):
        self.game_over = True
        self.game_over_reason = reason
        if reason in ("resign", "timeout") and resigned_player:
            if self.in_scoring_phase:
                self.in_scoring_phase = False  # End scoring phase if resignation occurs
            self.resigned_player = resigned_player
            # Find the opponent by checking who is not the resigning player
            opponent_ids = [pid for pid in self.players if pid != resigned_player]
            self.winner = opponent_ids[0] if opponent_ids else None

        elif reason == "double_pass":
            self.in_scoring_phase = True

    def make_move(self, index: int, color: Stone):
        if index == -2:
            # Find the resigning player's ID from the color
            resigned_player = next((pid for pid, c in self.players.items() if c == color.value), None)
            self.end_game(reason="resign", resigned_player=resigned_player)
            return  # Exit early; no further moves after resignation

        if index == -1:
            self.consecutive_passes += 1
        else:
            self.two_moves_ago_state = copy.deepcopy(self.previous_state)
            self.previous_state = copy.deepcopy(self.board_state)
            self.board_state[index] = color.value
            self.check_capture(index, color)
            self.consecutive_passes = 0

        if self.consecutive_passes >= 2:
            self.end_game(reason="double_pass")

        self.current_turn = Stone.BLACK if color == Stone.WHITE else Stone.WHITE


    def is_valid_move(self, index: int, color: Stone) -> bool:
        if self.game_over:
            print("Illegal move: The game is over.")
            return False
        if index == -2:
            return True  # Resignation move
        if color != self.current_turn:
            print(f"Illegal move: It's not {color.name}'s turn")
            return False
        if index == -1:  # Passing move
            return True
        if self.is_in_bounds(index):
            if self.is_unoccupied(index):
                if not self.is_suicidal(index, color):
                    if not self.check_ko():
                        return True
                    else:
                        print("Illegal move: Ko rule")
                else:
                    print("Illegal move: Suicidal")
            else:
                print("Illegal move: Occupied")
        else:
            print("Illegal move: Out of bounds")
        return False

    def is_in_bounds(self, index: int) -> bool:
        return 0 <= index < self.board_size * self.board_size

    def is_unoccupied(self, index: int) -> bool:
        return self.board_state[index] == Stone.EMPTY.value

    def check_ko(self) -> bool:
        if all(stone == Stone.EMPTY.value for stone in self.board_state):
            return False  # No stones = no Ko rule
        return self.board_state == self.two_moves_ago_state

    def is_suicidal(self, index: int, color: Stone) -> bool:
        visited = set()
        liberties = self.count_liberties(index, visited, color)
        capture = self.would_capture(index, color)
        return liberties == 0 and not capture  # Move is valid if it captures

    def would_capture(self, index: int, color: Stone) -> bool:
        opponent = Stone.BLACK if color == Stone.WHITE else Stone.WHITE
        captured = False

        # Temporarily place the stone
        self.board_state[index] = color.value

        for neighbor in self.get_adjacent_indices(index):
            if self.board_state[neighbor] == opponent.value:
                visited = set()
                if self.count_liberties(neighbor, visited, opponent) == 0:
                    captured = True  # At least one opponent group is captured

        # Restore board state (undo temporary move)
        self.board_state[index] = Stone.EMPTY.value

        return captured


    def count_liberties(self, index: int, visited: set, color: Stone = Stone.EMPTY) -> int:
        stack = [index]
        visited.add(index)
        liberties = set()
        #liberties = 0

        while stack:
            current = stack.pop()

            for neighbor in self.get_adjacent_indices(current):
                if neighbor in visited:
                    continue  # Skip already visited positions

                if self.board_state[neighbor] == Stone.EMPTY.value and neighbor not in liberties:
                    liberties.add(neighbor)
                elif self.board_state[neighbor] == color.value:  # Same color as the original stone
                    stack.append(neighbor)
                    visited.add(neighbor)
        return len(liberties)

    def score_game(self, excluded: list[int] = None) -> tuple:
        black_territory = 0
        white_territory = 0
        visited = set()
        excluded = set(excluded or [])

        for i in range(self.board_size * self.board_size):
            if i in excluded:
                continue  # Skip seki points excluded from scoring (Japanese only)

            if self.board_state[i] == Stone.EMPTY.value and i not in visited:
                owner, size = self.count_territory(i, visited, excluded)
                if owner == Stone.BLACK:
                    black_territory += size
                elif owner == Stone.WHITE:
                    white_territory += size

        if self.rule_set == "japanese":
            # Japanese rules: territory + captured prisoners
            final_black_score = black_territory + self.captured_white
            final_white_score = white_territory + self.captured_black + self.komi
        else:
            # Chinese rules: territory + number of living stones (area scoring)
            black_stones = sum(1 for s in self.board_state if s == Stone.BLACK.value)
            white_stones = sum(1 for s in self.board_state if s == Stone.WHITE.value)

            final_black_score = black_territory + black_stones
            final_white_score = white_territory + white_stones + self.komi

        return final_black_score, final_white_score

    def count_territory(self, start: int, visited: set, excluded: set) -> tuple:
        stack = [start]
        region = set()
        bordering_colors = set()
        visited.add(start)

        while stack:
            current = stack.pop()
            region.add(current)

            for neighbor in self.get_adjacent_indices(current):
                if neighbor in visited or neighbor in excluded:
                    continue

                if self.board_state[neighbor] == Stone.EMPTY.value:
                    stack.append(neighbor)
                    visited.add(neighbor)
                else:
                    bordering_colors.add(Stone(self.board_state[neighbor]))

        if len(bordering_colors) == 1:
            return next(iter(bordering_colors)), len(region)  # Controlled territory
        return Stone.EMPTY, 0  # Neutral territory


    def get_adjacent_indices(self, index: int) -> list:
        directions = [-self.board_size, self.board_size, -1, 1]
        neighbors = []

        for dir in directions:
            neighbor = index + dir
            if self.is_in_bounds(neighbor):
                # Prevent wrap-around on the left/right edges
                if abs((index % self.board_size) - (neighbor % self.board_size)) > 1:
                    continue
                neighbors.append(neighbor)

        return neighbors

    def to_dict(self):
        return {
            "board_size": self.board_size,
            "players": self.players,
            "board_state": self.board_state,
            "previous_state": self.previous_state,
            "two_moves_ago_state": self.two_moves_ago_state,
            "current_turn": self.current_turn.value,
            "consecutive_passes": self.consecutive_passes,
            "game_over": self.game_over,
            "game_over_reason": self.game_over_reason,
            "resigned_player": self.resigned_player,
            "captured_black": self.captured_black,
            "captured_white": self.captured_white,
            "winner": self.winner,
            "in_scoring_phase": self.in_scoring_phase,
            "dead_black": self.dead_black,
            "dead_white": self.dead_white,
            "final_score": self.final_score,
            "finalized_players": self.finalized_players,
            "time_control": self.time_control,
            "time_left": self.time_left,
            "periods_left": self.periods_left,
            "byo_yomi_periods": self.byo_yomi_periods,
            "byo_yomi_time": self.byo_yomi_time,
            "byo_yomi_time_left": self.byo_yomi_time_left,
            "moves": self.moves,
            "agreed_dead": self.agreed_dead,
            "excluded_points": self.excluded_points,
            "rule_set": self.rule_set,
            "komi": self.komi,
            "colors_randomized": self.colors_randomized,
            "color_preference": self.color_preference,
            "created_by": self.created_by,
            "allow_handicaps": self.allow_handicaps,
            "handicap_stones": self.handicap_stones,
            "handicap_placements": self.handicap_placements,
            "estimated_ranks": self.estimated_ranks
        }

    @staticmethod
    def from_dict(data):
        game = GameState(data["board_size"])
        game.players = data["players"]
        game.board_state = data["board_state"]
        game.previous_state = data["previous_state"]
        game.two_moves_ago_state = data["two_moves_ago_state"]
        game.current_turn = Stone(data["current_turn"])
        game.consecutive_passes = data["consecutive_passes"]
        game.game_over = data["game_over"]
        game.game_over_reason = data["game_over_reason"]
        game.resigned_player = data["resigned_player"]
        game.captured_black = data["captured_black"]
        game.captured_white = data["captured_white"]
        game.winner = data["winner"]
        game.in_scoring_phase = data.get("in_scoring_phase", False)
        game.dead_black = data.get("dead_black", [])
        game.dead_white = data.get("dead_white", [])
        game.final_score = data["final_score"]
        game.finalized_players = data.get("finalized_players", [])
        game.time_control = data.get("time_control", "none")
        game.time_left = data.get("time_left", {})
        game.periods_left = data.get("periods_left", {})
        game.byo_yomi_periods = data.get("byo_yomi_periods", 0)
        game.byo_yomi_time = data.get("byo_yomi_time", 0)
        game.byo_yomi_time_left = data.get("byo_yomi_time_left", {})
        game.moves = data.get("moves", [])
        game.agreed_dead = data.get("agreed_dead", [])
        game.excluded_points = data.get("excluded_points", [])
        game.rule_set = data.get("rule_set", "japanese")
        game.komi = data.get("komi", 6.5)
        game.color_preference = data.get("color_preference", "random")
        game.created_by = data.get("created_by", None)
        game.allow_handicaps = data.get("allow_handicaps", False)
        game.handicap_stones = data.get("handicap_stones", None)
        game.handicap_placements = data.get("handicap_placements", [])
        game.estimated_ranks = data.get("estimated_ranks", {})
        return game