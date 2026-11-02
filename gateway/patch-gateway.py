#!/usr/bin/env python3
"""Apply the Vietnamese gateway patch to the ViberVN Bot payload. Usage: patch-gateway.py [payload-dir]
Always rebuilds touched files from <file>.orig (created on first run), so it is idempotent and re-runnable after an update
(an update overwrites the files; an unmarked file is taken as the new pristine copy).
Also writes gateway/vi.patch (unified diff pristine -> patched) when run with --diff."""
import difflib, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
ROOT = args[0] if args else "/Applications/ViberVN Bot.app/Contents/Resources/agent-payload/vibervnbot-agent"
S = json.load(open(f"{HERE}/strings-vi.json", encoding="utf-8"))
J = lambda s: json.dumps(s, ensure_ascii=False)

def sub(src, old, new):
    assert src.count(old) == 1, f"anchor not found exactly once: {old[:60]!r}"
    return src.replace(old, new)

def text(src):
    src = sub(src, '    "zh-hant": "你好，我是 ViberVN Bot。我們先幫你把一切設定好，然後一起做點很酷的事。",\n}',
              f'    "zh-hant": "你好，我是 ViberVN Bot。我們先幫你把一切設定好，然後一起做點很酷的事。",\n    "vi": {J(S["greeting"])},\n}}')
    # every beat's card question; other languages still fall back to English for all but the name card
    src = sub(src, '    if beat == "name":\n', '    if ui_language(locale) == "vi":\n        return _QUESTIONS_VI[beat]\n    if beat == "name":\n')
    qs = "".join(f'    "{b}": {J(S["question." + b])},\n' for b in ("name", "theme", "layout", "connectors", "plugins", "tour", "build"))
    return sub(src, '\n_SET_THEME = ', f'\n_QUESTIONS_VI = {{\n{qs}}}\n\n_SET_THEME = ')

def flow(src):
    labels = "".join(f'    {J(k[6:])}: {J(v)},\n' for k, v in S.items() if k.startswith("label."))
    src = sub(src, '\n\n@dataclass(frozen=True)\nclass Facts:',
              f'\n# Fixed card labels in the desktop language (display.language / facts.locale); the model words its own.\n_LABELS_VI = {{\n{labels}}}\n\n\n'
              'def _localized(options, facts):\n'
              '    vi = (facts.locale or "").lower().replace("_", "-").split("-")[0] == "vi"\n'
              '    return [{**o, "label": _LABELS_VI.get(o["label"], o["label"])} for o in options] if vi else list(options)\n\n\n'
              '@dataclass(frozen=True)\nclass Facts:')
    src = sub(src, '{"options": list(LAYOUT_OPTIONS)}', '{"options": _localized(LAYOUT_OPTIONS, facts)}')
    src = sub(src, '{"options": list(TOUR_OPTIONS)}', '{"options": _localized(TOUR_OPTIONS, facts)}')
    return sub(src, '{"options": card_options(picks.get("build_options"))}', '{"options": _localized(card_options(picks.get("build_options")), facts)}')

def facts(src):
    # the desktop may report "en" for a language it does not know; display.language is the user's explicit choice
    src = sub(src, '    from tools.tour_tool import check_tours_enabled\n', '    from agent.i18n import get_language\n    from tools.tour_tool import check_tours_enabled\n')
    return sub(src, 'locale=locale or host["locale"],', 'locale=("vi" if get_language() == "vi" else None) or locale or host["locale"],')

FILES = {"agent/onboarding_facts.py": facts, "agent/onboarding_text.py": text, "agent/onboarding_flow.py": flow}
diff = []
for rel, fn in FILES.items():
    path = f"{ROOT}/{rel}"
    # a file without our marker is pristine (first run or fresh from an app update): it becomes the new .orig
    if "_VI = {" not in (cur := open(path, encoding="utf-8").read()) and "get_language" not in cur or not os.path.exists(path + ".orig"): shutil.copy(path, path + ".orig")
    orig = open(path + ".orig", encoding="utf-8").read()
    new = fn(orig)
    open(path, "w", encoding="utf-8").write(new)
    pyc = f"{ROOT}/{os.path.dirname(rel)}/__pycache__"
    if os.path.isdir(pyc):
        for f in os.listdir(pyc):
            if f.startswith(os.path.basename(rel)[:-3] + "."): os.remove(f"{pyc}/{f}")
    diff += difflib.unified_diff(orig.splitlines(True), new.splitlines(True), f"a/{rel}", f"b/{rel}")
    os.makedirs(f"{HERE}/pristine/{os.path.dirname(rel)}", exist_ok=True)
    shutil.copy(path + ".orig", f"{HERE}/pristine/{rel}")
if "--diff" in sys.argv: open(f"{HERE}/vi.patch", "w", encoding="utf-8").write("".join(diff))
print("patched", ", ".join(FILES))
