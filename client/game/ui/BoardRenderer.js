import { CARD_WIDTH, CARD_HEIGHT, COLUMN_SPACING } from '../core/Constants.js';

export class BoardRenderer {
    constructor({ canvas, gameState }) {
        if (!canvas) throw new Error('Canvas required');
        if (!gameState) throw new Error('GameState required');

        this.canvas = canvas;
        this.gameState = gameState;
        this.cardPool = gameState.cardPool;

        this.boardPosition = {
            x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
            y: canvas.height * 0.3
        };
    }

    draw(ctx) {
        ctx.clearRect(
            this.boardPosition.x - 30,
            this.boardPosition.y - 55,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 60,
            CARD_HEIGHT + 120
        );

        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.roundRect(
            this.boardPosition.x - 25,
            this.boardPosition.y - 50,
            CARD_WIDTH * 4 + COLUMN_SPACING * 3 + 50,
            CARD_HEIGHT + 110,
            15
        );
        ctx.fill();

        if (this.gameState.isDragging && this.gameState.dragStartCard) {
            ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
                const isValid = this.gameState.isValidMove(this.gameState.dragStartCard.value, col);
                const x = this.boardPosition.x + (CARD_WIDTH + COLUMN_SPACING) * i;

                ctx.fillStyle = isValid ? 'rgb(67, 64, 250)' : 'rgb(248, 51, 51)';
                ctx.beginPath();
                ctx.roundRect(
                    x - 5,
                    this.boardPosition.y - 10,
                    CARD_WIDTH + 10,
                    CARD_HEIGHT + 20,
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
            const x = this.boardPosition.x + (CARD_WIDTH + COLUMN_SPACING) * i + CARD_WIDTH / 2;
            ctx.fillText(i < 2 ? '↑' : '↓', x, this.boardPosition.y - 25);
        });

        ctx.shadowColor = 'transparent';

        ['asc1', 'asc2', 'desc1', 'desc2'].forEach((col, i) => {
            const isColumnAnimating = this.gameState.animatingCards.some(anim => anim.column === col);
            if (!isColumnAnimating) {
                const value = i < 2 ? this.gameState.board.ascending[i % 2] : this.gameState.board.descending[i % 2];
                const wasPlayedThisTurn = this.gameState.cardsPlayedThisTurn.some(
                    move => move.value === value && move.position === col
                );

                const card = this.cardPool.get(
                    value,
                    this.boardPosition.x + (CARD_WIDTH + COLUMN_SPACING) * i,
                    this.boardPosition.y,
                    false,
                    wasPlayedThisTurn
                );
                card.draw(ctx);
            }
        });
    }
}