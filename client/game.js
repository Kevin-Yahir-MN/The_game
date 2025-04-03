// Constantes del juego
const COLOR_FONDO = '#228B22';
const COLOR_CARTA = '#FFFFFF';
const COLOR_CARTA_JUGADOR = '#338CFA';
const COLOR_TEXTO = '#000000';
const COLOR_BOTON = '#4682B4';
const COLOR_BOTON_HOVER = '#6496C8';
const COLOR_ERROR = '#FF0000';
const COLOR_JUGABLE = '#00C800';
const COLOR_COLUMNA = 'rgba(200, 200, 200, 0.5)';
const DESTACAR_TURNO = 'rgba(255, 255, 0, 0.5)';

// Tamaños de cartas
const ANCHO_CARTA = 80;
const ALTO_CARTA = 120;
const ANCHO_CARTA_ARRATRE = 100;
const ALTO_CARTA_ARRATRE = 150;
const ESPACIADO_CARTAS = 25;
const MARGEN_COLUMNA = 10;

// Tamaños de columnas
const ANCHO_COLUMNA = ANCHO_CARTA * 2;
const ALTO_COLUMNA = ALTO_CARTA * 2;
const ESPACIADO_COLUMNAS = 80;

// Fuentes
const FUENTE_PEQ = 'Arial';
const TAM_PEQ = 20;
const FUENTE_GRANDE = 'Arial';
const TAM_GRANDE = 30;
const FUENTE_TITULO = 'Arial';
const TAM_TITULO = 24;

// Configuración de pantalla
const ANCHO = 1200;
const ALTO = 800;

// Variables globales
let socket;
let currentPlayer;
let roomId;
let isHost;
let players = [];
let gameInstance;

class Carta {
    constructor(valor, color = null) {
        this.valor = valor;
        this.color = color || COLOR_CARTA;
        this.rect = { x: 0, y: 0, width: ANCHO_CARTA, height: ALTO_CARTA };
        this.arrastrando = false;
        this.posicion_original = { x: 0, y: 0 };
        this.angulo = 0;
        this.jugada_este_turno = false;
        this.jugador = '';
    }

    dibujar(ctx, x, y) {
        this.rect.x = x;
        this.rect.y = y;

        ctx.save();

        if (this.arrastrando) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.roundRect(x + 5, y + 5, this.rect.width, this.rect.height, 8);
            ctx.fill();
        }

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.roundRect(x, y, this.rect.width, this.rect.height, 8);
        ctx.fill();

        if (this.jugada_este_turno) {
            ctx.fillStyle = DESTACAR_TURNO;
            ctx.beginPath();
            ctx.roundRect(x, y, this.rect.width, this.rect.height, 8);
            ctx.fill();
        }

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, this.rect.width, this.rect.height, 8);
        ctx.stroke();

        ctx.fillStyle = COLOR_TEXTO;
        ctx.font = `${TAM_GRANDE}px ${FUENTE_GRANDE}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.valor.toString(), x + this.rect.width / 2, y + this.rect.height / 2);

        // Mostrar nombre del jugador en cartas jugadas
        if (this.jugador) {
            ctx.font = `12px ${FUENTE_PEQ}`;
            ctx.fillText(this.jugador, x + this.rect.width / 2, y + 20);
        }

        ctx.restore();
    }
}

class Mazo {
    constructor() {
        this.cartas = [];
        for (let i = 2; i < 100; i++) {
            this.cartas.push(new Carta(i));
        }
        this.barajar();
    }

    barajar() {
        for (let i = this.cartas.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cartas[i], this.cartas[j]] = [this.cartas[j], this.cartas[i]];
        }
    }

    sacarCarta() {
        return this.cartas.pop() || null;
    }
}

class Jugador {
    constructor(nombre) {
        this.nombre = nombre;
        this.mano = [];
        this.cartas_jugadas_este_turno = 0;
        this.cartas_colocadas_este_turno = [];
    }

    robarCarta(mazo) {
        const cartasNecesarias = 6 - this.mano.length;
        let cartasRobadas = 0;

        while (cartasRobadas < cartasNecesarias && mazo.cartas.length > 0) {
            const carta = mazo.sacarCarta();
            if (carta) {
                this.mano.push(carta);
                cartasRobadas++;
            }
        }

        if (cartasRobadas > 0) {
            this.ordenarMano();
            this.actualizarPosiciones();
        }

        return cartasRobadas > 0;
    }

    ordenarMano() {
        this.mano.sort((a, b) => a.valor - b.valor);
    }

    actualizarPosiciones() {
        const cantidadMano = this.mano.length;
        if (cantidadMano === 0) return;

        const margen = 20;
        const anchoTotal = ANCHO - 2 * margen;
        const espacioCarta = Math.min(100, anchoTotal / Math.max(1, cantidadMano));
        const inicioX = margen + (anchoTotal - (cantidadMano * espacioCarta)) / 2;

        for (let i = 0; i < this.mano.length; i++) {
            const carta = this.mano[i];
            let x = inicioX + i * espacioCarta;
            const y = ALTO - 150;

            if (x + carta.rect.width > ANCHO - margen) {
                x = ANCHO - margen - carta.rect.width;
            }
            if (x < margen) {
                x = margen;
            }

            carta.posicion_original = { x, y };
            carta.rect.x = x;
            carta.rect.y = y;
            carta.angulo = 0;
            carta.rect.width = ANCHO_CARTA;
            carta.rect.height = ALTO_CARTA;
        }
    }

    puedeJugar(tablero) {
        for (const carta of this.mano) {
            for (const columna in tablero.columnas) {
                if (tablero.esMovimientoValido(columna, carta, this.mano)) {
                    return true;
                }
            }
        }
        return false;
    }
}

class Tablero {
    constructor() {
        this.columnas = {
            ascendente_1: [],
            ascendente_2: [],
            descendente_1: [],
            descendente_2: []
        };
        this.zonas_columnas = {};
        this.zonas_titulos = {};
        this.espaciado_columnas = ESPACIADO_COLUMNAS;
        this.ancho_columna = ANCHO_COLUMNA;
        this.alto_columna = ALTO_COLUMNA;
        this.pos_y = ALTO / 2 - this.alto_columna / 2;
        this.columna_seleccionada = null;
    }

    esMovimientoValido(columna, carta, manoJugador) {
        if (columna.includes('ascendente')) {
            if (this.columnas[columna].length === 0) {
                return columna === 'ascendente_1' ? carta.valor > 1 : true;
            }

            const ultima = this.columnas[columna][this.columnas[columna].length - 1].valor;

            if (carta.valor > ultima) {
                return true;
            }

            if (carta.valor === ultima - 10) {
                return manoJugador.some(c => c.valor === ultima - 10);
            }

            return false;
        } else {
            if (this.columnas[columna].length === 0) {
                return columna === 'descendente_1' ? carta.valor < 100 : true;
            }

            const ultima = this.columnas[columna][this.columnas[columna].length - 1].valor;

            if (carta.valor < ultima) {
                return true;
            }

            if (carta.valor === ultima + 10) {
                return manoJugador.some(c => c.valor === ultima + 10);
            }

            return false;
        }
    }

    dibujar(ctx) {
        const anchoTotal = (4 * this.ancho_columna) + (3 * this.espaciado_columnas);
        const inicioX = (ANCHO - anchoTotal) / 2;

        let i = 0;
        for (const [nombre, cartas] of Object.entries(this.columnas)) {
            const x = inicioX + i * (this.ancho_columna + this.espaciado_columnas);
            const y = this.pos_y;

            this.zonas_columnas[nombre] = { x, y, width: this.ancho_columna, height: this.alto_columna };

            ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
            const texto = nombre;
            const textoWidth = ctx.measureText(texto).width;
            const tituloRect = {
                x: x + (this.ancho_columna - textoWidth) / 2,
                y: y - 30,
                width: textoWidth,
                height: TAM_PEQ
            };
            this.zonas_titulos[nombre] = tituloRect;

            ctx.fillStyle = COLOR_COLUMNA;
            ctx.beginPath();
            ctx.roundRect(x, y, this.ancho_columna, this.alto_columna, 5);
            ctx.fill();

            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(x, y, this.ancho_columna, this.alto_columna, 5);
            ctx.stroke();

            const colorTitulo = nombre === this.columna_seleccionada ? 'rgba(200, 200, 0)' : COLOR_TEXTO;
            ctx.fillStyle = colorTitulo;
            ctx.fillText(texto, tituloRect.x, tituloRect.y + TAM_PEQ);

            if (cartas.length > 0) {
                const ultimaCarta = cartas[cartas.length - 1];
                ultimaCarta.rect.width = ANCHO_CARTA;
                ultimaCarta.rect.height = ALTO_CARTA;
                const posX = x + (this.ancho_columna - ANCHO_CARTA) / 2;
                const posY = y + (this.alto_columna - ALTO_CARTA) / 2;
                ultimaCarta.dibujar(ctx, posX, posY);
            }

            i++;
        }
    }

    mostrarCartasColumna(ctx, nombreColumna) {
        const cartas = this.columnas[nombreColumna];
        const anchoVentana = Math.min(800, ANCHO - 100);
        const altoVentana = Math.min(600, ALTO - 100);
        const posX = ANCHO / 2 - anchoVentana / 2;
        const posY = ALTO / 2 - altoVentana / 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, ANCHO, ALTO);

        ctx.fillStyle = 'rgba(70, 70, 70, 0.9)';
        ctx.beginPath();
        ctx.roundRect(posX, posY, anchoVentana, altoVentana, 10);
        ctx.fill();

        ctx.strokeStyle = 'rgba(120, 120, 120, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(posX, posY, anchoVentana, altoVentana, 10);
        ctx.stroke();

        ctx.fillStyle = 'rgba(30, 30, 30, 0.8)';
        ctx.beginPath();
        ctx.roundRect(posX + 20, posY + 15, anchoVentana - 40, 40, 5);
        ctx.fill();

        ctx.font = `${TAM_TITULO}px ${FUENTE_TITULO}`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.fillText(`Cartas en ${nombreColumna} (${cartas.length})`, posX + 30, posY + 40);

        ctx.fillStyle = 'rgba(200, 50, 50, 0.8)';
        ctx.beginPath();
        ctx.roundRect(posX + anchoVentana - 120, posY + altoVentana - 50, 100, 30, 5);
        ctx.fill();

        ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText('Cerrar', posX + anchoVentana - 70, posY + altoVentana - 30);

        let x = posX + 20;
        let y = posY + 70;
        const cartasPorFila = Math.max(1, Math.floor((anchoVentana - 40) / (ANCHO_CARTA + 20)));

        for (let i = 0; i < cartas.length; i++) {
            if (i > 0 && i % cartasPorFila === 0) {
                x = posX + 20;
                y += ALTO_CARTA + 20;
            }

            const carta = cartas[i];
            const cartaTemp = new Carta(carta.valor, carta.color);
            cartaTemp.rect.width = ANCHO_CARTA;
            cartaTemp.rect.height = ALTO_CARTA;
            cartaTemp.jugador = carta.jugador;
            cartaTemp.dibujar(ctx, x, y);

            x += ANCHO_CARTA + 20;
        }

        return {
            cerrar: {
                x: posX + anchoVentana - 120,
                y: posY + altoVentana - 50,
                width: 100,
                height: 30
            }
        };
    }
}

class Juego {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Obtener datos de la sesión
        currentPlayer = sessionStorage.getItem('playerName');
        roomId = sessionStorage.getItem('roomId');
        isHost = sessionStorage.getItem('isHost') === 'true';

        // Configurar conexión WebSocket
        this.setupWebSocket();

        // Inicializar juego
        this.initializeGame();

        // Configurar controles
        this.setupControls();

        // Estado del juego
        this.turno = currentPlayer;
        this.juego_terminado = false;
        this.resultado = null;
        this.carta_arrastrada = null;
        this.boton_terminar_turno = { x: 900, y: 100, width: 200, height: 50 };
        this.boton_reiniciar = { x: ANCHO / 2 - 100, y: ALTO / 2 + 100, width: 200, height: 50 };
        this.boton_hover = false;
        this.mensaje_error = "";
        this.tiempo_error = 0;
        this.mostrando_columna = false;
        this.columna_actual = "";
        this.boton_cerrar_columna = null;
    }

    setupWebSocket() {
        const WS_URL = 'wss://your-render-app.onrender.com';
        socket = new WebSocket(`${WS_URL}?roomId=${roomId}&playerName=${currentPlayer}`);

        socket.onopen = () => {
            console.log('Conexión WebSocket establecida');
        };

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleNetworkMessage(message);
        };

        socket.onclose = () => {
            console.log('Conexión WebSocket cerrada');
            alert('Se ha perdido la conexión con el servidor');
        };

        socket.onerror = (error) => {
            console.error('Error en WebSocket:', error);
        };
    }

    handleNetworkMessage(message) {
        switch (message.type) {
            case 'player_joined':
                this.updatePlayersList(message.players);
                break;

            case 'game_state':
                this.updateGameState(message.gameState);
                break;

            case 'player_turn':
                this.handlePlayerTurn(message.playerName);
                break;

            case 'card_played':
                this.handleCardPlayed(message.card, message.column, message.playerName);
                break;

            case 'game_over':
                this.handleGameOver(message.result);
                break;

            case 'error':
                this.mostrarError(message.message);
                break;
        }
    }

    initializeGame() {
        this.mazo = new Mazo();
        this.jugador = new Jugador(currentPlayer);
        this.tablero = new Tablero();

        // Solo el host inicializa el juego
        if (isHost) {
            const inicioAsc = new Carta(1, COLOR_CARTA);
            inicioAsc.jugador = 'Sistema';
            this.tablero.columnas["ascendente_1"].push(inicioAsc);
            this.tablero.columnas["ascendente_2"].push(inicioAsc);

            const inicioDesc = new Carta(100, COLOR_CARTA);
            inicioDesc.jugador = 'Sistema';
            this.tablero.columnas["descendente_1"].push(inicioDesc);
            this.tablero.columnas["descendente_2"].push(inicioDesc);

            this.mazo.cartas = this.mazo.cartas.filter(c => c.valor !== 1 && c.valor !== 100);

            // Enviar estado inicial a todos los jugadores
            this.broadcastGameState();
        }
    }

    setupControls() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));

        document.getElementById('endTurn').addEventListener('click', () => {
            this.terminarTurno();
        });
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const posRaton = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        posRaton.x *= scaleX;
        posRaton.y *= scaleY;

        this.boton_hover = this.colisionPuntoRect(posRaton, this.boton_terminar_turno);

        if (this.juego_terminado) {
            if (this.colisionPuntoRect(posRaton, this.boton_reiniciar)) {
                this.reiniciarJuego();
            }
            return;
        }

        // Verificar si es nuestro turno
        if (this.turno !== currentPlayer) {
            this.mostrarError("No es tu turno");
            return;
        }

        let columnaClicada = null;
        for (const [nombreColumna, rect] of Object.entries(this.tablero.zonas_titulos)) {
            if (this.colisionPuntoRect(posRaton, rect)) {
                columnaClicada = nombreColumna;
                break;
            }
        }

        if (columnaClicada) {
            this.mostrando_columna = true;
            this.columna_actual = columnaClicada;
        } else {
            if (this.colisionPuntoRect(posRaton, this.boton_terminar_turno)) {
                this.terminarTurno();
            } else {
                // Verificar clic en cartas jugadas este turno por el jugador actual
                let cartaDevuelta = null;
                let columnaSeleccionada = null;

                for (const [columna, cartasColumna] of Object.entries(this.tablero.columnas)) {
                    if (cartasColumna.length > 0 &&
                        cartasColumna[cartasColumna.length - 1].jugada_este_turno &&
                        cartasColumna[cartasColumna.length - 1].jugador === currentPlayer) {
                        const zona = this.tablero.zonas_columnas[columna];
                        const rectCarta = {
                            x: zona.x + (zona.width - ANCHO_CARTA) / 2,
                            y: zona.y + (zona.height - ALTO_CARTA) / 2,
                            width: ANCHO_CARTA,
                            height: ALTO_CARTA
                        };

                        if (this.colisionPuntoRect(posRaton, rectCarta)) {
                            cartaDevuelta = this.tablero.columnas[columna].pop();
                            columnaSeleccionada = columna;
                            break;
                        }
                    }
                }

                if (cartaDevuelta) {
                    cartaDevuelta.color = COLOR_CARTA;
                    this.jugador.mano.push(cartaDevuelta);
                    this.jugador.cartas_jugadas_este_turno--;
                    cartaDevuelta.jugada_este_turno = false;
                    cartaDevuelta.jugador = '';
                    this.jugador.ordenarMano();
                    this.jugador.actualizarPosiciones();

                    // Notificar a otros jugadores
                    if (isHost) {
                        this.broadcastGameState();
                    } else {
                        this.sendCardReturned(columnaSeleccionada);
                    }
                } else {
                    // Verificar clic en cartas de la mano
                    for (let i = this.jugador.mano.length - 1; i >= 0; i--) {
                        const carta = this.jugador.mano[i];
                        if (this.colisionPuntoRect(posRaton, carta.rect)) {
                            this.carta_arrastrada = carta;
                            carta.arrastrando = true;
                            carta.posicion_original = { x: carta.rect.x, y: carta.rect.y };
                            carta.rect.width = ANCHO_CARTA_ARRATRE;
                            carta.rect.height = ALTO_CARTA_ARRATRE;
                            break;
                        }
                    }
                }
            }
        }
    }

    handleMouseUp(e) {
        if (this.carta_arrastrada) {
            const rect = this.canvas.getBoundingClientRect();
            const posRaton = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };

            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            posRaton.x *= scaleX;
            posRaton.y *= scaleY;

            this.soltarCarta(posRaton);
            this.carta_arrastrada.arrastrando = false;
            this.carta_arrastrada.rect.width = ANCHO_CARTA;
            this.carta_arrastrada.rect.height = ALTO_CARTA;
            this.carta_arrastrada = null;
            this.jugador.actualizarPosiciones();
        }
    }

    handleMouseMove(e) {
        if (this.carta_arrastrada) {
            const rect = this.canvas.getBoundingClientRect();
            const posRaton = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };

            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            posRaton.x *= scaleX;
            posRaton.y *= scaleY;

            this.carta_arrastrada.rect.x = posRaton.x - ANCHO_CARTA_ARRATRE / 2;
            this.carta_arrastrada.rect.y = posRaton.y - ALTO_CARTA_ARRATRE / 2;
        }
    }

    colisionPuntoRect(punto, rect) {
        return (
            punto.x >= rect.x &&
            punto.x <= rect.x + rect.width &&
            punto.y >= rect.y &&
            punto.y <= rect.y + rect.height
        );
    }

    soltarCarta(pos) {
        let cartaValida = false;
        for (const [columna, zona] of Object.entries(this.tablero.zonas_columnas)) {
            if (this.colisionPuntoRect(pos, zona)) {
                if (this.tablero.esMovimientoValido(columna, this.carta_arrastrada, this.jugador.mano)) {
                    this.carta_arrastrada.color = COLOR_CARTA_JUGADOR;
                    this.carta_arrastrada.jugador = currentPlayer;
                    this.tablero.columnas[columna].push(this.carta_arrastrada);
                    this.jugador.mano = this.jugador.mano.filter(c => c !== this.carta_arrastrada);
                    this.carta_arrastrada.jugada_este_turno = true;
                    this.jugador.cartas_jugadas_este_turno++;
                    cartaValida = true;

                    // Notificar a otros jugadores
                    if (isHost) {
                        this.broadcastGameState();
                    } else {
                        this.sendCardPlayed(this.carta_arrastrada, columna);
                    }
                    break;
                }
            }
        }

        if (!cartaValida) {
            this.carta_arrastrada.rect.x = this.carta_arrastrada.posicion_original.x;
            this.carta_arrastrada.rect.y = this.carta_arrastrada.posicion_original.y;
        }
    }

    terminarTurno() {
        // Verificar si es nuestro turno
        if (this.turno !== currentPlayer) {
            this.mostrarError("No es tu turno");
            return;
        }

        const minimoRequerido = this.mazo.cartas.length === 0 ? 1 : 2;

        if (this.jugador.cartas_jugadas_este_turno < minimoRequerido) {
            const jugadasPosibles = this.verificarJugadasDisponibles(this.jugador);

            if (jugadasPosibles >= minimoRequerido) {
                this.mostrarError(
                    `¡Debes jugar ${minimoRequerido} carta${minimoRequerido > 1 ? 's' : ''} antes de terminar! (Tienes ${jugadasPosibles} jugadas disponibles)`);
                return;
            } else {
                if (this.verificarRequisitoMinimo(this.jugador)) {
                    return;
                }
            }
        }

        // Resetear estado de cartas jugadas
        for (const columna of Object.values(this.tablero.columnas)) {
            for (const carta of columna) {
                carta.jugada_este_turno = false;
            }
        }

        // Robar cartas si es posible
        this.jugador.robarCarta(this.mazo);
        this.jugador.cartas_jugadas_este_turno = 0;

        // Cambiar turno
        const currentIndex = players.indexOf(this.turno);
        const nextIndex = (currentIndex + 1) % players.length;
        this.turno = players[nextIndex];

        // Notificar cambio de turno
        if (isHost) {
            this.broadcastGameState();
        } else {
            this.sendEndTurn();
        }
    }

    verificarJugadasDisponibles(jugador) {
        let jugadasValidas = 0;
        for (const carta of jugador.mano) {
            for (const columna in this.tablero.columnas) {
                if (this.tablero.esMovimientoValido(columna, carta, jugador.mano)) {
                    jugadasValidas++;
                    break;
                }
            }
        }
        return jugadasValidas;
    }

    verificarRequisitoMinimo(jugador) {
        const minimoRequerido = this.mazo.cartas.length === 0 ? 1 : 2;
        const jugadasPosibles = this.verificarJugadasDisponibles(jugador);

        if (jugadasPosibles < minimoRequerido) {
            if (this.mazo.cartas.length === 0) {
                let todosSinCartas = true;
                // Aquí necesitaríamos información de otros jugadores
                // En una implementación real, esto lo manejaría el host
                this.resultado = "¡Victoria Parcial! (Mazo vacío)";
            } else {
                this.resultado = `¡Derrota! (${jugador.nombre} no pudo jugar ${minimoRequerido} carta${minimoRequerido > 1 ? 's' : ''})`;
            }

            this.juego_terminado = true;

            // Notificar fin del juego
            if (isHost) {
                socket.send(JSON.stringify({
                    type: 'game_over',
                    result: this.resultado
                }));
            }
            return true;
        }
        return false;
    }

    verificarEstadoJuego() {
        if (!isHost) return;

        // Verificar si todos los jugadores se quedaron sin cartas
        let todosSinCartas = true;
        // Aquí necesitaríamos información de otros jugadores
        // En una implementación real, esto lo manejaría el host

        if (todosSinCartas && this.mazo.cartas.length === 0) {
            this.juego_terminado = true;
            this.resultado = "¡VICTORY ROYALE! (Todos ganan - Sin cartas)";
            socket.send(JSON.stringify({
                type: 'game_over',
                result: this.resultado
            }));
            return;
        }

        // Verificar bloqueo mutuo
        let todosBloqueados = true;
        // Similarmente, necesitaríamos información de otros jugadores

        if (todosBloqueados) {
            this.juego_terminado = true;
            if (this.mazo.cartas.length === 0) {
                this.resultado = "¡Victoria Parcial! (Mazo vacío pero bloqueo mutuo)";
            } else {
                this.resultado = "¡Todos pierden! (Bloqueo total - Nadie puede jugar)";
            }
            socket.send(JSON.stringify({
                type: 'game_over',
                result: this.resultado
            }));
            return;
        }
    }

    // Métodos de red
    broadcastGameState() {
        if (!isHost) return;

        const gameState = {
            mazo: {
                cartas: this.mazo.cartas.length
            },
            tablero: {
                columnas: this.tablero.columnas
            },
            jugadores: players,
            turnoActual: this.turno,
            juegoTerminado: this.juego_terminado,
            resultado: this.resultado
        };

        socket.send(JSON.stringify({
            type: 'game_state',
            gameState
        }));
    }

    sendCardPlayed(card, column) {
        socket.send(JSON.stringify({
            type: 'card_played',
            card: {
                valor: card.valor,
                color: card.color,
                jugador: card.jugador
            },
            column,
            playerName: currentPlayer
        }));
    }

    sendCardReturned(column) {
        socket.send(JSON.stringify({
            type: 'card_returned',
            column,
            playerName: currentPlayer
        }));
    }

    sendEndTurn() {
        socket.send(JSON.stringify({
            type: 'end_turn',
            playerName: currentPlayer
        }));
    }

    // Manejo de mensajes de red
    updatePlayersList(playerList) {
        players = playerList;
        this.updatePlayersPanel();
    }

    updateGameState(gameState) {
        // Actualizar mazo
        this.mazo.cartas = [];
        for (let i = 0; i < gameState.mazo.cartas; i++) {
            this.mazo.cartas.push(new Carta(2)); // Valor dummy, no se usa
        }

        // Actualizar tablero
        for (const [columna, cartas] of Object.entries(gameState.tablero.columnas)) {
            this.tablero.columnas[columna] = cartas.map(c => {
                const carta = new Carta(c.valor, c.color);
                carta.jugador = c.jugador;
                carta.jugada_este_turno = c.jugada_este_turno;
                return carta;
            });
        }

        // Actualizar turno
        this.turno = gameState.turnoActual;

        // Actualizar estado del juego
        this.juego_terminado = gameState.juegoTerminado || false;
        this.resultado = gameState.resultado || null;

        // Actualizar panel de jugadores
        this.updatePlayersPanel();
    }

    handlePlayerTurn(playerName) {
        this.turno = playerName;
        this.updatePlayersPanel();
    }

    handleCardPlayed(cardData, column, playerName) {
        if (isHost) return; // El host ya tiene esta información

        const carta = new Carta(cardData.valor, cardData.color);
        carta.jugador = playerName;
        this.tablero.columnas[column].push(carta);

        if (playerName === currentPlayer) {
            this.jugador.cartas_jugadas_este_turno++;
        }
    }

    handleGameOver(result) {
        this.juego_terminado = true;
        this.resultado = result;
    }

    updatePlayersPanel() {
        const playersPanel = document.getElementById('playersPanel');
        playersPanel.innerHTML = '';

        players.forEach(player => {
            const playerElement = document.createElement('div');
            playerElement.className = 'player';
            playerElement.textContent = player;

            if (player === this.turno) {
                playerElement.classList.add('current-turn');
                playerElement.textContent += ' (Turno actual)';
            }

            if (player === currentPlayer) {
                playerElement.classList.add('you');
                playerElement.textContent += ' (Tú)';
            }

            playersPanel.appendChild(playerElement);
        });
    }

    mostrarError(mensaje) {
        this.mensaje_error = mensaje;
        this.tiempo_error = Date.now();
    }

    reiniciarJuego() {
        if (isHost) {
            // Reiniciar el juego como host
            this.initializeGame();
            this.turno = currentPlayer;
            this.juego_terminado = false;
            this.resultado = null;
            this.broadcastGameState();
        } else {
            // Solicitar reinicio al host
            socket.send(JSON.stringify({
                type: 'request_restart'
            }));
        }
    }

    dibujar(ctx) {
        if (this.mostrando_columna) {
            this.boton_cerrar_columna = this.tablero.mostrarCartasColumna(ctx, this.columna_actual);
            return;
        }

        ctx.fillStyle = COLOR_FONDO;
        ctx.fillRect(0, 0, ANCHO, ALTO);

        this.tablero.dibujar(ctx);

        if (Date.now() - this.tiempo_error < 3000) {
            ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
            ctx.fillStyle = COLOR_ERROR;
            ctx.textAlign = 'center';
            ctx.fillText(this.mensaje_error, ANCHO / 2, ALTO - 200);
        }

        if (!this.juego_terminado && this.turno === currentPlayer) {
            const minimoRequerido = this.mazo.cartas.length === 0 ? 1 : 2;
            const jugadasPosibles = this.verificarJugadasDisponibles(this.jugador);

            if (jugadasPosibles < minimoRequerido) {
                ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
                ctx.fillStyle = COLOR_ERROR;
                ctx.textAlign = 'center';
                ctx.fillText(
                    `¡ADVERTENCIA: Solo tienes ${jugadasPosibles} jugada${jugadasPosibles !== 1 ? 's' : ''} disponible${jugadasPosibles !== 1 ? 's' : ''} (necesitas ${minimoRequerido})`,
                    ANCHO / 2, ALTO - 230);
            }
        }

        for (const carta of this.jugador.mano) {
            if (carta !== this.carta_arrastrada) {
                let esJugable = false;
                for (const columna in this.tablero.columnas) {
                    if (this.tablero.esMovimientoValido(columna, carta, this.jugador.mano)) {
                        esJugable = true;
                        break;
                    }
                }

                if (esJugable) {
                    ctx.strokeStyle = COLOR_JUGABLE;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.roundRect(carta.rect.x - 3, carta.rect.y - 3, carta.rect.width + 6, carta.rect.height + 6, 5);
                    ctx.stroke();
                }

                carta.dibujar(ctx, carta.rect.x, carta.rect.y);
            }
        }

        if (this.carta_arrastrada) {
            this.carta_arrastrada.dibujar(ctx, this.carta_arrastrada.rect.x, this.carta_arrastrada.rect.y);
        }

        const colorBoton = this.boton_hover ? COLOR_BOTON_HOVER : COLOR_BOTON;
        ctx.fillStyle = colorBoton;
        ctx.beginPath();
        ctx.roundRect(this.boton_terminar_turno.x, this.boton_terminar_turno.y, this.boton_terminar_turno.width, this.boton_terminar_turno.height, 5);
        ctx.fill();

        ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
        ctx.fillStyle = COLOR_TEXTO;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("Terminar Turno", this.boton_terminar_turno.x + this.boton_terminar_turno.width / 2, this.boton_terminar_turno.y + this.boton_terminar_turno.height / 2);

        ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
        ctx.fillStyle = COLOR_TEXTO;
        ctx.textAlign = 'left';
        ctx.fillText(`Turno: ${this.turno}`, 50, 50);

        ctx.fillText(`Cartas restantes: ${this.mazo.cartas.length}`, 50, 80);

        const minimoRequerido = this.mazo.cartas.length === 0 ? 1 : 2;
        ctx.fillText(`Cartas jugadas: ${this.jugador.cartas_jugadas_este_turno} (mín ${minimoRequerido})`, 50, 110);

        if (this.juego_terminado) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, ANCHO, ALTO);

            ctx.font = `${TAM_GRANDE}px ${FUENTE_GRANDE}`;
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.fillText(this.resultado, ANCHO / 2, ALTO / 2);

            ctx.fillStyle = COLOR_BOTON;
            ctx.beginPath();
            ctx.roundRect(this.boton_reiniciar.x, this.boton_reiniciar.y, this.boton_reiniciar.width, this.boton_reiniciar.height, 5);
            ctx.fill();

            ctx.font = `${TAM_PEQ}px ${FUENTE_PEQ}`;
            ctx.fillStyle = COLOR_TEXTO;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("Reiniciar Juego", this.boton_reiniciar.x + this.boton_reiniciar.width / 2, this.boton_reiniciar.y + this.boton_reiniciar.height / 2);
        }
    }
}

// Inicialización del juego
function initGame() {
    const canvas = document.getElementById('gameCanvas');
    gameInstance = new Juego(canvas);

    function gameLoop() {
        gameInstance.dibujar(gameInstance.ctx);
        requestAnimationFrame(gameLoop);
    }

    gameLoop();
}

// Iniciar el juego cuando se cargue la página
if (window.location.pathname.endsWith('game.html')) {
    document.addEventListener('DOMContentLoaded', initGame);
}