"""ARCH-02: shared utility modules must exist and export expected function names."""
import os, re

UTILS_PATH = os.path.join(os.path.dirname(__file__), '..', 'electron', 'js', 'modules', 'shared', 'utils.js')
THEME_PATH = os.path.join(os.path.dirname(__file__), '..', 'electron', 'js', 'modules', 'shared', 'theme.js')
STATE_PATH = os.path.join(os.path.dirname(__file__), '..', 'electron', 'js', 'state.js')

REQUIRED_UTILS = ['esc', 'fmt', 'lineTotal', 'grandTotal', 'updTotals',
                  'nextQuoteNum', 'bumpQuoteSeq', 'toast', 'pushUndo',
                  'doUndo', 'doRedo', 'goTo', 'next', 'render']
REQUIRED_THEME = ['applyTheme', 'openThemes', 'closeThemes', 'initTheme']

def test_state_file_exists():
    assert os.path.exists(STATE_PATH), f"state.js not found at {STATE_PATH}"

def test_state_sets_window_S():
    content = open(STATE_PATH).read()
    assert 'window.S' in content, "state.js must assign window.S = {...}"

def test_utils_file_exists():
    assert os.path.exists(UTILS_PATH), f"utils.js not found at {UTILS_PATH}"

def test_utils_contains_required_functions():
    content = open(UTILS_PATH).read()
    for fn in REQUIRED_UTILS:
        assert f'function {fn}' in content or f'{fn} =' in content, \
            f"utils.js missing function: {fn}"

def test_theme_file_exists():
    assert os.path.exists(THEME_PATH), f"theme.js not found at {THEME_PATH}"

def test_theme_contains_required_functions():
    content = open(THEME_PATH).read()
    for fn in REQUIRED_THEME:
        assert f'function {fn}' in content or f'{fn} =' in content, \
            f"theme.js missing function: {fn}"
