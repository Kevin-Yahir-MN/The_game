import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';
import { Card } from './card.js';

document.addEventListener('DOMContentLoaded', () => {
    // Inicialización del juego
    const gameCore = new GameCore();
    gameCore.network = new GameNetwork(gameCore);
    gameCore.ui = new GameUI(gameCore);
    gameCore.input = new GameInput(gameCore);

    // Configuración del canvas
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 700;

    // Variables de estado del juego
    let animationFrameId;
    let lastRenderTime = 0;

    // Elementos de la UI
    const endTurnButton = document.getElementById('endTurnBtn');

    // Función para inicializar el juego
    const initGame = async () => {
        try {
            // Cargar assets (opcional, si usas la imagen)
            await gameCore.ui.loadAsset('./game/cards-icon.png').then(img => {
                if (img) gameCore.historyIcon = img;
            }).catch(err => {
                console.warn('Error loading history icon:', err);
            });

            // Configurar controles
            endTurnButton.addEventListener('click', () => gameCore.input.endTurn());
            document.getElementById('modalBackdrop').addEventListener('click', () => gameCore.ui.closeHistoryModal());

            // Iniciar bucle del juego
            gameLoop();

        } catch (error) {
            console.error('Error initializing game:', error);
            gameCore.network.showNotification('Error al iniciar el juego', true);
        }
    };

    // Bucle principal del juego
    const gameLoop = (timestamp) => {
        // Control de FPS
        if (timestamp - lastRenderTime < 1000 / gameCore.TARGET_FPS) {
            animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        lastRenderTime = timestamp;

        // Limpiar y redibujar
        if (gameCore.dirtyAreas.length > 0 || gameCore.needsRedraw) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1a6b1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            gameCore.clearDirtyAreas();
            gameCore.needsRedraw = false;
        }

        // Dibujar elementos del juego
        gameCore.ui.drawBoard();
        gameCore.ui.drawHistoryIcons();
        gameCore.ui.handleCardAnimations();
        gameCore.ui.drawPlayerCards();

        // Dibujar carta arrastrada si existe
        if (gameCore.isDragging && gameCore.dragStartCard) {
            gameCore.dragStartCard.draw();
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    };

    // Limpieza al salir
    const cleanup = () => {
        gameCore.gameState.animatingCards = [];

        if (gameCore.dragStartCard) {
            gameCore.dragStartCard.endDrag();
            gameCore.dragStartCard = null;
        }

        gameCore.isDragging = false;
        clearInterval(gameCore.historyIconsAnimation.interval);
        clearTimeout(gameCore.reconnectTimeout);
        cancelAnimationFrame(animationFrameId);

        if (gameCore.socket) {
            gameCore.socket.close(1000, 'Juego terminado');
            gameCore.socket = null;
        }

        // Eliminar event listeners
        endTurnButton.removeEventListener('click', gameCore.input.endTurn);
        document.getElementById('modalBackdrop').removeEventListener('click', gameCore.ui.closeHistoryModal);
    };

    // Configurar evento antes de salir
    window.addEventListener('beforeunload', cleanup);

    // Iniciar el juego
    initGame();
});