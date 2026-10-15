import chess

from rooms import Room


def test_first_player_gets_requested_colour_and_second_gets_the_other():
    room = Room(id="r1")
    _, a = room.join(None, "b")
    _, b = room.join(None, "b")  # Black is taken, so this player gets White
    assert a == "b" and b == "w"


def test_full_room_gives_spectators_no_seat():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    _, seat = room.join(None, "random")
    assert seat is None


def test_returning_token_gets_the_same_seat():
    room = Room(id="r1")
    token, seat = room.join(None, "w")
    again, seat2 = room.join(token, "b")  # preference ignored for a returning player
    assert again == token and seat2 == seat == "w"


def test_game_waits_until_both_seats_are_filled():
    room = Room(id="r1")
    room.join(None, "w")
    assert room.status == "waiting"
    assert room.apply_move("w", "e2e4") == "The game is not in progress yet."
    room.join(None, "b")
    assert room.status == "playing"


def test_legal_move_is_applied_and_turn_enforced():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    assert room.apply_move("b", "e7e5") == "It is not your turn."
    assert room.apply_move("w", "e2e4") is None
    assert room.apply_move("b", "e7e5") is None
    assert room.moves == ["e2e4", "e7e5"]


def test_illegal_move_is_rejected_and_board_unchanged():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    before = room.board.fen()
    assert room.apply_move("w", "e2e5") == "Illegal move."
    assert room.board.fen() == before


def test_bad_uci_format_is_rejected():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    assert room.apply_move("w", "zz") == "That is not a valid move format."


def test_checkmate_reports_winner():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    # Fool's mate
    for uci in ["f2f3", "e7e5", "g2g4", "d8h4"]:
        seat = "w" if room.board.turn == chess.WHITE else "b"
        assert room.apply_move(seat, uci) is None
    assert room.status == "over"
    assert room.result() == {"reason": "checkmate", "winner": "b"}


def test_resign_ends_game_for_opponent():
    room = Room(id="r1")
    room.join(None, "w")
    room.join(None, "b")
    assert room.resign("w") is None
    assert room.result() == {"reason": "resign", "winner": "b"}
