import { BoardRenderer } from './BoardRenderer.js';
import { PlayerCardsRenderer } from './PlayerCardsRenderer.js';
import { PlayersPanel } from './PlayersPanel.js';

export class Renderer {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.gameState = gameState;
        this.boardRenderer = new BoardRenderer(canvas, gameState, cardPool);
        this.playerCardsRenderer = new PlayerCardsRenderer(canvas, gameState);
        this.playersPanel = new PlayersPanel(gameState);
        this.dirtyAreas = [];
        this.needsRedraw = true;
    }

    markDirty(x, y, width, height) {
        this.dirtyAreas.push({ x, y, width, height });
        this.needsRedraw = true;
    }

    clearDirtyAreas() {
        this.dirtyAreas = [];
    }

    render(timestamp) {
        if (this.dirtyAreas.length > 0 || this.needsRedraw) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = '#1a6b1a';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.clearDirtyAreas();
            this.needsRedraw = false;
        }

        this.boardRenderer.draw(this.ctx);
        this.playerCardsRenderer.draw(this.ctx);
    }

    updateGameInfo(deckEmpty = false) {
        const currentTurnElement = document.getElementById('currentTurn');
        const remainingDeckElement = document.getElementById('remainingDeck');
        const progressTextElement = document.getElementById('progressText');
        const progressBarElement = document.getElementById('progressBar');

        if (!currentTurnElement || !remainingDeckElement || !progressTextElement || !progressBarElement) {
            setTimeout(() => this.updateGameInfo(deckEmpty), 100);
            return;
        }

        const currentPlayerObj = this.gameState.players.find(p => p.id === this.gameState.currentPlayer.id) || {
            cardsPlayedThisTurn: 0,
            totalCardsPlayed: 0
        };

        const minCardsRequired = deckEmpty || this.gameState.remainingDeck === 0 ? 1 : 2;
        const cardsPlayed = currentPlayerObj.cardsPlayedThisTurn || 0;

        currentTurnElement.textContent = this.gameState.currentTurn === this.gameState.currentPlayer.id
            ? 'Tu turno'
            : `Turno de ${this.gameState.players.find(p => p.id === this.gameState.currentTurn)?.name || '...'}`;

        remainingDeckElement.textContent = this.gameState.remainingDeck;
        progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
        progressBarElement.style.width = `${Math.min((cardsPlayed / minCardsRequired) * 100, 100)}%`;

        if (this.gameState.endTurnButton) {
            this.gameState.endTurnButton.disabled = this.gameState.currentTurn !== this.gameState.currentPlayer.id;
            const remainingCards = minCardsRequired - cardsPlayed;
            this.gameState.endTurnButton.title = remainingCards > 0
                ? `Necesitas jugar ${remainingCards} carta(s) más${deckEmpty ? ' (Mazo vacío)' : ''}`
                : 'Puedes terminar tu turno';
            this.gameState.endTurnButton.style.backgroundColor = cardsPlayed >= minCardsRequired ? '#2ecc71' : '#e74c3c';
        }
    }
}