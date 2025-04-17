document.addEventListener("DOMContentLoaded", function () {
    
    const createGameBtn = document.getElementById("createGameBtn");
    const boardSizeSelect = document.getElementById("boardSize");
    const gameIdDisplay = document.getElementById("gameIdDisplay");

    const joinGameBtn = document.getElementById("joinGameBtn");
    const gameIdInput = document.getElementById("gameIdInput");

    /** Handle creating a new game */
    createGameBtn.addEventListener("click", async function () {
        const selectedSize = boardSizeSelect.value;
        const selectedTimeControl = document.getElementById("timeControl").value;
        const existingPlayerId = localStorage.getItem("zg_player_id");
        const komiValue = parseFloat(document.getElementById("komiInput").value);
        const ruleSet = document.getElementById("ruleSet").value;

        try {
            const response = await fetch("/create_game", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    board_size: selectedSize,
                    time_control: selectedTimeControl,
                    komi: isNaN(komiValue) ? 7.5 : komiValue,
                    ...(existingPlayerId && { player_id: existingPlayerId }),
                    rule_set: ruleSet
                })
            });

            const data = await response.json();

            if (response.ok && data.game_id) {
                // Save (or preserve) the player_id
                localStorage.setItem("zg_player_id", data.player_id);

                gameIdDisplay.textContent = `Game ID: ${data.game_id}`;
            } else {
                alert(data.detail || "Failed to create game.");
                console.error("Error creating game:", data.detail || data.error);
            }
        } catch (error) {
            console.error("Failed to create game:", error);
        }
    });


    /** Handle joining an existing game */
    joinGameBtn.addEventListener("click", async function () {
        const gameId = gameIdInput.value.trim();
        if (!gameId) {
            alert("Please enter a valid Game ID.");
            return;
        }

        try {
            // Step 1: Check if game exists
            const gameResponse = await fetch(`/game/${gameId}`);
            if (!gameResponse.ok) {
                alert("Game not found!");
                return;
            }

            // Step 2: Get stored player_id (if any)
            const existingPlayerId = localStorage.getItem("zg_player_id");

            // Step 3: Attempt to join the game
            const joinResponse = await fetch(`/game/${gameId}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...(existingPlayerId && { player_id: existingPlayerId })
                })
            });

            const joinData = await joinResponse.json();
            if (joinResponse.ok) {
                localStorage.setItem("zg_player_id", joinData.player_id); // Store player ID in local storage
                window.location.href = `/game/${gameId}`;
            } else if (joinResponse.status === 409) {
                setTimeout(() => joinGameBtn(gameId), 500); //Retry after 500ms
            } else {
                alert(joinData.detail || "Failed to join game.");
            }

        } catch (error) {
            console.error("Error joining game:", error);
        }
    });

    //Other Event listeners
    document.getElementById("ruleSet").addEventListener("change", function () {
        const komiInput = document.getElementById("komiInput");
        const selectedRule = this.value;
      
        if (selectedRule === "japanese") {
          komiInput.value = 6.5;
        } else if (selectedRule === "chinese") {
          komiInput.value = 7.5;
        }
      });

});
