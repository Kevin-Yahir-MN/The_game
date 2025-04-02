import pygame
from pygame.locals import *
from constants import *


class Menu:
    def __init__(self):
        self.modos_juego = MODOS_JUEGO
        self.fuente_titulo = pygame.font.SysFont(
            FUENTE_TITULO, TAM_TITULO + 10)
        self.fuente_opciones = pygame.font.SysFont(FUENTE_TITULO, TAM_TITULO)
        self.fuente_desc = pygame.font.SysFont(FUENTE_PEQ, TAM_PEQ)
        self.seleccionado = 0
        self.ancho_opcion = 400
        self.alto_opcion = 80
        self.margen = 20

    def manejar_eventos(self):
        for evento in pygame.event.get():
            if evento.type == QUIT:
                return "salir"

            if evento.type == KEYDOWN:
                if evento.key == K_UP:
                    self.seleccionado = (
                        self.seleccionado - 1) % len(self.modos_juego)
                elif evento.key == K_DOWN:
                    self.seleccionado = (
                        self.seleccionado + 1) % len(self.modos_juego)
                elif evento.key == K_RETURN:
                    return self.seleccionado
                elif evento.key == K_ESCAPE:
                    return "salir"

        return None

    def dibujar(self, ventana):
        ventana.fill(COLOR_FONDO)

        # Título del juego
        titulo = self.fuente_titulo.render("THE GAME", True, COLOR_TEXTO)
        ventana.blit(titulo, (ANCHO//2 - titulo.get_width()//2, 100))

        # Opciones de juego
        y_pos = 200
        for i, modo in enumerate(self.modos_juego):
            color = COLOR_BOTON_HOVER if i == self.seleccionado else COLOR_BOTON
            rect = pygame.Rect(
                ANCHO//2 - self.ancho_opcion//2,
                y_pos,
                self.ancho_opcion,
                self.alto_opcion
            )
            pygame.draw.rect(ventana, color, rect, border_radius=10)

            # Texto de la opción
            texto = self.fuente_opciones.render(
                modo["nombre"], True, COLOR_TEXTO)
            ventana.blit(texto, (
                ANCHO//2 - texto.get_width()//2,
                y_pos + 10
            ))

            # Descripción
            desc = self.fuente_desc.render(
                modo["descripcion"], True, COLOR_TEXTO)
            ventana.blit(desc, (
                ANCHO//2 - desc.get_width()//2,
                y_pos + 45
            ))

            y_pos += self.alto_opcion + self.margen

        # Instrucciones
        instrucciones = self.fuente_desc.render(
            "Usa las flechas ↑↓ para navegar y ENTER para seleccionar", True, COLOR_TEXTO)
        ventana.blit(instrucciones, (
            ANCHO//2 - instrucciones.get_width()//2,
            ALTO - 50
        ))
