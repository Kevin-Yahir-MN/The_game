document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const WS_URL = 'wss://the-game-2xks.onrender.com';
    const endTurnButton = document.getElementById('endTurnBtn');

    // Dimensiones y posiciones
    const CARD_WIDTH = 80;
    const CARD_HEIGHT = 120;
    const COLUMN_SPACING = 60;
    const CARD_SPACING = 15;
    const BOARD_POSITION = {
        x: canvas.width / 2 - (CARD_WIDTH * 4 + COLUMN_SPACING * 3) / 2,
        y: canvas.height * 0.3
    };
    const PLAYER_CARDS_Y = canvas.height * 0.6;
    const BUTTONS_Y = canvas.height * 0.85;
    const HISTORY_ICON_Y = BOARD_POSITION.y + CARD_HEIGHT + 15;

    // Icono de historial
    const historyIcon = new Image();
    historyIcon.src = 'cards-icon.png';

    // Datos del jugador
    const currentPlayer = {
        id: sessionStorage.getItem('playerId'),
        name: sessionStorage.getItem('playerName'),
        isHost: sessionStorage.getItem('isHost') === 'true'
    };
    const roomId = sessionStorage.getItem('roomId');

    // Estado del juego
    let activeNotifications = [];
    const NOTIFICATION_COOLDOWN = 3000;
    let selectedCard = null;
    let dragState = {
        active: false,
        card: null
    };

    let gameState = {
        players: [],
        yourCards: [],
        board: { ascending: [1, 1], descending: [100, 100] },
        currentTurn: null,
        remainingDeck: 98,
        initialCards: 6,
        cardsPlayedThisTurn: [],
        animatingCards: [],
        columnHistory: {
            asc1: [],
            asc2: [],
            desc1: [],
            desc2: []
        }
    };

    class Card {
        constructor(value, x, y, isPlayable = false, isPlayedThisTurn = false) {
            this.value = value;
            this.x = x;
            this.y = y;
            this.width = CARD_WIDTH;
            this.height = CARD_HEIGHT;
            this.isPlayable = isPlayable;
            this.isPlayedThisTurn = isPlayedThisTurn;
            this.radius = 10;
            this.shakeOffset = 0;
            this.hoverOffset = 0;
            this.backgroundColor = isPlayedThisTurn ? '#99CCFF' : '#FFFFFF';

            // Drag & Drop
            this.isDragging = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;
            this.originalX = x;
            this.originalY = y;

            // Efectos visuales
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.shadowBlur = 8;
            this.shadowOffsetY = 4;
            this.rotation = 0;
            this.scale = 1.0;
            this.zIndex = 0;

            // Animación
            this.animation = {
                active: false,
                startTime: 0,
                duration: 0,
                fromX: 0,
                fromY: 0,
                fromRotation: 0,
                targetX: 0,
                targetY: 0,
                targetRotation: 0
            };
        }

        draw(ctx) {
            // Actualizar animación si está activa
            this.updateAnimation();

            ctx.save();

            // Aplicar transformaciones
            const shakeX = this.isDragging ? 0 : this.shakeOffset;
            ctx.translate(this.x + this.width / 2 + shakeX, this.y + this.height / 2);
            ctx.rotate(this.rotation * Math.PI / 180);
            ctx.scale(this.scale, this.scale);
            ctx.translate(-this.width / 2, -this.height / 2);

            // Sombra
            ctx.shadowColor = this.shadowColor;
            ctx.shadowBlur = this.isDragging ? 20 : this.shadowBlur;
            ctx.shadowOffsetY = this.isDragging ? 15 : (this.hoverOffset > 0 ? 8 : 4);

            // Cuerpo de la carta
            ctx.beginPath();
            ctx.roundRect(0, -this.hoverOffset, this.width, this.height, this.radius);

            // Color basado en estado
            if (this.isDragging) {
                ctx.fillStyle = '#FFFFE0';
            } else if (this.hoverOffset > 0) {
                ctx.fillStyle = '#FFFF99';
            } else {
                ctx.fillStyle = this.backgroundColor;
            }

            ctx.fill();

            // Borde
            ctx.strokeStyle = this.isPlayable ? '#27ae60' : '#34495e';
            ctx.lineWidth = this.isPlayable ? 3 : 2;
            ctx.stroke();

            // Texto
            ctx.fillStyle = '#2c3e50';
            ctx.font = 'bold 28px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'transparent';
            ctx.fillText(this.value.toString(), this.width / 2, this.height / 2 - this.hoverOffset);

            ctx.restore();
        }

        contains(x, y) {
            const relX = x - this.x - this.width / 2;
            const relY = y - this.y - this.height / 2;
            const angle = -this.rotation * Math.PI / 180;

            const rotatedX = relX * Math.cos(angle) - relY * Math.sin(angle);
            const rotatedY = relX * Math.sin(angle) + relY * Math.cos(angle);

            return rotatedX >= -this.width / 2 && rotatedX <= this.width / 2 &&
                rotatedY >= -this.height / 2 && rotatedY <= this.height / 2;
        }

        startDrag(mouseX, mouseY) {
            if (!this.isPlayable) return false;

            this.isDragging = true;
            this.dragOffsetX = mouseX - this.x;
            this.dragOffsetY = mouseY - this.y;
            this.originalX = this.x;
            this.originalY = this.y;

            // Efecto visual al agarrar
            this.applyGrabEffect();
            return true;
        }

        updateDrag(mouseX, mouseY) {
            if (!this.isDragging) return;

            const targetX = mouseX - this.dragOffsetX;
            const targetY = mouseY - this.dragOffsetY - 20; // Elevación

            this.x += (targetX - this.x) * 0.3;
            this.y += (targetY - this.y) * 0.3;

            const dx = targetX - this.x;
            this.rotation = dx * 0.1;
        }

        endDrag(success) {
            if (!this.isDragging) return;

            this.isDragging = false;
            this.resetCardStyle();

            if (!success) {
                this.animateReturn();
            }
        }

        applyGrabEffect() {
            this.shadowBlur = 20;
            this.shadowColor = 'rgba(0, 0, 0, 0.6)';
            this.rotation = Math.random() * 8 - 4;
            this.scale = 1.1;
            this.zIndex = 100;
        }

        resetCardStyle() {
            this.shadowBlur = 8;
            this.shadowColor = 'rgba(0, 0, 0, 0.3)';
            this.rotation = 0;
            this.scale = 1.0;
            this.zIndex = 0;
        }

        animateReturn() {
            this.animation = {
                active: true,
                startTime: Date.now(),
                duration: 600,
                fromX: this.x,
                fromY: this.y,
                fromRotation: this.rotation,
                targetX: this.originalX,
                targetY: this.originalY,
                targetRotation: 0
            };
        }

        updateAnimation() {
            if (!this.animation.active) return;

            const elapsed = Date.now() - this.animation.startTime;
            const progress = Math.min(elapsed / this.animation.duration, 1);

            const elasticProgress = this.easeOutElastic(progress);

            this.x = this.animation.fromX +
                (this.animation.targetX - this.animation.fromX) * elasticProgress;
            this.y = this.animation.fromY +
                (this.animation.targetY - this.animation.fromY) * elasticProgress;
            this.rotation = this.animation.fromRotation +
                (this.animation.targetRotation - this.animation.fromRotation) * elasticProgress;

            if (progress === 1) {
                this.animation.active = false;
            }
        }

        easeOutElastic(t) {
            const p = 0.3;
            return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        }

        animateShake() {
            const shakeAmount = 8;
            const shakeDuration = 400;
            const startTime = Date.now();

            const shake = () => {
                const elapsed = Date.now() - startTime;
                const progress = elapsed / shakeDuration;

                if (progress >= 1) {
                    this.shakeOffset = 0;
                    return;
                }

                this.shakeOffset = Math.sin(progress * Math.PI * 8) * shakeAmount * (1 - progress);
                requestAnimationFrame(shake);
            };

            shake();
        }

        updateHoverState(mouseX, mouseY) {
            const isHovered = this.contains(mouseX, mouseY);
            this.hoverOffset = isHovered && this.isPlayable ? 10 : 0;
            return isHovered;
        }
    }

    // ... [Resto de las funciones existentes (connectWebSocket, showNotification, etc.) ...]

    function handleMouseDown(event) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        for (let i = gameState.yourCards.length - 1; i >= 0; i--) {
            const card = gameState.yourCards[i];
            if (card.contains(mouseX, mouseY)) {
                if (card.isPlayable && card.startDrag(mouseX, mouseY)) {
                    dragState = { active: true, card };
                    selectedCard = card;
                    return;
                } else {
                    card.animateShake();
                    showNotification('No puedes jugar esta carta ahora', true);
                    return;
                }
            }
        }

        handleCanvasClick(event);
    }

    function handleMouseMove(event) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        gameState.yourCards.forEach(card => card.updateHoverState(mouseX, mouseY));

        if (dragState.active && dragState.card) {
            dragState.card.updateDrag(mouseX, mouseY);
        }
    }

    function handleMouseUp(event) {
        if (!dragState.active || !dragState.card) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const targetColumn = getClickedColumn(mouseX, mouseY);
        const isValid = targetColumn && isValidMove(dragState.card.value, targetColumn);

        dragState.card.endDrag(isValid);

        if (isValid) {
            playCard(dragState.card.value, targetColumn);
        }

        dragState = { active: false, card: null };
        selectedCard = null;
    }

    function drawPlayerCards() {
        const backgroundHeight = CARD_HEIGHT + 30;
        const backgroundWidth = gameState.yourCards.length * (CARD_WIDTH + CARD_SPACING) + 40;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.roundRect(
            (canvas.width - backgroundWidth) / 2,
            PLAYER_CARDS_Y - 15,
            backgroundWidth,
            backgroundHeight,
            15
        );
        ctx.fill();

        const cardsToDraw = [...gameState.yourCards].sort((a, b) => {
            if (a.isDragging) return 1;
            if (b.isDragging) return -1;
            return a.zIndex - b.zIndex;
        });

        cardsToDraw.forEach(card => {
            card.draw(ctx);
        });
    }

    function updateGameInfo() {
        const currentPlayerName = gameState.players.find(p => p.id === gameState.currentTurn)?.name || 'Esperando...';

        // Actualizar elementos HTML
        document.getElementById('currentTurn').textContent = currentPlayerName;
        document.getElementById('remainingDeck').textContent = gameState.remainingDeck;
        // Actualizar barra de progreso si es tu turno
        if (gameState.currentTurn === currentPlayer.id) {
            const cardsPlayed = gameState.cardsPlayedThisTurn.filter(c => c.playerId === currentPlayer.id).length;
            const required = gameState.remainingDeck > 0 ? 2 : 1;
            const progress = Math.min(cardsPlayed / required, 1) * 100;

            const progressBar = document.getElementById('progressBar');
            progressBar.style.width = `${progress}%`;
            progressBar.style.backgroundColor = progress >= 100 ? 'var(--secondary)' : 'var(--primary)';

            document.getElementById('progressText').textContent = `${cardsPlayed}/${required} cartas jugadas`;
        }
    }

    function handleCardAnimations() {
        const now = Date.now();
        for (let i = gameState.animatingCards.length - 1; i >= 0; i--) {
            const anim = gameState.animatingCards[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            anim.card.x = anim.fromX + (anim.targetX - anim.fromX) * progress;
            anim.card.y = anim.fromY + (anim.targetY - anim.fromY) * progress;

            anim.card.draw(ctx);

            if (progress === 1) {
                gameState.animatingCards.splice(i, 1);
            }
        }
    }

    function gameLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#1a6b1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        drawBoard();
        drawHistoryIcons();
        handleCardAnimations();
        drawPlayerCards();

        requestAnimationFrame(gameLoop);
    }

    function initGame() {
        if (!canvas || !ctx || !currentPlayer.id || !roomId) {
            alert('Error: No se pudo inicializar el juego. Vuelve a la sala.');
            return;
        }

        const loadIcon = new Promise((resolve) => {
            historyIcon.onload = () => resolve();
            historyIcon.onerror = () => resolve();
        });

        loadIcon.then(() => {
            canvas.width = 800;
            canvas.height = 700;

            // Configurar eventos
            endTurnButton.addEventListener('click', endTurn);
            canvas.addEventListener('click', handleCanvasClick);
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseup', handleMouseUp);
            canvas.addEventListener('mouseleave', handleMouseUp);
            document.getElementById('modalBackdrop').addEventListener('click', closeHistoryModal);

            updateGameInfo();

            const controlsDiv = document.querySelector('.game-controls');
            if (controlsDiv) {
                controlsDiv.style.bottom = `${canvas.height - BUTTONS_Y}px`;
            }

            connectWebSocket();
            gameLoop();
        });
    }

    initGame();
});