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
      this.doubleClickEnabled = false;  // never used for spectators
  
      this.resizeCanvas();
      window.addEventListener("resize", () => this.resizeCanvas());
    }
  
    resizeCanvas() {
      const maxSize = window.innerWidth > 768 ? 600 : window.innerWidth - 40;
      const side = Math.min(maxSize, window.innerHeight - 150);
      this.canvas.width = side;
      this.canvas.height = side;
      this.cellSize = side / (this.size + 1);
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
  
    connectWebSocket(gameId) {
        // Ensure each spectator has a stable 8-char ID in localStorage
        let specId = localStorage.getItem("zg_player_id");
        if (!specId) {
          specId = crypto.randomUUID().substring(0, 8);
          localStorage.setItem("zg_player_id", specId);
        }
    
        this.socket = new WebSocket(
          `ws://${window.location.host}/ws/${gameId}?player_id=${specId}&role=spectator`
        );

        this.socket.onopen = () => console.log("Spectator WS open:", specId);
    
        this.socket.onmessage = (evt) => {
          const msg = JSON.parse(evt.data);
          switch (msg.type) {
            case "game_state":
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
  