"""ARCH-01: index.html must contain no embedded JS logic block after modularization."""
import os, re

HTML_PATH = os.path.join(os.path.dirname(__file__), '..', 'electron', 'index.html')

def test_no_script_logic_block():
    """The <script> block containing wizard logic must be replaced by <script src> tags."""
    content = open(HTML_PATH).read()
    # After extraction, no bare <script> block (without src=) should exist
    # except potentially a single tiny shim. We check: no <script> with JS content.
    # A <script> tag with src= attribute is fine; an opening <script> followed by JS is not.
    bare_script = re.search(r'<script(?!\s+src)[^>]*>\s*\S', content)
    assert bare_script is None, (
        f"Found bare <script> block with inline JS content at "
        f"char {bare_script.start() if bare_script else '?'} — "
        f"all JS must be in external .js files"
    )

def test_script_src_tags_present():
    """External script src tags must be present pointing to js/ directory."""
    content = open(HTML_PATH).read()
    assert 'src="js/state.js"' in content or "src='js/state.js'" in content, \
        "state.js must be loaded via <script src> tag"
    assert 'src="js/modules/index.js"' in content or "src='js/modules/index.js'" in content, \
        "index.js bootstrapper must be loaded via <script src> tag"
