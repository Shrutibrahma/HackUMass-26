from server import guards


def test_invented_time_is_dropped():
    why = guards.check_suggestion("Yes, see you at 9.", user_input="yes", context=["Can you come at 8?"])
    assert why and "9" in why


def test_time_from_caller_is_allowed():
    assert guards.check_suggestion("Yes, 8 works for me.", user_input="yes", context=["Can you come at 8?"]) is None


def test_number_word_matches_digit():
    assert guards.check_suggestion("Yes, eight works.", user_input="yes", context=["Is 8 okay?"]) is None


def test_invented_day_is_dropped():
    assert guards.check_suggestion("Sure, Friday is fine.", user_input="sure", context=["When can you come?"])


def test_no_must_stay_no():
    assert guards.check_suggestion("Yes, that works.", user_input="no", context=["Does 5 work?"])
    assert guards.check_suggestion("No, that doesn't work for me.", user_input="no", context=["Does 5 work?"]) is None


def test_money_needs_confirmation():
    assert guards.needs_confirmation("Yes, charge my card.")
    assert guards.needs_confirmation("That's $23.40, okay.")
    assert guards.needs_confirmation("Please book it.")
    assert not guards.needs_confirmation("Could you repeat that, please?")


