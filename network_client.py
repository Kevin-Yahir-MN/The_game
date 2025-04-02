import socket
import json
import threading


class NetworkClient:
    def __init__(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.nickname = ""
        self.game_state = None
        self.message_queue = []
        self.connected = False
        self.lock = threading.Lock()

    def connect(self, host, port, nickname):
        try:
            self.client.connect((host, port))
            self.nickname = nickname
            self.connected = True

            # Enviar mensaje de unión
            self.send({
                'type': 'join',
                'nickname': nickname
            })

            # Iniciar hilo para recibir mensajes
            receive_thread = threading.Thread(target=self.receive_messages)
            receive_thread.daemon = True
            receive_thread.start()

            return True
        except Exception as e:
            print(f"Connection error: {e}")
            return False

    def receive_messages(self):
        while self.connected:
            try:
                data = self.client.recv(4096).decode('utf-8')
                if not data:
                    self.connected = False
                    break

                # Manejar posible concatenación de mensajes
                messages = data.split('}{')
                for i, msg in enumerate(messages):
                    if i != 0:
                        msg = '{' + msg
                    if i != len(messages) - 1:
                        msg = msg + '}'

                    try:
                        message = json.loads(msg)
                        with self.lock:
                            if message['type'] == 'game_state' or message['type'] == 'game_update':
                                self.game_state = message.get('state')
                            self.message_queue.append(message)
                    except json.JSONDecodeError:
                        print(f"Error decoding message: {msg}")
            except Exception as e:
                print(f"Receive error: {e}")
                self.connected = False
                break

    def get_messages(self):
        with self.lock:
            messages = self.message_queue.copy()
            self.message_queue.clear()
            return messages

    def send(self, message):
        try:
            self.client.send(json.dumps(message).encode('utf-8'))
            return True
        except Exception as e:
            print(f"Send error: {e}")
            self.connected = False
            return False

    def play_card(self, card, column):
        return self.send({
            'type': 'play_card',
            'card': card,
            'column': column
        })

    def end_turn(self):
        return self.send({
            'type': 'end_turn'
        })

    def start_game(self):
        return self.send({
            'type': 'start_game'
        })

    def disconnect(self):
        self.connected = False
        try:
            self.client.close()
        except:
            pass
