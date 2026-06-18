#!/usr/bin/env python3
"""
Database connection test for IR FAQ System
Test Cloud SQL connection and basic queries
"""

import os
import psycopg2
from google.cloud.sql.connector import Connector
import sqlalchemy

def init_connection_pool():
    """Cloud SQL PostgreSQL connection using Cloud SQL Connector"""
    
    # Cloud SQL connection details（認証情報は環境変数/Secret Managerから注入）
    instance_connection_name = os.environ.get(
        "DB_INSTANCE_CONNECTION_NAME",
        "hallowed-trail-462613-v1:us-central1:ir-faq-db",
    )
    db_user = os.environ.get("DB_USER", "ir_app_user")
    db_pass = os.environ.get("DB_PASSWORD")
    db_name = os.environ.get("DB_NAME", "ir_faq")

    if not db_pass:
        raise RuntimeError(
            "環境変数 DB_PASSWORD が未設定です。Secret Manager等から注入してください。"
        )

    # Initialize Cloud SQL Connector
    connector = Connector()
    
    def getconn():
        conn = connector.connect(
            instance_connection_name,
            "pg8000",
            user=db_user,
            password=db_pass,
            db=db_name
        )
        return conn
    
    # Create SQLAlchemy engine
    engine = sqlalchemy.create_engine(
        "postgresql+pg8000://",
        creator=getconn
    )
    
    return engine

def test_database_connection():
    """Test database connection and basic queries"""
    try:
        print("🔗 Testing Cloud SQL connection...")
        engine = init_connection_pool()
        
        with engine.connect() as conn:
            # Test 1: Basic connection
            result = conn.execute(sqlalchemy.text("SELECT version()"))
            version = result.fetchone()[0]
            print(f"✅ PostgreSQL Version: {version}")
            
            # Test 2: Check tables
            result = conn.execute(sqlalchemy.text("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            """))
            tables = [row[0] for row in result.fetchall()]
            print(f"✅ Tables created: {', '.join(tables)}")
            
            # Test 3: Check companies data
            result = conn.execute(sqlalchemy.text("SELECT COUNT(*) FROM companies"))
            company_count = result.fetchone()[0]
            print(f"✅ Companies in database: {company_count}")
            
            # Test 4: Check qa_data
            result = conn.execute(sqlalchemy.text("SELECT COUNT(*) FROM qa_data"))
            qa_count = result.fetchone()[0]
            print(f"✅ Q&A entries in database: {qa_count}")
            
            # Test 5: Check extensions
            result = conn.execute(sqlalchemy.text("""
                SELECT extname 
                FROM pg_extension 
                WHERE extname = 'pg_trgm'
            """))
            extensions = [row[0] for row in result.fetchall()]
            print(f"✅ Extensions installed: {', '.join(extensions)}")
            
            # Test 6: Sample company query
            result = conn.execute(sqlalchemy.text("""
                SELECT name, ticker, sector 
                FROM companies 
                WHERE is_active = true 
                LIMIT 3
            """))
            companies = result.fetchall()
            print("✅ Sample companies:")
            for company in companies:
                print(f"   - {company[0]} ({company[1]}) - {company[2]}")
            
            # Test 7: Sample Q&A query
            result = conn.execute(sqlalchemy.text("""
                SELECT question, category 
                FROM qa_data 
                WHERE is_active = true 
                LIMIT 2
            """))
            qa_entries = result.fetchall()
            print("✅ Sample Q&A entries:")
            for qa in qa_entries:
                print(f"   - {qa[0][:50]}... ({qa[1]})")
        
        print("🎉 All database tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        return False

if __name__ == "__main__":
    print("🚀 IR FAQ Database Connection Test...")
    success = test_database_connection()
    if success:
        print("🎉 Database is ready for use!")
    else:
        print("💥 Database test failed!")