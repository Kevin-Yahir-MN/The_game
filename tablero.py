import pygame
from pygame.locals import *
from constants import *
from carta import Carta


class Tablero:
    def __init__(self):
        self.columnas = {
            "ascendente_1": [],
            "ascendente_2": [],
            "descendente_1": [],
            "descendente_2": []
        }
        self.zonas_columnas = {}
        self.zonas_titulos = {}
        self.espaciado_columnas = ESPACIADO_COLUMNAS
        self.ancho_columna = ANCHO_COLUMNA
        self.alto_columna = ALTO_COLUMNA
        self.pos_y = ALTO // 2 - self.alto_columna // 2
        self.columna_seleccionada = None

    def to_dict(self):
        """Serializa el tablero a diccionario"""
        return {
            'columnas': {
                col: [carta.to_dict() for carta in cartas]
                for col, cartas in self.columnas.items()
            },
            'zonas_columnas': {
                col: {'x': rect.x, 'y': rect.y,
                      'width': rect.width, 'height': rect.height}
                for col, rect in self.zonas_columnas.items()
            },
            'zonas_titulos': {
                col: {'x': rect.x, 'y': rect.y,
                      'width': rect.width, 'height': rect.height}
                for col, rect in self.zonas_titulos.items()
            },
            'columna_seleccionada': self.columna_seleccionada
        }

    @classmethod
    def from_dict(cls, data):
        """Reconstruye el tablero desde un diccionario"""
        tablero = cls()
        tablero.columnas = {
            col: [Carta.from_dict(carta_data) for carta_data in cartas_data]
            for col, cartas_data in data['columnas'].items()
        }

        tablero.zonas_columnas = {
            col: pygame.Rect(rect['x'], rect['y'],
                             rect['width'], rect['height'])
            for col, rect in data['zonas_columnas'].items()
        }

        tablero.zonas_titulos = {
            col: pygame.Rect(rect['x'], rect['y'],
                             rect['width'], rect['height'])
            for col, rect in data['zonas_titulos'].items()
        }

        tablero.columna_seleccionada = data.get('columna_seleccionada')
        return tablero

    def es_movimiento_valido(self, columna, carta, mano_jugador):
        if "ascendente" in columna:
            if not self.columnas[columna]:
                return carta.valor > 1 if columna == "ascendente_1" else True

            ultima = self.columnas[columna][-1].valor

            if carta.valor > ultima:
                return True

            if carta.valor == ultima - 10:
                return any(c.valor == ultima - 10 for c in mano_jugador)

            return False

        else:
            if not self.columnas[columna]:
                return carta.valor < 100 if columna == "descendente_1" else True

            ultima = self.columnas[columna][-1].valor

            if carta.valor < ultima:
                return True

            if carta.valor == ultima + 10:
                return any(c.valor == ultima + 10 for c in mano_jugador)

            return False

    def dibujar(self, ventana):
        ancho_total = (4 * self.ancho_columna) + (3 * self.espaciado_columnas)
        inicio_x = (ANCHO - ancho_total) // 2

        for i, (nombre, cartas) in enumerate(self.columnas.items()):
            x = inicio_x + i * (self.ancho_columna + self.espaciado_columnas)
            y = self.pos_y

            self.zonas_columnas[nombre] = pygame.Rect(
                x, y, self.ancho_columna, self.alto_columna)

            fuente = pygame.font.SysFont(FUENTE_PEQ, TAM_PEQ)
            texto = fuente.render(nombre, True, COLOR_TEXTO)
            titulo_rect = pygame.Rect(
                x + (self.ancho_columna - texto.get_width()) // 2,
                y - 30,
                texto.get_width(),
                texto.get_height()
            )
            self.zonas_titulos[nombre] = titulo_rect

            pygame.draw.rect(ventana, COLOR_COLUMNA,
                             (x, y, self.ancho_columna, self.alto_columna), 0)
            pygame.draw.rect(ventana, (0, 0, 0),
                             (x, y, self.ancho_columna, self.alto_columna), 4)

            color_titulo = (
                200, 200, 0) if nombre == self.columna_seleccionada else COLOR_TEXTO
            texto = fuente.render(nombre, True, color_titulo)
            ventana.blit(texto, (titulo_rect.x, titulo_rect.y))

            if cartas:
                ultima_carta = cartas[-1]
                ultima_carta.rect.width = ANCHO_CARTA
                ultima_carta.rect.height = ALTO_CARTA
                pos_x = x + (self.ancho_columna - ANCHO_CARTA) // 2
                pos_y = y + (self.alto_columna - ALTO_CARTA) // 2
                ultima_carta.dibujar(ventana, pos_x, pos_y)

    def mostrar_cartas_columna(self, ventana, nombre_columna):
        cartas = self.columnas[nombre_columna]
        ancho_ventana = min(800, ANCHO - 100)
        alto_ventana = min(600, ALTO - 100)
        pos_x = ANCHO//2 - ancho_ventana//2
        pos_y = ALTO//2 - alto_ventana//2

        fondo_oscuro = pygame.Surface(
            (ancho_ventana, alto_ventana), pygame.SRCALPHA)
        fondo_oscuro.fill((50, 50, 50, 220))

        cartas_por_fila = max(1, (ancho_ventana - 40) // (ANCHO_CARTA + 20))
        filas_necesarias = (
            len(cartas) + cartas_por_fila - 1) // cartas_por_fila
        alto_contenido = 70 + filas_necesarias * (ALTO_CARTA + 20)
        scroll_height = alto_ventana - 120
        scroll_max = max(0, alto_contenido - alto_ventana + 70)
        necesita_scroll = alto_contenido > alto_ventana - 70
        scroll_pos = 0
        arrastrando_scroll = False

        esperando = True
        reloj = pygame.time.Clock()

        while esperando:
            ventana.blit(fondo_oscuro, (pos_x, pos_y))

            ventana_emergente = pygame.Surface(
                (ancho_ventana, alto_ventana), pygame.SRCALPHA)

            pygame.draw.rect(ventana_emergente, (70, 70, 70, 180),
                             (0, 0, ancho_ventana, alto_ventana), 0)
            pygame.draw.rect(ventana_emergente, (120, 120, 120, 200),
                             (0, 0, ancho_ventana, alto_ventana), 3)

            titulo_bg = pygame.Surface(
                (ancho_ventana - 40, 40), pygame.SRCALPHA)
            titulo_bg.fill((30, 30, 30, 200))
            ventana_emergente.blit(titulo_bg, (20, 15))

            fuente_titulo = pygame.font.SysFont(FUENTE_TITULO, TAM_TITULO)
            titulo = fuente_titulo.render(
                f"Cartas en {nombre_columna} ({len(cartas)})", True, (255, 255, 255))
            ventana_emergente.blit(titulo, (30, 20))

            superficie_contenido = pygame.Surface(
                (ancho_ventana - 30, alto_contenido), pygame.SRCALPHA)

            x, y = 20, 20
            for carta in cartas:
                if x + ANCHO_CARTA > ancho_ventana - 50:
                    x = 20
                    y += ALTO_CARTA + 20

                carta_temp = Carta(carta.valor, carta.color)
                carta_temp.rect.width = ANCHO_CARTA
                carta_temp.rect.height = ALTO_CARTA
                carta_temp.dibujar(superficie_contenido, x, y)
                x += ANCHO_CARTA + 20

            boton_bg = pygame.Surface((100, 30), pygame.SRCALPHA)
            boton_bg.fill((200, 50, 50, 200))
            ventana_emergente.blit(
                boton_bg, (ancho_ventana - 120, alto_ventana - 50))

            fuente_boton = pygame.font.SysFont(FUENTE_PEQ, TAM_PEQ)
            texto_cerrar = fuente_boton.render("Cerrar", True, (255, 255, 255))
            ventana_emergente.blit(
                texto_cerrar, (ancho_ventana - 100, alto_ventana - 45))

            ventana.blit(ventana_emergente, (pos_x, pos_y))

            area_visible = pygame.Rect(
                0, scroll_pos, ancho_ventana - 30, alto_ventana - 70)
            ventana.blit(superficie_contenido,
                         (pos_x + 10, pos_y + 70), area_visible)

            if necesita_scroll:
                scroll_bg = pygame.Surface(
                    (10, scroll_height), pygame.SRCALPHA)
                scroll_bg.fill((100, 100, 100, 150))
                ventana.blit(
                    scroll_bg, (pos_x + ancho_ventana - 20, pos_y + 70))

                tam_barra = max(20, scroll_height *
                                (scroll_height / alto_contenido))
                pos_barra = (scroll_pos / scroll_max) * \
                    (scroll_height - tam_barra)

                scroll_thumb = pygame.Surface((10, tam_barra), pygame.SRCALPHA)
                scroll_thumb.fill((180, 180, 180, 200))
                ventana.blit(scroll_thumb, (pos_x + ancho_ventana -
                             20, pos_y + 70 + int(pos_barra)))

            pygame.display.flip()

            for evento in pygame.event.get():
                if evento.type == QUIT:
                    pygame.quit()
                    sys.exit()

                if evento.type == MOUSEBUTTONDOWN:
                    mouse_pos = pygame.mouse.get_pos()
                    mouse_rel = (mouse_pos[0] - pos_x, mouse_pos[1] - pos_y)

                    if (ancho_ventana - 120 <= mouse_rel[0] <= ancho_ventana - 20 and
                            alto_ventana - 50 <= mouse_rel[1] <= alto_ventana - 20):
                        esperando = False

                    elif (necesita_scroll and
                          ancho_ventana - 20 <= mouse_rel[0] <= ancho_ventana - 10 and
                          70 <= mouse_rel[1] <= 70 + scroll_height):
                        arrastrando_scroll = True
                        click_rel_y = mouse_rel[1] - 70
                        scroll_pos = (click_rel_y / scroll_height) * scroll_max

                elif evento.type == MOUSEBUTTONUP:
                    arrastrando_scroll = False

                elif evento.type == MOUSEMOTION and arrastrando_scroll:
                    mouse_rel = pygame.mouse.get_pos()[1] - pos_y
                    scroll_pos = max(
                        0, min(scroll_max, (mouse_rel - 70) / scroll_height * scroll_max))

                elif evento.type == MOUSEWHEEL and necesita_scroll:
                    scroll_pos = max(
                        0, min(scroll_max, scroll_pos - evento.y * 30))

            reloj.tick(60)

        return True
