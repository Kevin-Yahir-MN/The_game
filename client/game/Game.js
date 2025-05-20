import { GameState } from './core/GameState.js';
import { CardPool } from './core/CardPool.js';
import { WebSocketManager } from './network/WebSocketManager.js';
import { MessageHandler } from './network/MessageHandler.js';
import { Renderer } from './ui/Renderer.js';
import { NotificationManager } from './ui/NotificationManager.js';
import { HistoryManager } from './ui/HistoryManager.js';
import { DragManager } from './input/DragManager.js';
import { TouchManager } from './input/TouchManager.js';
import { sanitizeInput } from './utils/Helpers.js';
import { CARD_WIDTH, CARD_HEIGHT, COLUMN_SPACING, TARGET_FPS } from './core/Constants.js';

export class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.endTurnButton = document.getElementById('endTurnBtn');

        this.cardPool = new CardPool();
        this.gameState = new GameState();
        this.gameState.cardPool = this.cardPool;

        this.currentPlayer = {
            id: sanitizeInput(sessionStorage.getItem('playerId')),
            name: sanitizeInput(sessionStorage.getItem('playerName')),
            isHost: sessionStorage.getItem('isHost') === 'true'
        };
        this.gameState.currentPlayer = this.currentPlayer;
        this.roomId = sanitizeInput(sessionStorage.getItem('roomId'));

        if (!this.roomId) {
            window.location.href = 'sala.html';
            return;
        }

        this.gameState.BOARD_POSITION = {
            x: this.canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
            y: this.canvas.height * 0.3
        };
        this.gameState.PLAYER_CARDS_Y = this.canvas.height * 0.6;

        this.notificationManager = new NotificationManager();
        this.historyManager = new HistoryManager(this.gameState);
        this.renderer = new Renderer({
            canvas: this.canvas,
            gameState: this.gameState,
            cardPool: this.cardPool
        });

        this.messageHandler = new MessageHandler(
            this.gameState,
            this.renderer,
            this.notificationManager,
            this.webSocketManager
        );

        this.webSocketManager = new WebSocketManager(
            this.roomId,
            this.currentPlayer.id,
            this.messageHandler,
            this.notificationManager
        );

        this.dragManager = new DragManager(
            this.canvas,
            this.gameState,
            this.renderer,
            this.messageHandler
        );

        this.touchManager = new TouchManager(
            this.canvas,
            this.historyManager
        );

        this.animationFrameId = null;
        this.lastRenderTime = 0;
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.webSocketManager.connect();
        this.gameLoop();
    }

    setupCanvas() {
        this.canvas.width = 800;
        this.canvas.height = 700;
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('mousedown', (e) => this.dragManager.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.dragManager.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.dragManager.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.dragManager.handleMouseUp(e));
        this.canvas.addEventListener('touchstart', (e) => {
            this.touchManager.handleTouchAsClick(e);
            this.dragManager.handleTouchStart(e);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.dragManager.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.dragManager.handleTouchEnd(e));
        this.endTurnButton.addEventListener('click', () => this.endTurn());
        document.getElementById('modalBackdrop').addEventListener('click', () => this.historyManager.closeHistoryModal());
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.gameState.historyIconAreas) {
            for (const area of this.gameState.historyIconAreas) {
                if (x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height) {
                    this.historyManager.showColumnHistory(area.column);
                    return;
                }
            }
        }
    }

    endTurn() {
        const currentPlayerObj = this.gameState.players.find(p => p.id === this.currentPlayer.id);
        const cardsPlayed = currentPlayerObj?.cardsPlayedThisTurn || 0;
        const minCardsRequired = this.gameState.remainingDeck > 0 ? 2 : 1;

        if (cardsPlayed < minCardsRequired) {
            const remainingCards = minCardsRequired - cardsPlayed;
            this.notificationManager.showNotification(`Necesitas jugar ${remainingCards} carta(s) más`, true);
            return;
        }

        this.webSocketManager.sendMessage({
            type: 'end_turn',
            playerId: this.currentPlayer.id,
            roomId: this.roomId
        });

        this.renderer.updateGameInfo();
    }

    gameLoop(timestamp) {
        if (timestamp - this.lastRenderTime < 1000 / TARGET_FPS) {
            this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
            return;
        }

        this.lastRenderTime = timestamp;
        this.renderer.render(timestamp);
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    cleanup() {
        cancelAnimationFrame(this.animationFrameId);

        if (this.dragManager.dragStartCard) {
            this.dragManager.dragStartCard.endDrag();
        }

        this.webSocketManager.close();

        const events = [
            'click', 'mousedown', 'mousemove', 'mouseup', 'mouseleave',
            'touchstart', 'touchmove', 'touchend'
        ];

        events.forEach(event => {
            this.canvas.removeEventListener(event, this.handleCanvasClick);
        });

        this.endTurnButton.removeEventListener('click', this.endTurn);
        document.getElementById('modalBackdrop').removeEventListener('click', this.historyManager.closeHistoryModal);
        window.removeEventListener('beforeunload', this.cleanup);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const game = new Game();
        game.init();
    } catch (error) {
        console.error('Failed to initialize game:', error);
        alert('Error crítico al iniciar el juego. Por favor recarga la página.');
    }
});