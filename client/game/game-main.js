import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';
import { Card } from './card.js';

document.addEventListener('DOMContentLoaded', () => {
    const gameCore = new GameCore();
    gameCore.Card = Card;
    gameCore.ctx = ctx;

    if (!gameCore.gameState.yourCards) {
        gameCore.gameState.yourCards = [];
    }

    // Inyectar la clase Card en gameCore
    gameCore.Card = Card;

    gameCore.network = new GameNetwork(gameCore);
    gameCore.ui = new GameUI(gameCore);
    gameCore.input = new GameInput(gameCore);

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 700;

    let animationFrameId;
    let lastRenderTime = 0;
    const endTurnButton = document.getElementById('endTurnBtn');

    const initGame = async () => {
        try {
            if (!gameCore.gameState.yourCards) {
                gameCore.gameState.yourCards = [];
            }
            // Cargar assets
            await gameCore.ui.loadAsset('./game/cards-icon.png').then(img => {
                gameCore.historyIcon = img;
            }).catch(console.warn);

            // Event listeners
            endTurnButton.addEventListener('click', () => gameCore.input.endTurn());
            document.getElementById('modalBackdrop').addEventListener('click', () => gameCore.ui.closeHistoryModal());

            // Iniciar juego
            gameLoop();

        } catch (error) {
            console.error('Error de inicialización:', error);
            gameCore.network.showNotification('Error al iniciar', true);
        }
    };

    const gameLoop = (timestamp) => {
        if (timestamp - lastRenderTime < 1000 / gameCore.TARGET_FPS) {
            animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        if (gameCore.dirtyAreas.length > 0 || gameCore.needsRedraw) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1a6b1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            gameCore.clearDirtyAreas();
            gameCore.needsRedraw = false;
        }

        gameCore.ui.drawBoard();
        gameCore.ui.drawHistoryIcons();
        gameCore.ui.handleCardAnimations();
        gameCore.ui.drawPlayerCards();

        if (gameCore.isDragging && gameCore.dragStartCard) {
            gameCore.dragStartCard.draw();
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    };

    window.addEventListener('beforeunload', () => {
        cancelAnimationFrame(animationFrameId);
        if (gameCore.socket) gameCore.socket.close();
    });

    initGame();
});