"""Exercise source package completeness, reproducibility and stale-file detection."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('package_source', ROOT / 'scripts/package-source.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class SourcePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.version = json.loads((ROOT / 'package.json').read_text())['version']
        for name, content in package.source_entries(ROOT, self.version).items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        self.source = self.root / f'artifacts/exhloj-{self.version}-source.zip'

    def test_complete_reproducible_archive_includes_workflows_and_current_release(self):
        # A local output, obsolete archive or git credential must never leak into the source ZIP.
        for name in ('tests/output/private.txt', 'release/exhloj-0.0.0.zip', '.git/config'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('excluded')
        package.stage(self.root)
        first = self.source.read_bytes()
        package.stage(self.root)
        self.assertEqual(first, self.source.read_bytes())
        package.stage(self.root, True)
        with ZipFile(self.source) as archive:
            names = archive.namelist()
            for name in package.REQUIRED:
                self.assertIn(name, names)
            self.assertIn(f'release/exhloj-{self.version}.zip', names)
            self.assertNotIn('tests/output/private.txt', names)
            self.assertNotIn('release/exhloj-0.0.0.zip', names)
            self.assertNotIn('.git/config', names)

    def test_missing_workflow_is_rejected(self):
        (self.root / '.github/workflows/test.yml').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing required'):
            package.stage(self.root)

    def test_stale_source_and_staged_installation_are_rejected(self):
        package.stage(self.root)
        file = self.root / 'src/exhloj.template.js'
        original = file.read_bytes()
        file.write_bytes(original + b'\n// modified\n')
        with self.assertRaisesRegex(ValueError, 'stale'):
            package.stage(self.root, True)
        file.write_bytes(original)
        (self.root / f'artifacts/exhloj-{self.version}.user.js').write_text('stale')
        with self.assertRaisesRegex(ValueError, 'differs'):
            package.stage(self.root, True)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SourcePackageTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    output = ROOT / 'tests/output'
    output.mkdir(exist_ok=True)
    (output / 'package-results.json').write_text(json.dumps({
        'version': json.loads((ROOT / 'package.json').read_text())['version'],
        'passed': result.testsRun - len(result.failures) - len(result.errors),
        'failures': [str(test) for test, _ in result.failures + result.errors],
    }, indent=2) + '\n')
    raise SystemExit(not result.wasSuccessful())
