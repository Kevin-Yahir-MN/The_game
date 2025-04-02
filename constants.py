# Configuración de pantalla
ANCHO, ALTO = 1200, 800

# Colores
COLOR_FONDO = (34, 139, 34)  # Verde
COLOR_CARTA = (255, 255, 255)  # Blanco
COLOR_CARTA_JUGADOR = (51, 140, 250)  # Azul claro
COLOR_CARTA_IA = (255, 182, 193)  # Rosa claro
COLOR_TEXTO = (0, 0, 0)
COLOR_BOTON = (70, 130, 180)
COLOR_BOTON_HOVER = (100, 150, 200)
COLOR_ERROR = (255, 0, 0)
COLOR_JUGABLE = (0, 200, 0)
COLOR_COLUMNA = (200, 200, 200, 50)
DESTACAR_TURNO = (255, 255, 0, 50)

# Tamaños de cartas
ANCHO_CARTA = 80
ALTO_CARTA = 120
ANCHO_CARTA_ARRATRE = 100
ALTO_CARTA_ARRATRE = 150
ESPACIADO_CARTAS = 25
MARGEN_COLUMNA = 10

# Tamaños de columnas
ANCHO_COLUMNA = ANCHO_CARTA * 2
ALTO_COLUMNA = ALTO_CARTA * 2
ESPACIADO_COLUMNAS = 80

# Fuentes
FUENTE_PEQ = "Arial"
TAM_PEQ = 20
FUENTE_GRANDE = "Arial"
TAM_GRANDE = 30
FUENTE_TITULO = "Arial"
TAM_TITULO = 24

# Estados del juego
MOSTRANDO_COLUMNA = False
COLUMNA_ACTUAL = ""

# Modos de juego
MODOS_JUEGO = [
    {"nombre": "Individual vs IA", "descripcion": "Juega contra la computadora"},
    {"nombre": "Multijugador Local",
        "descripcion": "Juega con amigos en la misma computadora"},
    {"nombre": "Multijugador Online", "descripcion": "Juega con amigos en línea"}
]
