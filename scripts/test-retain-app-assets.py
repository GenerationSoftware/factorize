import importlib.util
import pathlib
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("retention", pathlib.Path(__file__).with_name("retain-app-assets.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RetentionTest(unittest.TestCase):
    def test_retains_chunks_but_never_entry_or_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            with zipfile.ZipFile(root / "old.zip", "w") as archive:
                archive.writestr("assets/old-hash.js", "old")
                archive.writestr("index.html", "old index")
                archive.writestr("../escape.js", "bad")
                archive.writestr("assets/../../escape.js", "bad")
                archive.writestr(".env", "bad")
            (root / "dist").mkdir()
            (root / "dist/index.html").write_text("new index")
            self.assertEqual(module.restore(root / "old.zip", root / "dist"), 1)
            self.assertEqual((root / "dist/index.html").read_text(), "new index")
            self.assertFalse((root / "escape.js").exists())
            self.assertEqual(module.restore(root / "old.zip", root / "dist"), 0)
            (root / "dist/assets/old-hash.js").write_text("different")
            with self.assertRaisesRegex(ValueError, "collision"):
                module.restore(root / "old.zip", root / "dist")

if __name__ == "__main__":
    unittest.main()
