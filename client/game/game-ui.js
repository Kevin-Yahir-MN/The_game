import { GameCore } from './game-core.js';

export class GameUI {
    constructor(gameCore) {
        this.gameCore = gameCore;
    }

    loadAsset(url) {
        if (this.gameCore.assetCache.has(url)) {
            return Promise.resolve(this.gameCore.assetCache.get(url));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.gameCore.assetCache.set(url, img);
                resolve(img);
            };
            img.onerror = (err) => {
                this.gameCore.log('Error loading asset', { url, error: err });
                reject(err);
            };
            img.src = url;
        });
    }

    showColumnHistory(columnId) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const modal = document.getElementById('historyModal');
        const backdrop = document.getElementById('modalBackdrop');
        const title = document.getElementById('historyColumnTitle');
        const container = document.getElementById('historyCardsContainer');

        const columnNames = {
            asc1: 'Pila Ascendente 1 (↑)',
            asc2: 'Pila Ascendente 2 (↑)',
            desc1: 'Pila Descendente 1 (↓)',
            desc2: 'Pila Descendente 2 (↓)'
        };

        title.textContent = columnNames[columnId];
        container.innerHTML = '';

        const history = this.gameCore.gameState.columnHistory[columnId] || (columnId.includes('asc') ? [1] : [100]);

        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
        this.gameCore.canvas.style.pointerEvents = 'none';
    }

    closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';
        this.gameCore.canvas.style.pointerEvents = 'auto';
    }

    animateInvalidCard(card) {
        if (!card) return;

        const shakeAmount = 8;
        const shakeDuration = 200;
        const startTime = Date.now();
        const originalX = card.x;
        const originalY = card.y;

        const shake = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / shakeDuration;

            if (progress >= 1) {
                card.shakeOffset = 0;
                card.x = originalX;
                card.y = originalY;
                this.gameCore.markDirty(card.x, card.y, card.width, card.height);
                return;
            }

            card.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
            card.x = originalX + Math.sin(progress * Math.PI * 16) * shakeAmount * (1 - progress);
            this.gameCore.markDirty(card.x, card.y, card.width, card.height);
            requestAnimationFrame(shake);
        };

        shake();
    }

    resetCardsPlayedProgress() {
        const minCardsRequired = this.gameCore.gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent = '0/' + minCardsRequired + ' carta(s) jugada(s)';
        document.getElementById('progressBar').style.width = '0%';

        this.gameCore.gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
        });

        this.gameCore.gameState.cardsPlayedThisTurn = [];
    }

    drawHistoryIcons() {
        if (!this.gameCore.historyIcon.complete || this.gameCore.historyIcon.naturalWidth === 0) return;
        const ctx = this.gameCore.ctx;

        const shouldAnimate = this.gameCore.isMyTurn();
        const pulseProgress = shouldAnimate ? this.calculatePulseProgress() : 0;

        this.gameCore.gameState.historyIconAreas = [];

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const baseX = this.gameCore.BOARD_POSITION.x + (this.gameCore.CARD_WIDTH + this.gameCore.COLUMN_SPACING) * i + this.gameCore.CARD_WIDTH / 2 - 20;
            const baseY = this.gameCore.HISTORY_ICON_Y;

            this.gameCore.gameState.historyIconAreas.push({
                x: baseX,
                y: baseY,
                width: 40,
                height: 40,
                column: col
            });

            const scale = shouldAnimate ? (1 + 0.2 * pulseProgress) : 1;

            ctx.save();
            ctx.translate(baseX + 20, baseY + 20);
            ctx.scale(scale, scale);
            ctx.translate(-20, -20);
            ctx.drawImage(this.gameCore.historyIcon, 0, 0, 40, 40);
            ctx.restore();
        });
    }

    calculatePulseProgress() {
        const now = Date.now();
        const timeSinceLastPulse = (now - this.gameCore.historyIconsAnimation.lastPulseTime) % this.gameCore.HISTORY_ICON_PULSE_INTERVAL;
        return (this.gameCore.isMyTurn() && timeSinceLastPulse < this.gameCore.HISTORY_ICON_PULSE_DURATION)
            ? Math.sin((timeSinceLastPulse / this.gameCore.HISTORY_ICON_PULSE_DURATION) * Math.PI)
            : 0;
    }

    drawBoard() {
        const ctx = this.gameCore.ctx;
        const yourCards = this.gameCore.gameState.yourCards || [];
        const animatingCards = this.gameCore.gameState.animatingCards || [];

        ctx.clearRect(
            this.gameCore.BOARD_POSITION.x - 30,
            this.gameCore.BOARD_POSITION.y - 55,
            this.gameCore.CARD_WIDTH * 4 + this.gameCore.COLUMN_SPACING * 3 + 60,
            this.gameCore.CARD_HEIGHT + 120
        );

        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.roundRect(
            this.gameCore.BOARD_POSITION.x - 25,
            this.gameCore.BOARD_POSITION.y - 50,
            this.gameCore.CARD_WIDTH * 4 + this.gameCore.COLUMN_SPACING * 3 + 50,
            this.gameCore.CARD_HEIGHT + 110,
            15
        );
        ctx.fill();

        if (this.gameCore.isDragging && this.gameCore.dragStartCard) {
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = this.gameCore.isValidMove(this.gameCore.dragStartCard.value, col);
                const x = this.gameCore.BOARD_POSITION.x + (this.gameCore.CARD_WIDTH + this.gameCore.COLUMN_SPACING) * i;

                ctx.fillStyle = isValid ? 'rgb(67, 64, 250)' : 'rgb(248, 51, 51)';
                ctx.beginPath();
                ctx.roundRect(
                    x - 5,
                    this.gameCore.BOARD_POSITION.y - 10,
                    this.gameCore.CARD_WIDTH + 10,
                    this.gameCore.CARD_HEIGHT + 20,
                    15
                );
                ctx.fill();
            });
        }

        ctx.fillStyle = 'white';
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const x = this.gameCore.BOARD_POSITION.x + (this.gameCore.CARD_WIDTH + this.gameCore.COLUMN_SPACING) * i + this.gameCore.CARD_WIDTH / 2;
            ctx.fillText(i < 2 ? '↑' : '↓', x, this.gameCore.BOARD_POSITION.y - 25);
        });

        ctx.shadowColor = 'transparent';

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const isColumnAnimating = this.gameCore.gameState.animatingCards.some(anim => anim.column === col);

            if (!isColumnAnimating) {
                const value = i < 2 ? this.gameCore.gameState.board.ascending[i % 2] : this.gameCore.gameState.board.descending[i % 2];
                const wasPlayedThisTurn = this.gameCore.gameState.cardsPlayedThisTurn.some(
                    move => move.value === value && move.position === col
                );

                const card = this.gameCore.cardPool.get(
                    value,
                    this.gameCore.BOARD_POSITION.x + (this.gameCore.CARD_WIDTH + this.gameCore.COLUMN_SPACING) * i,
                    this.gameCore.BOARD_POSITION.y,
                    false,
                    wasPlayedThisTurn
                );
                card.draw(this.gameCore.ctx);
            }
        });

        this.handleCardAnimations();
        this.drawHistoryIcons();
    }

    drawPlayerCards() {
        const ctx = this.gameCore.ctx;
        if (!this.gameCore.gameState.yourCards) {
            this.gameCore.gameState.yourCards = [];
            return;
        }

        const backgroundHeight = this.gameCore.CARD_HEIGHT + 30;
        const backgroundWidth = this.gameCore.gameState.yourCards.length * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING) + 40;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.roundRect(
            (this.gameCore.canvas.width - backgroundWidth) / 2,
            this.gameCore.PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        ctx.fill();
        this.gameCore.markDirty(
            (this.gameCore.canvas.width - backgroundWidth) / 2,
            this.gameCore.PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight
        );

        this.gameCore.gameState.yourCards.forEach((card, index) => {
            if (card && card !== this.gameCore.dragStartCard) {
                card.x = (this.gameCore.canvas.width - (this.gameCore.gameState.yourCards.length * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING))) / 2 + index * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING);
                card.y = this.gameCore.PLAYER_CARDS_Y;
                card.draw(this.gameCore.ctx);
            }
        });
    }

    createPlayersPanel() {
        const panel = document.createElement('div');
        panel.id = 'playersPanel';
        panel.className = 'players-panel';
        document.body.appendChild(panel);
        return panel;
    }

    updatePlayersPanel() {
        const panel = document.getElementById('playersPanel') || this.createPlayersPanel();

        panel.innerHTML = `
            <h3>Jugadores (${this.gameCore.gameState.players.length})</h3>
            <ul>
                ${this.gameCore.gameState.players.map(player => {
            const displayName = player.name || `Jugador_${player.id.slice(0, 4)}`;
            const cardCount = player.cardCount || (player.cards ? player.cards.length : 0);

            return `
                        <li class="${player.id === this.gameCore.currentPlayer.id ? 'you' : ''} 
                                   ${player.id === this.gameCore.gameState.currentTurn ? 'current-turn' : ''}">
                            <span class="player-name">${displayName}</span>
                            <span class="card-count">🃏 ${cardCount}</span>
                            ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                        </li>
                    `;
        }).join('')}
            </ul>
        `;
    }

    handleCardAnimations() {
        const ctx = this.gameCore.ctx;
        const now = Date.now();

        for (let i = this.gameCore.gameState.animatingCards.length - 1; i >= 0; i--) {
            const anim = this.gameCore.gameState.animatingCards[i];
            if (!anim.newCard || !anim.currentCard) {
                this.gameCore.gameState.animatingCards.splice(i, 1);
                continue;
            }

            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            const easedProgress = progress * progress;

            anim.newCard.y = -this.gameCore.CARD_HEIGHT + (anim.targetY - (-this.gameCore.CARD_HEIGHT)) * easedProgress;

            ctx.save();
            anim.currentCard.draw(ctx);
            ctx.shadowColor = 'rgba(0, 100, 255, 0.7)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 5;
            anim.newCard.draw(ctx);
            ctx.restore();

            if (progress === 1) {
                if (anim.onComplete) anim.onComplete();
                this.gameCore.gameState.animatingCards.splice(i, 1);
                this.gameCore.updateGameInfo();
            }
        }
    }
}