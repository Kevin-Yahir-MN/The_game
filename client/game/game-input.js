import { GameCore } from './game-core.js';

export class GameInput {
    constructor(gameCore) {
        this.gameCore = gameCore;
    }

    handleCanvasClick(e) {
        if (document.getElementById('historyModal').style.display === 'block') {
            return;
        }

        const rect = this.gameCore.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.gameCore.gameState.historyIconAreas) {
            for (const area of this.gameCore.gameState.historyIconAreas) {
                if (x >= area.x && x <= area.x + area.width &&
                    y >= area.y && y <= area.y + area.height) {
                    this.gameCore.ui.showColumnHistory(area.column);
                    return;
                }
            }
        }

        const clickedCard = this.gameCore.gameState.yourCards.find(card => card.contains(x, y));
        if (clickedCard && clickedCard.isPlayable && this.gameCore.isMyTurn()) {
            this.startDrag(x, y);
        }
    }

    handleTouchAsClick(e) {
        e.preventDefault();
        if (e.touches && e.touches.length > 0) {
            const rect = this.gameCore.canvas.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const fakeClick = new MouseEvent('click', {
                clientX: touch.clientX,
                clientY: touch.clientY,
                bubbles: true,
                cancelable: true,
                view: window
            });

            if (this.gameCore.gameState.historyIconAreas) {
                for (const area of this.gameCore.gameState.historyIconAreas) {
                    if (x >= area.x && x <= area.x + area.width &&
                        y >= area.y && y <= area.y + area.height) {
                        this.gameCore.ui.showColumnHistory(area.column);
                        return;
                    }
                }
            }

            this.handleTouchStart(e);
        }
    }

    handleMouseDown(e) {
        const rect = this.gameCore.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.startDrag(x, y);
    }

    handleTouchStart(e) {
        e.preventDefault();
        const rect = this.gameCore.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.startDrag(x, y);
    }

    startDrag(x, y) {
        const clickedCard = this.gameCore.gameState.yourCards.find(card => card.contains(x, y));
        if (!clickedCard || !clickedCard.isPlayable || !this.gameCore.isMyTurn()) {
            if (!clickedCard?.isPlayable) {
                this.gameCore.network.showNotification('Esta carta no se puede jugar ahora', true);
            }
            return;
        }

        this.gameCore.dragStartCard = clickedCard;
        this.gameCore.dragStartX = x;
        this.gameCore.dragStartY = y;
        this.gameCore.isDragging = true;
        this.gameCore.dragStartCard.startDrag(x - clickedCard.x, y - clickedCard.y);
        this.gameCore.markDirty(clickedCard.x, clickedCard.y, clickedCard.width, clickedCard.height);
    }

    handleMouseMove(e) {
        const rect = this.gameCore.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this.updateDrag(x, y);
    }

    handleTouchMove(e) {
        e.preventDefault();
        const rect = this.gameCore.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.updateDrag(x, y);
    }

    updateDrag(x, y) {
        if (this.gameCore.isDragging && this.gameCore.dragStartCard) {
            this.gameCore.dragStartCard.updateDragPosition(x, y);
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
        if (!this.gameCore.isDragging || !this.gameCore.dragStartCard) {
            return;
        }

        const rect = this.gameCore.canvas.getBoundingClientRect();
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

        const targetColumn = this.gameCore.getClickedColumn(x, y);
        if (targetColumn) {
            if (this.gameCore.isValidMove(this.gameCore.dragStartCard.value, targetColumn)) {
                this.playCard(this.gameCore.dragStartCard.value, targetColumn);
            } else {
                this.gameCore.ui.animateInvalidCard(this.gameCore.dragStartCard);
                this.gameCore.network.showNotification('Movimiento no válido', true);
                this.resetCardPosition();
            }
        } else {
            this.resetCardPosition();
        }

        if (this.gameCore.dragStartCard) {
            this.gameCore.dragStartCard.endDrag();
        }
        this.gameCore.dragStartCard = null;
        this.gameCore.isDragging = false;
    }

    resetCardPosition() {
        if (!this.gameCore.dragStartCard) return;

        let cardIndex = this.gameCore.gameState.yourCards.findIndex(c => c === this.gameCore.dragStartCard);
        if (cardIndex === -1) {
            this.gameCore.gameState.yourCards.push(this.gameCore.dragStartCard);
            cardIndex = this.gameCore.gameState.yourCards.length - 1;
        }

        const startX = (this.gameCore.canvas.width - (this.gameCore.gameState.yourCards.length * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING))) / 2 + cardIndex * (this.gameCore.CARD_WIDTH + this.gameCore.CARD_SPACING);

        if (!this.gameCore.dragStartCard) return;

        const animation = {
            card: this.gameCore.dragStartCard,
            startTime: Date.now(),
            duration: 300,
            targetX: startX,
            targetY: this.gameCore.PLAYER_CARDS_Y,
            fromX: this.gameCore.dragStartCard.x,
            fromY: this.gameCore.dragStartCard.y,
            onComplete: () => {
                if (this.gameCore.dragStartCard) {
                    this.gameCore.dragStartCard.x = startX;
                    this.gameCore.dragStartCard.y = this.gameCore.PLAYER_CARDS_Y;
                    this.gameCore.dragStartCard.isDragging = false;
                }
                this.gameCore.network.updatePlayerCards(this.gameCore.gameState.yourCards.map(c => c.value));
            }
        };

        this.gameCore.gameState.animatingCards.push(animation);
    }

    playCard(cardValue, position) {
        if (!this.gameCore.dragStartCard) {
            return;
        }

        const previousValue = this.gameCore.getStackValue(position);
        this.gameCore.updateStack(position, cardValue);

        const cardIndex = this.gameCore.gameState.yourCards.findIndex(c => c === this.gameCore.dragStartCard);
        if (cardIndex !== -1) {
            this.gameCore.gameState.yourCards.splice(cardIndex, 1);
        }

        if (this.gameCore.socket && this.gameCore.socket.readyState === WebSocket.OPEN) {
            this.gameCore.socket.send(JSON.stringify({
                type: 'play_card',
                playerId: this.gameCore.currentPlayer.id,
                roomId: this.gameCore.roomId,
                cardValue: cardValue,
                position: position,
                previousValue: previousValue,
                isFirstMove: this.gameCore.gameState.cardsPlayedThisTurn.length === 0
            }));
        } else {
            this.gameCore.network.showNotification('Error de conexión', true);
        }

        this.gameCore.network.updateGameInfo();
        this.gameCore.network.updateCardsPlayedUI();
    }

    endTurn() {
        const currentPlayerObj = this.gameCore.gameState.players.find(p => p.id === this.gameCore.currentPlayer.id);
        const cardsPlayed = currentPlayerObj?.cardsPlayedThisTurn || 0;
        const minCardsRequired = this.gameCore.gameState.remainingDeck > 0 ? 2 : 1;

        if (cardsPlayed < minCardsRequired) {
            const remainingCards = minCardsRequired - cardsPlayed;
            this.gameCore.network.showNotification(`Necesitas jugar ${remainingCards} carta(s) más para terminar tu turno`, true);
            return;
        }

        this.gameCore.gameState.yourCards.forEach(card => {
            card.isPlayedThisTurn = false;
            card.updateColor();
        });

        this.gameCore.socket.send(JSON.stringify({
            type: 'end_turn',
            playerId: this.gameCore.currentPlayer.id,
            roomId: this.gameCore.roomId
        }));

        this.gameCore.network.updateGameInfo();
    }
}