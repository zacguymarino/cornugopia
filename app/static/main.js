document.addEventListener("DOMContentLoaded", function () {
    
    const createGameBtn = document.getElementById("createGameBtn");
    const boardSizeSelect = document.getElementById("boardSize");
    const gameIdDisplay = document.getElementById("gameIdDisplay");

    const joinGameBtn = document.getElementById("joinGameBtn");
    const gameIdInput = document.getElementById("gameIdInput");

    /** Handle creating a new game */
    createGameBtn.addEventListener("click", async function () {
        const selectedSize = boardSizeSelect.value;

        try {
            const response = await fetch("/create_game", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ board_size: selectedSize })
            });

            const data = await response.json();
            if (data.game_id) {
                gameIdDisplay.textContent = `Game ID: ${data.game_id}`;
                console.log(`Game created with ID: ${data.game_id}`);
            } else {
                console.error("Error creating game:", data.error);
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

            // Step 2: Attempt to join the game
            const joinResponse = await fetch(`/game/${gameId}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" }
            });

            const joinData = await joinResponse.json();
            if (joinResponse.ok) {
                sessionStorage.setItem("player_id", joinData.player_id); // Store player ID in session storage
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

});
