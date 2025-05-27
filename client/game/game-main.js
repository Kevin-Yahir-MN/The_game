import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';
import { Card } from './card.js';

document.addEventListener('DOMContentLoaded', () => {
    // Inicialización del core del juego
    const gameCore = new GameCore();

    // Inyectar dependencias
    gameCore.network = new GameNetwork(gameCore);
    gameCore.ui = new GameUI(gameCore);
    gameCore.input = new GameInput(gameCore);

    // Hacer disponible para depuración (opcional)
    window.game = gameCore;

    // Configuración del canvas
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 700;

    // Variables de estado
    let animationFrameId;
    let lastRenderTime = 0;

    // Elementos UI
    const endTurnButton = document.getElementById('endTurnBtn');

    // Función de inicialización
    const initGame = async () => {
        try {
            // Cargar assets
            await gameCore.ui.loadAsset('./game/cards-icon.png').then(img => {
                gameCore.historyIcon = img;
            }).catch(err => {
                console.warn('No se pudo cargar el icono de historial:', err);
            });

            // Configurar eventos
            endTurnButton.addEventListener('click', () => gameCore.input.endTurn());
            document.getElementById('modalBackdrop').addEventListener('click', () => gameCore.ui.closeHistoryModal());

            // Iniciar bucle del juego
            gameLoop();

        } catch (error) {
            console.error('Error al inicializar el juego:', error);
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

        // Limpiar canvas si es necesario
        if (gameCore.dirtyAreas.length > 0 || gameCore.needsRedraw) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#1a6b1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            gameCore.clearDirtyAreas();
            gameCore.needsRedraw = false;
        }

        // Dibujar elementos
        gameCore.ui.drawBoard();
        gameCore.ui.drawHistoryIcons();
        gameCore.ui.handleCardAnimations();
        gameCore.ui.drawPlayerCards();

        // Dibujar carta arrastrada
        if (gameCore.isDragging && gameCore.dragStartCard) {
            gameCore.dragStartCard.draw();
        }

        animationFrameId = requestAnimationFrame(gameLoop);
    };

    // Limpieza
    const cleanup = () => {
        cancelAnimationFrame(animationFrameId);
        if (gameCore.socket) {
            gameCore.socket.close();
        }
        // Limpiar event listeners
        endTurnButton.removeEventListener('click', gameCore.input.endTurn);
    };

    window.addEventListener('beforeunload', cleanup);

    // Iniciar el juego
    initGame();
});