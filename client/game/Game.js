import { GameState } from './core/GameState.js';
import { CardPool } from './core/CardPool.js';
import { WebSocketManager } from './network/WebSocketManager.js';
import { MessageHandler } from './network/MessageHandler.js';
import { Renderer } from './ui/Renderer.js';
import { NotificationManager } from './ui/NotificationManager.js';
import { HistoryManager } from './ui/HistoryManager.js';
import { DragManager } from './input/DragManager.js';
import { TouchManager } from './input/TouchManager.js';
import { AssetLoader } from './utils/AssetLoader.js';
import { sanitizeInput } from './utils/Helpers.js';
import { CARD_WIDTH, CARD_HEIGHT, COLUMN_SPACING, TARGET_FPS } from './core/Constants.js';

export class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.endTurnButton = document.getElementById('endTurnBtn');

        this.currentPlayer = {
            id: sanitizeInput(sessionStorage.getItem('playerId')),
            name: sanitizeInput(sessionStorage.getItem('playerName')),
            isHost: sessionStorage.getItem('isHost') === 'true'
        };

        this.roomId = sanitizeInput(sessionStorage.getItem('roomId'));
        if (!this.roomId) {
            window.location.href = 'sala.html';
            return;
        }

        this.gameState = new GameState();
        this.gameState.currentPlayer = this.currentPlayer;
        this.gameState.canvas = this.canvas;
        this.gameState.endTurnButton = this.endTurnButton;
        this.cardPool = new CardPool();
        this.assetLoader = new AssetLoader();

        this.notificationManager = new NotificationManager();
        this.historyManager = new HistoryManager(this.gameState);
        this.renderer = new Renderer(this.canvas, this.gameState);
        this.webSocketManager = new WebSocketManager(this.roomId, this.currentPlayer.id);
        this.messageHandler = new MessageHandler(this.gameState, this.renderer, this.notificationManager, this.webSocketManager);

        this.webSocketManager.messageHandler = this.messageHandler;

        this.dragManager = new DragManager(this.canvas, this.gameState, this.renderer, this.messageHandler);
        this.touchManager = new TouchManager(this.canvas, this.historyManager);

        this.animationFrameId = null;
        this.lastRenderTime = 0;

        this.BOARD_POSITION = {
            x: this.canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
            y: this.canvas.height * 0.3
        };
        this.PLAYER_CARDS_Y = this.canvas.height * 0.6;
        this.BUTTONS_Y = this.canvas.height * 0.85;

        this.gameState.BOARD_POSITION = this.BOARD_POSITION;
        this.gameState.PLAYER_CARDS_Y = this.PLAYER_CARDS_Y;
    }

    init() {
        if (!this.canvas || !this.ctx || !this.currentPlayer.id || !this.roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

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

        this.canvas.addEventListener('touchstart', (e) => this.touchManager.handleTouchAsClick(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.dragManager.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.dragManager.handleTouchEnd(e));

        this.endTurnButton.addEventListener('click', () => this.endTurn());
        document.getElementById('modalBackdrop').addEventListener('click', () => this.historyManager.closeHistoryModal());
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.gameState.historyIconAreas) {
            for (const area of this.gameState.historyIconAreas) {
                if (x >= area.x && x <= area.x + area.width &&
                    y >= area.y && y <= area.y + area.height) {
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
            this.notificationManager.showNotification(`Necesitas jugar ${remainingCards} carta(s) más para terminar tu turno`, true);
            return;
        }

        this.gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
            card.updateColor(this.gameState);
        });

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
        this.gameState.animatingCards = [];

        if (this.dragManager.dragStartCard) {
            this.dragManager.dragStartCard.endDrag();
            this.dragManager.dragStartCard = null;
        }
        this.dragManager.isDragging = false;
        clearTimeout(this.webSocketManager.reconnectTimeout);
        cancelAnimationFrame(this.animationFrameId);

        this.webSocketManager.close();

        const events = {
            click: this.handleCanvasClick,
            mousedown: this.dragManager.handleMouseDown,
            mousemove: this.dragManager.handleMouseMove,
            mouseup: this.dragManager.handleMouseUp,
            mouseleave: this.dragManager.handleMouseUp,
            touchstart: this.touchManager.handleTouchAsClick,
            touchmove: this.dragManager.handleTouchMove,
            touchend: this.dragManager.handleTouchEnd
        };

        Object.entries(events).forEach(([event, handler]) => {
            this.canvas.removeEventListener(event, handler);
        });

        this.endTurnButton?.removeEventListener('click', this.endTurn);
        document.getElementById('modalBackdrop')?.removeEventListener('click', this.historyManager.closeHistoryModal);

        document.querySelectorAll('.notification, .game-over-backdrop').forEach(el => el.remove());

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.gameState.animatingCards = [];
        this.assetLoader.cache.clear();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.init();
});