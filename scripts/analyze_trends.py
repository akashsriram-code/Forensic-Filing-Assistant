import os
import sys
import datetime
import time
import json
import asyncio
import google.generativeai as genai
from dotenv import load_dotenv

# Add parent directory to path to import sec_client
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sec_client

# Load environment variables
load_dotenv()

# Configuration
TURSO_DB_URL = os.getenv("TURSO_DATABASE_URL").replace("libsql://", "https://")
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
START_DATE = "2026-01-01"
from huggingface_hub import InferenceClient

# Initialize Hugging Face
HF_API_TOKEN = os.getenv("HUGGINGFACE_API_TOKEN")
hf_client = InferenceClient(api_key=HF_API_TOKEN)
model_id = "meta-llama/Meta-Llama-3-8B-Instruct"

async def initialize_schema(client):
    """Create necessary tables if they don't exist."""
    print("[DB] Initializing schema...")
    await client.execute("""
    CREATE TABLE IF NOT EXISTS filing_themes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT,
        cik TEXT,
        ticker TEXT,
        form TEXT,
        filing_date TEXT,
        filing_url TEXT, -- Direct link to SEC filing
        themes TEXT, -- JSON array of themes
        extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(accession_number)
    )
    """)

    
    await client.execute("""
    CREATE TABLE IF NOT EXISTS market_trends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT, -- e.g. "2026-Q1"
        trend_name TEXT,
        description TEXT,
        related_tickers TEXT, -- JSON array
        frequency INTEGER,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

def fetch_new_filings(sec):
    """Fetch all 10-K/10-Q filings since Jan 1, 2026."""
    new_filings = []
    print(f"[SEC] Checking GLOBAL filings since {START_DATE}...")
    
    # 10-K
    k_filings = sec.get_latest_filings("10-K", count=40)
    for f in k_filings:
        if f['date'] >= START_DATE:
            new_filings.append(f)
            print(f"  -> Found {f['form']} for {f['cik']} from {f['date']}")

    # 10-Q
    q_filings = sec.get_latest_filings("10-Q", count=40)
    for f in q_filings:
        if f['date'] >= START_DATE:
            new_filings.append(f)
            print(f"  -> Found {f['form']} for {f['cik']} from {f['date']}")
                
    return new_filings

def extract_themes(text):
    """Extract themes using Hugging Face Zephyr."""
    
    # Construct Message
    messages = [
        {"role": "system", "content": "You are a financial analyst. Your job is to extract UNIQUE, SPECIFIC themes from the provided text. Do NOT copy examples. If the text does not mention AI, do not invent it."},
        {"role": "user", "content": f"""Analyze the provided text from a corporate filing (10-K/10-Q). 
        Identify the top 3-5 specific strategic themes, risks, or operational focus areas mentioned in THIS text.

        Rules:
        1. Return ONLY a valid JSON array.
        2. Do NOT use the examples below. Use facts from the text.
        3. If the text is empty or irrelevant, return [].

        Example Format (do not copy content):
        [
            {{"theme": "Specific Product Launch", "sentiment": "Positive", "context": "Full 1-2 sentence quote from the text explaining this theme."}},
            {{"theme": "Regulatory Challenge", "sentiment": "Negative", "context": "Full 1-2 sentence quote from the text about this issue."}}
        ]


        TEXT:
        {text[:15000]}
        """}
    ]
    
    try:
        response = hf_client.chat_completion(
            messages=messages,
            model=model_id,
            max_tokens=500,
            temperature=0.1
        )
        content = response.choices[0].message.content
        
        # Debug: Print raw content if parsing fails
        # Find JSON array start/end
        start = content.find('[')
        end = content.rfind(']')
        
        if start != -1 and end != -1 and end > start:
            json_str = content[start:end+1]
            return json.loads(json_str)
            
        print(f"[AI] Parsing Error. Raw content: {content[:200]}...")
        return []

    except Exception as e:
        print(f"[AI] Error extracting themes: {e}")
        return []

async def main():
    print(f"--- Starting Corporate Theme Analysis ({datetime.datetime.now()}) ---")
    import libsql_client

    if not TURSO_DB_URL or not TURSO_AUTH_TOKEN:
        print("Missing TURSO credentials")
        return

    # Using the Async Client context manager
    async with libsql_client.create_client(TURSO_DB_URL, auth_token=TURSO_AUTH_TOKEN) as client:
        await initialize_schema(client)
        
        # 1. Setup SEC Client (Sync)
        sec = sec_client.SECClient(use_proxies=False)
        
        # 2. Find Filings
        filings = fetch_new_filings(sec)
        print(f"[Pipeline] Found {len(filings)} relevant filings to process.")
        
        # 3. Process Filings
        for filing in filings:
            # Check if already processed
            rs = await client.execute("SELECT 1 FROM filing_themes WHERE accession_number = ?", [filing['accession']])
            if rs.rows:
                print(f"[Skip] Already processed {filing['ticker']} {filing['accession']}")
                continue
                
            print(f"[Process] Analyzing {filing['ticker']} {filing['form']}...")
            
            # Download text (Sync)
            text = sec.download_filing(filing['url'])
            if not text:
                print("  -> Failed to download text")
                continue
                
            # DEBUG: Save first text to file to inspect content
            if not os.path.exists("debug_text.txt"):
                with open("debug_text.txt", "w", encoding="utf-8") as f:
                    f.write(text[:20000])
                print("[DEBUG] Saved debug_text.txt")

            # Extract Themes (Sync - Hugging Face)
            themes = extract_themes(text)
            
            if themes:
                print(f"  -> Extracted {len(themes)} themes")
                await client.execute(
                    "INSERT INTO filing_themes (accession_number, cik, ticker, form, filing_date, filing_url, themes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [filing['accession'], filing['cik'], filing['ticker'], filing['form'], filing['date'], filing['url'], json.dumps(themes)]
                )
                
                # Store themes in vector database for semantic search
                try:
                    from vector_store import add_theme
                    for idx, t in enumerate(themes):
                        theme_id = f"{filing['accession']}_{idx}"
                        add_theme(
                            theme_id=theme_id,
                            ticker=filing['ticker'],
                            form=filing['form'],
                            date=filing['date'],
                            theme_name=t.get('theme', ''),
                            context=t.get('context', ''),
                            filing_url=filing.get('url', '')
                        )
                    print(f"  -> Indexed {len(themes)} themes in vector store")
                except Exception as ve:
                    print(f"  -> Vector store error (non-fatal): {ve}")

            
            print("  -> Sleeping 20s for rate limit...")
            time.sleep(20)
                
                
        print("--- Analysis Cycle Complete ---")

if __name__ == "__main__":
    asyncio.run(main())
