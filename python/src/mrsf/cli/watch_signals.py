from __future__ import annotations

import signal
from typing import Any, Callable


def register_signal_handlers(shutdown: Callable[..., None]) -> Callable[[], None]:
    previous_sigint = signal.getsignal(signal.SIGINT)
    previous_sigterm = signal.getsignal(signal.SIGTERM)
    cleaned_up = False

    def cleanup_signal_handlers() -> None:
        nonlocal cleaned_up
        if cleaned_up:
            return
        cleaned_up = True
        signal.signal(signal.SIGINT, previous_sigint)
        signal.signal(signal.SIGTERM, previous_sigterm)

    def on_sigint(*args: Any) -> None:
        shutdown(*args)

    def on_sigterm(*args: Any) -> None:
        shutdown(*args)

    signal.signal(signal.SIGINT, on_sigint)
    signal.signal(signal.SIGTERM, on_sigterm)
    return cleanup_signal_handlers