import pygame
from menu import Menu
from juego import Juego
from constants import *


def main():
    # Inicialización de pygame
    pygame.init()
    pygame.mixer.init()

    # Configuración de la ventana
    ventana = pygame.display.set_mode((ANCHO, ALTO))
    pygame.display.set_caption("The game")

    # Mostrar menú
    menu = Menu()
    modo_seleccionado = None

    reloj = pygame.time.Clock()
    ejecutando = True

    while ejecutando:
        # Manejar menú
        if modo_seleccionado is None:
            resultado = menu.manejar_eventos()
            if resultado == "salir":
                ejecutando = False
            elif isinstance(resultado, int):
                modo_seleccionado = resultado
            menu.dibujar(ventana)

        # Iniciar juego según modo seleccionado
        else:
            juego = Juego(modo=modo_seleccionado)
            while ejecutando:
                juego.manejar_eventos()
                juego.dibujar(ventana)
                pygame.display.flip()
                reloj.tick(60)

                if juego.juego_terminado:
                    modo_seleccionado = None
                    break

        pygame.display.flip()
        reloj.tick(60)

    pygame.quit()


if __name__ == "__main__":
    main()
