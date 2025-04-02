from mazo import Mazo
from jugador import Jugador
from tablero import Tablero
import random
from constants import *
from datetime import datetime, timedelta


class GameManager:
    def __init__(self):
        self.games = {}
        self.player_game_map = {}

    def create_game(self, host_name):
        game_id = str(random.randint(1000, 9999))
        while game_id in self.games:
            game_id = str(random.randint(1000, 9999))

        self.games[game_id] = {
            'host': host_name,
            'players': [],
            'game_state': None,
            'current_turn': None,
            'started': False,
            'last_activity': datetime.now(),
            'timeout': timedelta(minutes=30)
        }
        return game_id

    def join_game(self, game_id, player_name):
        if game_id not in self.games:
            return False, "Juego no encontrado"

        game = self.games[game_id]

        if len(game['players']) >= 2:
            return False, "El juego ya está lleno"

        if player_name in game['players']:
            return False, "Nombre de jugador ya en uso"

        game['players'].append(player_name)
        self.player_game_map[player_name] = game_id

        if len(game['players']) == 2:
            self.initialize_game(game_id)
            game['started'] = True

        return True, "Unido al juego exitosamente"

    def initialize_game(self, game_id):
        game = self.games[game_id]

        # Initialize game components
        tablero = Tablero()
        mazo = Mazo()

        # Setup initial board
        inicio_asc = Carta(1, COLOR_CARTA)
        tablero.columnas["ascendente_1"].append(inicio_asc)
        tablero.columnas["ascendente_2"].append(inicio_asc)

        inicio_desc = Carta(100, COLOR_CARTA)
        tablero.columnas["descendente_1"].append(inicio_desc)
        tablero.columnas["descendente_2"].append(inicio_desc)

        # Remove initial cards from deck
        mazo.cartas = [c for c in mazo.cartas if c.valor not in [1, 100]]

        # Create players and deal cards
        players = {}
        for player_name in game['players']:
            mano = []
            for _ in range(6):
                carta = mazo.sacar_carta()
                if carta:
                    mano.append(carta)
            players[player_name] = Jugador(player_name)
            players[player_name].mano = mano
            players[player_name].ordenar_mano()

        # Set initial turn
        current_turn = random.choice(game['players'])

        game['game_state'] = {
            'tablero': tablero,
            'mazo': mazo,
            'players': players,
            'turno': current_turn,
            'game_over': False,
            'resultado': None
        }

    def play_card(self, game_id, player_name, column, card_value):
        if game_id not in self.games:
            return False, "Juego no encontrado"

        game = self.games[game_id]
        game_state = game['game_state']

        if game_state['turno'] != player_name:
            return False, "No es tu turno"

        if game_state['game_over']:
            return False, "El juego ha terminado"

        # Find the card in player's hand
        player = game_state['players'][player_name]
        card_to_play = None
        for card in player.mano:
            if card.valor == card_value:
                card_to_play = card
                break

        if not card_to_play:
            return False, "Carta no encontrada en tu mano"

        # Validate move
        if not game_state['tablero'].es_movimiento_valido(column, card_to_play, player.mano):
            return False, "Movimiento no válido"

        # Play the card
        card_to_play.color = COLOR_CARTA_JUGADOR if player_name == game[
            'players'][0] else COLOR_CARTA_IA
        game_state['tablero'].columnas[column].append(card_to_play)
        player.mano.remove(card_to_play)
        player.cartas_jugadas_este_turno += 1
        card_to_play.jugada_este_turno = True

        # Check game state
        self.check_game_state(game_id)

        return True, f"Carta {card_value} jugada en {column}"

    def end_turn(self, game_id, player_name):
        if game_id not in self.games:
            return False, "Juego no encontrado"

        game = self.games[game_id]
        game_state = game['game_state']

        if game_state['turno'] != player_name:
            return False, "No es tu turno"

        if game_state['game_over']:
            return False, "El juego ha terminado"

        player = game_state['players'][player_name]

        # Check minimum cards played requirement
        min_required = 1 if len(game_state['mazo'].cartas) == 0 else 2
        if player.cartas_jugadas_este_turno < min_required:
            # Check if player could have played more
            playable_cards = 0
            for card in player.mano:
                for column in game_state['tablero'].columnas:
                    if game_state['tablero'].es_movimiento_valido(column, card, player.mano):
                        playable_cards += 1
                        break

            if playable_cards >= min_required:
                return False, f"Debes jugar al menos {min_required} cartas este turno"

        # Draw cards if available
        cartas_robadas = 0
        while len(player.mano) < 6 and len(game_state['mazo'].cartas) > 0:
            carta = game_state['mazo'].sacar_carta()
            if carta:
                player.mano.append(carta)
                cartas_robadas += 1

        if cartas_robadas > 0:
            player.ordenar_mano()

        # Reset turn counters
        player.cartas_jugadas_este_turno = 0

        # Switch turns
        current_idx = game['players'].index(player_name)
        next_idx = (current_idx + 1) % len(game['players'])
        game_state['turno'] = game['players'][next_idx]

        # Check if next player can play
        next_player = game_state['players'][game_state['turno']]
        if not self.player_can_play(next_player, game_state['tablero']):
            # If not, check game state
            self.check_game_state(game_id)

        return True, "Turno terminado"

    def player_can_play(self, player, tablero):
        for card in player.mano:
            for column in tablero.columnas:
                if tablero.es_movimiento_valido(column, card, player.mano):
                    return True
        return False

    def check_game_state(self, game_id):
        game = self.games[game_id]
        game_state = game['game_state']

        # Check Victory Royale (all cards played and deck empty)
        all_hands_empty = all(len(player.mano) ==
                              0 for player in game_state['players'].values())
        if all_hands_empty and len(game_state['mazo'].cartas) == 0:
            game_state['game_over'] = True
            game_state['resultado'] = "¡VICTORY ROYALE! Todos ganan"
            return

        # Check mutual block (no one can play)
        can_play = [self.player_can_play(player, game_state['tablero'])
                    for player in game_state['players'].values()]

        if not any(can_play):
            game_state['game_over'] = True
            if len(game_state['mazo'].cartas) == 0:
                game_state['resultado'] = "¡Victoria Parcial! (Mazo vacío pero bloqueo mutuo)"
            else:
                game_state['resultado'] = "¡Todos pierden! (Bloqueo total)"
            return

    def get_game_state(self, game_id):
        if game_id not in self.games:
            return None

        game = self.games[game_id]
        return {
            'tablero': game['game_state']['tablero'].to_dict(),
            'mazo': {'cartas_restantes': len(game['game_state']['mazo'].cartas)},
            'players': {name: player.to_dict() for name, player in game['game_state']['players'].items()},
            'turno': game['game_state']['turno'],
            'game_over': game['game_state']['game_over'],
            'resultado': game['game_state']['resultado']
        }

    def get_current_player(self, game_id):
        return self.games[game_id]['game_state']['turno'] if game_id in self.games else None

    def handle_disconnect(self, game_id, player_name):
        if game_id in self.games and player_name in self.games[game_id]['players']:
            self.games[game_id]['players'].remove(player_name)
            if player_name in self.player_game_map:
                del self.player_game_map[player_name]
