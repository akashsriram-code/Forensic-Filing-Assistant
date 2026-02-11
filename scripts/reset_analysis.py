import os
import asyncio
import libsql_client
from dotenv import load_dotenv

load_dotenv()
TURSO_DB_URL = os.getenv("TURSO_DATABASE_URL").replace("libsql://", "https://")
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

async def main():
    async with libsql_client.create_client(TURSO_DB_URL, auth_token=TURSO_AUTH_TOKEN) as client:
        print("Dropping and recreating tables...")
        await client.execute("DROP TABLE IF EXISTS filing_themes")
        await client.execute("DROP TABLE IF EXISTS market_trends")
        await client.execute("""
        CREATE TABLE filing_themes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            accession_number TEXT,
            cik TEXT,
            ticker TEXT,
            form TEXT,
            filing_date TEXT,
            filing_url TEXT,
            themes TEXT,
            extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(accession_number)
        )
        """)
        await client.execute("""
        CREATE TABLE IF NOT EXISTS market_trends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            period TEXT,
            trend_name TEXT,
            description TEXT,
            related_tickers TEXT,
            frequency INTEGER,
            generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """)
        print("Database schema recreated. Filings will be re-processed.")

if __name__ == "__main__":
    asyncio.run(main())
