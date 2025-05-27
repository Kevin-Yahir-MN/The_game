import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';
import { Card } from './card.js';


document.addEventListener('DOMContentLoaded', () => {
    window.gameCore = new GameCore();
    window.gameCore.network = new GameNetwork(window.gameCore);
    window.gameCore.ui = new GameUI(window.gameCore);
    window.gameCore.input = new GameInput(window.gameCore);

    window.gameCore.endTurnButton = document.getElementById('endTurnBtn');

    const initGame = () => {
        if (!window.gameCore.canvas || !window.gameCore.ctx || !window.gameCore.currentPlayer.id || !window.gameCore.roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        Promise.all([
            window.gameCore.ui.loadAsset('cards-icon.png').then(img => { if (img) window.gameCore.historyIcon = img; }).catch(err => {
                window.gameCore.log('Error loading history icon', err);
            })
        ]).then(() => {
            window.gameCore.canvas.width = 800;
            window.gameCore.canvas.height = 700;

            window.gameCore.canvas.addEventListener('click', (e) => window.gameCore.input.handleCanvasClick(e));
            window.gameCore.canvas.addEventListener('mousedown', (e) => window.gameCore.input.handleMouseDown(e));
            window.gameCore.canvas.addEventListener('mousemove', (e) => window.gameCore.input.handleMouseMove(e));
            window.gameCore.canvas.addEventListener('mouseup', (e) => window.gameCore.input.handleMouseUp(e));
            window.gameCore.canvas.addEventListener('mouseleave', (e) => window.gameCore.input.handleMouseUp(e));

            window.gameCore.canvas.addEventListener('touchstart', (e) => window.gameCore.input.handleTouchAsClick(e), { passive: false });
            window.gameCore.canvas.addEventListener('touchmove', (e) => window.gameCore.input.handleTouchMove(e));
            window.gameCore.canvas.addEventListener('touchend', (e) => window.gameCore.input.handleTouchEnd(e));

            window.gameCore.endTurnButton.addEventListener('click', () => window.gameCore.input.endTurn());
            document.getElementById('modalBackdrop').addEventListener('click', () => window.gameCore.ui.closeHistoryModal());
            window.addEventListener('beforeunload', () => cleanup());

            const controlsDiv = document.querySelector('.game-controls');
            if (controlsDiv) {
                controlsDiv.style.bottom = `${window.gameCore.canvas.height - window.gameCore.BUTTONS_Y}px`;
            }

            window.gameCore.historyIconsAnimation = {
                interval: null,
                lastPulseTime: Date.now(),
                pulseDuration: 500,
                pulseInterval: 20000
            };

            window.gameCore.network.connectWebSocket();
            setTimeout(() => {
                window.gameCore.ui.updatePlayersPanel();
            }, 1000);
            gameLoop();
        }).catch(err => {
            window.gameCore.log('Error initializing game', err);
            window.gameCore.network.showNotification('Error al cargar los recursos del juego', true);
        });
    };

    const gameLoop = (timestamp) => {
        if (timestamp - window.gameCore.lastRenderTime < 1000 / window.gameCore.TARGET_FPS) {
            window.gameCore.animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        window.gameCore.lastRenderTime = timestamp;

        if (window.gameCore.dirtyAreas.length > 0 || window.gameCore.needsRedraw) {
            window.gameCore.ctx.clearRect(0, 0, window.gameCore.canvas.width, window.gameCore.canvas.height);
            window.gameCore.ctx.fillStyle = '#1a6b1a';
            window.gameCore.ctx.fillRect(0, 0, window.gameCore.canvas.width, window.gameCore.canvas.height);
            window.gameCore.clearDirtyAreas();
            window.gameCore.needsRedraw = false;
        }

        window.gameCore.ui.drawBoard();
        window.gameCore.ui.drawHistoryIcons();
        window.gameCore.ui.handleCardAnimations();
        window.gameCore.ui.drawPlayerCards();

        if (window.gameCore.isDragging && window.gameCore.dragStartCard) {
            window.gameCore.dragStartCard.draw();
        }

        window.gameCore.animationFrameId = requestAnimationFrame(gameLoop);
    };

    const cleanup = () => {
        window.gameCore.gameState.animatingCards = [];

        if (window.gameCore.dragStartCard) {
            window.gameCore.dragStartCard.endDrag();
            window.gameCore.dragStartCard = null;
        }
        window.gameCore.isDragging = false;
        clearInterval(window.gameCore.historyIconsAnimation.interval);
        clearTimeout(window.gameCore.reconnectTimeout);
        cancelAnimationFrame(window.gameCore.animationFrameId);

        if (window.gameCore.socket) {
            window.gameCore.socket.onopen = window.gameCore.socket.onmessage =
                window.gameCore.socket.onclose = window.gameCore.socket.onerror = null;
            if (window.gameCore.socket.readyState === WebSocket.OPEN) {
                window.gameCore.socket.close(1000, 'Juego terminado');
            }
            window.gameCore.socket = null;
        }

        const events = {
            click: window.gameCore.input.handleCanvasClick,
            mousedown: window.gameCore.input.handleMouseDown,
            mousemove: window.gameCore.input.handleMouseMove,
            mouseup: window.gameCore.input.handleMouseUp,
            mouseleave: window.gameCore.input.handleMouseUp,
            touchstart: window.gameCore.input.handleTouchStart,
            touchmove: window.gameCore.input.handleTouchMove,
            touchend: window.gameCore.input.handleTouchEnd
        };

        Object.entries(events).forEach(([event, handler]) => {
            window.gameCore.canvas.removeEventListener(event, handler);
        });

        document.getElementById('endTurnBtn')?.removeEventListener('click', window.gameCore.input.endTurn);
        document.getElementById('modalBackdrop')?.removeEventListener('click', window.gameCore.ui.closeHistoryModal);

        document.querySelectorAll('.notification, .game-over-backdrop').forEach(el => el.remove());

        window.gameCore.ctx.clearRect(0, 0, window.gameCore.canvas.width, window.gameCore.canvas.height);
        window.gameCore.gameState.animatingCards = [];
        window.gameCore.assetCache.clear();
    };

    initGame();
});