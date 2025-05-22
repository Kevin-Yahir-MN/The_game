export class HistoryManager {
    constructor(gameState) {
        this.gameState = gameState;
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

        const history = this.gameState.columnHistory[columnId] || (columnId.includes('asc') ? [1] : [100]);

        history.forEach((card, index) => {
            const cardElement = document.createElement('div');
            cardElement.className = `history-card ${index === history.length - 1 ? 'recent' : ''}`;
            cardElement.textContent = card;
            container.appendChild(cardElement);
        });

        modal.style.display = 'block';
        backdrop.style.display = 'block';
        this.gameState.canvas.style.pointerEvents = 'none';
    }

    closeHistoryModal() {
        document.getElementById('historyModal').style.display = 'none';
        document.getElementById('modalBackdrop').style.display = 'none';
        this.gameState.canvas.style.pointerEvents = 'auto';
    }
}