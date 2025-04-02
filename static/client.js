// =============================================
// CONSTANTES DEL JUEGO
// =============================================
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

// =============================================
// CONFIGURACIÓN DE SOCKET.IO
// =============================================
const socket = io({
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    timeout: 15000,
    transports: ['websocket']
});

// =============================================
// ESTADO DEL JUEGO
// =============================================
let gameState = {
    tablero: null,
    jugadores: {},
    turnoActual: null,
    mazo: null,
    gameOver: false
};

let app;
let cardSprites = {};
let columnZones = {};
let selectedCard = null;
let originalCardPosition = { x: 0, y: 0 };

// =============================================
// ELEMENTOS DE INTERFAZ
// =============================================
const UI = {
    setupScreen: document.getElementById('setup-screen'),
    waitingScreen: document.getElementById('waiting-screen'),
    gameScreen: document.getElementById('game-screen'),
    gameOverScreen: document.getElementById('game-over-screen'),
    playerNameInput: document.getElementById('playerName'),
    gameIdInput: document.getElementById('gameId'),
    displayGameId: document.getElementById('displayGameId'),
    gameInfoDiv: document.getElementById('game-info'),
    gameMessagesDiv: document.getElementById('game-messages'),
    endTurnButton: document.getElementById('endTurn'),
    setupErrorDiv: document.getElementById('setup-error'),
    waitingErrorDiv: document.getElementById('waiting-error'),
    gameResultTitle: document.getElementById('game-result-title'),
    gameResultMessage: document.getElementById('game-result-message')
};

// =============================================
// MANEJO DE CONEXIÓN
// =============================================
function initConnectionStatus() {
    const statusDiv = document.createElement('div');
    statusDiv.id = 'connection-status';
    Object.assign(statusDiv.style, {
        position: 'fixed',
        bottom: '10px',
        right: '10px',
        padding: '8px 15px',
        borderRadius: '15px',
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: 'white',
        fontFamily: 'Arial',
        fontSize: '14px',
        zIndex: '1000'
    });
    document.body.appendChild(statusDiv);
}

function updateConnectionStatus(text, color) {
    const statusDiv = document.getElementById('connection-status');
    if (statusDiv) {
        statusDiv.textContent = text;
        statusDiv.style.color = color;
    }
}

// =============================================
// MANEJADORES DE SOCKET.IO (COMPLETOS)
// =============================================
socket.on('connect', () => {
    console.log('✅ Conectado al servidor');
    updateConnectionStatus('Conectado', '#4CAF50');
});

socket.on('disconnect', () => {
    console.log('❌ Desconectado');
    updateConnectionStatus('Desconectado', '#F44336');
});

socket.on('connect_error', (err) => {
    console.error('Error de conexión:', err);
    updateConnectionStatus('Error de conexión', '#FF9800');
});

socket.on('game_created', (data) => {
    console.log('Juego creado con ID:', data.gameId);
    UI.displayGameId.textContent = data.gameId;
    UI.setupScreen.classList.add('hidden');
    UI.waitingScreen.classList.remove('hidden');
});

socket.on('player_joined', (data) => {
    addMessage(`${data.playerName} se ha unido al juego`);
});

socket.on('game_started', () => {
    UI.waitingScreen.classList.add('hidden');
    UI.gameScreen.classList.remove('hidden');
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

socket.on('game_over', (result) => {
    endGame(result);
});

// =============================================
// FUNCIONES PRINCIPALES (COMPLETAS)
// =============================================
function createGame() {
    const playerName = UI.playerNameInput.value.trim();

    if (!playerName) {
        UI.setupErrorDiv.textContent = 'Por favor ingresa tu nombre';
        return;
    }

    UI.setupErrorDiv.textContent = '';
    socket.emit('create_game', { playerName });
    UI.setupScreen.classList.add('hidden');
    UI.waitingScreen.classList.remove('hidden');
}

function joinGame() {
    const playerName = UI.playerNameInput.value.trim();
    const gameId = UI.gameIdInput.value.trim();

    if (!playerName || !gameId) {
        UI.setupErrorDiv.textContent = 'Por favor ingresa tu nombre y el ID del juego';
        return;
    }

    UI.setupErrorDiv.textContent = '';
    socket.emit('join_game', { playerName, gameId });
}

function endTurn() {
    socket.emit('end_turn');
}

function newGame() {
    UI.gameOverScreen.classList.add('hidden');
    UI.setupScreen.classList.remove('hidden');
    resetGame();
}

function resetGame() {
    if (app) {
        app.destroy(true);
        app = null;
    }
    gameState = {
        tablero: null,
        jugadores: {},
        turnoActual: null,
        mazo: null,
        gameOver: false
    };
    UI.gameMessagesDiv.innerHTML = '';
}

// =============================================
// INICIALIZACIÓN DE PIXI.JS (COMPLETA)
// =============================================
function initializeGame() {
    app = new PIXI.Application({
        width: GAME_CONSTANTS.ANCHO,
        height: GAME_CONSTANTS.ALTO,
        backgroundColor: GAME_CONSTANTS.COLOR_FONDO,
        view: document.getElementById('gameCanvas')
    });

    setupCardInteractions();
    updateGameDisplay();
}

function setupCardInteractions() {
    app.stage.interactive = true;

    app.stage.on('pointerdown', (event) => {
        if (!gameState || gameState.gameOver || gameState.turnoActual !== gameState.playerName) return;

        const pos = event.data.global;

        for (const [id, sprite] of Object.entries(cardSprites)) {
            if (sprite.getBounds().contains(pos.x, pos.y) {
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
        if (!selectedCard) return;

        const pos = event.data.global;
        let played = false;

        for (const [columnName, zone] of Object.entries(columnZones)) {
            if (zone.getBounds().contains(pos.x, pos.y)) {
                socket.emit('play_card', {
                    column: columnName,
                    cardValue: selectedCard.cardValue
                });
                played = true;
                break;
            }
        }

        if (!played) {
            selectedCard.x = originalCardPosition.x;
            selectedCard.y = originalCardPosition.y;
        }

        selectedCard.zIndex = 0;
        selectedCard = null;
        app.stage.sortChildren();
    });
}

// =============================================
// RENDERIZADO DEL JUEGO (COMPLETO)
// =============================================
function updateGameDisplay() {
    if (!app || !gameState.tablero) return;

    app.stage.removeChildren();
    cardSprites = {};
    columnZones = {};

    renderBoard();
    renderPlayerHands();
    updateGameInfo();

    if (gameState.gameOver) {
        endGame(gameState.resultado);
    }
}

function renderBoard() {
    const board = gameState.tablero;
    const columnNames = Object.keys(board.columnas);
    const totalWidth = (columnNames.length * GAME_CONSTANTS.ANCHO_COLUMNA) +
        ((columnNames.length - 1) * GAME_CONSTANTS.ESPACIADO_COLUMNAS);
    const startX = (GAME_CONSTANTS.ANCHO - totalWidth) / 2;
    const yPos = GAME_CONSTANTS.ALTO / 2 - GAME_CONSTANTS.ALTO_COLUMNA / 2;

    columnNames.forEach((columnName, i) => {
        const x = startX + i * (GAME_CONSTANTS.ANCHO_COLUMNA + GAME_CONSTANTS.ESPACIADO_COLUMNAS);

        // Fondo de columna
        const columnBg = new PIXI.Graphics();
        columnBg.beginFill(0xFFFFFF, 0.2);
        columnBg.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        columnBg.endFill();
        columnBg.lineStyle(4, 0x000000);
        columnBg.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        app.stage.addChild(columnBg);

        // Título de columna
        const titleStyle = new PIXI.TextStyle({
            fontFamily: 'Arial',
            fontSize: 20,
            fill: gameState.turnoActual === gameState.playerName ? 0xFFFF00 : 0x000000
        });

        const title = new PIXI.Text(columnName, titleStyle);
        title.x = x + (GAME_CONSTANTS.ANCHO_COLUMNA - title.width) / 2;
        title.y = yPos - 30;
        app.stage.addChild(title);

        // Zona interactiva
        const columnZone = new PIXI.Graphics();
        columnZone.beginFill(0xFF0000, 0);
        columnZone.drawRect(x, yPos, GAME_CONSTANTS.ANCHO_COLUMNA, GAME_CONSTANTS.ALTO_COLUMNA);
        columnZone.endFill();
        columnZone.interactive = true;
        columnZones[columnName] = columnZone;
        app.stage.addChild(columnZone);

        // Última carta de la columna
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

function renderPlayerHands() {
    const players = gameState.jugadores;
    const playerNames = Object.keys(players);

    playerNames.forEach((playerName, playerIndex) => {
        const player = players[playerName];
        const isCurrentPlayer = playerName === gameState.playerName;
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

            // Resaltar cartas jugables
            if (isCurrentPlayer && gameState.turnoActual === gameState.playerName) {
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
                    highlight.drawRoundedRect(-5, -5, cardSprite.width + 10, cardSprite.height + 10, 5);
                    cardSprite.addChild(highlight);
                }
            }

            cardSprites[`${playerName}_${card.valor}`] = cardSprite;
            app.stage.addChild(cardSprite);
        });
    });
}

function createCardSprite(cardData, owner = null) {
    const card = new PIXI.Graphics();
    card.beginFill(cardData.color || GAME_CONSTANTS.COLOR_CARTA);
    card.drawRoundedRect(0, 0, GAME_CONSTANTS.ANCHO_CARTA, GAME_CONSTANTS.ALTO_CARTA, 8);
    card.endFill();
    card.lineStyle(2, 0x000000, 0.3);
    card.drawRoundedRect(0, 0, GAME_CONSTANTS.ANCHO_CARTA, GAME_CONSTANTS.ALTO_CARTA, 8);

    // Valor de la carta
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

    // Datos de la carta
    card.cardValue = cardData.valor;
    card.cardOwner = owner;
    card.interactive = owner === gameState.playerName;

    return card;
}

function isCardPlayable(card, columnName, hand) {
    const column = gameState.tablero.columnas[columnName];
    if (!column || column.length === 0) return true;

    const lastCard = column[column.length - 1];

    if (columnName.includes('ascendente')) {
        return card.valor > lastCard.valor ||
            (card.valor === lastCard.valor - 10 && hand.some(c => c.valor === lastCard.valor - 10));
    } else {
        return card.valor < lastCard.valor ||
            (card.valor === lastCard.valor + 10 && hand.some(c => c.valor === lastCard.valor + 10));
    }
}

// =============================================
// INTERFAZ DE USUARIO (COMPLETA)
// =============================================
function updateGameInfo() {
    const players = gameState.jugadores;
    const currentPlayer = gameState.turnoActual;
    const isMyTurn = currentPlayer === gameState.playerName;
    const deckCount = gameState.mazo.cartas_restantes;

    let infoHTML = `<h2>Jugadores:</h2><ul style="list-style-type: none; padding: 0;">`;

    for (const [playerName, player] of Object.entries(players)) {
        infoHTML += `<li>${playerName}${playerName === currentPlayer ? ' (Turno actual)' : ''} - Cartas: ${player.mano.length}</li>`;
    }

    infoHTML += `</ul><p>Cartas en mazo: ${deckCount}</p>`;
    infoHTML += `<p>${isMyTurn ? '¡Es tu turno!' : 'Esperando a otro jugador...'}</p>`;

    UI.gameInfoDiv.innerHTML = infoHTML;
    UI.endTurnButton.disabled = !isMyTurn || gameState.gameOver;
}

function addMessage(text, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.textContent = text;
    messageDiv.className = type === 'error' ? 'error-message' :
        type === 'success' ? 'success-message' : '';

    UI.gameMessagesDiv.appendChild(messageDiv);
    UI.gameMessagesDiv.scrollTop = UI.gameMessagesDiv.scrollHeight;
}

function endGame(result) {
    UI.gameScreen.classList.add('hidden');
    UI.gameOverScreen.classList.remove('hidden');

    UI.gameResultTitle.textContent = result.includes('VICTORY') ? '¡Felicidades!' :
        result.includes('Derrota') ? '¡Juego Terminado!' :
            '¡Resultado del Juego!';
    UI.gameResultMessage.textContent = result;
}

// =============================================
// INICIALIZACIÓN (COMPLETA)
// =============================================
document.addEventListener('DOMContentLoaded', () => {
    initConnectionStatus();
    updateConnectionStatus('Conectando...', '#FFC107');

    UI.playerNameInput.focus();

    UI.playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createGame();
    });

    UI.gameIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinGame();
    });
});