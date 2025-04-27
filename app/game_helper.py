from game_state import Stone

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