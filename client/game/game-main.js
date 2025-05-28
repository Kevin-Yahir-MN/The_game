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
    gameCore.ui = new GameUI(gameCore);
    gameCore.network = new GameNetwork(gameCore);
    gameCore.input = new GameInput(gameCore);

    let animationFrameId;
    let lastRenderTime = 0;
    const endTurnButton = document.getElementById('endTurnBtn');

    const initGame = async () => {
        try {
            await new Promise(resolve => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });

            await gameCore.ui.loadAsset('./game/cards-icon.png')
                .then(img => gameCore.historyIcon = img)
                .catch(error => { });

            gameCore.network.connectWebSocket();

            gameCore.canvas.addEventListener('click', (e) => gameCore.input.handleCanvasClick(e));
            gameCore.canvas.addEventListener('mousedown', (e) => gameCore.input.handleMouseDown(e));
            gameCore.canvas.addEventListener('mousemove', (e) => gameCore.input.handleMouseMove(e));
            gameCore.canvas.addEventListener('mouseup', (e) => gameCore.input.handleMouseUp(e));

            gameCore.canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                gameCore.input.handleTouchStart(e);
            }, { passive: false });

            gameCore.canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
                gameCore.input.handleTouchMove(e);
            }, { passive: false });

            gameCore.canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                gameCore.input.handleTouchEnd(e);
            }, { passive: false });

            endTurnButton.addEventListener('click', () => gameCore.input.endTurn());

            document.getElementById('modalBackdrop').addEventListener('click', () => {
                gameCore.ui.closeHistoryModal();
            });

            setTimeout(() => {
                if (gameCore.socket && gameCore.socket.readyState === WebSocket.OPEN) {
                    gameCore.socket.send(JSON.stringify({
                        type: 'get_full_state',
                        playerId: gameCore.currentPlayer.id,
                        roomId: gameCore.roomId,
                        requireCurrentState: true
                    }));
                }
            }, 500);

            gameLoop();
        } catch (error) {
            gameCore.network.showNotification('Error al inicializar el juego', true);
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