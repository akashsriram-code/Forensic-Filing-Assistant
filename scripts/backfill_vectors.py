"""
Backfill existing themes from Turso into the vector store.
"""
import os
import sys
import json
import asyncio
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(__file__))
from vector_store import add_theme, get_stats

load_dotenv()

TURSO_DB_URL = os.getenv("TURSO_DATABASE_URL").replace("libsql://", "https://")
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN")

async def backfill():
    import libsql_client
    
    async with libsql_client.create_client(TURSO_DB_URL, auth_token=TURSO_AUTH_TOKEN) as client:
        print("[Backfill] Fetching themes from Turso...")
        rs = await client.execute("SELECT accession_number, ticker, form, filing_date, filing_url, themes FROM filing_themes")
        
        total = 0
        for row in rs.rows:
            accession = row[0]
            ticker = row[1] or "UNKNOWN"
            form = row[2]
            date = row[3]
            url = row[4] or ""
            themes_json = row[5]
            
            try:
                themes = json.loads(themes_json)
                for idx, t in enumerate(themes):
                    theme_id = f"{accession}_{idx}"
                    add_theme(
                        theme_id=theme_id,
                        ticker=ticker,
                        form=form,
                        date=date,
                        theme_name=t.get('theme', ''),
                        context=t.get('context', ''),
                        filing_url=url
                    )
                    total += 1
                    if total % 10 == 0:
                        print(f"  -> Indexed {total} themes...")
            except Exception as e:
                print(f"  -> Error processing {accession}: {e}")
        
        print(f"\n[Backfill] Complete! Indexed {total} themes.")
        print(f"Stats: {get_stats()}")

if __name__ == "__main__":
    asyncio.run(backfill())
