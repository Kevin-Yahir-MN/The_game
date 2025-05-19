export class PlayersPanel {
    constructor(gameState) {
        this.gameState = gameState;
    }

    create() {
        const panel = document.createElement('div');
        panel.id = 'playersPanel';
        panel.className = 'players-panel';
        document.body.appendChild(panel);
        return panel;
    }

    update() {
        const panel = document.getElementById('playersPanel') || this.create();

        panel.innerHTML = `
            <h3>Jugadores (${this.gameState.players.length})</h3>
            <ul>
                ${this.gameState.players.map(player => {
            const displayName = player.name || `Jugador_${player.id.slice(0, 4)}`;
            const cardCount = player.cardCount || (player.cards ? player.cards.length : 0);

            return `
                        <li class="${player.id === this.gameState.currentPlayer.id ? 'you' : ''} 
                                   ${player.id === this.gameState.currentTurn ? 'current-turn' : ''}">
                            <span class="player-name">${displayName}</span>
                            <span class="card-count">🃏 ${cardCount}</span>
                            ${player.isHost ? ' <span class="host-tag">(Host)</span>' : ''}
                        </li>
                    `;
        }).join('')}
            </ul>
        `;
    }
}