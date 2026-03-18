#!/usr/bin/env python3
"""Shared constants for the SolicitationQuoter backend."""

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

PORT = 5199

ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.doc', '.txt'}

TMP_PREFIX = 'sqt_'
