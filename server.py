import os
import random
from datetime import datetime
from flask import Flask, render_template, session, request
from flask_socketio import SocketIO, emit, join_room
import sys
from engineio.payload import Payload

# Configuration
Payload.max_decode_packets = 500  # Para manejar más datos

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_secret_key')
socketio = SocketIO(app,
                    cors_allowed_origins="*",
                    logger=True,
                    engineio_logger=True,
                    ping_timeout=300,
                    ping_interval=25)

# Game Storage
games = {}

# Routes


@app.route('/')
def index():
    return render_template('index.html')

# Socket.IO Handlers


@socketio.on('create_game')
def handle_create_game(data):
    try:
        print(f"\n[SERVER] 📡 Nuevo juego solicitado por: {data['playerName']}")

        # Generate unique game ID
        game_id = str(random.randint(1000, 9999))
        while game_id in games:
            game_id = str(random.randint(1000, 9999))

        games[game_id] = {
            'host': data['playerName'],
            'players': [data['playerName']],
            'game_state': None,
            'started': False,
            'created_at': datetime.now().isoformat(),
            'last_activity': datetime.now()
        }

        session['game_id'] = game_id
        join_room(game_id)

        print(f"[SERVER] 🎮 Juego creado - ID: {game_id}")

        emit('game_created', {
            'gameId': game_id,
            'message': 'Juego creado exitosamente'
        }, callback=lambda: print("[SERVER] ✔ Confirmación recibida por cliente"))

    except Exception as e:
        error_msg = f"[SERVER] Error al crear juego: {str(e)}"
        print(error_msg, file=sys.stderr)
        emit('creation_error', {
            'error': error_msg,
            'suggestions': [
                "Recarga la página",
                "Verifica tu conexión a internet"
            ]
        })


@socketio.on('join_game')
def handle_join_game(data):
    try:
        game_id = data['gameId']
        player_name = data['playerName']

        print(
            f"\n[SERVER] 📥 Intento de unión a juego {game_id} por {player_name}")

        if game_id not in games:
            raise ValueError("ID de juego no válido")

        if len(games[game_id]['players']) >= 2:
            raise ValueError("El juego ya está lleno")

        games[game_id]['players'].append(player_name)
        session['game_id'] = game_id
        join_room(game_id)

        print(f"[SERVER] 🎉 {player_name} se unió al juego {game_id}")

        emit('player_joined', {
            'playerName': player_name
        }, room=game_id)

        emit('game_started', room=game_id)

    except Exception as e:
        error_msg = f"[SERVER] Error al unirse al juego: {str(e)}"
        print(error_msg, file=sys.stderr)
        emit('join_error', {
            'error': error_msg
        })

# Cleanup


@socketio.on('disconnect')
def handle_disconnect():
    game_id = session.get('game_id')
    if game_id and game_id in games:
        print(f"\n[SERVER] ♻️ Limpiando juego {game_id} por desconexión")
        del games[game_id]


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app,
                 host='0.0.0.0',
                 port=port,
                 debug=True,
                 use_reloader=True,
                 allow_unsafe_werkzeug=True)
