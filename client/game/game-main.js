import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';
import { Card } from './card.js';

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 700;

    const gameCore = new GameCore();
    gameCore.ctx = ctx;
    gameCore.Card = Card;

    // Notificar que la UI está lista
    gameCore.network.setUIReady();

    let animationFrameId;
    let lastRenderTime = 0;
    const endTurnButton = document.getElementById('endTurnBtn');

    const initGame = async () => {
        try {
            await gameCore.ui.loadAsset('./game/cards-icon.png').then(img => {
                gameCore.historyIcon = img;
            }).catch(console.warn);

            gameCore.network.connectWebSocket();
            endTurnButton.addEventListener('click', () => gameCore.input.endTurn());
            document.getElementById('modalBackdrop').addEventListener('click', () => gameCore.ui.closeHistoryModal());

            gameLoop();
        } catch (error) {
            console.error('Error de inicialización:', error);
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
        gameCore.ui.drawPlayerCards();

        if (gameCore.isDragging && gameCore.dragStartCard) {
            gameCore.dragStartCard.draw(ctx);
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    };

    window.addEventListener('beforeunload', () => {
        cancelAnimationFrame(animationFrameId);
        if (gameCore.socket) gameCore.socket.close();
    });

    initGame();
});