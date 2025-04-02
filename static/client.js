// Game constants matching Python constants
const GAME_CONSTANTS = {
    ANCHO: 1200,
    ALTO: 800,
    COLOR_FONDO: 0x228B22,
    COLOR_CARTA: 0xFFFFFF,
    COLOR_CARTA_JUGADOR: 0x3399FF,
    COLOR_CARTA_IA: 0xFF9999,
    COLOR_TEXTO: 0x000000,
    ANCHO_CARTA: 80,
    ALTO_CARTA: 120,
    ESPACIADO_COLUMNAS: 80,
    ANCHO_COLUMNA: 160,
    ALTO_COLUMNA: 240
};

// Initialize Socket.IO connection
const socket = io();

// Game state
let gameState = null;
let currentPlayerName = '';
let gameId = '';
let app = null;
let cardSprites = {};
let columnZones = {};
let selectedCard = null;
let originalCardPosition = { x: 0, y: 0 };

// DOM Elements
const setupScreen = document.getElementById('setup-screen');
const waitingScreen = document.getElementById('waiting-screen');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const playerNameInput = document.getElementById('playerName');
const gameIdInput = document.getElementById('gameId');
const displayGameId = document.getElementById('displayGameId');
const gameInfoDiv = document.getElementById('game-info');
const gameMessagesDiv = document.getElementById('game-messages');
const endTurnButton = document.getElementById('endTurn');
const setupErrorDiv = document.getElementById('setup-error');
const waitingErrorDiv = document.getElementById('waiting-error');
const gameResultTitle = document.getElementById('game-result-title');
const gameResultMessage = document.getElementById('game-result-message');

// Event Listeners
document.getElementById('createGame').addEventListener('click', createGame);
document.getElementById('joinGame').addEventListener('click', joinGame);
document.getElementById('endTurn').addEventListener('click', endTurn);
document.getElementById('newGameButton').addEventListener('click', newGame);

// Handle creating a new game
function createGame() {
    const playerName = playerNameInput.value.trim();

    if (!playerName) {
        setupErrorDiv.textContent = 'Por favor ingresa tu nombre';
        return;
    }

    setupErrorDiv.textContent = '';
    currentPlayerName = playerName;

    socket.emit('create_game', { playerName });
    setupScreen.classList.add('hidden');
    waitingScreen.classList.remove('hidden');
}

// Handle joining an existing game
function joinGame() {
    const playerName = playerNameInput.value.trim();
    const gameId = gameIdInput.value.trim();

    if (!playerName || !gameId) {
        setupErrorDiv.textContent = 'Por favor ingresa tu nombre y el ID del juego';
        return;
    }

    setupErrorDiv.textContent = '';
    currentPlayerName = playerName;

    socket.emit('join_game', {
        playerName,
        gameId: gameId
    });
}

// Handle ending turn
function endTurn() {
    socket.emit('end_turn');
}

// Start a new game after game over
function newGame() {
    gameOverScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    resetGame();
}

// Reset game state
function resetGame() {
    if (app) {
        app.destroy(true);
        app = null;
    }
    gameState = null;
    cardSprites = {};
    columnZones = {};
    selectedCard = null;
    gameMessagesDiv.innerHTML = '';
}

// Socket.IO event handlers
socket.on('game_created', (data) => {
    gameId = data.gameId;
    displayGameId.textContent = gameId;
});

socket.on('player_joined', (data) => {
    waitingErrorDiv.textContent = '';
    addMessage(`${data.playerName} se ha unido al juego`);
});

socket.on('game_started', () => {
    waitingScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    initializeGame();
});

socket.on('game_state', (state) => {
    gameState = state;
    updateGameDisplay();
});

socket.on('play_success', (data) => {
    addMessage(data.message, 'success');
});

socket.on('play_error', (data) => {
    addMessage(data.message, 'error');
});

socket.on('turn_ended', (data) => {
    addMessage(`Turno cambiado a ${data.nextPlayer}`);
});

socket.on('turn_error', (data) => {
    addMessage(data.message, 'error');
});

socket.on('join_error', (data) => {
    if (waitingScreen.classList.contains('hidden')) {
        setupErrorDiv.textContent = data.message;
    } else {
        waitingErrorDiv.textContent = data.message;
    }
});

socket.on('player_left', (data) => {
    addMessage(`${data.playerName} ha abandonado el juego`, 'error');
    endGame(`El juego ha terminado porque ${data.playerName} se desconectó`);
});

socket.on('game_over', (result) => {
    endGame(result);
});

// Initialize PixiJS game
function initializeGame() {
    app = new PIXI.Application({
        width: GAME_CONSTANTS.ANCHO,
        height: GAME_CONSTANTS.ALTO,
        backgroundColor: GAME_CONSTANTS.COLOR_FONDO,
        view: document.getElementById('gameCanvas')
    });

    // Setup card interaction
    setupCardInteractions();

    // Initial render
    updateGameDisplay();
}

// Setup card drag and drop
function setupCardInteractions() {
    app.stage.interactive = true;

    app.stage.on('pointerdown', (event) => {
        if (!gameState || gameState.game_over || gameState.turno !== currentPlayerName) {
            return;
        }

        const pos = event.data.global;

        // Check if clicking on a card in hand
        for (const [id, sprite] of Object.entries(cardSprites)) {
            if (sprite.getBounds().contains(pos.x, pos.y) && sprite.cardOwner === currentPlayerName) {
                selectedCard = sprite;
                originalCardPosition = { x: sprite.x, y: sprite.y };
                sprite.zIndex = 100;
                app.stage.sortChildren();
                break;
            }
        }
    });

    app.stage.on('pointermove', (event) => {
        if (selectedCard) {
            const pos = event.data.global;
            selectedCard.x = pos.x - selectedCard.width / 2;
            selectedCard.y = pos.y - selectedCard.height / 2;
        }
    });

    app.stage.on('pointerup', (event) => {
        if (selectedCard) {
            const pos = event.data.global;
            let played = false;

            // Check if dropped on a column
            for (const [columnName, zone] of Object.entries(columnZones)) {
                if (zone.getBounds().contains(pos.x, pos.y)) {
                    // Emit play card event
                    socket.emit('play_card', {
                        column: columnName,
                        cardValue: selectedCard.cardValue
                    });
                    played = true;
                    break;
                }
            }

            // Return card to original position if not played
            if (!played) {
                selectedCard.x = originalCardPosition.x;
                selectedCard.y = originalCardPosition.y;
            }

            selectedCard.zIndex = 0;
            selectedCard = null;
            app.stage.sortChildren();
        }
    });
}

// Update game display based on current state
function updateGameDisplay() {
    if (!app || !gameState) return;

    // Clear previous sprites
    app.stage.removeChildren();
    cardSprites = {};
    columnZones = {};

    // Draw board columns
    drawBoard();

    // Draw player hands
    drawPlayerHands();

    // Update game info
    updateGameInfo();

    // Check if game is over
    if (gameState.game_over) {
        endGame(gameState.resultado);
    }
}

// Draw the game board
function drawBoard() {
    const board = gameState.tablero;
    const columnNames = Object.keys(board.columnas);
    const totalWidth = (columnNames.length * GAME_CONSTANTS.ANCHO_COLUMNA) +
        ((columnNames.length - 1) * GAME_CONSTANTS.ESPACIADO_COLUMNAS);
    const startX = (GAME_CONSTANTS.ANCHO - totalWidth) / 2;
    const yPos = GAME_CONSTANTS.ALTO / 2 - GAME_CONSTANTS.ALTO_COLUMNA / 2;

    // Draw columns
    columnNames.forEach((columnName, i) => {
        const x = startX + i * (GAME_CONSTANTS.ANCHO_COLUMNA + GAME_CONSTANTS.ESPACIADO_COLUMNAS);

        // Column background
        const columnBg = new PIXI.Graphics();
        columnBg.beginFill(0xFFFFFF, 0.2);
        columnBg.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        columnBg.endFill();
        columnBg.lineStyle(4, 0x000000);
        columnBg.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        app.stage.addChild(columnBg);

        // Column title
        const titleStyle = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 20,
            fill: gameState.turno === currentPlayerName ? 0xFFFF00 : 0x000000,
            align: 'center'
        });

        const title = new PIXI.Text(columnName, titleStyle);
        title.x = x + (GAME_CONSTANTS.ANCHO_COLUMNA - title.width) / 2;
        title.y = yPos - 30;
        app.stage.addChild(title);

        // Store column zone for drop targets
        const columnZone = new PIXI.Graphics();
        columnZone.beginFill(0xFF0000, 0);
        columnZone.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        columnZone.endFill();
        columnZone.interactive = true;
        columnZones[columnName] = columnZone;
        app.stage.addChild(columnZone);

        // Draw last card in column
        const columnCards = board.columnas[columnName];
        if (columnCards.length > 0) {
            const lastCard = columnCards[columnCards.length - 1];
            const cardSprite = createCardSprite(lastCard);
            cardSprite.x = x + (GAME_CONSTANTS.ANCHO_COLUMNA - GAME_CONSTANTS.ANCHO_CARTA) / 2;
            cardSprite.y = yPos + (GAME_CONSTANTS.ALTO_COLUMNA - GAME_CONSTANTS.ALTO_CARTA) / 2;
            cardSprite.interactive = false;
            app.stage.addChild(cardSprite);
        }
    });
}

// Draw player hands
function drawPlayerHands() {
    const players = gameState.players;
    const playerNames = Object.keys(players);

    playerNames.forEach((playerName, playerIndex) => {
        const player = players[playerName];
        const isCurrentPlayer = playerName === currentPlayerName;
        const hand = player.mano;
        const margin = 20;
        const totalWidth = GAME_CONSTANTS.ANCHO - 2 * margin;
        const cardSpacing = Math.min(100, totalWidth / Math.max(1, hand.length));
        const startX = margin + (totalWidth - (hand.length * cardSpacing)) / 2;
        const yPos = GAME_CONSTANTS.ALTO - (playerIndex === 0 ? 150 : 50);

        hand.forEach((card, i) => {
            const cardSprite = createCardSprite(card, playerName);
            cardSprite.x = startX + i * cardSpacing;
            cardSprite.y = yPos;

            // Highlight playable cards
            if (isCurrentPlayer && gameState.turno === currentPlayerName) {
                let isPlayable = false;
                for (const columnName in gameState.tablero.columnas) {
                    if (isCardPlayable(card, columnName, hand)) {
                        isPlayable = true;
                        break;
                    }
                }

                if (isPlayable) {
                    const highlight = new PIXI.Graphics();
                    highlight.lineStyle(3, 0x00FF00);
                    highlight.drawRoundedRect(
                        -5, -5,
                        cardSprite.width + 10,
                        cardSprite.height + 10,
                        5
                    );
                    cardSprite.addChild(highlight);
                }
            }

            cardSprites[`${playerName}_${card.valor}`] = cardSprite;
            app.stage.addChild(cardSprite);
        });
    });
}

// Create a card sprite
function createCardSprite(cardData, owner = null) {
    const card = new PIXI.Graphics();
    card.beginFill(cardData.color || GAME_CONSTANTS.COLOR_CARTA);
    card.drawRoundedRect(0, 0, GAME_CONSTANTS.ANCHO_CARTA, GAME_CONSTANTS.ALTO_CARTA, 8);
    card.endFill();
    card.lineStyle(2, 0x000000, 0.3);
    card.drawRoundedRect(0, 0, GAME_CONSTANTS.ANCHO_CARTA, GAME_CONSTANTS.ALTO_CARTA, 8);

    // Card value
    const style = new PIXI.TextStyle({
        fontFamily: 'Arial',
        fontSize: 24,
        fill: GAME_CONSTANTS.COLOR_TEXTO,
        align: 'center'
    });

    const valueText = new PIXI.Text(cardData.valor.toString(), style);
    valueText.anchor.set(0.5);
    valueText.x = GAME_CONSTANTS.ANCHO_CARTA / 2;
    valueText.y = GAME_CONSTANTS.ALTO_CARTA / 2;
    card.addChild(valueText);

    // Store card data
    card.cardValue = cardData.valor;
    card.cardOwner = owner;
    card.interactive = owner === currentPlayerName;

    return card;
}

// Check if card can be played in column
function isCardPlayable(card, columnName, hand) {
    // Simplified check - actual validation happens on server
    const column = gameState.tablero.columnas[columnName];

    if (column.length === 0) {
        return true;
    }

    const lastCard = column[column.length - 1];

    if (columnName.includes('ascendente')) {
        return card.valor > lastCard.valor ||
            (card.valor === lastCard.valor - 10 && hand.some(c => c.valor === lastCard.valor - 10));
    } else {
        return card.valor < lastCard.valor ||
            (card.valor === lastCard.valor + 10 && hand.some(c => c.valor === lastCard.valor + 10));
    }
}

// Update game info display
function updateGameInfo() {
    const players = gameState.players;
    const currentPlayer = gameState.turno;
    const isMyTurn = currentPlayer === currentPlayerName;
    const deckCount = gameState.mazo.cartas_restantes;

    let infoHTML = `
        <h2>Jugadores:</h2>
        <ul style="list-style-type: none; padding: 0;">
    `;

    for (const [playerName, player] of Object.entries(players)) {
        infoHTML += `
            <li>
                ${playerName}${playerName === currentPlayer ? ' (Turno actual)' : ''}
                - Cartas: ${player.mano.length}
            </li>
        `;
    }

    infoHTML += `</ul>`;
    infoHTML += `<p>Cartas en mazo: ${deckCount}</p>`;
    infoHTML += `<p>${isMyTurn ? '¡Es tu turno!' : 'Esperando a otro jugador...'}</p>`;

    gameInfoDiv.innerHTML = infoHTML;
    endTurnButton.disabled = !isMyTurn || gameState.game_over;
}

// Add message to game messages
function addMessage(text, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.textContent = text;
    messageDiv.className = type === 'error' ? 'error-message' :
        type === 'success' ? 'success-message' : '';

    gameMessagesDiv.appendChild(messageDiv);
    gameMessagesDiv.scrollTop = gameMessagesDiv.scrollHeight;
}

// Handle game over
function endGame(result) {
    gameScreen.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');

    gameResultTitle.textContent = result.includes('VICTORY') ? '¡Felicidades!' :
        result.includes('Derrota') ? '¡Juego Terminado!' :
            '¡Resultado del Juego!';
    gameResultMessage.textContent = result;
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Focus player name input
    playerNameInput.focus();

    // Handle Enter key in inputs
    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createGame();
    });

    gameIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinGame();
    });
});