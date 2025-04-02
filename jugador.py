from constants import *


class Jugador:
    def __init__(self, nombre, es_ia=False, indice=0):
        self.nombre = nombre
        self.mano = []
        self.es_ia = es_ia
        self.cartas_jugadas_este_turno = 0
        self.cartas_colocadas_este_turno = []
        self.indice = indice
        self.color = self.obtener_color_jugador(indice)

    def obtener_color_jugador(self, indice):
        colores = [
            (51, 140, 250),   # Azul claro (Jugador 1)
            (255, 182, 193),  # Rosa claro (Jugador 2)
            (144, 238, 144),  # Verde claro (Jugador 3)
            (255, 215, 0)     # Amarillo (Jugador 4)
        ]
        return colores[indice % len(colores)]

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
            # Ajuste vertical para multijugador
            y = ALTO - 150 - (self.indice * 50)

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
