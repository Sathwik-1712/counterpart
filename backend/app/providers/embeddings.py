"""Local embeddings. No API, no rate limit, deterministic.

HashingEmbedder is the always-available fallback: signed feature hashing of
character n-grams, which works across Latin, Kannada and Devanagari scripts.
A neural multilingual model (e.g. multilingual-e5-small via fastembed) can be
plugged in behind the same EmbeddingProvider interface later.
"""

import hashlib
import unicodedata

import numpy as np


class HashingEmbedder:
    name = "local:hashing-ngrams"

    def __init__(self, dim: int = 512, ngrams: tuple[int, ...] = (2, 3, 4)):
        self.dim = dim
        self.ngrams = ngrams

    def _vector(self, text: str) -> np.ndarray:
        t = " " + " ".join(unicodedata.normalize("NFC", text.lower()).split()) + " "
        v = np.zeros(self.dim, dtype=np.float32)
        for n in self.ngrams:
            for i in range(max(0, len(t) - n + 1)):
                h = int.from_bytes(hashlib.blake2b(t[i : i + n].encode(), digest_size=8).digest(), "little")
                v[h % self.dim] += 1.0 if (h >> 63) & 1 else -1.0
        norm = np.linalg.norm(v)
        return v / norm if norm else v

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t).tolist() for t in texts]


def cosine(a: list[float] | np.ndarray, b: list[float] | np.ndarray) -> float:
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b / denom) if denom else 0.0
