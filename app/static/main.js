document.addEventListener("DOMContentLoaded", function () {
    
    const createGameBtn = document.getElementById("createGameBtn");
    const boardSizeSelect = document.getElementById("boardSize");
    const gameIdDisplay = document.getElementById("gameIdDisplay");

    const joinGameBtn = document.getElementById("joinGameBtn");
    const gameIdInput = document.getElementById("gameIdInput");

    const allowHandicapsCheckbox = document.getElementById("allowHandicaps");

    const byoYomiPeriodsSelect = document.getElementById("byoYomiPeriods");
    const byoYomiTimeInput = document.getElementById("byoYomiTime");

    /** Handle creating a new game */
    createGameBtn.addEventListener("click", async function () {
        const selectedSize = boardSizeSelect.value;
        const selectedTimeControl = document.getElementById("timeControl").value;
        const existingPlayerId = localStorage.getItem("zg_player_id");
        const komiValue = parseFloat(document.getElementById("komiInput").value);
        const ruleSet = document.getElementById("ruleSet").value;
        const colorPreference = document.getElementById("colorPreference").value;
        const byoYomiPeriods = parseInt(byoYomiPeriodsSelect.value);
        const byoYomiTime = parseInt(byoYomiTimeInput.value) || 0;

        try {
            const response = await fetch("/create_game", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    board_size: selectedSize,
                    time_control: selectedTimeControl,
                    komi: isNaN(komiValue) ? 6.5 : komiValue,
                    ...(existingPlayerId && { player_id: existingPlayerId }),
                    rule_set: ruleSet,
                    color_preference: colorPreference,
                    allow_handicaps: allowHandicapsCheckbox.checked,
                    byo_yomi_periods: byoYomiPeriods,
                    byo_yomi_time: byoYomiTime
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
            const gameResponse = await fetch(`/game/${gameId}/state`);
            if (!gameResponse.ok) {
                alert("Game not found!");
                return;
            }

            const gameData = await gameResponse.json();
            const existingPlayerId = localStorage.getItem("zg_player_id");

            // Step 2: Get player rank if handicaps are allowed
            if (gameData.allow_handicaps) {
                const container = document.getElementById("rankSelectionContainer");
                container.innerHTML = rankSelectionInput();
                document.getElementById("confirmJoinBtn").addEventListener("click", async function () {
                    const confirmButton = document.getElementById("confirmJoinBtn");
                    confirmButton.disabled = true; // Disable immediately

                    const selectedRank = document.getElementById("estimatedRank").value;

                    const joinResponse = await fetch(`/game/${gameId}/join`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            ...(existingPlayerId && { player_id: existingPlayerId }),
                            estimated_rank: selectedRank
                        })
                    });

                    const joinData = await joinResponse.json();

                    clearRankSelectionUI(); // Clear the rank selection UI

                    if (joinResponse.ok) {
                        localStorage.setItem("zg_player_id", joinData.player_id);
                        window.location.href = `/game/${gameId}`;
                    } else if (joinResponse.status === 409) {
                        setTimeout(() => joinGameBtn(gameId), 500);
                    } else {
                        alert(joinData.detail || "Failed to join game.");
                    }
                });
            } else {
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
            }

        } catch (error) {
            console.error("Error joining game:", error);
            clearRankSelectionUI();
            confirmButton.disabled = false;
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

    byoYomiPeriodsSelect.addEventListener("change", () => {
        if (parseInt(byoYomiPeriodsSelect.value) > 0) {
            byoYomiTimeInput.disabled = false;
        } else {
            byoYomiTimeInput.disabled = true;
        }
    });
});

function clearRankSelectionUI() {
    const container = document.getElementById("rankSelectionContainer");
    if (container) container.innerHTML = "";
}

function rankSelectionInput() {
    return `
    <label for="estimatedRank">Your Estimated Rank:</label>
    <select id="estimatedRank">
      <optgroup label="Kyu">
        <option value="30k">30k</option>
        <option value="29k">29k</option>
        <option value="28k">28k</option>
        <option value="27k">27k</option>
        <option value="26k">26k</option>
        <option value="25k">25k</option>
        <option value="24k">24k</option>
        <option value="23k">23k</option>
        <option value="22k">22k</option>
        <option value="21k">21k</option>
        <option value="20k">20k</option>
        <option value="19k">19k</option>
        <option value="18k">18k</option>
        <option value="17k">17k</option>
        <option value="16k">16k</option>
        <option value="15k">15k</option>
        <option value="14k">14k</option>
        <option value="13k">13k</option>
        <option value="12k">12k</option>
        <option value="11k">11k</option>
        <option value="10k">10k</option>
        <option value="9k">9k</option>
        <option value="8k">8k</option>
        <option value="7k">7k</option>
        <option value="6k">6k</option>
        <option value="5k">5k</option>
        <option value="4k">4k</option>
        <option value="3k">3k</option>
        <option value="2k">2k</option>
        <option value="1k">1k</option>
      </optgroup>
      <optgroup label="Dan">
        <option value="1d">1d</option>
        <option value="2d">2d</option>
        <option value="3d">3d</option>
        <option value="4d">4d</option>
        <option value="5d">5d</option>
        <option value="6d">6d</option>
        <option value="7d">7d</option>
        <option value="8d">8d</option>
        <option value="9d">9d</option>
      </optgroup>
      <optgroup label="Dan Pro">
        <option value="1p">1p</option>
        <option value="2p">2p</option>
        <option value="3p">3p</option>
        <option value="4p">4p</option>
        <option value="5p">5p</option>
        <option value="6p">6p</option>
        <option value="7p">7p</option>
        <option value="8p">8p</option>
        <option value="9p">9p</option>
      </optgroup>
    </select>
    <button id="confirmJoinBtn">Confirm and Join</button>
    `;
}
