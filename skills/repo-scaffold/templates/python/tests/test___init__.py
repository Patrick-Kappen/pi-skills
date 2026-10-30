from @MODULE@ import greet


def test_greets_by_name() -> None:
    assert greet(" Ada ") == "Hello, Ada!"


def test_greets_the_world_without_a_name() -> None:
    assert greet("  ") == "Hello, world!"
