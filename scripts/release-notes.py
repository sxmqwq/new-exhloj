#!/usr/bin/env python3
"""Create user-facing release notes from the current changelog entry."""
import argparse
import json
import re
from pathlib import Path


def release_notes(root, repository):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Invalid repository name')
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    changelog = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
    entry = re.search(r'^## ' + re.escape(version) + r'\s*\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
    if not entry or not entry.group(1).strip():
        raise ValueError(f'Missing changelog entry for {version}')
    base = f'https://github.com/{repository}'
    return (
        f'### 安装与更新\n\n'
        f'1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。\n'
        f'2. 点击 [安装脚本]({base}/releases/download/v{version}/exhloj.user.js)，按提示安装或更新。\n'
        f'3. 刷新 OJ，在用户名菜单中点击 **Extend HLOJ**。\n\n'
        f'也可以下载下方的 **exhloj-{version}-install.zip**，解压后安装其中的 `.user.js` 文件。更新现有脚本会沿用本地设置和资料。\n\n'
        f'### 本次更新\n\n{entry.group(1).strip()}\n\n'
        f'完整操作说明见 [项目首页]({base}#readme)。\n'
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repository', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(release_notes(Path(__file__).resolve().parent.parent, args.repository), encoding='utf-8')
