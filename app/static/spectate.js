import {
    Stone,
    getAdjacentIndices,
    getConnectedGroup,
    replayMovesUpTo
  } from "./go_engine.js";
  
  class SpectatorBoard {
    constructor(canvasId, size, ruleSet) {
      this.size = size;
      this.board = new Array(size * size).fill(Stone.EMPTY);
      this.ruleSet = ruleSet;
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext("2d");
      this.cellSize = 0;

      // Last move index
      this.lastMoveIndex = null;

      // Sound stuff
      this.firstUpdate = true;
      this.prevMoveCount = 0;
      this.stoneSound = new Audio("/static/sounds/stone.ogg");
      this.passSound  = new Audio("/static/sounds/pass.ogg");
      this.stoneSound.load();
      this.passSound.load();
  
      this.resizeCanvas();
      window.addEventListener("resize", () => this.resizeCanvas());
    }

    resizeCanvas() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Compute “available” width and height:
      const availableWidth  = Math.max(0, vw  - 20);
      const availableHeight = Math.max(0, vh  - 20);

      // On desktop (vw > 768), we’ll let the board go up to 90% of whichever is smaller.
      // On mobile (vw ≤ 768), we’ll let it fill the availableWidth (i.e. viewport-20px).
      let size;
      if (vw > 768) {
          // 90% of availableWidth vs. 90% of availableHeight, pick the smaller
          size = Math.min( availableWidth  * 0.9, 
                          availableHeight * 0.9 );
      } else {
          // On narrow screens, just fit to (viewport – 20px), but no more than availableHeight
          size = Math.min( availableWidth, availableHeight );
      }

      // Finally, apply to <canvas>
      this.canvas.width  = size;
      this.canvas.height = size;
      this.cellSize = size / (this.size + 1);

      this.redrawStones();
    }
  
    drawBoard() {
      const { ctx, canvas, cellSize, size } = this;
      ctx.fillStyle = "#DEB887";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      for (let i = 1; i <= size; i++) {
        const pos = i * cellSize;
        ctx.beginPath();
        ctx.moveTo(pos, cellSize);
        ctx.lineTo(pos, canvas.height - cellSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cellSize, pos);
        ctx.lineTo(canvas.width - cellSize, pos);
        ctx.stroke();
      }
      this.drawStarPoints();
    }
  
    drawStarPoints() {
      const { ctx, cellSize, size } = this;
      ctx.fillStyle = "#000";
      const coords = {
        19: [[4,4],[4,10],[4,16],[10,4],[10,10],[10,16],[16,4],[16,10],[16,16]],
        13: [[4,4],[4,7],[4,10],[7,4],[7,7],[7,10],[10,4],[10,7],[10,10]],
         9: [[3,3],[3,5],[3,7],[5,3],[5,5],[5,7],[7,3],[7,5],[7,7]],
      }[size] || [];
      coords.forEach(([x,y]) => {
        ctx.beginPath();
        ctx.arc(x * cellSize, y * cellSize, cellSize/6, 0, 2*Math.PI);
        ctx.fill();
      });
    }
  
    redrawStones() {
      this.drawBoard();
      for (let idx=0; idx< this.board.length; idx++) {
        const stone = this.board[idx];
        if (stone !== Stone.EMPTY) {
          const x = idx % this.size, y = Math.floor(idx/this.size);
          this.drawStone(x+1, y+1, stone===Stone.BLACK ? "black" : "white");
        }
      }
      // Draw last move highlight
      if (this.lastMoveIndex !== null) {
        const idx = this.lastMoveIndex;
        const gridX = idx % this.size;
        const gridY = Math.floor(idx / this.size);
        const cx = (gridX + 1) * this.cellSize;
        const cy = (gridY + 1) * this.cellSize;

        const stoneVal = this.board[idx];
        let circleColor = null;
        if (stoneVal === Stone.BLACK) {
            circleColor = "white";
        } else if (stoneVal === Stone.WHITE) {
            circleColor = "black";
        }

        if (circleColor) {
            this.ctx.save();
            this.ctx.strokeStyle = circleColor;
            this.ctx.lineWidth = 2;
            const radius = this.cellSize / 3.5; // slightly smaller than stone radius
            this.ctx.beginPath();
            this.ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            this.ctx.stroke();
            this.ctx.restore();
        }
      }
    }
  
    drawStone(gridX, gridY, color, opacity=1) {
      const { ctx, cellSize } = this;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(gridX * cellSize, gridY * cellSize, cellSize/2.2, 0, 2*Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.stroke();
      ctx.restore();
    }

    getWebSocketUrl(path) {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${proto}://${window.location.host}${path}`;
    }
  
    connectWebSocket(gameId) {
        // Ensure each spectator has a stable 8-char ID in localStorage
        let specId = localStorage.getItem("zg_player_id");
        if (!specId) {
          const base = crypto.randomUUID?.() 
            ? crypto.randomUUID() 
            : URL.createObjectURL(new Blob());
          specId = base.slice(-8);
          localStorage.setItem("zg_player_id", specId);
        }
    
        const wsPath = `/ws/${gameId}?player_id=${specId}&role=spectator`;
        this.socket = new WebSocket(
          this.getWebSocketUrl(wsPath)
        );

        this.socket.onopen = () => console.log("Spectator WS open:", specId);
    
        this.socket.onmessage = (evt) => {
          const msg = JSON.parse(evt.data);
          switch (msg.type) {
            case "game_state":
              if (!this.firstUpdate) {
                const moves = msg.payload.moves || [];
                if (moves.length > this.prevMoveCount) {
                  const lastMove = moves[moves.length - 1].index;
                  if (lastMove === -1) {
                    this.passSound.play();
                  } else {
                    this.stoneSound.play();
                  }
                }
              }
              this.prevMoveCount = msg.payload.moves.length;
              this.firstUpdate = false;
            case "toggle_dead_stone":
              this.handleGameState(msg.payload);
              break;
            case "chat":
              this.appendChat(msg.sender, msg.text);
              break;
          }
        };
    
        this.socket.onerror = (err) =>
          console.error("Spectator WS error:", err);
        this.socket.onclose = (ev) =>
          console.log("Spectator WS closed:", ev.code, ev.reason);
    }
  
    handleGameState(state) {
      // update board array
      this.board = state.board_state.map(v =>
        v===1 ? Stone.BLACK : v===2 ? Stone.WHITE : Stone.EMPTY
      );
      
      // update last move index
      const allMoves = state.moves || [];
      if (allMoves.length > 0) {
          const lastIdx = allMoves[allMoves.length - 1].index;
          this.lastMoveIndex = lastIdx >= 0 ? lastIdx : null;
      } else {
          this.lastMoveIndex = null;
      }

      // redraw the stones
      this.redrawStones();

      // check game over
      if (state.game_over && !state.in_scoring_phase) {
        const msgDiv = document.getElementById("gameOverMessage");
        let text = "";
        if (state.game_over_reason === "resign") {
          text = `${state.winner} wins by resignation.`;
        } else if (state.game_over_reason === "timeout") {
          text = `${state.winner} wins on time.`;
        } else if (state.final_score) {
          const [b, w] = state.final_score;
          const winner = b>w ? "Black" : w>b ? "White" : "No one";
          text = `Game over. Score: Black ${b} – White ${w}. Winner: ${winner}.`;
        }
        msgDiv.textContent = text;
        msgDiv.style.display = "block";
      }
    }
  
    appendChat(sender, text) {
      const box = document.getElementById("chatMessages");
      const div = document.createElement("div");
      div.textContent = `${sender}: ${text}`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }
  }
  
  async function initSpectate() {
    const state = await fetch(`/game/${gameId}/state`).then(r=>r.json());
    const board = new SpectatorBoard("spectateCanvas", state.board_size, state.rule_set);
    board.connectWebSocket(gameId);
    board.handleGameState(state);
  }
  
  window.addEventListener("DOMContentLoaded", initSpectate);
  