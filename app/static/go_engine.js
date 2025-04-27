export const Stone = {
    EMPTY: 0,
    BLACK: 1,
    WHITE: 2
};

export function oppositeColor(color) {
    return color === Stone.BLACK ? Stone.WHITE : Stone.BLACK;
}

export function getAdjacentIndices(index, boardSize) {
    const x = index % boardSize;
    const y = Math.floor(index / boardSize);
    const neighbors = [];

    if (x > 0) neighbors.push(index - 1);
    if (x < boardSize - 1) neighbors.push(index + 1);
    if (y > 0) neighbors.push(index - boardSize);
    if (y < boardSize - 1) neighbors.push(index + boardSize);

    return neighbors;
}

export function getConnectedGroup(startIndex, board, boardSize) {
    const targetColor = board[startIndex];
    const visited = new Set();
    const stack = [startIndex];

    while (stack.length > 0) {
        const current = stack.pop();
        if (visited.has(current)) continue;

        visited.add(current);
        const neighbors = getAdjacentIndices(current, boardSize);
        for (const n of neighbors) {
            if (board[n] === targetColor && !visited.has(n)) {
                stack.push(n);
            }
        }
    }

    return Array.from(visited);
}

export function hasLiberties(group, board, boardSize) {
    for (const idx of group) {
        const neighbors = getAdjacentIndices(idx, boardSize);
        for (const n of neighbors) {
            if (board[n] === Stone.EMPTY) {
                return true;
            }
        }
    }
    return false;
}

export function isCaptured(index, color, board, boardSize) {
    const group = getConnectedGroup(index, board, boardSize);
    return !hasLiberties(group, board, boardSize);
}

export function replayMovesUpTo(moves, index, boardSize, initialHandicaps = []) {
    const board = Array(boardSize * boardSize).fill(Stone.EMPTY);
    let currentTurn = Stone.BLACK;
    let capturedBlack = 0;
    let capturedWhite = 0;

    // First place handicap stones
    for (const idx of initialHandicaps) {
        console.log("Placing handicap stone at index:", idx);
        board[idx] = Stone.BLACK;
    }

    if (initialHandicaps.length > 0) {
        currentTurn = Stone.WHITE;
    }

    for (let i = 0; i < index; i++) {
        const { index: moveIndex, color } = moves[i];

        if (moveIndex === -2) continue; // resignation
        if (moveIndex === -1) {
            currentTurn = oppositeColor(currentTurn);
            continue; // pass
        }

        board[moveIndex] = color;

        const neighbors = getAdjacentIndices(moveIndex, boardSize);
        for (const neighbor of neighbors) {
            const neighborColor = board[neighbor];
            if (neighborColor !== Stone.EMPTY && neighborColor !== color) {
                const group = getConnectedGroup(neighbor, board, boardSize);
                if (!hasLiberties(group, board, boardSize)) {
                    for (const idx of group) {
                        board[idx] = Stone.EMPTY;
                    }
                    if (neighborColor === Stone.BLACK) capturedBlack += group.length;
                    if (neighborColor === Stone.WHITE) capturedWhite += group.length;
                }
            }
        }

        currentTurn = oppositeColor(color);
    }

    return {
        board,
        capturedBlack,
        capturedWhite,
        currentTurn
    };
}
