document.addEventListener("DOMContentLoaded", function () {
    
    const createGameBtn = document.getElementById("createGameBtn");
    const boardSizeSelect = document.getElementById("boardSize");
    const gameIdDisplay = document.getElementById("gameIdDisplay");

    const joinGameBtn = document.getElementById("joinGameBtn");
    const gameIdInput = document.getElementById("gameIdInput");

    const allowHandicapsCheckbox = document.getElementById("allowHandicaps");

    const byoYomiPeriodsSelect = document.getElementById("byoYomiPeriods");
    const byoYomiTimeInput = document.getElementById("byoYomiTime");

    const gameTypeSelect = document.getElementById("gameType");
    const createRankContainer = document.getElementById("createRankContainer");

    const spectateGameInput = document.getElementById("spectateGameId");
    const spectateBtn = document.getElementById("spectateBtn");

    let publicPage = 1;
    const perPage = 5;

    const publicAllCheckbox      = document.getElementById("publicAll");
    const filterBoardSizeSelect  = document.getElementById("filterBoardSize");
    const filterTimeControlSel   = document.getElementById("filterTimeControl");
    const filterHandicapCheckbox = document.getElementById("filterHandicap");
    const publicFilterBtn        = document.getElementById("publicFilterBtn");
    const publicTableBody        = document.querySelector("#publicGamesTable tbody");
    const publicCardsContainer   = document.getElementById("publicGamesCards");
    const prevPageBtn            = document.getElementById("prevPageBtn");
    const nextPageBtn            = document.getElementById("nextPageBtn");
    const pageInfoSpan           = document.getElementById("pageInfo");

    //////////////////////////////////
    /// Handle creating a new game ///
    //////////////////////////////////

    createGameBtn.addEventListener("click", async function () {
        const selectedSize = boardSizeSelect.value;
        const selectedTimeControl = document.getElementById("timeControl").value;
        const existingPlayerId = localStorage.getItem("zg_player_id");
        const komiValue = parseFloat(document.getElementById("komiInput").value);
        const ruleSet = document.getElementById("ruleSet").value;
        const colorPreference = document.getElementById("colorPreference").value;
        const byoYomiPeriods = parseInt(byoYomiPeriodsSelect.value);
        const byoYomiTime = parseInt(byoYomiTimeInput.value) || 0;
        const gameType = document.getElementById("gameType").value;
        const creatorRank = document.getElementById("creatorEstimatedRank") ? document.getElementById("creatorEstimatedRank").value : null;

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
                    byo_yomi_time: byoYomiTime,
                    game_type: gameType,
                    creator_rank: creatorRank
                })
            });

            const data = await response.json();

            if (response.ok && data.game_id) {
                // Save (or preserve) the player_id
                localStorage.setItem("zg_player_id", data.player_id);

                //Redirect to the game page if public game
                if (gameType === "public") {
                    window.location.href = `/game/${data.game_id}`;
                    return;
                }

                gameIdDisplay.innerHTML = "";

                // Create a label span
                const labelSpan = document.createElement("span");
                labelSpan.textContent = "Your Game ID: ";
                labelSpan.style.fontWeight = "600";

                // Create a button whose text is the new game ID
                const copyBtn = document.createElement("button");
                copyBtn.textContent = data.game_id;
                copyBtn.style.cursor = "pointer";
                copyBtn.style.fontWeight = "600";
                copyBtn.title = "Click to copy Game ID";

                // When clicked, copy to clipboard and show temporary “Copied!” feedback
                copyBtn.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(data.game_id);
                        copyBtn.textContent = "Copied!";
                        setTimeout(() => {
                            copyBtn.textContent = data.game_id;
                        }, 1500);
                    } catch (e) {
                        console.error("Clipboard write failed:", e);
                        alert("Could not copy automatically—please select & copy the ID manually.");
                    }
                });

                // Insert that button under gameIdDisplay
                gameIdDisplay.append(labelSpan, copyBtn);

                // 3) Autofill the “join” input so creator can immediately join
                gameIdInput.value = data.game_id;
            } else {
                alert(data.detail || "Failed to create game.");
                console.error("Error creating game:", data.detail || data.error);
            }
        } catch (error) {
            console.error("Failed to create game:", error);
        }
    });

    ///////////////////////////////////////
    /// Handle joining an existing game ///
    ///////////////////////////////////////

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
                container.innerHTML = getRankSelectHTML("estimatedRank") + getConfirmJoinButtonHTML("confirmJoinBtn", "Confirm and Join");
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

    ////////////////////////
    /// PUBLIC GAME MENU ///
    ////////////////////////

    async function fetchPublicGames() {
        const params = new URLSearchParams();
      
        // Only apply filters when “All” is unchecked
        if (!publicAllCheckbox.checked) {
          const bs = filterBoardSizeSelect.value;
          if (bs) params.set("board_size", bs);
      
          const tc = filterTimeControlSel.value;
          if (tc) params.set("time_control", tc);
      
          if (filterHandicapCheckbox.checked) {
            params.set("allow_handicaps", "true");
          }
      
          const byp = document.getElementById("filterByoYomiPeriods").value;
          if (byp) params.set("byo_yomi_periods", byp);
      
          const byt = document.getElementById("filterByoYomiTime").value;
          if (byt) params.set("byo_yomi_time", byt);
      
          const rs = document.getElementById("filterRuleSet").value;
          if (rs) params.set("rule_set", rs);
      
          const cp = document.getElementById("filterColorPref").value;
          if (cp) params.set("color_preference", cp);
      
          const km = document.getElementById("filterKomi").value;
          if (km) params.set("komi", km);
        }
      
        params.set("page", publicPage);
        params.set("per_page", perPage);
      
        const res = await fetch(`/games/public?${params.toString()}`);
        if (!res.ok) {
          console.error("Failed to fetch public games", res.statusText);
          return;
        }
        const data = await res.json();
      
        // Render rows
        publicTableBody.innerHTML = "";
        data.games.forEach(g => {
          const row = document.createElement("tr");
          row.innerHTML = `
            <td>${g.id}</td>
            <td>${g.board_size}×${g.board_size}</td>
            <td>${g.time_control}</td>
            <td>${g.allow_handicaps ? "Yes" : "No"}</td>
            <td>${g.byo_yomi_periods}</td>
            <td>${g.byo_yomi_time}</td>
            <td>${g.rule_set}</td>
            <td>${g.color_preference}</td>
            <td>${g.komi}</td>
            <td><button class="joinPublicBtn" data-id="${g.id}">Join</button></td>
          `;
          publicTableBody.appendChild(row);
        });
      
        // Update pagination UI
        const totalPages = Math.ceil(data.total / data.per_page);
        pageInfoSpan.textContent = `Page ${data.page} of ${totalPages}`;
        prevPageBtn.disabled = data.page <= 1;
        nextPageBtn.disabled = data.page >= totalPages;

        //Cards
        const cardsContainer = document.getElementById("publicGamesCards");
        cardsContainer.innerHTML = data.games.map(g => `
        <details class="public-card">
            <summary>
            <strong>ID: </strong>${g.id} &nbsp;&bull;&nbsp; <strong>Size</strong>: ${g.board_size} &nbsp;&bull;&nbsp; <strong>Time:</strong> ${g.time_control} &nbsp;&bull;&nbsp; <strong>HC:</strong> ${g.allow_handicaps ? "Yes" : "No"}
            </summary>
            <div class="card-details">
            <p>Byo-yomi: ${g.byo_yomi_periods} × ${g.byo_yomi_time}s</p>
            <p>Ruleset: ${g.rule_set}</p>
            <p>Color: ${g.color_preference}</p>
            <p>Komi: ${g.komi}</p>
            <button class="joinPublicBtn" data-id="${g.id}">Join</button>
            </div>
        </details>
        `).join("");
    }
      
    
    // handle filter & pagination clicks
    publicFilterBtn.addEventListener("click", () => { publicPage = 1; fetchPublicGames(); });
    prevPageBtn.addEventListener("click", () => { publicPage--; fetchPublicGames(); });
    nextPageBtn.addEventListener("click", () => { publicPage++; fetchPublicGames(); });
    
    // delegate “Join” clicks in table and cards
    function delegateJoinClick(e) {
        if (!e.target.classList.contains("joinPublicBtn")) return;
        const gameId = e.target.dataset.id;
        // reuse join flow
        gameIdInput.value = gameId;
        joinGameBtn.click();
        }
        publicTableBody.addEventListener("click", delegateJoinClick);
        publicCardsContainer.addEventListener("click", delegateJoinClick);
    
    // initial load
    fetchPublicGames();

    ///////////////////////////////////////
    /// Other Event listeners and setup ///
    ///////////////////////////////////////

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

    // Handle spectate button click //
    spectateBtn.addEventListener("click", async () => {
        const id = spectateGameInput.value.trim();
        if (!id) {
          alert("Please enter a valid Game ID to spectate.");
          return;
        }
      
        const resp = await fetch(`/game/${id}/state`);
        if (!resp.ok) {
          alert("Game not found or has ended.");
          return;
        }
      
        window.location.href = `/spectate/${id}`;
      });

    // Handle rank selection UI for creator //
    function updateCreateRankUI() {
        if (gameTypeSelect.value === "public" && allowHandicapsCheckbox.checked) {
          createRankContainer.innerHTML = getRankSelectHTML("creatorEstimatedRank");
        } else {
          createRankContainer.innerHTML = "";
        }
    }
    gameTypeSelect.addEventListener("change", updateCreateRankUI);
    allowHandicapsCheckbox.addEventListener("change", updateCreateRankUI);
    updateCreateRankUI();
    loadSiteSettings();
});

function clearRankSelectionUI() {
    const container = document.getElementById("rankSelectionContainer");
    if (container) container.innerHTML = "";
}

function getRankSelectHTML(selectId = "estimatedRank") {
    return `
    <label for=${selectId}>Your Estimated Rank:</label>
    <select id=${selectId}>
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
    `;
}

function getConfirmJoinButtonHTML(buttonId = "confirmJoinBtn", text = "Confirm and Join") {
    return `<button id="${buttonId}">${text}</button>`;
}

async function loadSiteSettings() {
    try {
        const res = await fetch("/settings");
        if (!res.ok) return;
        const s = await res.json();

        // Snackbar
        if (s.snackbar_active) {
        const sb = document.getElementById("snackbar");
        sb.textContent = s.snackbar_message;
        sb.classList.add("show");
        setTimeout(() => sb.classList.remove("show"), s.snackbar_timeout_seconds * 1000);
        }

        // Sponsor
        if (s.sponsor_active) {
        const container = document.getElementById("sponsor-container");
        container.classList.add("active");

        const link = document.createElement("a");
        link.href = s.sponsor_target_url || "#";

        const imgDesktop = document.createElement("img");
        imgDesktop.src = s.sponsor_image_desktop;
        imgDesktop.alt = "Sponsor";
        imgDesktop.classList.add("desktop");

        const imgMobile = document.createElement("img");
        imgMobile.src = s.sponsor_image_mobile;
        imgMobile.alt = "Sponsor";
        imgMobile.classList.add("mobile");

        link.append(imgDesktop, imgMobile);
        container.append(link);
        }
    } catch (err) {
        console.error("Could not load site settings:", err);
    }
}