import { BoardRenderer } from './BoardRenderer.js';
import { PlayerCardsRenderer } from './PlayerCardsRenderer.js';
import { PlayersPanel } from './PlayersPanel.js';

export class Renderer {
    constructor({ canvas, gameState }) {
        if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Invalid canvas element provided to Renderer');
        }
        if (!gameState || !gameState.cardPool) {
            throw new Error('Invalid gameState provided to Renderer');
        }

        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.gameState = gameState;

        this.boardRenderer = new BoardRenderer({
            canvas: this.canvas,
            gameState: this.gameState
        });

        this.playerCardsRenderer = new PlayerCardsRenderer({
            canvas: this.canvas,
            gameState: this.gameState
        });

        this.playersPanel = new PlayersPanel(this.gameState);
        this.dirtyAreas = [];
        this.needsRedraw = true;
    }

    markDirty(x, y, width, height) {
        this.dirtyAreas.push({ x, y, width, height });
        this.needsRedraw = true;
    }

    clearDirtyAreas() {
        this.dirtyAreas = [];
        this.needsRedraw = false;
    }

    render(timestamp) {
        try {
            // Limpiar solo las áreas sucias
            if (this.dirtyAreas.length > 0) {
                this.dirtyAreas.forEach(area => {
                    this.ctx.clearRect(
                        area.x - 1,
                        area.y - 1,
                        area.width + 2,
                        area.height + 2
                    );
                });
                this.clearDirtyAreas();
            }
            // Redibujar completo si es necesario
            else if (this.needsRedraw) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillStyle = '#1a6b1a';
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.clearDirtyAreas();
            }

            // Renderizar componentes
            this.boardRenderer.draw(this.ctx);
            this.playerCardsRenderer.draw(this.ctx);

            // Si hay una carta siendo arrastrada, renderizarla encima
            if (this.gameState.dragStartCard) {
                this.gameState.dragStartCard.draw(this.ctx);
            }
        } catch (error) {
            console.error('Error en renderizado:', error);
            this.needsRedraw = true; // Forzar redibujado completo en el siguiente frame
        }
    }

    updateGameInfo(deckEmpty = false) {
        try {
            const currentTurnElement = document.getElementById('currentTurn');
            const remainingDeckElement = document.getElementById('remainingDeck');
            const progressTextElement = document.getElementById('progressText');
            const progressBarElement = document.getElementById('progressBar');

            if (!currentTurnElement || !remainingDeckElement ||
                !progressTextElement || !progressBarElement) {
                return;
            }

            const currentPlayerObj = this.gameState.players.find(
                p => p.id === this.gameState.currentPlayer.id
            ) || { cardsPlayedThisTurn: 0 };

            const minCardsRequired = deckEmpty || this.gameState.remainingDeck === 0 ? 1 : 2;
            const cardsPlayed = currentPlayerObj.cardsPlayedThisTurn || 0;

            currentTurnElement.textContent = this.gameState.currentTurn === this.gameState.currentPlayer.id
                ? 'Tu turno'
                : `Turno de ${this.gameState.players.find(
                    p => p.id === this.gameState.currentTurn
                )?.name || '...'}`;

            remainingDeckElement.textContent = this.gameState.remainingDeck;
            progressTextElement.textContent = `${cardsPlayed}/${minCardsRequired} carta(s) jugada(s)`;
            progressBarElement.style.width = `${Math.min(
                (cardsPlayed / minCardsRequired) * 100,
                100
            )}%`;

            if (this.gameState.endTurnButton) {
                const remainingCards = minCardsRequired - cardsPlayed;
                this.gameState.endTurnButton.disabled = this.gameState.currentTurn !== this.gameState.currentPlayer.id;
                this.gameState.endTurnButton.title = remainingCards > 0
                    ? `Necesitas jugar ${remainingCards} carta(s) más${deckEmpty ? ' (Mazo vacío)' : ''}`
                    : 'Puedes terminar tu turno';
                this.gameState.endTurnButton.style.backgroundColor = cardsPlayed >= minCardsRequired
                    ? '#2ecc71'
                    : '#e74c3c';
            }
        } catch (error) {
            console.error('Error actualizando información del juego:', error);
        }
    }

    updatePlayersPanel() {
        try {
            this.playersPanel.update();
        } catch (error) {
            console.error('Error actualizando panel de jugadores:', error);
        }
    }
}