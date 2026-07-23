from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.app import db


class DatabaseConfigurationTests(unittest.TestCase):
    def test_local_mode_has_no_remote_database(self) -> None:
        with (
            patch.object(db, "DATABASE_URL", ""),
            patch.object(db, "SUPABASE_URL", ""),
            patch.object(db, "SUPABASE_SERVICE_ROLE_KEY", ""),
        ):
            self.assertFalse(db.has_database())

    def test_postgres_url_enables_remote_persistence(self) -> None:
        with patch.object(db, "DATABASE_URL", "postgresql://example.invalid/app"):
            self.assertTrue(db.has_database())

    def test_supabase_http_credentials_enable_remote_persistence(self) -> None:
        with (
            patch.object(db, "DATABASE_URL", ""),
            patch.object(db, "SUPABASE_URL", "https://example.supabase.co"),
            patch.object(db, "SUPABASE_SERVICE_ROLE_KEY", "test-placeholder"),
        ):
            self.assertTrue(db.has_database())


if __name__ == "__main__":
    unittest.main()

