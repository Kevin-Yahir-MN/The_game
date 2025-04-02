from constants import *


class Jugador:
    def __init__(self, nombre, es_ia=False):
        self.nombre = nombre
        self.mano = []
        self.es_ia = es_ia
        self.cartas_jugadas_este_turno = 0
        self.cartas_colocadas_este_turno = []

    def to_dict(self):
        """Serializa el jugador a diccionario"""
        return {
            'nombre': self.nombre,
            'es_ia': self.es_ia,
            'mano': [carta.to_dict() for carta in self.mano],
            'cartas_jugadas_este_turno': self.cartas_jugadas_este_turno,
            'cartas_colocadas_este_turno': self.cartas_colocadas_este_turno.copy()
        }

    @classmethod
    def from_dict(cls, data):
        """Crea un jugador desde un diccionario serializado"""
        jugador = cls(data['nombre'], data.get('es_ia', False))
        jugador.mano = [Carta.from_dict(carta_data)
                        for carta_data in data['mano']]
        jugador.cartas_jugadas_este_turno = data['cartas_jugadas_este_turno']
        jugador.cartas_colocadas_este_turno = data['cartas_colocadas_este_turno']
        return jugador

    def robar_carta(self, mazo):
        cartas_necesarias = 6 - len(self.mano)
        cartas_robadas = 0

        while cartas_robadas < cartas_necesarias and len(mazo.cartas) > 0:
            carta = mazo.sacar_carta()
            if carta:
                self.mano.append(carta)
                cartas_robadas += 1

        if cartas_robadas > 0:
            self.ordenar_mano()
            self.actualizar_posiciones()

        return cartas_robadas > 0

    def ordenar_mano(self):
        self.mano.sort(key=lambda carta: carta.valor)

    def actualizar_posiciones(self):
        cantidad_mano = len(self.mano)
        if cantidad_mano == 0:
            return

        margen = 20
        ancho_total = ANCHO - 2 * margen
        espacio_carta = min(100, ancho_total / max(1, cantidad_mano))
        inicio_x = margen + (ancho_total - (cantidad_mano * espacio_carta)) / 2

        for i, carta in enumerate(self.mano):
            x = inicio_x + i * espacio_carta
            y = ALTO - 150 if not self.es_ia else 30

            if x + carta.rect.width > ANCHO - margen:
                x = ANCHO - margen - carta.rect.width
            if x < margen:
                x = margen

            carta.posicion_original = (x, y)
            carta.rect.x, carta.rect.y = x, y
            carta.angulo = 0
            carta.rect.width = ANCHO_CARTA
            carta.rect.height = ALTO_CARTA

    def puede_jugar(self, tablero):
        for carta in self.mano:
            for columna in tablero.columnas:
                if tablero.es_movimiento_valido(columna, carta, self.mano):
                    return True
        return False
