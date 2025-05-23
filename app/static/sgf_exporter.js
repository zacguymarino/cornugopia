function generateSGF(gameState) {
    const size = gameState.board_size;
    const komi = gameState.komi || 6.5;
    const moves = gameState.moves || [];

    const getColor = (value) => value === 1 ? 'B' : 'W';
    const getCoords = (index) => {
        const x = index % size;
        const y = Math.floor(index / size);
        const sgfChar = (n) => String.fromCharCode("a".charCodeAt(0) + n);
        return `${sgfChar(x)}${sgfChar(y)}`;
    };

    const props = [
        "GM[1]",      // Game type: Go
        "FF[4]",      // SGF file format version 4
        `SZ[${size}]`,// Board size
        `KM[${komi}]` // Komi
    ];

    // Add handicap if needed
    if (gameState.handicap_placements && gameState.handicap_placements.length > 0) {
        props.push(`HA[${gameState.handicap_placements.length}]`);
        const handicapCoords = gameState.handicap_placements.map(idx => `[${getCoords(idx)}]`).join('');
        props.push(`AB${handicapCoords}`);
    }

    // Add result if the game is over
    if (gameState.game_over) {
        const reason = gameState.game_over_reason;
        const winner = gameState.winner;
        const winnerColor = gameState.players?.[winner]; // 1 = Black, 2 = White

        if (reason === "resign") {
            props.push(`RE[${winnerColor === 1 ? "B+R" : "W+R"}]`);
        } else if (reason === "timeout") {
            props.push(`RE[${winnerColor === 1 ? "B+T" : "W+T"}]`);
        } else if (reason === "double_pass" && gameState.final_score) {
            const [blackScore, whiteScore] = gameState.final_score;
            const margin = Math.abs(blackScore - whiteScore);
            if (margin === 0) {
                props.push(`RE[0]`);
            } else {
                const leadingColor = blackScore > whiteScore ? "B" : "W";
                props.push(`RE[${leadingColor}+${margin}]`);
            }
        }
    }

    // Start building SGF
    let sgf = `(;${props.join('')}`;

    // Now the moves
    for (const move of moves) {
        if (move.index === -1) {
            sgf += `;${getColor(move.color)}[]`; // Pass
        } else if (move.index === -2) {
            continue; // Skip resign moves
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
