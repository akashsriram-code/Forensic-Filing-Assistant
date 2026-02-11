import os
import asyncio
import libsql_client
from dotenv import load_dotenv

load_dotenv()

async def main():
    url = os.getenv("TURSO_DATABASE_URL").replace("libsql://", "https://")
    token = os.getenv("TURSO_AUTH_TOKEN")
    
    async with libsql_client.create_client(url, auth_token=token) as client:
        try:
            rs = await client.execute("SELECT count(*) FROM filing_themes")
            count = rs.rows[0][0]
            print(f"Processed Filings: {count}")
            
            if count > 0:
                rs2 = await client.execute("SELECT ticker, form, filing_date FROM filing_themes ORDER BY extracted_at DESC LIMIT 5")
                print("\nLatest processed:")
                for row in rs2.rows:
                    print(f"- {row[0]} ({row[1]}) from {row[2]}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
