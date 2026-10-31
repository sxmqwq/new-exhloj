#!/usr/bin/env python3
"""Stage current installation files and a complete, deterministic source ZIP."""
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT_FILES = (
    '.gitattributes', '.gitignore', '.node-version', 'README.md', 'CHANGELOG.md',
    'NOTICE.md', 'THIRD_PARTY_NOTICES.txt', 'package.json', 'package-lock.json',
    'VERSION.txt', 'SHA256SUMS',
)
SOURCE_DIRS = ('.github', 'src', 'vendor', 'scripts', 'docs', 'tests')
REQUIRED = (
    '.github/workflows/test.yml', '.github/workflows/release.yml',
    'src/exhloj.template.js', 'vendor/markdown-renderer.js', 'vendor/pinyin.js',
    'scripts/build.cjs', 'scripts/package-release.py', 'scripts/package-source.py',
    'tests/browser.cjs', 'tests/session.cjs', 'tests/package_test.py',
    'docs/INSTALL.zh-CN.txt', 'dist/exhloj.user.js',
)


def source_entries(root, version):
    entries = {}
    for name in ROOT_FILES:
        entries[name] = (root / name).read_bytes()
    for directory in SOURCE_DIRS:
        for file in sorted((root / directory).rglob('*')):
            relative = file.relative_to(root)
            if 'output' in relative.parts or '__pycache__' in relative.parts or file.suffix == '.pyc':
                continue
            if file.is_symlink():
                raise ValueError(f'Source packages must not follow symlinks: {relative}')
            if file.is_file():
                entries[relative.as_posix()] = file.read_bytes()
    for name in (*REQUIRED, f'release/exhloj-{version}.zip'):
        if not (root / name).is_file():
            raise ValueError(f'Missing required source file: {name}')
        entries[name] = (root / name).read_bytes()
    return dict(sorted(entries.items()))


def write_zip(output, entries):
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in entries.items():
            info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content, compresslevel=9)


def check_zip(output, entries):
    with ZipFile(output) as archive:
        if archive.testzip() is not None or sorted(archive.namelist()) != sorted(entries):
            raise ValueError('Source ZIP is corrupt, incomplete or contains unexpected files')
        for name, content in entries.items():
            if archive.read(name) != content:
                raise ValueError(f'Source ZIP contains stale {name}')


def stage(root, check_only=False):
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    output = root / 'artifacts'
    source = output / f'exhloj-{version}-source.zip'
    entries = source_entries(root, version)
    install_files = {
        f'exhloj-{version}-install.zip': (root / f'release/exhloj-{version}.zip').read_bytes(),
        f'exhloj-{version}.user.js': (root / 'dist/exhloj.user.js').read_bytes(),
        'VERSION.txt': (root / 'VERSION.txt').read_bytes(),
    }
    if not check_only:
        output.mkdir(exist_ok=True)
        write_zip(source, entries)
        for name, content in install_files.items():
            (output / name).write_bytes(content)
    check_zip(source, entries)
    for name, content in install_files.items():
        if (output / name).read_bytes() != content:
            raise ValueError(f'Staged installation file differs: {name}')
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n'
                   for name, content in sorted({**install_files, source.name: source.read_bytes()}.items()))
    if check_only:
        if (output / 'SHA256SUMS').read_text(encoding='utf-8') != sums:
            raise ValueError('Staged SHA256SUMS is stale')
    else:
        (output / 'SHA256SUMS').write_text(sums, encoding='utf-8', newline='\n')
    print(f'{"Checked" if check_only else "Staged"} installation and source packages for {version}')


if __name__ == '__main__':
    if sys.argv[1:] not in ([], ['--check']):
        raise SystemExit('Usage: package-source.py [--check]')
    stage(Path(__file__).resolve().parent.parent, bool(sys.argv[1:]))
