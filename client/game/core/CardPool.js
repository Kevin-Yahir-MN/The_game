import { Card } from './Card.js';
export class CardPool {
    constructor() {
        this.pool = [];
    }

    get(value, x, y, isPlayable, isPlayedThisTurn) {
        if (this.pool.length > 0) {
            const card = this.pool.pop();
            card.value = value;
            card.x = x;
            card.y = y;
            card.isPlayable = isPlayable;
            card.isPlayedThisTurn = isPlayedThisTurn;
            return card;
        }
        return new Card(value, x, y, isPlayable, isPlayedThisTurn);
    }

    release(card) {
        this.pool.push(card);
    }
}