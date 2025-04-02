import pygame
import sys
from pygame.locals import *
from constants import *
from carta import Carta
from mazo import Mazo
from jugador import Jugador
from tablero import Tablero
from network_client import NetworkClient  # Para modo online


class Juego:
    def __init__(self, modo=0):
        self.modo = modo  # 0=Individual, 1=Local, 2=Online
        self.mazo = Mazo()
        self.tablero = Tablero()
        self.juego_terminado = False
        self.resultado = None
        self.carta_arrastrada = None
        self.turno = 0  # Índice del jugador actual

        # Configuración según modo de juego
        if modo == 0:  # Individual vs IA
            self.jugadores = [Jugador("Humano"), Jugador("IA", es_ia=True)]
        elif modo == 1:  # Multijugador local
            self.jugadores = [Jugador("Jugador 1"), Jugador("Jugador 2")]
        elif modo == 2:  # Multijugador online
            self.network = NetworkClient()
            self.jugadores = []  # Se llenará con datos del servidor

        # Inicializar columnas
        inicio_asc = Carta(1, COLOR_CARTA)
        self.tablero.columnas["ascendente_1"].append(inicio_asc)
        self.tablero.columnas["ascendente_2"].append(inicio_asc)

        inicio_desc = Carta(100, COLOR_CARTA)
        self.tablero.columnas["descendente_1"].append(inicio_desc)
        self.tablero.columnas["descendente_2"].append(inicio_desc)

        # Eliminar cartas iniciales del mazo
        self.mazo.cartas = [
            c for c in self.mazo.cartas if c.valor not in [1, 100]]

        # Repartir cartas iniciales (6 por jugador)
        for jugador in self.jugadores:
            for _ in range(6):
                carta = self.mazo.sacar_carta()
                if carta:
                    jugador.mano.append(carta)
            jugador.ordenar_mano()
            if not jugador.es_ia:
                jugador.actualizar_posiciones()

        # Elementos de interfaz
        self.boton_terminar_turno = pygame.Rect(900, 100, 200, 50)
        self.boton_reiniciar = pygame.Rect(
            ANCHO//2 - 100, ALTO//2 + 100, 200, 50)
        self.boton_hover = False
        self.mensaje_error = ""
        self.tiempo_error = 0
        self.mostrando_columna = False
        self.columna_actual = ""

    def manejar_eventos(self):
        pos_raton = pygame.mouse.get_pos()
        self.boton_hover = self.boton_terminar_turno.collidepoint(pos_raton)

        for evento in pygame.event.get():
            if evento.type == QUIT:
                pygame.quit()
                sys.exit()

            if evento.type == MOUSEBUTTONDOWN:
                if self.juego_terminado:
                    if self.boton_reiniciar.collidepoint(evento.pos):
                        self.__init__(modo=self.modo)
                    continue

                if self.boton_terminar_turno.collidepoint(evento.pos):
                    self.terminar_turno()
                else:
                    for carta in reversed(self.jugadores[self.turno].mano):
                        if carta.rect.collidepoint(evento.pos):
                            self.carta_arrastrada = carta
                            carta.arrastrando = True
                            carta.posicion_original = (
                                carta.rect.x, carta.rect.y)
                            carta.rect.width = ANCHO_CARTA_ARRATRE
                            carta.rect.height = ALTO_CARTA_ARRATRE
                            break

            elif evento.type == MOUSEBUTTONUP and self.carta_arrastrada:
                self.soltar_carta(pygame.mouse.get_pos())
                self.carta_arrastrada = None
                self.jugadores[self.turno].actualizar_posiciones()

            elif evento.type == MOUSEMOTION and self.carta_arrastrada:
                self.carta_arrastrada.rect.x = evento.pos[0] - \
                    ANCHO_CARTA_ARRATRE // 2
                self.carta_arrastrada.rect.y = evento.pos[1] - \
                    ALTO_CARTA_ARRATRE // 2

    def soltar_carta(self, pos):
        if not self.carta_arrastrada:
            return

        carta_valida = False
        for columna, zona in self.tablero.zonas_columnas.items():
            if zona.collidepoint(pos):
                if self.tablero.es_movimiento_valido(columna, self.carta_arrastrada, self.jugadores[self.turno].mano):
                    self.carta_arrastrada.color = COLOR_CARTA_JUGADOR
                    self.tablero.columnas[columna].append(
                        self.carta_arrastrada)
                    self.jugadores[self.turno].mano.remove(
                        self.carta_arrastrada)
                    self.jugadores[self.turno].cartas_jugadas_este_turno += 1
                    carta_valida = True
                    break

        if not carta_valida:
            self.carta_arrastrada.rect.x, self.carta_arrastrada.rect.y = self.carta_arrastrada.posicion_original

        self.carta_arrastrada.arrastrando = False
        self.carta_arrastrada.rect.width = ANCHO_CARTA
        self.carta_arrastrada.rect.height = ALTO_CARTA

    def terminar_turno(self):
        # Robar cartas si es posible
        self.jugadores[self.turno].robar_carta(self.mazo)
        self.jugadores[self.turno].cartas_jugadas_este_turno = 0

        # Cambiar turno
        self.turno = (self.turno + 1) % len(self.jugadores)

        # Si es turno de la IA, ejecutar su turno
        if self.jugadores[self.turno].es_ia:
            self.turno_ia()

    def turno_ia(self):
        # Implementación simplificada del turno de la IA
        for carta in self.jugadores[self.turno].mano:
            for columna in self.tablero.columnas:
                if self.tablero.es_movimiento_valido(columna, carta, self.jugadores[self.turno].mano):
                    carta.color = COLOR_CARTA_IA
                    self.tablero.columnas[columna].append(carta)
                    self.jugadores[self.turno].mano.remove(carta)
                    self.jugadores[self.turno].cartas_jugadas_este_turno += 1
                    break

        self.terminar_turno()

    def dibujar(self, ventana):
        ventana.fill(COLOR_FONDO)
        self.tablero.dibujar(ventana)

        # Dibujar información de jugadores
        fuente = pygame.font.SysFont(FUENTE_PEQ, TAM_PEQ)
        y_pos = 50
        for i, jugador in enumerate(self.jugadores):
            color = (0, 255, 0) if i == self.turno else COLOR_TEXTO
            texto = f"{jugador.nombre}: {len(jugador.mano)} cartas"
            texto_surface = fuente.render(texto, True, color)
            ventana.blit(texto_surface, (50, y_pos))
            y_pos += 30

        # Dibujar cartas del jugador actual (si no es IA)
        if not self.jugadores[self.turno].es_ia:
            for carta in self.jugadores[self.turno].mano:
                if carta != self.carta_arrastrada:
                    carta.dibujar(ventana, carta.rect.x, carta.rect.y)

        if self.carta_arrastrada:
            self.carta_arrastrada.dibujar(
                ventana, self.carta_arrastrada.rect.x, self.carta_arrastrada.rect.y)

        # Botón terminar turno (solo si es turno humano)
        if not self.jugadores[self.turno].es_ia:
            color_boton = COLOR_BOTON_HOVER if self.boton_hover else COLOR_BOTON
            pygame.draw.rect(ventana, color_boton,
                             self.boton_terminar_turno, border_radius=5)
            texto_boton = fuente.render("Terminar Turno", True, COLOR_TEXTO)
            texto_rect = texto_boton.get_rect(
                center=self.boton_terminar_turno.center)
            ventana.blit(texto_boton, texto_rect)

        # Pantalla de fin de juego
        if self.juego_terminado:
            overlay = pygame.Surface((ANCHO, ALTO), pygame.SRCALPHA)
            overlay.fill((0, 0, 0, 180))
            ventana.blit(overlay, (0, 0))

            fuente_grande = pygame.font.SysFont(FUENTE_GRANDE, TAM_GRANDE)
            texto_resultado = fuente_grande.render(
                self.resultado, True, (255, 255, 255))
            ventana.blit(texto_resultado, (ANCHO//2 -
                         texto_resultado.get_width()//2, ALTO//2))

            pygame.draw.rect(ventana, COLOR_BOTON,
                             self.boton_reiniciar, border_radius=5)
            texto_reiniciar = fuente.render(
                "Reiniciar Juego", True, COLOR_TEXTO)
            ventana.blit(texto_reiniciar, (self.boton_reiniciar.x +
                         20, self.boton_reiniciar.y + 15))
