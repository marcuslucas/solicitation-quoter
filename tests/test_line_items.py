"""
Phase 3 acceptance tests: extract_sow_line_items, extract_pricing_spreadsheet,
merge_line_item_sources.

Fixture: testdata/test_solicitations/70B06C26Q00000080/
"""
import json
import os
import pytest

FIXTURE_DIR = os.path.join(
    os.path.dirname(__file__), "..",
    "testdata", "test_solicitations", "70B06C26Q00000080"
)
SOW_PATH  = os.path.join(FIXTURE_DIR, "70B06C26Q00000080+Attachment+1+-+LLSM+SOW.pdf")
XLSX_PATH = os.path.join(FIXTURE_DIR, "70B06C26Q00000080+Attachment+2-Pricing+Sheeet.xlsx")
EXPECTED_PATH = os.path.join(FIXTURE_DIR, "70B06C26Q00000080_expected_line_items.json")

pytestmark = pytest.mark.skipif(
    not os.path.exists(SOW_PATH),
    reason="DHS LLSM fixture not present"
)


@pytest.fixture(scope="module")
def sow_text():
    import pdfplumber
    with pdfplumber.open(SOW_PATH) as pdf:
        return "\n\n".join(p.extract_text() or "" for p in pdf.pages)


@pytest.fixture(scope="module")
def expected():
    with open(EXPECTED_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def sow_items(sow_text):
    import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
    from extractor import extract_sow_line_items
    return extract_sow_line_items(sow_text)


@pytest.fixture(scope="module")
def pricing_items():
    import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
    from extractor import extract_pricing_spreadsheet
    return extract_pricing_spreadsheet(XLSX_PATH)


@pytest.fixture(scope="module")
def merged(sow_items, pricing_items):
    import sys; sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
    from extractor import merge_line_item_sources
    return merge_line_item_sources(sow_items, pricing_items)


# ── extract_pricing_spreadsheet ───────────────────────────────────────────────

class TestPricingSpreadsheet:
    def test_item_count(self, pricing_items):
        assert len(pricing_items) == 118

    def test_first_item(self, pricing_items):
        first = pricing_items[0]
        assert first["sow_section"] == "4.1.1"
        assert first["qty_period_1"] == 1140
        assert first["qty"] == 1140

    def test_all_sections_three_part(self, pricing_items):
        import re
        for item in pricing_items:
            assert re.match(r"^\d+\.\d+\.\d+$", item["sow_section"]), \
                f"Bad section: {item['sow_section']}"

    def test_quantities_by_period_present(self, pricing_items):
        for item in pricing_items:
            assert "quantities_by_period" in item
            assert "period_1" in item["quantities_by_period"]


# ── extract_sow_line_items ────────────────────────────────────────────────────

class TestSowLineItems:
    def test_item_count(self, sow_items):
        # SOW may miss 1-2 anomalous sections; XLSX provides full 118
        assert len(sow_items) >= 110

    def test_known_defense_technologies_item(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        item = by_sec["4.1.1"]
        assert item["description"] == "Smoke Canister for Training (Reduced Toxicity)"
        assert item["manufacturer_ref"] == "Defense Technologies"
        assert item["part_number"] == "1063"
        assert item["unit"] == "EA"

    def test_avon_model_item(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        item = by_sec["4.10.1"]
        assert item["manufacturer_ref"] == "Avon"
        assert item["part_number"] == "PC50"
        assert "PC50" in item["description"]

    def test_avon_part_number_item(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        item = by_sec["4.10.4"]
        assert item["part_number"] == "70501-156"   # # prefix stripped

    def test_avon_slash_part_number(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        item = by_sec["4.10.6"]
        assert item["part_number"] == "72606/3"

    def test_kit_unit(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        assert by_sec["4.8.1"]["unit"] == "KT"
        assert by_sec["4.8.2"]["unit"] == "KT"

    def test_liquid_smoke_disambiguation(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        assert by_sec["4.9.2"]["description"] == "Liquid Smoke Solution (1 Quart)"
        assert by_sec["4.9.2"]["unit"] == "QT"
        assert by_sec["4.9.3"]["description"] == "Liquid Smoke Solution (1 Gallon)"
        assert by_sec["4.9.3"]["unit"] == "GA"

    def test_null_refs_for_kit_sections(self, sow_items):
        by_sec = {i["sow_section"]: i for i in sow_items}
        assert by_sec["4.8.1"]["manufacturer_ref"] is None
        assert by_sec["4.8.1"]["part_number"] is None

    def test_sorted_by_section(self, sow_items):
        sections = [i["sow_section"] for i in sow_items]
        def key(s):
            return tuple(int(p) for p in s.split(".") if p.isdigit())
        assert sections == sorted(sections, key=key)


# ── merge_line_item_sources (full acceptance) ─────────────────────────────────

class TestMerge:
    def test_item_count(self, merged, expected):
        assert len(merged) == len(expected) == 118

    def test_no_missing_sections(self, merged, expected):
        exp_sections = {e["sow_section"] for e in expected}
        got_sections = {m["sow_section"] for m in merged}
        assert exp_sections - got_sections == set()

    def test_description_accuracy(self, merged, expected):
        merged_by = {m["sow_section"]: m for m in merged}
        matches = sum(
            1 for e in expected
            if merged_by.get(e["sow_section"], {}).get("description") == e["description"]
        )
        assert matches >= 110, f"Only {matches}/118 description matches"

    def test_part_number_accuracy(self, merged, expected):
        merged_by = {m["sow_section"]: m for m in merged}
        pn_matches = sum(
            1 for e in expected
            if e.get("part_number") and
            merged_by.get(e["sow_section"], {}).get("part_number") == e["part_number"]
        )
        pn_total = sum(1 for e in expected if e.get("part_number"))
        assert pn_matches >= 100, f"Only {pn_matches}/{pn_total} part number matches"

    def test_qty_period_1_for_first_item(self, merged, expected):
        merged_by = {m["sow_section"]: m for m in merged}
        assert merged_by["4.1.1"]["qty_period_1"] == 1140
        # qty is now qty_total (sum of all periods); qty_period_1 still holds raw P1 value
        assert merged_by["4.1.1"]["qty"] == merged_by["4.1.1"]["qty_total"]

    def test_sow_description_overrides_xlsx(self, merged):
        # 4.7.5 XLSX has truncated "(Inert Powder" — SOW provides full title
        merged_by = {m["sow_section"]: m for m in merged}
        assert merged_by["4.7.5"]["description"] == "40mm Ferret Round (Inert Powder)"

    def test_sorted_output(self, merged):
        sections = [m["sow_section"] for m in merged]
        def key(s):
            return tuple(int(p) for p in s.split(".") if p.isdigit())
        assert sections == sorted(sections, key=key)
