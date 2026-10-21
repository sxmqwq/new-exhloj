#!/usr/bin/env python3
"""Build the userscript and package an installation ZIP using Python's standard library."""
import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent.parent
subprocess.run(["node", "scripts/build.cjs"], cwd=root, check=True)
version = json.loads((root / "package.json").read_text())["version"]
script = (root / "dist/exhloj.user.js").read_bytes()
digest = hashlib.sha256(script).hexdigest()
version_text = (
    f"Extend HLOJ\nVersion: {version}\n"
    "Modules: core, ui, captcha, remote-problem, contest-helper, juan-monitor, user\n"
    f"Script SHA-256: {digest}\n"
    "User data and Rating: local only; no special administrator UID\n"
    "Automatic registration: disabled by default\n"
)
output = root / "release" / f"exhloj-{version}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    archive.writestr(f"exhloj-{version}.user.js", script)
    archive.write(root / "docs/INSTALL.zh-CN.txt", "INSTALL.txt")
    archive.writestr("VERSION.txt", version_text)
    archive.write(root / "THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt")
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert archive.read(f"exhloj-{version}.user.js") == script
checksums = [
    f"{digest}  dist/exhloj.user.js",
    f"{hashlib.sha256(output.read_bytes()).hexdigest()}  release/{output.name}",
]
(root / "SHA256SUMS").write_text("\n".join(checksums) + "\n")
(root / "VERSION.txt").write_text(version_text)
print(f"Packaged {output.relative_to(root)}")
