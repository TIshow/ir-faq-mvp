#!/usr/bin/env python3
"""
Database initialization script for IR FAQ System
Cloud SQL PostgreSQL schema setup using gcloud beta sql connect
"""

import os
import subprocess
from pathlib import Path

# DB認証情報は環境変数（本番ではSecret Managerから注入）で受け取る。
# 平文でコミットしないこと。
DB_INSTANCE = os.environ.get("DB_INSTANCE", "ir-faq-db")
DB_USER = os.environ.get("DB_USER", "ir_app_user")
DB_NAME = os.environ.get("DB_NAME", "ir_faq")

def execute_schema():
    """Execute the schema.sql file using gcloud beta sql connect"""
    try:
        db_pass = os.environ.get("DB_PASSWORD")
        if not db_pass:
            print("❌ 環境変数 DB_PASSWORD が未設定です。Secret Manager等から注入してください。")
            print("   例: DB_PASSWORD=$(gcloud secrets versions access latest --secret=ir-faq-db-password) python database/init-db.py")
            return False

        schema_file = str(Path(__file__).with_name("schema.sql"))

        print("🚀 Deploying schema using gcloud beta sql connect...")

        # Build the command
        cmd = [
            'gcloud', 'beta', 'sql', 'connect', DB_INSTANCE,
            f'--user={DB_USER}',
            f'--database={DB_NAME}'
        ]

        # Read schema file
        with open(schema_file, 'r', encoding='utf-8') as f:
            schema_sql = f.read()

        print("📊 Executing schema.sql...")

        # Execute with stdin and provide password
        result = subprocess.run(
            cmd,
            input=f"{db_pass}\n{schema_sql}",
            text=True,
            capture_output=True
        )
        
        if result.returncode == 0:
            print("✅ Database schema deployed successfully!")
            if result.stdout:
                print("📋 Output:")
                print(result.stdout)
            return True
        else:
            print(f"❌ Error deploying schema:")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Initializing IR FAQ Database Schema...")
    success = execute_schema()
    if success:
        print("🎉 Database initialization completed!")
    else:
        print("💥 Database initialization failed!")