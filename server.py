import socket
import threading
import json
from time import sleep
import sys


class GameServer:
    def __init__(self, host='0.0.0.0', port=5555):
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind((host, port))
        self.server.listen()
        self.clients = []
        self.players = {}
        self.game_state = {
            'players': {},
            'tablero': {
                'ascendente_1': [1],
                'ascendente_2': [1],
                'descendente_1': [100],
                'descendente_2': [100]
            },
            'mazo': list(range(2, 100)),
            'turno': None,
            'game_started': False
        }
        self.max_players = 5
        self.min_players = 2
        self.lock = threading.Lock()

        # Mostrar información de conexión al iniciar
        self.host = host
        self.port = port

    def show_server_info(self):
        print("\n" + "="*50)
        print(f"⚡ SERVIDOR INICIADO CORRECTAMENTE")
        print("="*50)
        print(f"🔌 Dirección: {self.host}")
        print(f"🔢 Puerto: {self.port}")
        print(f"👥 Máx. jugadores: {self.max_players}")
        print("="*50 + "\n")
        print("Esperando conexiones de jugadores...")
        print("Presiona Ctrl+C para detener el servidor\n")

    def broadcast(self, message, sender=None):
        with self.lock:
            for client_id in self.players:
                if client_id != sender:
                    try:
                        self.players[client_id]['socket'].send(
                            json.dumps(message).encode('utf-8'))
                    except:
                        self.remove_player(client_id)

    def handle_client(self, client, address):
        client_id = f"{address[0]}:{address[1]}"
        try:
            # Esperar mensaje de conexión
            data = client.recv(1024).decode('utf-8')
            join_data = json.loads(data)

            if join_data['type'] != 'join' or 'nickname' not in join_data:
                client.close()
                return

            with self.lock:
                if len(self.players) >= self.max_players:
                    client.send(json.dumps({
                        'type': 'error',
                        'message': 'Game is full'
                    }).encode('utf-8'))
                    client.close()
                    return

                self.players[client_id] = {
                    'socket': client,
                    'nickname': join_data['nickname'],
                    'mano': []
                }

                print(
                    f"🎮 Jugador conectado: {join_data['nickname']} ({address[0]})")

                # Repartir cartas iniciales si el juego ya empezó
                if self.game_state['game_started']:
                    self.deal_cards_to_new_player(client_id)

                # Notificar a todos
                self.broadcast({
                    'type': 'notification',
                    'message': f"{join_data['nickname']} se unió al juego"
                })

                # Enviar estado actual al nuevo jugador
                client.send(json.dumps({
                    'type': 'game_state',
                    'state': self.game_state
                }).encode('utf-8'))

            # Manejar mensajes del cliente
            while True:
                data = client.recv(1024).decode('utf-8')
                if not data:
                    break

                message = json.loads(data)
                self.process_message(message, client_id)

        except Exception as e:
            print(f"Error con el cliente {client_id}: {e}")
        finally:
            self.remove_player(client_id)

    def process_message(self, message, client_id):
        if message['type'] == 'start_game':
            self.start_game()
        elif message['type'] == 'play_card':
            self.play_card(client_id, message)
        elif message['type'] == 'end_turn':
            self.end_turn(client_id)

    def start_game(self):
        with self.lock:
            if len(self.players) >= self.min_players and not self.game_state['game_started']:
                self.game_state['game_started'] = True
                random.shuffle(self.game_state['mazo'])

                print("\n¡JUEGO INICIADO! Repartiendo cartas...")

                # Repartir cartas iniciales (6 por jugador)
                for player_id in self.players:
                    self.players[player_id]['mano'] = []
                    for _ in range(6):
                        if self.game_state['mazo']:
                            card = self.game_state['mazo'].pop()
                            self.players[player_id]['mano'].append(card)
                    print(
                        f"  - {self.players[player_id]['nickname']}: {len(self.players[player_id]['mano'])} cartas")

                # Elegir primer jugador al azar
                self.game_state['turno'] = random.choice(
                    list(self.players.keys()))

                # Actualizar estado del juego
                self.update_game_state()

                # Notificar a todos
                self.broadcast({
                    'type': 'game_start',
                    'state': self.game_state
                })

    def deal_cards_to_new_player(self, player_id):
        # Repartir cartas a un jugador que se une a partida en curso
        cards_needed = 6 - len(self.players[player_id]['mano'])
        for _ in range(cards_needed):
            if self.game_state['mazo']:
                card = self.game_state['mazo'].pop()
                self.players[player_id]['mano'].append(card)

    def play_card(self, player_id, message):
        with self.lock:
            if not self.game_state['game_started'] or self.game_state['turno'] != player_id:
                return

            # Validar movimiento
            card = message['card']
            column = message['column']

            if card not in self.players[player_id]['mano']:
                return

            # Lógica de validación simplificada
            last_card = self.game_state['tablero'][column][-1]
            valid = False

            if 'ascendente' in column:
                valid = card > last_card or card == last_card - 10
            else:
                valid = card < last_card or card == last_card + 10

            if valid:
                # Mover carta
                self.players[player_id]['mano'].remove(card)
                self.game_state['tablero'][column].append(card)

                print(
                    f"🃏 {self.players[player_id]['nickname']} jugó {card} en {column}")

                # Robar nueva carta si hay
                if self.game_state['mazo']:
                    new_card = self.game_state['mazo'].pop()
                    self.players[player_id]['mano'].append(new_card)

                self.update_game_state()
                self.broadcast({
                    'type': 'game_update',
                    'state': self.game_state
                })

    def end_turn(self, player_id):
        with self.lock:
            if self.game_state['game_started'] and self.game_state['turno'] == player_id:
                # Cambiar turno al siguiente jugador
                player_ids = list(self.players.keys())
                current_index = player_ids.index(player_id)
                next_index = (current_index + 1) % len(player_ids)
                self.game_state['turno'] = player_ids[next_index]

                print(
                    f"🔄 Turno cambiado a {self.players[self.game_state['turno']]['nickname']}")

                self.update_game_state()
                self.broadcast({
                    'type': 'game_update',
                    'state': self.game_state
                })

    def update_game_state(self):
        # Actualizar estado para enviar a clientes
        state = {
            'players': {pid: {
                'nickname': self.players[pid]['nickname'],
                'card_count': len(self.players[pid]['mano']),
                'is_turn': pid == self.game_state['turno']
            } for pid in self.players},
            'tablero': self.game_state['tablero'],
            'mazo_count': len(self.game_state['mazo']),
            'game_started': self.game_state['game_started']
        }
        self.game_state['broadcast_state'] = state

    def remove_player(self, client_id):
        with self.lock:
            if client_id in self.players:
                nickname = self.players[client_id]['nickname']
                try:
                    self.players[client_id]['socket'].close()
                except:
                    pass

                del self.players[client_id]
                print(f"🚪 Jugador desconectado: {nickname}")

                # Si el juego está en progreso y quedan jugadores
                if self.game_state['game_started'] and self.players:
                    # Si era su turno, pasar al siguiente
                    if self.game_state['turno'] == client_id:
                        player_ids = list(self.players.keys())
                        next_index = 0 % len(player_ids)
                        self.game_state['turno'] = player_ids[next_index]

                    self.update_game_state()
                    self.broadcast({
                        'type': 'notification',
                        'message': f"{nickname} abandonó el juego"
                    })
                    self.broadcast({
                        'type': 'game_update',
                        'state': self.game_state
                    })
                else:
                    self.broadcast({
                        'type': 'notification',
                        'message': f"{nickname} abandonó el juego"
                    })

    def shutdown(self):
        print("\nApagando servidor...")
        with self.lock:
            # Notificar a todos los clientes
            self.broadcast({
                'type': 'notification',
                'message': "El servidor se está apagando"
            })

            # Cerrar todas las conexiones
            for player_id in list(self.players.keys()):
                self.remove_player(player_id)

            # Cerrar socket del servidor
            self.server.close()
        print("Servidor detenido correctamente")

    def run(self):
        self.show_server_info()
        try:
            while True:
                client, address = self.server.accept()
                thread = threading.Thread(
                    target=self.handle_client, args=(client, address))
                thread.start()
        except KeyboardInterrupt:
            self.shutdown()
        except Exception as e:
            print(f"Error inesperado: {e}")
            self.shutdown()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Servidor del juego The Game')
    parser.add_argument('--host', default='0.0.0.0',
                        help='Dirección IP del servidor')
    parser.add_argument('--port', type=int, default=5555,
                        help='Puerto del servidor')
    args = parser.parse_args()

    server = GameServer(host=args.host, port=args.port)
    try:
        server.run()
    except Exception as e:
        print(f"Error al iniciar el servidor: {e}")
        sys.exit(1)
