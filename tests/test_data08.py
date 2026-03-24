"""
DATA-08 tests: Extraction confidence scoring module (python/validator.py).

Coverage:
  - DATA-04a: validate_fields() returns overallConfidence, fields, flags
  - DATA-04b: field entry structure (name, value, confidence, status, issue, boundingBox)
  - DATA-04c: CONFIDENCE_THRESHOLD == 95 and below-threshold result has flags
  - DATA-01: scope_truncated flag pass-through
  - DATA-02: SAM.gov null guard
  - Format validation for naics_code and psc_code
"""
import sys
import os

# Add python/ to path so we can import validator directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

from validator import validate_fields, CONFIDENCE_THRESHOLD


# ---------------------------------------------------------------------------
# Constant tests
# ---------------------------------------------------------------------------

def test_confidence_threshold_constant():
    """CONFIDENCE_THRESHOLD must equal 95 per DATA-04c / D-17."""
    assert CONFIDENCE_THRESHOLD == 95, (
        f"Expected CONFIDENCE_THRESHOLD == 95, got {CONFIDENCE_THRESHOLD}"
    )


# ---------------------------------------------------------------------------
# Return-structure tests
# ---------------------------------------------------------------------------

def test_validate_returns_confidence():
    """validate_fields() must return dict with overallConfidence, fields, flags."""
    data = {
        "solicitation_number": "W911S225U1431",
        "project_title": "Test",
        "due_date": "01/15/2026",
        "issuing_agency": "Army",
        "naics_code": "336992",
        "scope_of_work": "Test scope",
    }
    result = validate_fields(data, "pdf")
    assert isinstance(result, dict), "validate_fields() must return a dict"
    assert "overallConfidence" in result, "result must have 'overallConfidence' key"
    assert "fields" in result, "result must have 'fields' key"
    assert "flags" in result, "result must have 'flags' key"
    assert isinstance(result["overallConfidence"], int), (
        f"overallConfidence must be int, got {type(result['overallConfidence'])}"
    )
    assert 0 <= result["overallConfidence"] <= 100, (
        f"overallConfidence must be 0-100, got {result['overallConfidence']}"
    )
    assert isinstance(result["fields"], list), "'fields' must be a list"
    assert isinstance(result["flags"], list), "'flags' must be a list"


def test_parse_response_structure():
    """Each field entry must have name, value, confidence, status, issue, boundingBox."""
    data = {
        "solicitation_number": "W911S225U1431",
        "project_title": "Test project",
        "due_date": "01/15/2026",
        "issuing_agency": "Army",
        "naics_code": "336992",
        "scope_of_work": "Test scope text",
    }
    result = validate_fields(data, "pdf")
    assert len(result["fields"]) > 0, "fields list must not be empty"
    for entry in result["fields"]:
        for key in ("name", "value", "confidence", "status", "issue", "boundingBox"):
            assert key in entry, (
                f"Field entry missing key '{key}': {entry}"
            )
        assert entry["status"] in ("ok", "flagged"), (
            f"status must be 'ok' or 'flagged', got {entry['status']!r}"
        )
        assert isinstance(entry["confidence"], int), (
            f"confidence must be int, got {type(entry['confidence'])}"
        )


# ---------------------------------------------------------------------------
# Below-threshold / flags tests
# ---------------------------------------------------------------------------

def test_below_threshold_has_flags():
    """All-empty critical fields must produce overallConfidence < 95 and non-empty flags."""
    data = {
        "solicitation_number": "",
        "project_title": "",
        "due_date": "",
        "issuing_agency": "",
        "naics_code": "",
        "scope_of_work": "",
    }
    result = validate_fields(data, "unknown")
    assert result["overallConfidence"] < 95, (
        f"Expected overallConfidence < 95 when all critical fields empty, "
        f"got {result['overallConfidence']}"
    )
    assert len(result["flags"]) > 0, (
        "Expected non-empty flags when all critical fields empty"
    )


def test_high_confidence_no_flags():
    """All critical + format-valid fields must return overallConfidence >= 90 and no flags."""
    data = {
        "solicitation_number": "W911S225U1431",
        "project_title": "Ballistic Vest Procurement",
        "due_date": "01/15/2026",
        "issuing_agency": "Army Contracting Command",
        "naics_code": "336992",
        "psc_code": "8470",
        "scope_of_work": "Provide ballistic vests per military specifications.",
        "contact_email": "contracting@army.mil",
        "set_aside": "Small Business",
        "place_of_performance": "JBLM, WA",
        "period_of_performance": "12 months",
        "estimated_value": "250000",
        "contact_name": "John Smith",
        "contact_phone": "253-555-0100",
        "posting_date": "2025-12-01",
        "solicitation_type": "RFQ",
    }
    result = validate_fields(data, "pdf")
    assert result["overallConfidence"] >= 90, (
        f"Expected overallConfidence >= 90 with all fields valid, "
        f"got {result['overallConfidence']}"
    )
    assert result["flags"] == [], (
        f"Expected empty flags with all fields valid, got {result['flags']}"
    )


# ---------------------------------------------------------------------------
# Format validation tests
# ---------------------------------------------------------------------------

def test_format_validation_naics():
    """3-digit NAICS code must be flagged with '5-6 digit' in the issue message."""
    data = {"naics_code": "123"}
    result = validate_fields(data, "pdf")
    naics_entry = next(
        (f for f in result["fields"] if f["name"] == "naics_code"), None
    )
    assert naics_entry is not None, "naics_code must appear in fields list"
    assert naics_entry["status"] == "flagged", (
        f"naics_code='123' should be flagged, got status={naics_entry['status']!r}"
    )
    assert naics_entry["issue"] is not None, "issue must not be None for flagged naics_code"
    assert "5-6 digit" in naics_entry["issue"], (
        f"issue must contain '5-6 digit', got: {naics_entry['issue']!r}"
    )


def test_format_validation_psc():
    """2-character PSC code must be flagged with '4-character' in the issue message."""
    data = {"psc_code": "AB"}
    result = validate_fields(data, "pdf")
    psc_entry = next(
        (f for f in result["fields"] if f["name"] == "psc_code"), None
    )
    assert psc_entry is not None, "psc_code must appear in fields list"
    assert psc_entry["status"] == "flagged", (
        f"psc_code='AB' should be flagged, got status={psc_entry['status']!r}"
    )
    assert psc_entry["issue"] is not None, "issue must not be None for flagged psc_code"
    assert "4-character" in psc_entry["issue"], (
        f"issue must contain '4-character', got: {psc_entry['issue']!r}"
    )


# ---------------------------------------------------------------------------
# scope_truncated pass-through tests (DATA-01)
# ---------------------------------------------------------------------------

def test_scope_truncation_flag():
    """scope_truncated=True must not cause an error; scope_of_work field is in the result."""
    data = {
        "scope_of_work": "x",
        "scope_truncated": True,
    }
    result = validate_fields(data, "pdf")
    # validator does not check scope_truncated — extractor sets it
    # but the call must not raise, and scope_of_work must appear in fields
    scope_entry = next(
        (f for f in result["fields"] if f["name"] == "scope_of_work"), None
    )
    assert scope_entry is not None, "scope_of_work must appear in fields list"


def test_scope_full_text():
    """scope_truncated=False must not cause scope_of_work to be flagged for truncation."""
    data = {
        "scope_of_work": "short",
        "scope_truncated": False,
    }
    result = validate_fields(data, "pdf")
    scope_entry = next(
        (f for f in result["fields"] if f["name"] == "scope_of_work"), None
    )
    assert scope_entry is not None, "scope_of_work must appear in fields list"
    # should not be flagged for truncation (validator does not check scope_truncated)
    if scope_entry["status"] == "flagged":
        assert scope_entry["issue"] is not None
        assert "truncat" not in (scope_entry["issue"] or "").lower(), (
            "scope_of_work must not be flagged for truncation by validator"
        )


# ---------------------------------------------------------------------------
# SAM.gov null guard (DATA-02)
# ---------------------------------------------------------------------------

def test_sam_null_guard():
    """Empty solicitation_number from SAM.gov source must be flagged as missing critical field."""
    data = {
        "solicitation_number": "",
        "project_title": None,
    }
    result = validate_fields(data, "sam_gov")
    sol_entry = next(
        (f for f in result["fields"] if f["name"] == "solicitation_number"), None
    )
    assert sol_entry is not None, "solicitation_number must appear in fields list"
    assert sol_entry["status"] == "flagged", (
        f"Empty solicitation_number must be flagged, got {sol_entry['status']!r}"
    )
    assert sol_entry["confidence"] == 0, (
        f"Missing critical field must have confidence=0, got {sol_entry['confidence']}"
    )
