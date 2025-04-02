import random
from carta import Carta


class Mazo:
    def __init__(self):
        self.cartas = [Carta(i) for i in range(1, 101)]  # Cartas del 1 al 100
        # Eliminar las cartas 1 y 100 que se usarán para iniciar las columnas
        self.cartas = [c for c in self.cartas if c.valor not in [1, 100]]
        random.shuffle(self.cartas)

    def sacar_carta(self):
        return self.cartas.pop() if self.cartas else None
