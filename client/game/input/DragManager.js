import { CARD_WIDTH, CARD_HEIGHT, COLUMN_SPACING } from '../core/Constants.js';

export class DragManager {
    constructor(canvas, gameState, renderer, messageHandler) {
        this.canvas = canvas;
        this.gameState = gameState;
        this.renderer = renderer;
        this.messageHandler = messageHandler;
        this.dragStartCard = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.isDragging = false;
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.startDrag(x, y);
    }

    handleTouchStart(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.startDrag(x, y);
    }

    startDrag(x, y) {
        const clickedCard = this.gameState.yourCards.find(card => card.contains(x, y));
        if (clickedCard && clickedCard.isPlayable && this.isMyTurn()) {
            this.dragStartCard = clickedCard;
            this.dragStartX = x;
            this.dragStartY = y;
            this.isDragging = true;
            this.dragStartCard.startDrag(x - this.dragStartCard.x, y - this.dragStartCard.y);
            this.renderer.markDirty(this.dragStartCard.x, this.dragStartCard.y, this.dragStartCard.width, this.dragStartCard.height);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.updateDrag(x, y);
    }

    handleTouchMove(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.updateDrag(x, y);
    }

    updateDrag(x, y) {
        if (this.isDragging && this.dragStartCard) {
            this.dragStartCard.updateDragPosition(x, y);
            this.renderer.markDirty(this.dragStartCard.x, this.dragStartCard.y, this.dragStartCard.width, this.dragStartCard.height);
        }
    }

    handleMouseUp(e) {
        this.endDrag(e);
    }

    handleTouchEnd(e) {
        e.preventDefault();
        if (e.changedTouches.length > 0) {
            const fakeMouseEvent = new MouseEvent('mouseup', {
                clientX: e.changedTouches[0].clientX,
                clientY: e.changedTouches[0].clientY
            });
            this.endDrag(fakeMouseEvent);
        }
    }

    endDrag(e) {
        if (!this.isDragging || !this.dragStartCard) return;

        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e instanceof MouseEvent) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.changedTouches?.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            this.resetCardPosition();
            return;
        }

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const targetColumn = this.getClickedColumn(x, y);
        if (targetColumn && this.gameState.isValidMove(this.dragStartCard.value, targetColumn)) {
            this.playCard(this.dragStartCard.value, targetColumn);
        } else {
            if (targetColumn) {
                this.animateInvalidCard(this.dragStartCard);
                this.messageHandler.notificationManager.showNotification('Movimiento no válido', true);
            }
            this.resetCardPosition();
        }

        if (this.dragStartCard) {
            this.dragStartCard.endDrag();
        }
        this.dragStartCard = null;
        this.isDragging = false;
    }

    resetCardPosition() {
        if (!this.dragStartCard) return;

        let cardIndex = this.gameState.yourCards.findIndex(c => c === this.dragStartCard);
        if (cardIndex === -1) {
            this.gameState.yourCards.push(this.dragStartCard);
            cardIndex = this.gameState.yourCards.length - 1;
        }

        const startX = (this.canvas.width - (this.gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 + cardIndex * (CARD_WIDTH + CARD_SPACING);

        const animation = {
            card: this.dragStartCard,
            startTime: Date.now(),
            duration: 300,
            targetX: startX,
            targetY: this.gameState.PLAYER_CARDS_Y,
            fromX: this.dragStartCard.x,
            fromY: this.dragStartCard.y,
            onComplete: () => {
                if (this.dragStartCard) {
                    this.dragStartCard.x = startX;
                    this.dragStartCard.y = this.gameState.PLAYER_CARDS_Y;
                    this.dragStartCard.isDragging = false;
                }
                this.messageHandler.updatePlayerCards(this.gameState.yourCards.map(c => c.value));
            }
        };

        this.gameState.animatingCards.push(animation);
    }

    getClickedColumn(x, y) {
        if (y < this.gameState.BOARD_POSITION.y || y > this.gameState.BOARD_POSITION.y + CARD_HEIGHT) return null;

        const columns = [
            { x: this.gameState.BOARD_POSITION.x, id: 'asc1' },
            { x: this.gameState.BOARD_POSITION.x + CARD_WIDTH + COLUMN_SPACING, id: 'asc2' },
            { x: this.gameState.BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 2, id: 'desc1' },
            { x: this.gameState.BOARD_POSITION.x + (CARD_WIDTH + COLUMN_SPACING) * 3, id: 'desc2' }
        ];

        const column = columns.find(col => x >= col.x && x <= col.x + CARD_WIDTH);
        return column ? column.id : null;
    }

    playCard(cardValue, position) {
        if (!this.dragStartCard) return;

        const previousValue = this.gameState.getStackValue(position);
        this.gameState.updateStack(position, cardValue);

        const cardIndex = this.gameState.yourCards.findIndex(c => c === this.dragStartCard);
        if (cardIndex !== -1) {
            this.gameState.yourCards.splice(cardIndex, 1);
        }

        this.messageHandler.webSocketManager.sendMessage({
            type: 'play_card',
            playerId: this.gameState.currentPlayer.id,
            roomId: this.gameState.roomId,
            cardValue: cardValue,
            position: position,
            previousValue: previousValue,
            isFirstMove: this.gameState.cardsPlayedThisTurn.length === 0
        });

        this.messageHandler.updateGameInfo();
        this.updateCardsPlayedUI();
    }

    updateCardsPlayedUI() {
        const currentPlayerCardsPlayed = this.gameState.cardsPlayedThisTurn.filter(
            card => card.playerId === this.gameState.currentPlayer.id
        ).length;

        const minCardsRequired = this.gameState.remainingDeck > 0 ? 2 : 1;
        document.getElementById('progressText').textContent =
            `${currentPlayerCardsPlayed + 1}/${minCardsRequired} carta(s) jugada(s)`;

        const progressPercentage = Math.min(((currentPlayerCardsPlayed + 1) / minCardsRequired) * 100, 100);
        document.getElementById('progressBar').style.width = `${progressPercentage}%`;
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
                this.renderer.markDirty(card.x, card.y, card.width, card.height);
                return;
            }

            card.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
            card.x = originalX + Math.sin(progress * Math.PI * 16) * shakeAmount * (1 - progress);
            this.renderer.markDirty(card.x, card.y, card.width, card.height);
            requestAnimationFrame(shake);
        };

        shake();
    }

    isMyTurn() {
        return this.gameState.currentTurn === this.gameState.currentPlayer.id;
    }
}