import filecmp
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "frameworks" / "_shared"))
import labkit  # noqa: E402


def test_calculate():
    assert labkit.calculate("12*(65-5) + 99") == "819"
    assert labkit.calculate("round(1452/1024, 2)") == "1.42"
    assert labkit.calculate("$2,627.76 - 1539") == "1088.76"
    assert labkit.calculate("__import__('os')").startswith("Error")
    assert labkit.calculate("open('x')").startswith("Error")


def test_every_adapter_has_the_current_labkit():
    for d in (ROOT / "frameworks").iterdir():
        for name in ("labkit.py", "labkit.ts"):
            f = d / name
            if d.name != "_shared" and f.exists():
                assert filecmp.cmp(f, ROOT / "frameworks" / "_shared" / name, shallow=False), f"{f} is stale: run scripts/sync-labkit.sh"
