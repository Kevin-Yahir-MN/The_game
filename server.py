import os
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
from game_logic import GameManager
from constants import *

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev_secret_key')
socketio = SocketIO(app, cors_allowed_origins="*")

games = GameManager()


@app.route('/')
def index():
    return render_template('index.html')


@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")


@socketio.on('disconnect')
def handle_disconnect():
    game_id = session.get('game_id')
    if game_id:
        leave_room(game_id)
        games.handle_disconnect(game_id, session.get('player_name'))
        emit('player_left', {'playerName': session.get(
            'player_name')}, room=game_id)


@socketio.on('create_game')
def handle_create_game(data):
    game_id = games.create_game(data['playerName'])
    session['game_id'] = game_id
    session['player_name'] = data['playerName']
    join_room(game_id)
    emit('game_created', {'gameId': game_id})
    emit('waiting_for_player', room=game_id)


@socketio.on('join_game')
def handle_join_game(data):
    game_id = data['gameId'].strip()
    player_name = data['playerName'].strip()

    if not game_id or not player_name:
        emit('join_error', {'message': 'ID de juego y nombre son requeridos'})
        return

    result, message = games.join_game(game_id, player_name)
    if result:
        session['game_id'] = game_id
        session['player_name'] = player_name
        join_room(game_id)
        emit('player_joined', {'playerName': player_name}, room=game_id)
        emit('game_started', room=game_id)
        emit('game_state', games.get_game_state(game_id), room=game_id)
    else:
        emit('join_error', {'message': message})


@socketio.on('play_card')
def handle_play_card(data):
    game_id = session.get('game_id')
    player_name = session.get('player_name')

    if not game_id or not player_name:
        return

    success, message = games.play_card(
        game_id,
        player_name,
        data['column'],
        data['cardValue']
    )

    if success:
        emit('game_state', games.get_game_state(game_id), room=game_id)
        emit('play_success', {'message': message}, room=game_id)
    else:
        emit('play_error', {'message': message})


@socketio.on('end_turn')
def handle_end_turn():
    game_id = session.get('game_id')
    player_name = session.get('player_name')

    if not game_id or not player_name:
        return

    success, message = games.end_turn(game_id, player_name)
    if success:
        emit('game_state', games.get_game_state(game_id), room=game_id)
        emit('turn_ended', {
             'nextPlayer': games.get_current_player(game_id)}, room=game_id)
    else:
        emit('turn_error', {'message': message})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
