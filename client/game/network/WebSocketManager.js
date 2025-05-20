import { WS_URL, MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY } from '../core/Constants.js';

export class WebSocketManager {
    constructor(roomId, playerId, messageHandler, notificationManager) {
        this.roomId = roomId;
        this.playerId = playerId;
        this.messageHandler = messageHandler;
        this.notificationManager = notificationManager;
        this.reconnectAttempts = 0;
        this.reconnectTimeout = null;
        this.socket = null;
        this.connectionStatus = 'disconnected';
    }

    connect() {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.messageHandler.showNotification('No se puede conectar al servidor. Recarga la página.', true);
            this.updateConnectionStatus('Desconectado', true);
            return;
        }

        this.updateConnectionStatus('Conectando...');

        if (this.socket) {
            this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null;
            if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
                this.socket.close();
            }
        }

        this.socket = new WebSocket(`${WS_URL}?roomId=${this.roomId}&playerId=${this.playerId}`);

        this.socket.onopen = () => {
            clearTimeout(this.reconnectTimeout);
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('Conectado');
            this.notificationManager.showNotification('Conectado al servidor');

            this.sendMessage({
                type: 'get_full_state',
                playerId: this.playerId,
                roomId: this.roomId,
                requireCurrentState: true
            });

            this.sendMessage({
                type: 'get_player_state',
                playerId: this.playerId,
                roomId: this.roomId
            });
        };

        this.socket.onclose = (event) => {
            if (!event.wasClean && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                this.reconnectAttempts++;
                const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1), 30000);
                this.reconnectTimeout = setTimeout(() => this.connect(), delay);
                this.updateConnectionStatus(`Reconectando (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                this.connectionStatus = 'reconnecting';
            } else {
                this.updateConnectionStatus('Desconectado', true);
                this.connectionStatus = 'disconnected';
            }
        };

        this.socket.onerror = (error) => {
            console.error('Error en WebSocket', error);
            this.updateConnectionStatus('Error de conexión', true);
            this.connectionStatus = 'error';
        };

        this.socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.messageHandler.handleMessage(message);
            } catch (error) {
                console.error('Error procesando mensaje:', { error, data: event.data });
            }
        };
    }

    sendMessage(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    updateConnectionStatus(status, isError = false) {
        this.connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus') || this.createConnectionStatusElement();
        statusElement.textContent = `Estado: ${status}`;
        statusElement.className = isError ? 'connection-error' : 'connection-status';
    }

    createConnectionStatusElement() {
        const panelContent = document.querySelector('.panel-content');
        const statusElement = document.createElement('p');
        statusElement.id = 'connectionStatus';
        statusElement.className = 'connection-status';
        const remainingDeckElement = document.getElementById('remainingDeck').parentNode;
        remainingDeckElement.parentNode.insertBefore(statusElement, remainingDeckElement.nextSibling);
        return statusElement;
    }

    close() {
        if (this.socket) {
            this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null;
            if (this.socket.readyState === WebSocket.OPEN) {
                this.socket.close(1000, 'Juego terminado');
            }
            this.socket = null;
        }
        clearTimeout(this.reconnectTimeout);
    }
}