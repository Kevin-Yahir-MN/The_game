export class Card {
    constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
        this.value = typeof value === 'number' ? value : 0;
        this.x = typeof x === 'number' ? x : 0;
        this.y = typeof y === 'number' ? y : 0;
        this.width = 80;
        this.height = 120;
        this.isPlayable = !!isPlayable;
        this.isPlayedThisTurn = !!isPlayedThisTurn;
        this.isFromCurrentTurn = !!isPlayedThisTurn;
        this.playedThisRound = false;
        this.radius = 10;
        this.shakeOffset = 0;
        this.hoverOffset = 0;
        this.backgroundColor = this.determineColor();
        this.shadowColor = 'rgba(0, 0, 0, 0.3)';
        this.isDragging = false;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
    }

    determineColor() {
        if (!window.gameCore || !window.gameCore.gameState || !window.gameCore.gameState.cardsPlayedThisTurn || !window.gameCore.gameState.animatingCards) {
            return '#FFFFFF';
        }

        const isPlayedThisTurn = window.gameCore.gameState.cardsPlayedThisTurn.some(move => {
            return move && move.value === this.value &&
                ((move.position === 'asc1' && window.gameCore.gameState.board.ascending[0] === this.value) ||
                    (move.position === 'asc2' && window.gameCore.gameState.board.ascending[1] === this.value) ||
                    (move.position === 'desc1' && window.gameCore.gameState.board.descending[0] === this.value) ||
                    (move.position === 'desc2' && window.gameCore.gameState.board.descending[1] === this.value));
        });

        const isAnimatedCard = window.gameCore.gameState.animatingCards.some(anim => {
            return anim && anim.card && anim.card.value === this.value &&
                (anim.card.position === this.position || anim.column === this.position);
        });

        return (isPlayedThisTurn || isAnimatedCard || this.playedThisRound) ? '#99CCFF' : '#FFFFFF';
    }

    updateColor() {
        this.backgroundColor = this.determineColor();
    }

    draw(ctx) {
        this.ctx.save();
        ctx.save();
        if (!this.isDragging) ctx.translate(this.shakeOffset, 0);

        ctx.shadowColor = this.isPlayedThisTurn || this.playedThisRound ? 'rgba(0, 100, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 4;

        ctx.beginPath();
        ctx.roundRect(this.x, this.y - this.hoverOffset, this.width, this.height, this.radius);
        ctx.fillStyle = this.backgroundColor;
        ctx.fill();

        ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
        ctx.lineWidth = this.isPlayable ? 3 : 2;
        ctx.stroke();

        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'transparent';
        ctx.fillText(this.value.toString(), this.x + this.width / 2, this.y + this.height / 2 - this.hoverOffset);

        ctx.restore();
        window.gameCore.markDirty(this.x, this.y, this.width, this.height);
    }

    contains(x, y) {
        return x >= this.x && x <= this.x + this.width &&
            y >= this.y && y <= this.y + this.height;
    }

    startDrag(offsetX, offsetY) {
        this.isDragging = true;
        this.dragOffsetX = offsetX;
        this.dragOffsetY = offsetY;
        this.shadowColor = 'rgba(0, 0, 0, 0.5)';
        this.hoverOffset = 15;
        window.gameCore.markDirty(this.x, this.y, this.width, this.height);
    }

    endDrag() {
        this.isDragging = false;
        this.shadowColor = 'rgba(0, 0, 0, 0.3)';
        this.hoverOffset = 0;
        window.gameCore.markDirty(this.x, this.y, this.width, this.height);
    }

    updateDragPosition(x, y) {
        if (this.isDragging) {
            window.gameCore.markDirty(this.x, this.y, this.width, this.height);
            this.x = x - this.dragOffsetX;
            this.y = y - this.dragOffsetY;
            window.gameCore.markDirty(this.x, this.y, this.width, this.height);
        }
    }
}