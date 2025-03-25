document.addEventListener("DOMContentLoaded", function () {

    const Stone = Object.freeze({
        EMPTY: 0,
        BLACK: 1,
        WHITE: 2
    }); 

    class GoBoard {
        constructor(canvasId, size = 19, playerColor) {
            this.size = size;
            this.board = new Array(size * size).fill(Stone.EMPTY);

            this.playerColor = playerColor;

            this.socket = null;

            this.currentTurn = null;

            this.canvas = document.getElementById(canvasId);
            this.ctx = this.canvas.getContext("2d");

            this.cellSize = 0;

            this.gameOverHandled = false;

            this.resizeCanvas();
            window.addEventListener("resize", () => this.resizeCanvas());
            this.canvas.addEventListener("click", (event) => this.handleClick(event));
        }

        /** Connect to WebSocket for real-time updates */
        connectWebSocket(gameId, playerId) {
            this.socket = new WebSocket(`ws://${window.location.host}/ws/${gameId}?player_id=${playerId}`);

            this.socket.onopen = () => {
                console.log("Connected to WebSocket for game updates");
            };

            this.socket.onmessage = (event) => {
                try {
                    const gameState = JSON.parse(event.data);
                    this.updateBoard(gameState);
                } catch (error) {
                    console.error("Error parsing WebSocket message:", error);
                }
            };

            this.socket.onerror = (error) => {
                console.error("WebSocket Error:", error);
            };

            this.socket.onclose = (event) => {
                console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
            };
        }

        resizeCanvas() {
            const maxSize = window.innerWidth > 768 ? 600 : window.innerWidth - 40; // extra padding on mobile
            const size = Math.min(maxSize, window.innerHeight - 150);
            this.canvas.width = size;
            this.canvas.height = size;
            this.cellSize = size / (this.size + 1);
            this.drawBoard();
            this.redrawStones();
        }
        

        /** Draw the Go board grid */
        drawBoard() {
            const { ctx, canvas, cellSize, size } = this;
            ctx.fillStyle = "#DEB887"; // Wooden board background
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.strokeStyle = "black";
            ctx.lineWidth = 2;

            for (let i = 1; i <= size; i++) {
                let pos = i * cellSize;

                // Vertical lines
                ctx.beginPath();
                ctx.moveTo(pos, cellSize);
                ctx.lineTo(pos, canvas.height - cellSize);
                ctx.stroke();

                // Horizontal lines
                ctx.beginPath();
                ctx.moveTo(cellSize, pos);
                ctx.lineTo(canvas.width - cellSize, pos);
                ctx.stroke();
            }

            this.drawStarPoints();
        }

        /** Draw star points (hoshi) */
        drawStarPoints() {
            const { ctx, cellSize, size } = this;
            ctx.fillStyle = "black";

            let starCoords = [];
            if (size === 19) {
                starCoords = [
                    [4, 4], [4, 10], [4, 16],
                    [10, 4], [10, 10], [10, 16],
                    [16, 4], [16, 10], [16, 16]
                ];
            } else if (size === 13) {
                starCoords = [
                    [4, 4], [4, 10],
                    [10, 4], [10, 10]
                ];
            } else if (size === 9) {
                starCoords = [
                    [3, 3], [3, 7],
                    [7, 3], [7, 7]
                ];
            }

            starCoords.forEach(([x, y]) => {
                ctx.beginPath();
                ctx.arc(x * cellSize, y * cellSize, cellSize / 6, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        /** Handle click event and attempt to place a stone */
        handleClick(event) {
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            // Convert click position to board grid position
            let gridX = Math.round(x / this.cellSize);
            let gridY = Math.round(y / this.cellSize);

            // Check if inside the playable area
            if (gridX < 1 || gridX > this.size || gridY < 1 || gridY > this.size) {
                return; // Ignore clicks outside of the board
            }

            gridX -= 1; // Adjust to 0-based indexing
            gridY -= 1;

            const index = this.getIndex(gridX, gridY);

            this.sendMove(index);
        }
        

        /** Send move data to the server */
        async sendMove(index) {
            const playerId = sessionStorage.getItem("player_id");

            if (!playerId) {
                alert("Error: No user ID found. Please rejoin the game.");
                return;
            }

            // Fetch game state to check if both players have joined
            const gameResponse = await fetch(`/game/${gameId}/state`);
            const gameData = await gameResponse.json();

            if (!gameData.players || Object.keys(gameData.players).length < 2) {
                alert("Waiting for another player to join...");
                return;
            }

            await fetch(`/game/${gameId}/move`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ player_id: playerId, index: index })
            }).then(response => {
                if (!response.ok) {
                    response.json().then(data => alert(`Error: ${data.detail}`));
                }
            }).catch(error => console.error("Failed to send move:", error));
        }

        /** Convert (x, y) to 1D board index */
        getIndex(x, y) {
            return y * this.size + x;
        }

        /** Draw a stone on the board */
        drawStone(gridX, gridY, color) {
            const { ctx, cellSize } = this;
            ctx.beginPath();
            ctx.arc(gridX * cellSize, gridY * cellSize, cellSize / 2.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "black";
            ctx.stroke();
        }

        /** Redraw all stones on the board */
        redrawStones() {
            this.drawBoard();
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    const index = this.getIndex(x, y);
                    if (this.board[index] !== Stone.EMPTY) {
                        this.drawStone(x + 1, y + 1, this.board[index] === Stone.BLACK ? "black" : "white");
                    }
                }
            }
        }

        /** Update the board state and UI */
        updateBoard(gameState) {
            // 1. Update the board
            this.board = gameState.board_state.map(value => {
                if (value === 1) return Stone.BLACK;
                if (value === 2) return Stone.WHITE;
                return Stone.EMPTY;
            });

            // 2. Redraw stones
            this.redrawStones();

            // 3. Update turn and color info
            this.currentTurn = gameState.current_turn;

            const colorText = document.querySelector("#playerColor span");
            const turnText = document.querySelector("#turnIndicator span");

            colorText.textContent = this.playerColor === 1 ? "Black" : "White";

            if (this.playerColor === this.currentTurn) {
                turnText.textContent = "Your move";
                turnText.style.color = "green";
            } else {
                turnText.textContent = "Opponent's move";
                turnText.style.color = "gray";
            }

            if (gameState.game_over && !this.gameOverHandled) {
                this.gameOverHandled = true; // Prevent multiple alerts

                const messageDiv = document.getElementById("gameOverMessage");
                let message = "";

                const score = gameState.final_score;
                const reason = gameState.game_over_reason;
                const playerId = sessionStorage.getItem("player_id");
            
                if (reason === "resign") {
                    const resigningPlayer = gameState.resigned_player;
                    const winner = gameState.winner;
                    const resignColor = gameState.players[resigningPlayer] === 1 ? "Black" : "White";
                    const winnerColor = gameState.players[winner] === 1 ? "Black" : "White";
                    const resignDisplay = resignColor.charAt(0).toUpperCase() + resignColor.slice(1);
            
                    message = `Game over. ${resignDisplay} resigned. ${winnerColor} wins!`;
                } else if (score) {
                    const [blackScore, whiteScore] = score;
                    const winner = blackScore > whiteScore ? "Black" : "White";
                    message = `Game over. Score: Black ${blackScore} - White ${whiteScore}<br><strong>Winner: ${winner}</strong>`;
                } else {
                    message = "Game over.";
                }

                messageDiv.innerHTML = message;
                messageDiv.style.display = "block";
                messageDiv.style.color = "#222";
            }
        }
    }

    async function initializeGame() {
        const gameId = window.gameId || getGameIdFromURL();
    
        if (!gameId) {
            console.error("Error: gameId is missing.");
            return;
        }
        
        let boardState = await getBoardState();
        let boardSize = boardState.board_size;
        let playerId = sessionStorage.getItem("player_id");
        let playerColor = boardState.players[playerId];
    
        if (!boardSize) {
            console.error("Error: Failed to fetch board size.");
            return;
        }

        if (!playerColor) {
            console.error("Error: Failed to fetch player's color.");
            return;
        }
    
        const goBoard = new GoBoard("gameCanvas", boardSize, playerColor);
        goBoard.connectWebSocket(gameId, playerId);
        goBoard.updateBoard(boardState);

        // Button handlers
        document.getElementById("passBtn").addEventListener("click", () => {
            goBoard.sendMove(-1);  // Pass
        });

        document.getElementById("resignBtn").addEventListener("click", () => {
            if (confirm("Are you sure you want to resign?")) {
                goBoard.sendMove(-2);  // Resign
            }
        });
    }

    initializeGame();    
});

function getGameIdFromURL() {
    const pathSegments = window.location.pathname.split("/");
    return pathSegments.length > 2 ? pathSegments[2] : null;  // Extract game ID
}

async function getBoardState() {
    const gameId = window.gameId || getGameIdFromURL();
    const response = await fetch(`/game/${gameId}/state`);
    
    if (!response.ok) {
        console.error("Failed to fetch game state");
        return;
    }

    const gameData = await response.json();
    return gameData;
}

let checkPlayersInterval = null;
async function checkPlayers() {
    const gameId = window.gameId || getGameIdFromURL();
    const response = await fetch(`/game/${gameId}/state`);
    
    if (!response.ok) {
        console.error("Failed to fetch game state");
        return;
    }

    const gameData = await response.json();
    const waitingMessage = document.getElementById("waitingMessage");

    if (!gameData.players || Object.keys(gameData.players).length < 2) {
        waitingMessage.style.display = "block";
    } else {
        waitingMessage.style.display = "none";
        clearInterval(checkPlayersInterval);
    }
}

checkPlayersInterval = setInterval(checkPlayers, 1000); // Check every second
