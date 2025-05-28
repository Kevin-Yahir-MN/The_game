export class Card {
    constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
        this.value = value;
        this.x = x;
        this.y = y;
        this.width = 80;
        this.height = 120;
        this.isPlayable = isPlayable;
        this.isPlayedThisTurn = isPlayedThisTurn;
        this.radius = 10;
        this.shakeOffset = 0;
        this.hoverOffset = 0;
        this.backgroundColor = '#FFFFFF';
        this.shadowColor = 'rgba(0, 0, 0, 0.3)';
        this.isDragging = false;
    }

    draw(ctx) {
        if (!ctx) return;

        ctx.save();
        if (!this.isDragging) ctx.translate(this.shakeOffset, 0);

        ctx.shadowColor = this.isPlayedThisTurn ? 'rgba(0, 100, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)';
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
    }

    endDrag() {
        this.isDragging = false;
        this.shadowColor = 'rgba(0, 0, 0, 0.3)';
        this.hoverOffset = 0;
    }

    updateDragPosition(x, y) {
        if (this.isDragging) {
            this.x = x - this.dragOffsetX;
            this.y = y - this.dragOffsetY;
        }
    }
}