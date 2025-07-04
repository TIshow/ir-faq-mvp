#!/usr/bin/env python3
"""
Database initialization script for IR FAQ System
Cloud SQL PostgreSQL schema setup using gcloud beta sql connect
"""

import os
import subprocess

def execute_schema():
    """Execute the schema.sql file using gcloud beta sql connect"""
    try:
        schema_file = '/Users/saitoutaishou/src/steins/ir/ir-faq-mvp/database/schema.sql'
        
        print("🚀 Deploying schema using gcloud beta sql connect...")
        
        # Build the command
        cmd = [
            'gcloud', 'beta', 'sql', 'connect', 'ir-faq-db',
            '--user=ir_app_user',
            '--database=ir_faq'
        ]
        
        # Read schema file
        with open(schema_file, 'r', encoding='utf-8') as f:
            schema_sql = f.read()
        
        print("📊 Executing schema.sql...")
        
        # Execute with stdin and provide password
        result = subprocess.run(
            cmd,
            input=f"AppUser2024SecurePass\n{schema_sql}",
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