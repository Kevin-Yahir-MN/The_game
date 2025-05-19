export class NotificationManager {
    showNotification(message, isError = false) {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => existing.remove(), 300);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${isError ? 'error' : ''}`;
        notification.textContent = message;
        notification.style.animation = 'notificationEnter 0.3s forwards';
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'notificationExit 0.3s forwards';
            setTimeout(() => notification.remove(), 300);
        }, isError || message.includes('GAME OVER') ? 3000 : 3000);
    }

    showGameOver(message, isError = false) {
        const backdrop = document.createElement('div');
        backdrop.className = 'game-over-backdrop';

        const isVictory = !isError || message.includes('Victoria') || message.includes('ganan');
        const isPerfectVictory = isVictory && this.gameState.remainingDeck === 0 && this.gameState.yourCards.length === 0;

        const gameOverDiv = document.createElement('div');
        gameOverDiv.className = 'game-over-notification';

        if (isPerfectVictory) {
            gameOverDiv.innerHTML = `
                <div class="victory-image-container">
                    <img id="victoryImage" class="victory-image">
                </div>
                <div class="game-over-message">${message}</div>
                <div class="game-over-buttons">
                    <button id="returnToRoom" class="game-over-btn">
                        Volver a la Sala
                    </button>
                </div>
            `;
        } else {
            const title = isVictory ? '¡VICTORIA!' : '¡GAME OVER!';
            const titleColor = isVictory ? '#2ecc71' : '#e74c3c';

            gameOverDiv.innerHTML = `
                <h2 style="color: ${titleColor}">${title}</h2>
                <p>${message}</p>
                <div class="game-over-buttons">
                    <button id="returnToRoom" class="game-over-btn" 
                            style="background-color: ${titleColor}">
                        Volver a la Sala
                    </button>
                </div>
            `;
        }

        document.body.appendChild(backdrop);
        backdrop.appendChild(gameOverDiv);

        if (isPerfectVictory) {
            const victoryImage = document.getElementById('victoryImage');
            const maxWidth = window.innerWidth * 0.85;
            const maxHeight = window.innerHeight * 0.6;
            const ratio = Math.min(
                maxWidth / victoryImage.naturalWidth,
                maxHeight / victoryImage.naturalHeight
            );

            victoryImage.style.width = `${victoryImage.naturalWidth * ratio}px`;
            victoryImage.style.height = 'auto';
            victoryImage.style.display = 'block';
            victoryImage.style.margin = '0 auto';

            setTimeout(() => {
                victoryImage.classList.add('animate-in');
                setTimeout(() => {
                    victoryImage.classList.add('pulse-animation');
                }, 1000);
            }, 100);
        }

        setTimeout(() => {
            backdrop.style.opacity = '1';
            gameOverDiv.style.transform = 'translateY(0)';
        }, 10);
    }
}