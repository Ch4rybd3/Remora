"""
RQL — Artifact Query Language
==============================
A SIEM-like query language compiled to DuckDB SQL WHERE clauses.

Syntax reference
----------------
  # Equality / comparison
  EventID = "4624"
  ProcessId > 1000
  EventID >= 4600 AND EventID <= 4700

  # String operators (case-insensitive)
  Computer contains "dc"
  CommandLine startswith "powershell"
  FileName endswith ".exe"
  Computer != "WORKSTATION-01"

  # Wildcards (* = any chars, ? = one char)
  Computer = "DC-*"
  User = "adm?n"

  # IN list
  EventID IN ("4624", "4625", "4648", "4768")
  EventID NOT IN ("4634", "4647")

  # BETWEEN range
  EventID BETWEEN 4600 AND 4700

  # Regular expression
  CommandLine REGEX "powershell.*-enc.*"

  # CIDR subnet (for IP columns)
  IpAddress CIDR "10.0.0.0/8"

  # Relative time (requires a datetime column)
  @timestamp LAST 2h       # hours
  @timestamp LAST 7d       # days
  @timestamp LAST 30m      # minutes

  # Full-text search across ALL columns
  ~ "mimikatz"
  ~ "lsass" AND EventID = "10"

  # Boolean logic + grouping
  EventID = "4624" AND NOT Computer = "DC01"
  (EventID = "4624" OR EventID = "4625") AND Channel = "Security"
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass, field
from typing import Any, Optional


# ── Tokens ────────────────────────────────────────────────────────────────────

@dataclass
class Token:
    type:  str
    value: Any
    pos:   int

    def __repr__(self) -> str:
        return f"Token({self.type}, {self.value!r}, @{self.pos})"


_SINGLE: dict[str, str] = {'(': 'LPAREN', ')': 'RPAREN', ',': 'COMMA', '~': 'TILDE', '*': 'STAR'}
_DOUBLE: dict[str, str] = {'!=': 'NEQ', '>=': 'GTE', '<=': 'LTE'}
_KEYWORDS: dict[str, str] = {
    'AND': 'AND', 'OR': 'OR', 'NOT': 'NOT',
    'IN': 'IN', 'BETWEEN': 'BETWEEN',
    'CONTAINS': 'CONTAINS', 'STARTSWITH': 'STARTSWITH', 'ENDSWITH': 'ENDSWITH',
    'REGEX': 'REGEX', 'CIDR': 'CIDR', 'LAST': 'LAST',
    'NULL': 'NULL', 'TRUE': 'BOOL', 'FALSE': 'BOOL',
}
_UNITS = {'h', 'd', 'm', 's', 'hours', 'days', 'minutes', 'seconds'}


class RQLSyntaxError(ValueError):
    def __init__(self, message: str, pos: int = -1):
        super().__init__(message)
        self.pos = pos


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(text)

    while i < n:
        # whitespace
        if text[i].isspace():
            i += 1
            continue

        # two-char operators
        two = text[i:i+2]
        if two in _DOUBLE:
            tokens.append(Token(_DOUBLE[two], two, i)); i += 2; continue

        c = text[i]

        # single-char operators / punctuation
        if c in _SINGLE:
            tokens.append(Token(_SINGLE[c], c, i)); i += 1; continue
        if c == '=':
            tokens.append(Token('EQ', '=', i)); i += 1; continue
        if c == '>':
            tokens.append(Token('GT', '>', i)); i += 1; continue
        if c == '<':
            tokens.append(Token('LT', '<', i)); i += 1; continue

        # quoted strings — double or single quotes, backslash escape
        if c in ('"', "'"):
            quote = c
            j = i + 1
            parts: list[str] = []
            while j < n:
                ch = text[j]
                if ch == '\\' and j + 1 < n:
                    parts.append(text[j + 1]); j += 2; continue
                if ch == quote:
                    break
                parts.append(ch); j += 1
            if j >= n:
                raise RQLSyntaxError(f"Unterminated string at position {i}", i)
            tokens.append(Token('STRING', ''.join(parts), i))
            i = j + 1
            continue

        # numbers (int or float, optional leading minus handled via NEG in expressions)
        if c.isdigit():
            j = i
            while j < n and (text[j].isdigit() or text[j] == '.'):
                j += 1
            raw = text[i:j]
            val: Any = float(raw) if '.' in raw else int(raw)
            tokens.append(Token('NUMBER', val, i)); i = j; continue

        # identifiers, keywords, @timestamp-style names
        if c.isalpha() or c in ('_', '@'):
            j = i
            while j < n and (text[j].isalnum() or text[j] in ('_', '.', '@', '-')):
                j += 1
            word = text[i:j]
            upper = word.upper()
            if upper in _KEYWORDS:
                tt = _KEYWORDS[upper]
                tval: Any = (upper == 'TRUE') if tt == 'BOOL' else word
                tokens.append(Token(tt, tval, i))
            else:
                tokens.append(Token('IDENT', word, i))
            i = j
            continue

        raise RQLSyntaxError(f"Unexpected character '{c}' at position {i}", i)

    tokens.append(Token('EOF', None, n))
    return tokens


# ── AST nodes ─────────────────────────────────────────────────────────────────

@dataclass
class AndNode:
    left:  Any
    right: Any

@dataclass
class OrNode:
    left:  Any
    right: Any

@dataclass
class NotNode:
    operand: Any

@dataclass
class CompareNode:
    """=, !=, >, <, >=, <= (strings or numerics)"""
    col:      str
    op:       str
    value:    Any
    wildcard: bool = False   # value contains * or ?

@dataclass
class ContainsNode:
    """contains / startswith / endswith"""
    col:  str
    op:   str    # 'contains' | 'startswith' | 'endswith'
    value: str

@dataclass
class InNode:
    col:     str
    values:  list
    negated: bool = False

@dataclass
class BetweenNode:
    col:  str
    low:  Any
    high: Any

@dataclass
class RegexNode:
    col:     str
    pattern: str

@dataclass
class CidrNode:
    col:  str
    cidr: str

@dataclass
class LastNode:
    col:    str
    amount: int
    unit:   str    # 'h' | 'd' | 'm' | 's'

@dataclass
class FullTextNode:
    value: str

@dataclass
class WildcardColNode:
    """* CONTAINS/STARTSWITH/ENDSWITH/REGEX "value" — applies op across ALL columns."""
    op:    str   # 'contains' | 'startswith' | 'endswith' | 'regex'
    value: str


# ── Parser ────────────────────────────────────────────────────────────────────

class _Parser:
    def __init__(self, tokens: list[Token]):
        self._t = tokens
        self._i = 0

    # ── helpers ────────────────────────────────────────────────────────────────

    def _peek(self) -> Token:
        return self._t[self._i]

    def _eat(self, expected: str | None = None) -> Token:
        tok = self._t[self._i]
        if expected and tok.type != expected:
            raise RQLSyntaxError(
                f"Expected {expected} but got {tok.type!r} ({tok.value!r})",
                tok.pos,
            )
        self._i += 1
        return tok

    def _match(self, *types: str) -> bool:
        return self._peek().type in types

    # ── grammar ────────────────────────────────────────────────────────────────

    def parse(self) -> Any:
        if self._match('EOF'):
            return None
        expr = self._or()
        self._eat('EOF')
        return expr

    def _or(self) -> Any:
        left = self._and()
        while self._match('OR'):
            self._eat('OR'); right = self._and()
            left = OrNode(left, right)
        return left

    def _and(self) -> Any:
        left = self._not()
        while self._match('AND'):
            self._eat('AND'); right = self._not()
            left = AndNode(left, right)
        return left

    def _not(self) -> Any:
        if self._match('NOT'):
            self._eat('NOT')
            return NotNode(self._atom())
        return self._atom()

    def _atom(self) -> Any:
        tok = self._peek()

        # Parenthesised group
        if tok.type == 'LPAREN':
            self._eat('LPAREN')
            inner = self._or()
            self._eat('RPAREN')
            return inner

        # Full-text: ~ "value"
        if tok.type == 'TILDE':
            self._eat('TILDE')
            val = self._eat('STRING')
            return FullTextNode(val.value)

        # Wildcard column: * CONTAINS / STARTSWITH / ENDSWITH / REGEX "value"
        if tok.type == 'STAR':
            self._eat('STAR')
            next_tok = self._peek()
            if next_tok.type not in ('CONTAINS', 'STARTSWITH', 'ENDSWITH', 'REGEX'):
                raise RQLSyntaxError(
                    "Expected CONTAINS, STARTSWITH, ENDSWITH or REGEX after '*'", next_tok.pos
                )
            op = self._eat(next_tok.type).value.lower()
            val = self._eat('STRING').value
            return WildcardColNode(op, val)

        # Field expression — bare identifier OR quoted column name
        if tok.type in ('IDENT', 'STRING'):
            # Quoted strings used as column names must be followed by an operator,
            # not by another STRING (which would indicate a tilde-less FTS attempt).
            col = self._eat(tok.type).value
            return self._field_expr(col)

        raise RQLSyntaxError(
            f"Unexpected token {tok.type!r} ('{tok.value}')", tok.pos
        )

    def _field_expr(self, col: str) -> Any:
        tok = self._peek()

        # NOT IN
        if tok.type == 'NOT':
            self._eat('NOT')
            self._eat('IN')
            values = self._value_list()
            return InNode(col, values, negated=True)

        # IN (...)
        if tok.type == 'IN':
            self._eat('IN')
            return InNode(col, self._value_list())

        # BETWEEN low AND high
        if tok.type == 'BETWEEN':
            self._eat('BETWEEN')
            low  = self._scalar()
            self._eat('AND')
            high = self._scalar()
            return BetweenNode(col, low, high)

        # CONTAINS / STARTSWITH / ENDSWITH
        if tok.type in ('CONTAINS', 'STARTSWITH', 'ENDSWITH'):
            op = self._eat(tok.type).value.lower()
            val = self._eat('STRING').value
            return ContainsNode(col, op, val)

        # REGEX "pattern"
        if tok.type == 'REGEX':
            self._eat('REGEX')
            return RegexNode(col, self._eat('STRING').value)

        # CIDR "network"
        if tok.type == 'CIDR':
            self._eat('CIDR')
            return CidrNode(col, self._eat('STRING').value)

        # LAST Nh/d/m/s
        if tok.type == 'LAST':
            self._eat('LAST')
            amount = int(self._eat('NUMBER').value)
            unit   = 'd'
            if self._match('IDENT') and self._peek().value.lower() in _UNITS:
                unit = self._eat('IDENT').value.lower()[0]
            return LastNode(col, amount, unit)

        # Comparison operators
        op_map = {'EQ': '=', 'NEQ': '!=', 'GT': '>', 'LT': '<', 'GTE': '>=', 'LTE': '<='}
        if tok.type in op_map:
            op = op_map[self._eat(tok.type).type]
            value = self._scalar()
            wc = isinstance(value, str) and ('*' in value or '?' in value)
            return CompareNode(col, op, value, wildcard=wc)

        raise RQLSyntaxError(
            f"Expected operator after '{col}' but got {tok.type!r} ('{tok.value}')",
            tok.pos,
        )

    def _value_list(self) -> list:
        self._eat('LPAREN')
        items = [self._scalar()]
        while self._match('COMMA'):
            self._eat('COMMA'); items.append(self._scalar())
        self._eat('RPAREN')
        return items

    def _scalar(self) -> Any:
        tok = self._peek()
        if tok.type == 'STRING': return self._eat('STRING').value
        if tok.type == 'NUMBER': return self._eat('NUMBER').value
        if tok.type == 'BOOL':   return self._eat('BOOL').value   # True/False
        if tok.type == 'NULL':   self._eat('NULL'); return None
        raise RQLSyntaxError(
            f"Expected a value but got {tok.type!r} ('{tok.value}')", tok.pos
        )


# ── SQL generator ─────────────────────────────────────────────────────────────

_IDENT_RE = re.compile(r'^[\w\s.\-@]+$')


def _safe_col(col: str, columns: list[str]) -> None:
    """Raise if col is not a valid/known column name."""
    if not _IDENT_RE.match(col):
        raise RQLSyntaxError(f"Invalid column name: '{col}'")
    if columns and col not in columns:
        hint = ', '.join(f'"{c}"' for c in columns[:8])
        raise RQLSyntaxError(f"Unknown column '{col}'. Known columns include: {hint}")


def _cast_varchar(col: str) -> str:
    return f'CAST("{col}" AS VARCHAR)'


def _wildcard_to_like(s: str) -> str:
    """Convert AQL wildcard pattern to SQL LIKE pattern (escape %, _)."""
    return s.replace('%', r'\%').replace('_', r'\_').replace('*', '%').replace('?', '_')


def _ip_to_int_sql(col: str) -> str:
    """DuckDB expression that converts a dotted-decimal IPv4 string to a BIGINT."""
    c = f'CAST("{col}" AS VARCHAR)'
    return (
        f"TRY_CAST(split_part({c}, '.', 1) AS BIGINT) * 16777216 + "
        f"TRY_CAST(split_part({c}, '.', 2) AS BIGINT) * 65536 + "
        f"TRY_CAST(split_part({c}, '.', 3) AS BIGINT) * 256 + "
        f"TRY_CAST(split_part({c}, '.', 4) AS BIGINT)"
    )


def _unit_sql(unit: str) -> str:
    return {'h': 'HOUR', 'd': 'DAY', 'm': 'MINUTE', 's': 'SECOND'}.get(unit, 'DAY')


def _to_sql(node: Any, columns: list[str], params: list) -> str:
    if node is None:
        return '1=1'

    if isinstance(node, AndNode):
        l = _to_sql(node.left,  columns, params)
        r = _to_sql(node.right, columns, params)
        return f"({l} AND {r})"

    if isinstance(node, OrNode):
        l = _to_sql(node.left,  columns, params)
        r = _to_sql(node.right, columns, params)
        return f"({l} OR {r})"

    if isinstance(node, NotNode):
        return f"(NOT {_to_sql(node.operand, columns, params)})"

    if isinstance(node, CompareNode):
        _safe_col(node.col, columns)
        val = node.value

        # NULL checks
        if val is None:
            return (f'"{node.col}" IS NULL'
                    if node.op == '=' else f'"{node.col}" IS NOT NULL')

        # Wildcard → ILIKE / NOT ILIKE
        if node.wildcard and isinstance(val, str):
            pat = _wildcard_to_like(val)
            params.append(pat)
            if node.op in ('=', '!='):
                neg = 'NOT ' if node.op == '!=' else ''
                return f'{_cast_varchar(node.col)} {neg}ILIKE ?'

        # Numeric → cast and compare
        if isinstance(val, (int, float)):
            params.append(val)
            return f'TRY_CAST("{node.col}" AS DOUBLE) {node.op} ?'

        # String equality — case-insensitive
        if node.op == '=':
            params.append(val)
            return f'{_cast_varchar(node.col)} ILIKE ?'
        if node.op == '!=':
            params.append(val)
            return f'{_cast_varchar(node.col)} NOT ILIKE ?'

        # Fallback (>, <, >=, <=) on strings
        params.append(val)
        return f'{_cast_varchar(node.col)} {node.op} ?'

    if isinstance(node, ContainsNode):
        _safe_col(node.col, columns)
        if node.op == 'contains':
            params.append(f'%{node.value}%')
            return f'{_cast_varchar(node.col)} ILIKE ?'
        if node.op == 'startswith':
            params.append(f'{node.value}%')
            return f'{_cast_varchar(node.col)} ILIKE ?'
        if node.op == 'endswith':
            params.append(f'%{node.value}')
            return f'{_cast_varchar(node.col)} ILIKE ?'

    if isinstance(node, InNode):
        _safe_col(node.col, columns)
        placeholders = ', '.join('?' for _ in node.values)
        params.extend(str(v) for v in node.values)
        neg = 'NOT ' if node.negated else ''
        return f'{_cast_varchar(node.col)} {neg}IN ({placeholders})'

    if isinstance(node, BetweenNode):
        _safe_col(node.col, columns)
        if isinstance(node.low, (int, float)):
            params.extend([node.low, node.high])
            return f'TRY_CAST("{node.col}" AS DOUBLE) BETWEEN ? AND ?'
        params.extend([str(node.low), str(node.high)])
        return f'{_cast_varchar(node.col)} BETWEEN ? AND ?'

    if isinstance(node, RegexNode):
        _safe_col(node.col, columns)
        params.append(node.pattern)
        return f'regexp_matches({_cast_varchar(node.col)}, ?)'

    if isinstance(node, CidrNode):
        _safe_col(node.col, columns)
        try:
            net = ipaddress.ip_network(node.cidr, strict=False)
            lo  = int(net.network_address)
            hi  = int(net.broadcast_address)
        except ValueError as exc:
            raise RQLSyntaxError(f"Invalid CIDR: '{node.cidr}'") from exc
        params.extend([lo, hi])
        ip_int = _ip_to_int_sql(node.col)
        return f'({ip_int}) BETWEEN ? AND ?'

    if isinstance(node, LastNode):
        _safe_col(node.col, columns)
        params.append(node.amount)
        unit = _unit_sql(node.unit)
        return (
            f'TRY_CAST("{node.col}" AS TIMESTAMP) '
            f'>= (CURRENT_TIMESTAMP - INTERVAL (?) {unit})'
        )

    if isinstance(node, FullTextNode):
        if not columns:
            return '1=1'
        parts = []
        for col in columns:
            params.append(f'%{node.value}%')
            parts.append(f'CAST("{col}" AS VARCHAR) ILIKE ?')
        return '(' + ' OR '.join(parts) + ')'

    if isinstance(node, WildcardColNode):
        if not columns:
            return '1=1'
        parts = []
        for col in columns:
            cv = _cast_varchar(col)
            if node.op == 'contains':
                params.append(f'%{node.value}%')
                parts.append(f'{cv} ILIKE ?')
            elif node.op == 'startswith':
                params.append(f'{node.value}%')
                parts.append(f'{cv} ILIKE ?')
            elif node.op == 'endswith':
                params.append(f'%{node.value}')
                parts.append(f'{cv} ILIKE ?')
            elif node.op == 'regex':
                params.append(node.value)
                parts.append(f'regexp_matches({cv}, ?)')
        return '(' + ' OR '.join(parts) + ')'

    raise RQLSyntaxError(f"Unknown AST node: {type(node).__name__}")


# ── Public API ────────────────────────────────────────────────────────────────

def parse_rql(query: str, columns: list[str]) -> tuple[str, list]:
    """
    Parse an RQL query string and return ``(sql_where_fragment, params)``.
    The fragment can be embedded directly in a DuckDB WHERE clause.
    Raises ``RQLSyntaxError`` (subclass of ``ValueError``) on invalid input.
    """
    query = query.strip()
    if not query:
        return '', []
    tokens = tokenize(query)
    ast    = _Parser(tokens).parse()
    if ast is None:
        return '', []
    params: list = []
    sql = _to_sql(ast, columns, params)
    return sql, params


def validate_rql(query: str) -> Optional[str]:
    """
    Return an error message string if the query has a syntax error, else ``None``.
    Column validation is skipped (columns=[]).
    """
    try:
        parse_rql(query.strip(), [])
        return None
    except RQLSyntaxError as exc:
        return str(exc)
    except Exception as exc:
        return f"Parse error: {exc}"
