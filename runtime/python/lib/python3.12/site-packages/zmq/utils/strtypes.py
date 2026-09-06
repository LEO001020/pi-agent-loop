"""Declare basic string types unambiguously for various Python versions.

Authors
-------
* MinRK
"""

# Copyright (C) PyZMQ Developers
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import warnings

bytes = bytes
unicode = str
basestring = (str,)


def cast_bytes(s: str | bytes, encoding: str = 'utf8', errors: str = 'strict') -> bytes:
    """cast str or bytes to bytes"""
    warnings.warn(
        "zmq.utils.strtypes is deprecated in pyzmq 23.",
        DeprecationWarning,
        stacklevel=2,
    )
    if isinstance(s, bytes):
        return s
    elif isinstance(s, str):
        return s.encode(encoding, errors)
    else:
        raise TypeError(f"Expected unicode or bytes, got {s!r}")


def cast_unicode(s: str | bytes, encoding: str = 'utf8', errors: str = 'strict') -> str:
    """cast bytes or str to str"""
    warnings.warn(
        "zmq.utils.strtypes is deprecated in pyzmq 23.",
        DeprecationWarning,
        stacklevel=2,
    )
    if isinstance(s, bytes):
        return s.decode(encoding, errors)
    elif isinstance(s, str):
        return s
    else:
        raise TypeError(f"Expected unicode or bytes, got {s!r}")


# give short 'b' alias for cast_bytes, so that we can use fake b'stuff'
# to simulate b'stuff'
b = asbytes = cast_bytes
u = cast_unicode

__all__ = [
    'asbytes',
    'bytes',
    'unicode',
    'basestring',
    'b',
    'u',
    'cast_bytes',
    'cast_unicode',
]
