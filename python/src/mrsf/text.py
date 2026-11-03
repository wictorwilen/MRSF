"""String operations for MRSF's UTF-16 column offsets."""

from __future__ import annotations


def utf16_length(text: str) -> int:
    """Count UTF-16 code units, matching JavaScript String.length."""
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def utf16_slice(text: str, start: int = 0, end: int | None = None) -> str:
    """Slice by UTF-16 code units, matching JavaScript String.slice."""
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    stop = end * 2 if end is not None else None
    return encoded[start * 2 : stop].decode("utf-16-le", errors="surrogatepass")
