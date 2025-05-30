import { Stone, replayMovesUpTo, getConnectedGroup, isCaptured, getAdjacentIndices} from "./go_engine.js";

document.addEventListener("DOMContentLoaded", function () {

    class GoBoard {
        constructor(canvasId, size = 19, playerColor, ruleSet) {
            this.size = size;
            this.board = new Array(size * size).fill(Stone.EMPTY);

            this.ruleSet = ruleSet || "japanese";

            this.playerColor = playerColor;

            this.socket = null;

            this.currentTurn = null;

            this.canvas = document.getElementById(canvasId);
            this.ctx = this.canvas.getContext("2d");

            this.cellSize = 0;

            this.gameOverHandled = false;

            this.myDead = new Set(); //My selected dead stones
            this.theirDead = new Set(); //Opponent's selected dead stones

            this.playerId = localStorage.getItem("zg_player_id");

            this.doubleClickEnabled = false;
            this.pendingMoveIndex = null;

            // Sound stuff
            this.firstUpdate = true;
            this.prevMoveCount = 0;
            this.stoneSound = new Audio("/static/sounds/stone.ogg");
            this.passSound  = new Audio("/static/sounds/pass.ogg");
            this.stoneSound.load();
            this.passSound.load();

            //Game review stuff
            this.reviewIndex = null;
            this.originalGameState = null;

            this.resizeCanvas();
            window.addEventListener("resize", () => this.resizeCanvas());
            this.canvas.addEventListener("click", (event) => this.handleClick(event));
        }

        getWebsocketUrl(path) {
            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
            return `${proto}://${window.location.host}${path}`;
        }

        /** Connect to WebSocket for real-time updates */
        connectWebSocket(gameId, playerId) {
            const wsPath = `/ws/${gameId}?player_id=${playerId}`;
            this.socket = new WebSocket(this.getWebsocketUrl(wsPath));

            this.socket.onopen = () => {
                console.log("Connected to WebSocket for game updates");
            };

            this.socket.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    const countdownElement = document.getElementById("countdown");
            
                    switch (message.type) {
                        case "disconnect_notice":
                            let boardState = await getBoardState();
                            if (boardState.game_over && !boardState.in_scoring_phase) {
                                return; // Game is already over, no need to handle disconnection
                            }
                            const { timestamp, timeout_seconds } = message;
                            const deadline = timestamp + timeout_seconds;

                            if (countdownElement) {
                                this.disconnectInterval = setInterval(() => {
                                    const remaining = Math.max(0, Math.ceil(deadline - Date.now() / 1000));
                                    countdownElement.textContent = `Opponent disconnected. They have ${remaining}s to reconnect.`;
                        
                                    if (remaining === 0) {
                                        clearInterval(this.disconnectInterval);
                                        this.disconnectInterval = null;
                                        countdownElement.textContent = `Opponent forfeited by disconnection.`;
                                    }
                                }, 1000);
                            }
                            break;

                        case "reconnect_notice":
                            if (countdownElement) {
                                countdownElement.textContent = "";
                            }
                            if (this.disconnectInterval) {
                                clearInterval(this.disconnectInterval);
                                this.disconnectInterval = null;
                            }
                            break;
            
                        case "game_state":
                            if (!this.firstUpdate) {
                                const moves = message.payload.moves || [];
                                if (moves.length > this.prevMoveCount) {
                                  const lastMove = moves[moves.length - 1].index;
                                  if (lastMove === -1) {
                                    this.passSound.play();
                                  } else {
                                    this.stoneSound.play();
                                  }
                                }
                            }
                            this.firstUpdate = false;
                            this.prevMoveCount = (message.payload.moves || []).length;

                            this.updateBoard(message.payload);
                            break;

                        case "toggle_dead_stone":
                            if (message.payload) {
                                this.updateBoard(message.payload);
                            } else {
                                console.warn("toggle_dead_stone message missing payload.");
                            }
                            break;

                        case "chat":
                            this.appendChatMessage(message.sender, message.text);
                            break;
            
                        default:
                            console.warn("Unrecognized WebSocket message type:", message.type);
                    }
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
                    [4, 4], [4, 7], [4, 10],
                    [7, 4], [7, 7], [7, 10],
                    [10, 4], [10, 7], [10, 10]
                ];
            } else if (size === 9) {
                starCoords = [
                    [3, 3], [3, 5], [3, 7],
                    [5, 3], [5, 5], [5, 7],
                    [7, 3], [7, 5], [7, 7]
                ];
            }

            starCoords.forEach(([x, y]) => {
                ctx.beginPath();
                ctx.arc(x * cellSize, y * cellSize, cellSize / 6, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        handleClick(event) {
            const index = this.getIndexFromClick(event);
            if (index === null) return;
        
            if (this.inScoringPhase) {
                const clickedStone = this.board[index];

                // Japanese rules: allow toggling empty points
                if (clickedStone === Stone.EMPTY && this.ruleSet === "japanese") {
                    if (this.myDead.has(index)) {
                        this.myDead.delete(index);
                    } else {
                        this.myDead.add(index);
                    }

                    this.socket.send(JSON.stringify({
                        type: "toggle_dead_stone",
                        group: [index],
                        player_id: this.playerId
                    }));

                    this.redrawStones();
                    this.drawDeadOverlays();
                    return;
                }

                // Normal stone toggling
                if (clickedStone !== Stone.EMPTY) {
                    const group = getConnectedGroup(index, this.board, this.size);
                    const isGroupDead = [...group].every(i => this.myDead.has(i));

                    if (isGroupDead) {
                        group.forEach(i => this.myDead.delete(i));
                    } else {
                        group.forEach(i => this.myDead.add(i));
                    }
                    this.socket.send(JSON.stringify({
                        type: "toggle_dead_stone",
                        group: [...group],
                        player_id: this.playerId
                    }));

                    this.redrawStones();
                    this.drawDeadOverlays();
                }
                
                return;
            }
        
            if (this.doubleClickEnabled) {
                if (this.pendingMoveIndex === index) {
                    // Second click on same spot: send move
                    this.sendMove(index);
                    this.pendingMoveIndex = null;
                } else {
                    // First click: preview move
                    this.pendingMoveIndex = index;
                    this.redrawStones();
                    const pos = this.getBoardCoords(index);
                    this.drawStone(pos.x, pos.y, this.playerColor === 1 ? "black" : "white", 0.5);
                }
            } else {
                // Standard single-click send
                this.sendMove(index);
            }
        }

        drawDeadOverlays() {
            this.ctx.save();
        
            const all = new Set([...this.myDead, ...this.theirDead]);
        
            for (let index of all) {
                const { x, y } = this.getCanvasCoords(index);
                const radius = this.cellSize / 2.2;
        
                const agreed = this.myDead.has(index) && this.theirDead.has(index);
                const mineOnly = this.myDead.has(index);
                const theirsOnly = this.theirDead.has(index);
        
                // Set color
                if (agreed) {
                    this.ctx.strokeStyle = "green";
                } else if (mineOnly) {
                    this.ctx.strokeStyle = "red";
                } else if (theirsOnly) {
                    this.ctx.strokeStyle = "blue";
                }
        
                this.ctx.lineWidth = 2;
        
                if (this.board[index] === Stone.EMPTY) {
                    // Draw X for excluded empty point
                    const offset = radius * 0.7;
                    this.ctx.beginPath();
                    this.ctx.moveTo(x - offset, y - offset);
                    this.ctx.lineTo(x + offset, y + offset);
                    this.ctx.moveTo(x + offset, y - offset);
                    this.ctx.lineTo(x - offset, y + offset);
                    this.ctx.stroke();
                } else {
                    // Draw circle for dead stones
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
                    this.ctx.stroke();
                }
            }
        
            this.ctx.restore();
        }

        /** Send move data to the server */
        async sendMove(index) {
            const playerId = localStorage.getItem("zg_player_id");

            if (!playerId) {
                alert("Error: No user ID found. Please rejoin the game.");
                return;
            }

            // Fetch game state to check if both players have joined
            const gameResponse = await fetch(`/game/${gameId}/state`);
            const gameData = await gameResponse.json();

            if (index != -2 && (!gameData.players || Object.keys(gameData.players).length < 2)) {
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

        /** Draw a stone on the board with optional opacity */
        drawStone(gridX, gridY, color, opacity = 1.0) {
            const { ctx, cellSize } = this;
            ctx.save();
            ctx.globalAlpha = opacity;

            ctx.beginPath();
            ctx.arc(gridX * cellSize, gridY * cellSize, cellSize / 2.2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = "black";
            ctx.stroke();

            ctx.restore();
        }

        /** Draw an X mark on the board with optional color and opacity */
        drawX(gridX, gridY, color = "black", opacity = 1.0) {
            const { ctx, cellSize } = this;
            const half = cellSize / 2.2;
            const centerX = gridX * cellSize;
            const centerY = gridY * cellSize;

            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(centerX - half, centerY - half);
            ctx.lineTo(centerX + half, centerY + half);
            ctx.moveTo(centerX - half, centerY + half);
            ctx.lineTo(centerX + half, centerY - half);
            ctx.stroke();

            ctx.restore();
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
            if (this.pendingMoveIndex !== null) {
                const color = this.playerColor === 1 ? "black" : "white";
                const pos = this.getBoardCoords(this.pendingMoveIndex);
                this.drawStone(pos.x, pos.y, color, 0.5);  // Half-opacity
            }
        }

        stepBack() {
            if (this.reviewIndex > 0) {
                this.reviewIndex--;

                // Skip over end-game passes
                const moves = this.originalGameState.moves || [];
                while (
                    this.reviewIndex > 0 &&
                    moves[this.reviewIndex - 1]?.index === -1 &&
                    moves[this.reviewIndex]?.index === -1
                ) {
                    this.reviewIndex--;
                }

                const result = replayMovesUpTo(this.originalGameState.moves, this.reviewIndex, this.size, this.originalGameState.handicap_placements || []);
                this.board = result.board;
                this.capturedBlack = result.capturedBlack;
                this.capturedWhite = result.capturedWhite;
                this.currentTurn = result.currentTurn;
                this.redrawStones();
            }
        }
        
        stepForward() {
            const moves = this.originalGameState.moves || [];
            const max = moves.length - 1;

            if (this.reviewIndex < max) {
                this.reviewIndex++;

                // Skip over end-game passes
                while (
                    this.reviewIndex < max &&
                    moves[this.reviewIndex - 1]?.index === -1 &&
                    moves[this.reviewIndex]?.index === -1
                ) {
                    this.reviewIndex++;
                }
        
                // If this is the final move again, re-show agreed dead
                if (this.reviewIndex === max) {
                    const result = replayMovesUpTo(moves, this.reviewIndex, this.size, this.originalGameState.handicap_placements || []);
                    this.board = result.board;
                    this.capturedBlack = result.capturedBlack;
                    this.capturedWhite = result.capturedWhite;
                    this.currentTurn = result.currentTurn;
                    
                    const agreedDead = this.originalGameState.agreed_dead || [];
                    const excludedPoints = this.originalGameState.excluded_points || [];

                    for (const stone of agreedDead) {
                        this.board[stone.index] = Stone.EMPTY;  // Remove it for redraw
                    }
    
                    this.redrawStones();  // draw board first
                    
                    // Redraw agreed dead stones at half opacity
                    for (const stone of agreedDead) {
                        const boardPos = this.getBoardCoords(stone.index);
                        const color = stone.color === 1 ? "black" : "white";
                        this.drawStone(boardPos.x, boardPos.y, color, 0.5);
                    }
                    // Redraw excluded points as Xs
                    for (const index of excludedPoints) {
                        const boardPos = this.getBoardCoords(index);
                        this.drawX(boardPos.x, boardPos.y, "black", 0.5);
                    }
                } else {
                    const result = replayMovesUpTo(this.originalGameState.moves, this.reviewIndex, this.size, this.originalGameState.handicap_placements || []);
                    this.board = result.board;
                    this.capturedBlack = result.capturedBlack;
                    this.capturedWhite = result.capturedWhite;
                    this.currentTurn = result.currentTurn;
                    this.redrawStones();
                }
            }
        }

        appendChatMessage(sender, text) {
            const chatBox = document.getElementById("chatMessages");
            const msgDiv = document.createElement("div");
            const msgSpan = document.createElement("span");
            msgSpan.textContent = text;

            if ((sender === "Black" && this.playerColor === 1) || 
                (sender === "White" && this.playerColor === 2)) {
                msgSpan.classList.add("chat-outgoing");
            } else {
                msgSpan.classList.add("chat-incoming");
            }

            msgDiv.appendChild(msgSpan);
            chatBox.appendChild(msgDiv);
            chatBox.scrollTop = chatBox.scrollHeight;
        };

        /** Update the board state and UI */
        updateBoard(gameState) {
            // 0. Update player color if necessary
            if (gameState.players && this.playerId) {
                const assignedColor = gameState.players[this.playerId];
                console.log("Assigned color:", assignedColor);
                console.log("Current player color:", this.playerColor);
                if (assignedColor && assignedColor !== this.playerColor) {
                    this.playerColor = assignedColor;
                    const colorText = document.querySelector("#playerColor span");
                    if (colorText) {
                        colorText.textContent = this.playerColor === 1 ? "Black" : "White";
                    }
                }
            }

            // 1. Update the board
            this.board = gameState.board_state.map(value => {
                if (value === 1) return Stone.BLACK;
                if (value === 2) return Stone.WHITE;
                return Stone.EMPTY;
            });

            this.inScoringPhase = gameState.in_scoring_phase;
            const color = this.playerColor;

            const deadBlack = gameState.dead_black || [];
            const deadWhite = gameState.dead_white || [];

            if (color === 1) {
                this.myDead = new Set(deadBlack);
                this.theirDead = new Set(deadWhite);
            } else {
                this.myDead = new Set(deadWhite);
                this.theirDead = new Set(deadBlack);
            }

            // 2. Redraw stones
            this.redrawStones();

            if (this.inScoringPhase) {
                this.drawDeadOverlays();

                // Create button and message if they don't exist yet
                let finalizeBtn = document.getElementById("finalizeScoreBtn");
                let finalizeMsg = document.getElementById("finalizeScoreMessage");
                if (!finalizeMsg) {
                    finalizeMsg = document.createElement("span");
                    finalizeMsg.id = "finalizeScoreMessage";
                    if (gameState.ruleSet === "japanese") {
                        finalizeMsg.textContent = "Select dead stones and seki territory to finalize the score.";
                    } else {
                        finalizeMsg.textContent = "Select dead stones to finalize the score.";
                    }
                    const container = document.getElementById("finalizeScoreMessageContainer");
                    container.appendChild(finalizeMsg);
                }
                if (!finalizeBtn) {
                    finalizeBtn = document.createElement("button");
                    finalizeBtn.id = "finalizeScoreBtn";
                    finalizeBtn.textContent = "Finalize Score";
                    finalizeBtn.disabled = true;
                    finalizeBtn.style.marginTop = "10px";
                    finalizeBtn.style.padding = "6px 12px";
                    finalizeBtn.style.fontSize = "16px";

                    const container = document.getElementById("finalizeScoreContainer");
                    container.appendChild(finalizeBtn);

                    finalizeBtn.addEventListener("click", () => {
                        this.socket.send(JSON.stringify({
                            type: "finalize_score",
                            player_id: this.playerId
                        }));
                        finalizeBtn.disabled = true;
                        finalizeBtn.textContent = "Waiting for opponent...";
                    });
                }

                // Check agreement between players
                const myDead = color === 1 ? deadBlack : deadWhite;
                const theirDead = color === 1 ? deadWhite : deadBlack;

                const mySet = new Set(myDead);
                const theirSet = new Set(theirDead);

                const setsMatch =
                    mySet.size === theirSet.size &&
                    [...mySet].every(i => theirSet.has(i));

                finalizeBtn.disabled = !setsMatch;
            } else {
                let finalizeBtn = document.getElementById("finalizeScoreBtn");
                let finalizeMsg = document.getElementById("finalizeScoreMessage");
                // Check if both players have finalized
                const finalizedPlayers = gameState.finalized_players || [];
                const bothFinalized = finalizedPlayers.length === 2;

                // Disable further toggling and hide finalize button
                if (bothFinalized) {
                    if (finalizeMsg) {
                        finalizeMsg.remove();
                    }
                    if (finalizeBtn) {
                        finalizeBtn.remove();
                    }
                }
            }

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

            if (gameState.game_over && !gameState.in_scoring_phase && !this.gameOverHandled) {
                this.gameOverHandled = true; // Prevent multiple alerts

                const messageDiv = document.getElementById("gameOverMessage");
                let message = "";

                const score = gameState.final_score;
                const reason = gameState.game_over_reason;
            
                if (reason === "resign") {
                    const resigningPlayer = gameState.resigned_player;
                    const winner = gameState.winner;
                    const resignColor = gameState.players[resigningPlayer] === 1 ? "Black" : "White";
                    const winnerColor = gameState.players[winner] === 1 ? "Black" : "White";
                    const resignDisplay = resignColor.charAt(0).toUpperCase() + resignColor.slice(1);
            
                    message = `Game over. ${resignDisplay} resigned. ${winnerColor} wins!`;
                } else if (reason === "timeout") {
                    const timedOutPlayer = gameState.resigned_player;
                    const winner = gameState.winner;
                    const timeoutColor = gameState.players[timedOutPlayer] === 1 ? "Black" : "White";
                    const winnerColor = gameState.players[winner] === 1 ? "Black" : "White";
                    const timeoutDisplay = timeoutColor.charAt(0).toUpperCase() + timeoutColor.slice(1);

                    message = `Game over. ${timeoutDisplay} ran out of time. ${winnerColor} wins!`;
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

                // Hide pass and resign buttons
                const actionButtons = document.getElementById("actionButtons");
                if (actionButtons) {
                    actionButtons.style.display = "none";
                }

                // Create review buttons container
                const reviewContainer = document.getElementById("reviewButtons") || document.createElement("div");
                reviewContainer.id = "reviewButtons";
                reviewContainer.style.marginTop = "10px";

                // Only add buttons if they don't already exist
                if (!document.getElementById("prevMoveBtn")) {
                    const prevBtn = document.createElement("button");
                    prevBtn.id = "prevMoveBtn";
                    prevBtn.textContent = "← Prev";
                    prevBtn.style.marginRight = "10px";
                    reviewContainer.appendChild(prevBtn);

                    prevBtn.addEventListener("click", () => this.stepBack());
                }

                if (!document.getElementById("nextMoveBtn")) {
                    const nextBtn = document.createElement("button");
                    nextBtn.id = "nextMoveBtn";
                    nextBtn.textContent = "Next →";
                    reviewContainer.appendChild(nextBtn);

                    nextBtn.addEventListener("click", () => this.stepForward());
                }

                document.getElementById("controlsContainer").appendChild(reviewContainer);

                // Setup navigation parameters
                this.reviewIndex = (gameState.moves || []).length;
                this.originalGameState = gameState;
            }

            if (gameState.time_control === "none") {
                // Hide or remove timers from the DOM
                const timers = document.getElementById("timers");
                if (timers) timers.style.display = "none";
            } else if (gameState.time_left) {
                const blackTimer = document.getElementById("blackTimer");
                const whiteTimer = document.getElementById("whiteTimer");
            
                const blackId = Object.keys(gameState.players).find(pid => gameState.players[pid] === 1);
                const whiteId = Object.keys(gameState.players).find(pid => gameState.players[pid] === 2);
            
                const blackTime = gameState.time_left[blackId];
                const whiteTime = gameState.time_left[whiteId];

                const blackPeriods = gameState.periods_left?.[blackId] ?? 0;
                const whitePeriods = gameState.periods_left?.[whiteId] ?? 0;

                const blackByoYomiTime = gameState.byo_yomi_time_left?.[blackId] ?? 0;
                const whiteByoYomiTime = gameState.byo_yomi_time_left?.[whiteId] ?? 0;
            
                const formatTime = (seconds) => {
                    const min = Math.floor(seconds / 60).toString().padStart(2, '0');
                    const sec = (seconds % 60).toString().padStart(2, '0');
                    return `${min}:${sec}`;
                };
            
                // Black timer display
                if (blackTimer) {
                    if (blackTime > 0) {
                        blackTimer.textContent = formatTime(blackTime);
                    } else if (blackPeriods > 0) {
                        blackTimer.textContent = `${formatTime(blackByoYomiTime)} (${blackPeriods})`;
                    } else {
                        blackTimer.textContent = "--:--";
                    }
                }

                // White timer display
                if (whiteTimer) {
                    if (whiteTime > 0) {
                        whiteTimer.textContent = formatTime(whiteTime);
                    } else if (whitePeriods > 0) {
                        whiteTimer.textContent = `${formatTime(whiteByoYomiTime)} (${whitePeriods})`;
                    } else {
                        whiteTimer.textContent = "--:--";
                    }
                }
            }
            
        }

        getIndexFromClick(event) {
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
        
            let gridX = Math.round(x / this.cellSize) - 1;
            let gridY = Math.round(y / this.cellSize) - 1;
        
            if (gridX < 0 || gridX >= this.size || gridY < 0 || gridY >= this.size) {
                return null; // Outside board
            }
        
            return this.getIndex(gridX, gridY);
        }

        getBoardCoords(index) {
            const x = index % this.size;
            const y = Math.floor(index / this.size);
        
            return {
                x: x + 1,
                y: y + 1
            };
        }

        getCanvasCoords(index) {
            const x = index % this.size;
            const y = Math.floor(index / this.size);
        
            return {
                x: (x + 1) * this.cellSize,
                y: (y + 1) * this.cellSize
            };
        }

        addChatHint() {
            const roleHint = document.createElement("div");
            roleHint.textContent = `Welcome to the chat. Your messages appear on the right in blue.`;
            roleHint.style.fontStyle = "italic";
            roleHint.style.marginBottom = "6px";
            roleHint.style.color = "#555";

            document.getElementById("chatMessages").appendChild(roleHint);
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
        let playerId = localStorage.getItem("zg_player_id");
        let playerColor = boardState.players[playerId];
        let ruleSet = boardState.rule_set;
    
        if (!boardSize) {
            console.error("Error: Failed to fetch board size.");
            return;
        }

        if (!playerColor) {
            console.error("Error: Failed to fetch player's color.");
            return;
        }

        if (!ruleSet) {
            console.error("Error: Failed to fetch rule set.");
            return;
        }
    
        const goBoard = new GoBoard("gameCanvas", boardSize, playerColor, ruleSet);
        goBoard.connectWebSocket(gameId, playerId);
        goBoard.updateBoard(boardState);

        //Add chat box hint
        goBoard.addChatHint();

        //Add game details dropdown
        const settingsHtml = `
            <p><strong>Board Size:</strong> ${boardState.board_size}×${boardState.board_size}</p>
            <p><strong>Time Control:</strong> ${boardState.time_control === 'none' ? 'None' : boardState.time_control + 's'}</p>
            <p><strong>Handicaps Allowed:</strong> ${boardState.allow_handicaps ? 'Yes' : 'No'}</p>
            <p><strong>Byo-Yomi:</strong> ${boardState.byo_yomi_periods}×${boardState.byo_yomi_time}s</p>
            <p><strong>Ruleset:</strong> ${boardState.rule_set.charAt(0).toUpperCase() + boardState.rule_set.slice(1)}</p>
            <p><strong>Color Pref.:</strong> ${boardState.color_preference.charAt(0).toUpperCase() + boardState.color_preference.slice(1)}</p>
            <p><strong>Komi:</strong> ${boardState.komi}</p>
            `;
        document.getElementById('gameSettingsContent').innerHTML = settingsHtml;

        // Button handlers
        document.getElementById("passBtn").addEventListener("click", () => {
            goBoard.sendMove(-1);  // Pass
        });

        document.getElementById("resignBtn").addEventListener("click", () => {
            if (confirm("Are you sure you want to resign?")) {
                goBoard.sendMove(-2);  // Resign
            }
        });

        document.getElementById("downloadSGF").addEventListener("click", async () => {
            const gameId = window.location.pathname.split("/").pop();
            const res = await fetch(`/game/${gameId}/state`);
            const gameState = await res.json();
            downloadSGF(gameState);
        });

        const input = document.getElementById("chatInput");
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                document.getElementById("sendChatBtn").click();
            }
        });

        document.getElementById("sendChatBtn").addEventListener("click", () => {
            const input = document.getElementById("chatInput");
            const text = input.value.trim();
            if (text && goBoard.socket) {
              goBoard.socket.send(JSON.stringify({
                type: "chat",
                player_id: goBoard.playerId,
                text: text
              }));
              input.value = "";
            }
        });

        document.getElementById("doubleClickToggle").addEventListener("change", (e) => {
            goBoard.doubleClickEnabled = e.target.checked;
            goBoard.pendingMoveIndex = null;
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
