"""ARCH-03: index.html must contain zero inline event handler attributes."""
import os, re

HTML_PATH = os.path.join(os.path.dirname(__file__), '..', 'electron', 'index.html')
INLINE_HANDLER_PATTERN = re.compile(r'\b(onclick|onchange|oninput|ondrop|ondragover|ondragleave|onkeydown)\s*=', re.IGNORECASE)

def test_zero_inline_event_handlers():
    content = open(HTML_PATH).read()
    matches = INLINE_HANDLER_PATTERN.findall(content)
    assert len(matches) == 0, (
        f"Found {len(matches)} inline event handler attribute(s) in index.html. "
        f"All event wiring must use addEventListener in .js modules. "
        f"Handlers found: {set(matches)}"
    )
