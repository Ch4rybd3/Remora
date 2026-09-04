"""
RQL parser unit tests.

RQL compiles analyst input into a SQL WHERE clause. A silent bug here does not
crash — it returns the wrong rows, which in an investigation is worse than an
error. Hence real assertions rather than smoke tests.
"""
from __future__ import annotations

import pytest

from app.services.rql_parser import RQLSyntaxError, parse_rql, tokenize

COLUMNS = [
    "EventID", "Computer", "CommandLine", "ProcessId",
    "IpAddress", "User", "TimeCreated",
]


def where(query: str) -> tuple[str, list]:
    return parse_rql(query, COLUMNS)


class TestEmptyInput:
    @pytest.mark.parametrize("query", ["", "   ", "\n\t "])
    def test_blank_query_matches_everything(self, query: str) -> None:
        assert where(query) == ("", [])


class TestComparison:
    def test_equality_is_parameterised(self) -> None:
        sql, params = where('EventID = "4624"')
        assert "EventID" in sql
        assert "4624" in params
        assert "4624" not in sql, "value must not be inlined into the SQL"

    def test_numeric_comparison(self) -> None:
        sql, params = where("ProcessId > 1000")
        assert ">" in sql
        assert params == [1000] or "1000" in str(params)

    def test_inequality(self) -> None:
        sql, _ = where('Computer != "WORKSTATION-01"')
        assert sql


class TestStringOperators:
    @pytest.mark.parametrize(
        "query",
        [
            'Computer contains "dc"',
            'CommandLine startswith "powershell"',
            'CommandLine endswith ".exe"',
        ],
    )
    def test_string_operators_compile(self, query: str) -> None:
        sql, params = where(query)
        assert sql and params


class TestSetAndRange:
    def test_in_list(self) -> None:
        sql, params = where('EventID IN ("4624", "4625", "4648")')
        assert len(params) == 3

    def test_not_in_list(self) -> None:
        sql, params = where('EventID NOT IN ("4634", "4647")')
        assert "NOT" in sql.upper()
        assert len(params) == 2

    def test_between(self) -> None:
        sql, params = where("EventID BETWEEN 4600 AND 4700")
        assert len(params) == 2


class TestBooleanLogic:
    def test_and(self) -> None:
        sql, params = where('EventID = "4624" AND Computer contains "dc"')
        assert " AND " in sql.upper()
        assert len(params) == 2

    def test_or(self) -> None:
        sql, _ = where('EventID = "4624" OR EventID = "4625"')
        assert " OR " in sql.upper()

    def test_not(self) -> None:
        sql, _ = where('NOT EventID = "4624"')
        assert "NOT" in sql.upper()

    def test_grouping_changes_the_result(self) -> None:
        grouped, _ = where('(EventID = "1" OR EventID = "2") AND Computer = "dc"')
        flat, _ = where('EventID = "1" OR EventID = "2" AND Computer = "dc"')
        assert grouped != flat, "parentheses must affect precedence"


class TestSpecialOperators:
    def test_full_text_searches_without_a_column(self) -> None:
        sql, params = where('~ "mimikatz"')
        assert sql and params

    def test_cidr(self) -> None:
        sql, _ = where('IpAddress CIDR "10.0.0.0/8"')
        assert sql

    def test_regex(self) -> None:
        sql, _ = where('CommandLine REGEX "powershell.*-enc"')
        assert sql

    def test_wildcard_becomes_a_like(self) -> None:
        sql, params = where('Computer = "DC-*"')
        assert "LIKE" in sql.upper()
        assert any("%" in str(p) for p in params)


class TestRejection:
    """Invalid input must raise, never silently produce a clause that matches
    everything — an analyst who mistypes a query has to be told."""

    @pytest.mark.parametrize(
        "query",
        [
            'EventID = ',
            'EventID "4624"',
            '= "4624"',
            'EventID = "unterminated',
            'EventID IN (',
            'AND EventID = "1"',
            '((EventID = "1")',
        ],
    )
    def test_malformed_queries_raise(self, query: str) -> None:
        with pytest.raises((RQLSyntaxError, ValueError)):
            where(query)

    def test_unknown_column_is_rejected(self) -> None:
        with pytest.raises((RQLSyntaxError, ValueError)):
            where('NoSuchColumn = "x"')


class TestInjectionResistance:
    """Values reach DuckDB as bound parameters. A quote or a semicolon in
    analyst input must never become SQL."""

    @pytest.mark.parametrize(
        "payload",
        [
            "x'; DROP TABLE _src; --",
            "'; DELETE FROM _src; --",
            "1 OR 1=1",
            "%_",
        ],
    )
    def test_values_are_bound_not_inlined(self, payload: str) -> None:
        sql, params = where(f'Computer = "{payload}"')
        assert "DROP" not in sql.upper()
        assert "DELETE" not in sql.upper()
        assert any(payload in str(p) for p in params)

    def test_a_double_quote_inside_a_value_is_a_syntax_error(self) -> None:
        """It closes the string literal, so the remainder is parsed as RQL and
        rejected. Documented here because it is the behaviour that stops a
        quote from ever reaching the SQL builder."""
        with pytest.raises(RQLSyntaxError):
            where('Computer = "x"; DROP TABLE _src; --"')


class TestTokenizer:
    def test_tokenize_returns_tokens(self) -> None:
        assert len(tokenize('EventID = "4624"')) >= 3

    def test_unterminated_string_raises(self) -> None:
        with pytest.raises(RQLSyntaxError):
            tokenize('Computer = "unterminated')
