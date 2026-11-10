"""French wording shared by the notes the app shows (#406): a count agreed with its noun.

« 1 module injoignable », « 2 modules injoignables », « 0 mise à jour détectée » — never
« module(s) ». French: the plural starts at 2.
"""

from __future__ import annotations


def nombre(n: int, singulier: str, pluriel: str | None = None) -> str:
    """« 3 modules » / « 1 module » / « 0 module » (`pluriel`: an irregular plural, a phrase)."""
    if n >= 2:
        return f"{n} {pluriel if pluriel is not None else singulier + 's'}"
    return f"{n} {singulier}"
