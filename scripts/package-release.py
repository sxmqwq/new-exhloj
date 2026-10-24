#!/usr/bin/env python3
"""Build the userscript and package an installation ZIP using Python's standard library."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parent.parent
if sys.argv[1:] not in ([], ["--check"]):
    raise SystemExit("Usage: package-release.py [--check]")
check_only = bool(sys.argv[1:])
subprocess.run(["node", "scripts/build.cjs", *(["--check"] if check_only else [])], cwd=root, check=True)
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
entries = {
    f"exhloj-{version}.user.js": script,
    "INSTALL.txt": (root / "docs/INSTALL.zh-CN.txt").read_bytes(),
    "VERSION.txt": version_text.encode(),
    "THIRD_PARTY_NOTICES.txt": (root / "THIRD_PARTY_NOTICES.txt").read_bytes(),
}
if not entries["INSTALL.txt"].startswith(f"Extend HLOJ {version}\n".encode()):
    raise SystemExit("INSTALL.zh-CN.txt and package.json versions differ.")
if not check_only:
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in entries.items():
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content, compresslevel=9)
with ZipFile(output) as archive:
    if archive.testzip() is not None or sorted(archive.namelist()) != sorted(entries):
        raise SystemExit("Installation ZIP is corrupt or contains unexpected files; run npm run package.")
    for name, content in entries.items():
        if archive.read(name) != content:
            raise SystemExit(f"Installation ZIP has stale {name}; run npm run package.")
checksums = [
    f"{digest}  dist/exhloj.user.js",
    f"{hashlib.sha256(output.read_bytes()).hexdigest()}  release/{output.name}",
]
checksum_text = "\n".join(checksums) + "\n"
if check_only:
    if (root / "SHA256SUMS").read_text() != checksum_text or (root / "VERSION.txt").read_text() != version_text:
        raise SystemExit("VERSION.txt or SHA256SUMS is stale; run npm run package.")
    print(f"Release files match version {version} and the checked-in script.")
else:
    (root / "SHA256SUMS").write_text(checksum_text)
    (root / "VERSION.txt").write_text(version_text)
    print(f"Packaged {output.relative_to(root)}")
