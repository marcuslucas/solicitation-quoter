#!/usr/bin/env python3
"""
Extraction confidence scoring for SolicitationQuoter.

Pure-function module — no Flask, no IO, no file system access.
Called after extract_data() to score and flag the extracted fields.
"""

import re

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CONFIDENCE_THRESHOLD = 95  # D-17: fields at or above this score pass silently

CRITICAL_FIELDS = [
    "solicitation_number",
    "project_title",
    "due_date",
    "issuing_agency",
    "naics_code",
    "scope_of_work",
]

# All fields that get scored (the 15 step-2 data-field inputs + scope_of_work)
SCORED_FIELDS = [
    "solicitation_number",
    "project_title",
    "solicitation_type",
    "issuing_agency",
    "due_date",
    "posting_date",
    "contact_name",
    "contact_email",
    "contact_phone",
    "naics_code",
    "psc_code",
    "set_aside",
    "place_of_performance",
    "period_of_performance",
    "estimated_value",
    "scope_of_work",
]

# Format rules: field_name -> (regex_pattern, error_message, re_flags)
FORMAT_RULES = {
    "naics_code": (r"^\d{5,6}$", "Expected 5-6 digit NAICS code", 0),
    "psc_code": (r"^[A-Z0-9]{4}$", "Expected 4-character alphanumeric PSC code", re.IGNORECASE),
    "contact_email": (r"^[^@]+@[^@]+\.[^@]+$", "Expected valid email address", 0),
    "due_date": (r"\d{4}|\d{1,2}/\d{1,2}", "Expected a date value", 0),
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_fields(data: dict, source_type: str = "unknown") -> dict:
    """
    Score the extraction quality of a parsed solicitation dict.

    Parameters
    ----------
    data : dict
        Output of extract_data() — a flat dict of field_name -> value.
        May also contain internal keys like _method, scope_truncated, etc.
    source_type : str
        Origin of the data: "pdf", "docx", "txt", "sam_gov", or "unknown".

    Returns
    -------
    dict
        {
            "overallConfidence": int,       # 0–100 weighted average
            "fields": [                     # entry for every SCORED_FIELD
                {
                    "name":        str,
                    "value":       any,
                    "confidence":  int,     # 0–100
                    "status":      "ok" | "flagged",
                    "issue":       str | None,
                    "boundingBox": None,    # wired in Plan 03
                }
            ],
            "flags": [                      # subset of fields with status=="flagged"
                {"type": str, "field": str, "message": str}
            ]
        }
    """
    is_rules_only = data.get("_method") == "rules"
    field_entries = []

    for field_name in SCORED_FIELDS:
        raw_value = data.get(field_name)

        # Normalise: None -> empty string for emptiness checks
        is_empty = raw_value is None or raw_value == "" or raw_value == []

        confidence = 100
        status = "ok"
        issue = None

        if is_empty:
            # Missing field
            if field_name in CRITICAL_FIELDS:
                confidence = 0
                status = "flagged"
                issue = "Required field not found"
            else:
                # Optional field not in document — don't flag, just note as absent
                confidence = 100
                status = "absent"
                issue = None
        else:
            # Field has a value — check format rules
            str_value = str(raw_value)
            if field_name in FORMAT_RULES:
                pattern, message, flags = FORMAT_RULES[field_name]
                # NAICS/PSC values may include description ("339113: Surgical Appliance...")
                # Extract just the code part before the colon for format validation
                check_value = str_value.split(':')[0].strip() if field_name in ('naics_code', 'psc_code') else str_value
                if not re.search(pattern, check_value, flags):
                    confidence = max(10, confidence - 30)
                    status = "flagged"
                    issue = message

        # Rules-only penalty: -10 to all fields with confidence < 90
        if is_rules_only and confidence < 90:
            confidence = max(0, confidence - 10)

        field_entries.append({
            "name": field_name,
            "value": raw_value,
            "confidence": confidence,
            "status": status,
            "issue": issue,
            "boundingBox": None,
        })

    # Weighted overall confidence: critical fields weight=2, others weight=1
    # Absent (optional, not in document) fields are excluded — not a quality signal
    total_weight = 0
    weighted_sum = 0
    for entry in field_entries:
        if entry["status"] == "absent":
            continue
        weight = 2 if entry["name"] in CRITICAL_FIELDS else 1
        weighted_sum += entry["confidence"] * weight
        total_weight += weight

    overall = round(weighted_sum / total_weight) if total_weight > 0 else 0

    # Build flags list from flagged entries only (not absent)
    flags_list = []
    for entry in field_entries:
        if entry["status"] == "flagged":
            # Determine flag type
            if entry["confidence"] == 0 and entry["name"] in CRITICAL_FIELDS:
                flag_type = "missing"
            elif entry["issue"] and entry["issue"] != "Field not extracted":
                flag_type = "format"
            else:
                flag_type = "low_confidence"
            flags_list.append({
                "type": flag_type,
                "field": entry["name"],
                "message": entry["issue"] or "Field requires review",
            })

    return {
        "overallConfidence": overall,
        "fields": field_entries,
        "flags": flags_list,
    }
