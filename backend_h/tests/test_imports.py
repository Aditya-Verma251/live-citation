import unittest


class IntegratedPackageImportTests(unittest.TestCase):
    def test_analyzer_pipeline_imports(self):
        from analyzer.pipeline import run_pipeline
        self.assertTrue(callable(run_pipeline))

    def test_discovery_class_imports(self):
        from discovery.discovery import PaperDiscovery
        self.assertTrue(callable(PaperDiscovery))

    def test_coordinator_imports(self):
        from app import run_research_pipeline
        self.assertTrue(callable(run_research_pipeline))


if __name__ == "__main__":
    unittest.main()
