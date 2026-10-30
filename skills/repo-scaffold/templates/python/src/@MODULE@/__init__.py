"""@DESCRIPTION@"""


def greet(name: str) -> str:
    """Greet someone; replace this with the real code."""
    trimmed = name.strip()
    return f"Hello, {trimmed or 'world'}!"
