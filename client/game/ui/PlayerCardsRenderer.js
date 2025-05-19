import { CARD_WIDTH, CARD_HEIGHT, CARD_SPACING } from '../core/Constants.js';

export class PlayerCardsRenderer {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.gameState = gameState;
        this.playerCardsY = canvas.height * 0.6;
    }

    draw(ctx) {
        const backgroundHeight = CARD_HEIGHT + 30;
        const backgroundWidth = this.gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING) + 40;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.roundRect(
            (this.canvas.width - backgroundWidth) / 2,
            this.playerCardsY - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        ctx.fill();

        this.gameState.yourCards.forEach((card, index) => {
            if (card && card !== this.gameState.dragStartCard) {
                card.x = (this.canvas.width - (this.gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING))) / 2 + index * (CARD_WIDTH + CARD_SPACING);
                card.y = this.playerCardsY;
                card.draw(ctx);
            }
        });
    }
}