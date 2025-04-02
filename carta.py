import pygame
from constants import *


class Carta:
    def __init__(self, valor, color=None):
        self.valor = valor
        self.color = color if color else COLOR_CARTA
        self.rect = pygame.Rect(0, 0, ANCHO_CARTA, ALTO_CARTA)
        self.arrastrando = False
        self.posicion_original = (0, 0)
        self.angulo = 0
        self.jugada_este_turno = False
        self.sombra = pygame.Surface(
            (ANCHO_CARTA+5, ALTO_CARTA+5), pygame.SRCALPHA)
        self.sombra.fill((0, 0, 0, 100))

    def to_dict(self):
        """Convierte la carta a un diccionario serializable"""
        return {
            'valor': self.valor,
            'color': self.color,
            'jugada_este_turno': self.jugada_este_turno,
            'rect': {
                'x': self.rect.x,
                'y': self.rect.y,
                'width': self.rect.width,
                'height': self.rect.height
            }
        }

    @classmethod
    def from_dict(cls, data):
        """Crea una carta desde un diccionario"""
        carta = cls(data['valor'], data.get('color'))
        carta.jugada_este_turno = data.get('jugada_este_turno', False)
        carta.rect.x = data['rect']['x']
        carta.rect.y = data['rect']['y']
        carta.rect.width = data['rect']['width']
        carta.rect.height = data['rect']['height']
        return carta

    def dibujar(self, superficie, x, y):
        self.rect.x = x
        self.rect.y = y

        superficie_carta = pygame.Surface(
            (ANCHO_CARTA, ALTO_CARTA), pygame.SRCALPHA)
        pygame.draw.rect(superficie_carta, self.color,
                         (0, 0, ANCHO_CARTA, ALTO_CARTA), border_radius=8)

        if self.jugada_este_turno:
            resaltado = pygame.Surface(
                (ANCHO_CARTA, ALTO_CARTA), pygame.SRCALPHA)
            resaltado.fill(DESTACAR_TURNO)
            superficie_carta.blit(resaltado, (0, 0))

        fuente = pygame.font.SysFont(FUENTE_GRANDE, TAM_GRANDE)
        texto = fuente.render(str(self.valor), True, COLOR_TEXTO)
        rect_texto = texto.get_rect(center=(ANCHO_CARTA//2, ALTO_CARTA//2))
        superficie_carta.blit(texto, rect_texto)

        pygame.draw.rect(superficie_carta, (0, 0, 0, 30),
                         (0, 0, ANCHO_CARTA, ALTO_CARTA), 2, border_radius=8)
        superficie.blit(superficie_carta, (x, y))
