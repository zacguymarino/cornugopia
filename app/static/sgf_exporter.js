function generateSGF(gameState) {
    const size = gameState.board_size;
    const komi = gameState.komi || 7.5;
    const moves = gameState.moves || [];

    const getColor = (value) => value === 1 ? 'B' : 'W';
    const getCoords = (index) => {
        const x = index % size;
        const y = Math.floor(index / size);
        const sgfChar = (n) => String.fromCharCode("a".charCodeAt(0) + n);
        return `${sgfChar(x)}${sgfChar(y)}`;
    };

    let sgf = `(;GM[1]FF[4]SZ[${size}]KM[${komi}]`;

    if (gameState.game_over) {
        const reason = gameState.game_over_reason;
        const winner = gameState.winner;
        const winnerColor = gameState.players?.[winner]; // 1 = Black, 2 = White

        if (reason === "resign") {
            sgf += `RE[${winnerColor === 1 ? "B+R" : "W+R"}]`;
        } else if (reason === "timeout") {
            sgf += `RE[${winnerColor === 1 ? "B+T" : "W+T"}]`;
        } else if (reason === "double_pass" && gameState.final_score) {
            const [blackScore, whiteScore] = gameState.final_score;
            const margin = Math.abs(blackScore - whiteScore);
            if (margin === 0) {
                sgf += `RE[0]`; // Tie game, but shouldn't happen
            } else {
                const leadingColor = blackScore > whiteScore ? "B" : "W";
                sgf += `RE[${leadingColor}+${margin}]`;
            }
        }
    }

    for (const move of moves) {
        if (move.index === -1) {
            sgf += `;${getColor(move.color)}[]`; // Pass
        } else if (move.index === -2) {
            continue; // Don't encode resignations as moves
        } else {
            sgf += `;${getColor(move.color)}[${getCoords(move.index)}]`;
        }
    }

    sgf += ')';
    return sgf;
}

function downloadSGF(gameState) {
    const sgf = generateSGF(gameState);
    const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "game.sgf";
    a.click();
    URL.revokeObjectURL(url);
}
