"""
SEC Client - Official SEC API Integration
Handles CIK lookup, filing discovery, and data fetching
"""
import requests
import json
import re
from bs4 import BeautifulSoup
from urllib.parse import quote

class SECClient:
    """Interface to SEC EDGAR using official APIs."""
    
    # Common CIK fallbacks for demo reliability
    CIK_MAP = {
        "AAPL": "320193", "MSFT": "789019", "GOOGL": "1652044", "AMZN": "1018724",
        "META": "1326801", "TSLA": "1318605", "NVDA": "1045810", "JPM": "19617",
        "V": "1403161", "JNJ": "200406", "WMT": "104169", "PG": "80424",
        "MA": "1141391", "UNH": "731766", "HD": "354950", "BAC": "70858",
        "XOM": "34088", "PFE": "78003", "ABBV": "1551152", "CVX": "93410",
        "KO": "21344", "PEP": "77476", "COST": "909832", "MRK": "310158",
        "AVGO": "1441634", "TMO": "97745", "CSCO": "858877", "MCD": "63908",
        "ABT": "1800", "DHR": "313616", "ACN": "1467373", "NKE": "320187",
        "LLY": "59478", "TXN": "97476", "ORCL": "1341439", "PM": "1413329",
        "NEE": "753308", "IBM": "51143", "QCOM": "804328", "HON": "773840",
        "INTC": "50863", "AMD": "2488", "CRM": "1108524", "NFLX": "1065280",
        "GM": "1467858", "F": "37996", "GS": "886982", "MS": "895421",
        "BRK-A": "1067983", "BRK-B": "1067983", "BRKB": "1067983"
    }
    
    PROXIES = [
        "https://api.allorigins.win/raw?url=",  # Works best for SEC
        "https://corsproxy.io/?",
        "https://thingproxy.freeboard.io/fetch/",
    ]
    
    def __init__(self, use_proxies: bool = True):
        self.use_proxies = use_proxies
        self.headers = {
            "User-Agent": "ForensicNewsroom/1.0 (press@example.com)",
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov"
        }
    
    def _fetch(self, url: str) -> requests.Response | None:
        """Fetch URL, optionally through CORS proxy."""
        print(f"[SEC] Fetching: {url[:60]}...")
        
        # Direct fetch for backend/backend scripts
        if not self.use_proxies:
            try:
                # Update host header based on URL
                if "data.sec.gov" in url:
                    self.headers["Host"] = "data.sec.gov"
                else:
                    self.headers["Host"] = "www.sec.gov"
                    
                resp = requests.get(url, headers=self.headers, timeout=30)
                if resp.status_code == 200:
                    return resp
                print(f"[SEC] Direct fetch failed: {resp.status_code}")
            except Exception as e:
                print(f"[SEC] Direct fetch error: {e}")
            return None

        # Proxy fetch for frontend
        for proxy in self.PROXIES:
            try:
                if "allorigins" in proxy:
                    full_url = f"{proxy}{quote(url, safe='')}"
                else:
                    full_url = f"{proxy}{url}"
                
                print(f"[SEC] Trying proxy: {proxy[:25]}...")
                # Remove Host header for proxy requests
                proxy_headers = self.headers.copy()
                if "Host" in proxy_headers:
                    del proxy_headers["Host"]
                    
                resp = requests.get(full_url, headers=proxy_headers, timeout=30)
                
                if resp.status_code == 200 and len(resp.text) > 100:
                    print(f"[SEC] Success! Got {len(resp.text)} bytes")
                    return resp
                else:
                    print(f"[SEC] Failed: status={resp.status_code}, len={len(resp.text)}")
            except Exception as e:
                print(f"[SEC] Error: {str(e)[:50]}")
                continue
        
        print("[SEC] All proxies failed!")
        return None
    
    def get_cik(self, ticker: str) -> str | None:
        """Get CIK for ticker (10-digit padded)."""
        ticker = ticker.upper().strip().replace(".", "-")
        
        # Check fallback first
        if ticker in self.CIK_MAP:
            return self.CIK_MAP[ticker].zfill(10)
        
        # Try SEC API
        resp = self._fetch("https://www.sec.gov/files/company_tickers.json")
        if resp:
            try:
                for entry in resp.json().values():
                    if entry.get("ticker") == ticker:
                        return str(entry["cik_str"]).zfill(10)
            except:
                pass
        return None
    
    def get_ticker(self, cik: str) -> str:
        """Resolve Ticker from CIK using SEC bulk data."""
        cik_str = str(int(cik)) # Remove padding
        
        # 1. Check internal map reverse
        for t, c in self.CIK_MAP.items():
            if str(int(c)) == cik_str:
                return t
                
        # 2. Lazy load full map if needed (basic caching)
        if not hasattr(self, '_ticker_map'):
            print("[SEC] Building CIK->Ticker map...")
            self._ticker_map = {}
            try:
                resp = self._fetch("https://www.sec.gov/files/company_tickers.json")
                if resp:
                    data = resp.json()
                    for entry in data.values():
                        self._ticker_map[str(entry['cik_str'])] = entry['ticker']
            except Exception as e:
                print(f"[SEC] Map build error: {e}")
        
        return self._ticker_map.get(cik_str, "UNKNOWN")
    
    def get_submissions(self, cik: str) -> dict | None:
        """Get company submissions JSON."""
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        print(f"[SEC] Getting submissions for CIK {cik}")
        resp = self._fetch(url)
        if resp:
            try:
                data = resp.json()
                print(f"[SEC] Got submissions, filings count: {len(data.get('filings', {}).get('recent', {}).get('form', []))}")
                return data
            except Exception as e:
                print(f"[SEC] JSON parse error: {e}")
        return None
    
    def get_filings_via_html(self, cik: str, form_type: str, count: int = 2) -> list[dict]:
        """
        Get filings by scraping the SEC Company Filings HTML page.
        URL: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=...
        """
        cik_clean = cik.lstrip("0")
        url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik_clean}&type={form_type}&dateb=&owner=include&count={count + 5}"
        
        print(f"[SEC] Trying Company Filings HTML page...")
        resp = self._fetch(url)
        
        if not resp:
            return []
        
        filings = []
        try:
            soup = BeautifulSoup(resp.text, 'html.parser')
            
            # Find the filings table
            table = soup.find('table', class_='tableFile2')
            if not table:
                print("[SEC] Could not find filings table")
                return []
            
            rows = table.find_all('tr')[1:]  # Skip header row
            
            for row in rows:
                cells = row.find_all('td')
                if len(cells) >= 4:
                    form = cells[0].get_text(strip=True)
                    
                    # Check if this matches our form type
                    if not form.startswith(form_type):
                        continue
                    
                    # Get the link to filing details
                    link_cell = cells[1]
                    link = link_cell.find('a')
                    if not link:
                        continue
                    
                    href = link.get('href', '')
                    date = cells[3].get_text(strip=True)
                    
                    # Parse accession from the href
                    # href looks like: /cgi-bin/browse-edgar?action=getcompany&...&accession_number=0000320193-24-000123
                    # or: /Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm
                    
                    acc_match = re.search(r'(\d{10}-\d{2}-\d{6})', href)
                    if acc_match:
                        acc = acc_match.group(1)
                        acc_clean = acc.replace("-", "")
                        
                        # Now we need to get the primary document
                        # Fetch the filing index page
                        if '-index.htm' in href or '-index.html' in href:
                            index_url = f"https://www.sec.gov{href}" if href.startswith('/') else href
                        else:
                            index_url = f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/{acc}-index.htm"
                        
                        # Get primary document name from index page
                        primary_doc = self._get_primary_doc_from_index(index_url, cik_clean, acc_clean)
                        
                        if primary_doc:
                            filings.append({
                                "form": form,
                                "accession": acc,
                                "accession_clean": acc_clean,
                                "primary_doc": primary_doc,
                                "date": date,
                                "url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/{primary_doc}",
                                "folder_url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/"
                            })
                            print(f"[SEC] Found via HTML: {form} from {date}")
                            
                            if len(filings) >= count:
                                break
        except Exception as e:
            print(f"[SEC] HTML parse error: {e}")
        
        return filings
    
    def get_filings_via_rss(self, cik: str, form_type: str, count: int = 2) -> list[dict]:
        """Get filings using RSS feed as alternative."""
        cik_clean = cik.lstrip("0")
        url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik_clean}&type={form_type}&count={count}&output=atom"
        
        print(f"[SEC] Trying RSS feed for {form_type}...")
        resp = self._fetch(url)
        
        if not resp:
            return []
        
        filings = []
        try:
            import xml.etree.ElementTree as ET
            xml_text = re.sub(r'\sxmlns[^"]*"[^"]*"', '', resp.text)
            root = ET.fromstring(xml_text)
            
            for entry in root.findall('.//entry'):
                link = entry.find('link')
                updated = entry.find('updated')
                
                if link is not None:
                    href = link.get('href', '')
                    acc_match = re.search(r'/(\d{10}-\d{2}-\d{6})', href)
                    if acc_match:
                        acc = acc_match.group(1)
                        acc_clean = acc.replace("-", "")
                        
                        filings.append({
                            "form": form_type,
                            "accession": acc,
                            "accession_clean": acc_clean,
                            "primary_doc": f"{acc_clean}.htm",
                            "date": updated.text[:10] if updated is not None else "Unknown",
                            "url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/{acc_clean}.htm",
                            "folder_url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/"
                        })
                        print(f"[SEC] Found via RSS: {form_type} from {filings[-1]['date']}")
                        
                        if len(filings) >= count:
                            break
        except Exception as e:
            print(f"[SEC] RSS parse error: {e}")
        
        return filings

    def get_latest_filings(self, form_type: str, count: int = 40) -> list[dict]:
        """Get latest filings from ALL companies via SEC RSS feed."""
        import datetime
        # Clean form type for URL (e.g. 10-K, 10-Q)
        type_param = form_type.replace(" ", "+")
        url = f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type={type_param}&company=&dateb=&owner=include&start=0&count={count}&output=atom"
        
        print(f"[SEC] Fetching latest {form_type} filings from market...")
        resp = self._fetch(url)
        
        if not resp:
            return []
        
        filings = []
        try:
            import xml.etree.ElementTree as ET
            # Remove namespace for easier parsing
            xml_text = re.sub(r'\sxmlns[^"]*"[^"]*"', '', resp.text)
            root = ET.fromstring(xml_text)
            entries = root.findall('.//entry')
            print(f"[SEC] RSS feed contains {len(entries)} entries")
            
            for entry in entries:

                title = entry.find('title').text
                # Title format usually: "10-K - Microsoft Corp (0000789019) (Filer)"
                
                # Extract CIK and Company Name
                cik_match = re.search(r'\((\d{10})\)', title)
                cik = cik_match.group(1) if cik_match else "Unknown"
                
                updated = entry.find('updated')
                date_str = updated.text[:10] if updated is not None else datetime.datetime.now().strftime("%Y-%m-%d")
                print(f"[SEC] Entry: {title[:50]}... Date: {date_str}")
                
                # Link format: https://www.sec.gov/Archives/edgar/data/789019/000095017025123456/0000950170-25-123456-index.htm
                link = entry.find('link')
                if link is not None:
                    href = link.get('href', '')
                    
                    acc_match = re.search(r'/(\d{10}-\d{2}-\d{6})', href)
                    if acc_match:
                        acc = acc_match.group(1)
                        acc_clean = acc.replace("-", "")
                        cik_clean = str(int(cik)) # Remove leading zeros for URL
                        
                        updated = entry.find('updated')
                        date_str = updated.text[:10] if updated is not None else datetime.datetime.now().strftime("%Y-%m-%d")
                        print(f"[SEC] Entry: {title[:50]}... Date: {date_str}")

                        # Resolve primary document URL
                        primary_doc = "unknown.htm"
                        real_url = href
                        
                        # Only resolve if we are going to use it (count check is later, but we need it for the dict)
                        # To save time, we could lazily resolve, but let's just do it.
                        if len(filings) < count:
                            primary_doc = self._get_primary_doc_from_index(href, cik_clean, acc) or f"{acc_clean}.htm"
                            real_url = f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/{primary_doc}"

                        filings.append({
                            "form": form_type,
                            "accession": acc,
                            "accession_clean": acc_clean,
                            "cik": cik,
                            "ticker": self.get_ticker(cik), 
                            "primary_doc": primary_doc, 
                            "date": date_str,
                            "url": real_url,
                            "folder_url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc_clean}/"
                        })
                        
                        if len(filings) >= count:
                            break
        except Exception as e:
            print(f"[SEC] Latest RSS parse error: {e}")
            
        return filings

    def _get_primary_doc_from_index(self, index_url: str, cik: str, acc: str) -> str | None:
        """Get the primary document filename from a filing index page."""
        resp = self._fetch(index_url)
        if not resp:
            # Fallback: try common naming patterns
            return f"{acc}.htm"
        
        try:
            soup = BeautifulSoup(resp.text, 'html.parser')
            
            # Look for the main document in the table
            table = soup.find('table', class_='tableFile')
            if table:
                rows = table.find_all('tr')[1:]
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) >= 4:
                        doc_type = cells[3].get_text(strip=True).lower()
                        if '10-k' in doc_type or '10-q' in doc_type or '8-k' in doc_type or '13-f' in doc_type:
                            link = cells[2].find('a')
                            if link:
                                return link.get('href', '').split('/')[-1]
            
            # Fallback: find first .htm link that's not an index
            for link in soup.find_all('a'):
                href = link.get('href', '')
                if href.endswith('.htm') and 'index' not in href.lower():
                    return href.split('/')[-1]
                    
        except Exception as e:
            print(f"[SEC] Index parse error: {e}")
        
        return f"{acc}.htm"
    
    def _load_local_json(self, path: str) -> dict | list | None:
        """Try to load data from local JSON file or static server."""
        import os
        import json
        import sys
        
        # 1. Try local filesystem (Native Python)
        try:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8') as f:
                    print(f"[SEC] Loading local data: {path}")
                    return json.load(f)
        except Exception as e:
            pass

        # 2. Try fetching via HTTP (Stlite/Wasm)
        # In stlite, local files aren't mounted, so we fetch relative URL
        try:
            # path is like "data/AAPL/filings.json"
            # In deployed app, this is "./data/AAPL/filings.json"
            print(f"[SEC] Fetching static data: {path}")
            resp = requests.get(path) # Relative path works in browser
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f"[SEC] Static fetch error: {e}")
            
        return None

    def get_filings(self, cik: str, form_type: str, count: int = 2, ticker: str = None) -> list[dict]:
        """Get recent filings - tries LOCAL first, then HTML, RSS, API."""
        
        # Method 0: Check local data
        if ticker:
            local_data = self._load_local_json(f"data/{ticker}/filings.json")
            if local_data:
                # Filter by form type
                filtered = [f for f in local_data if f['form'] == form_type]
                if filtered:
                    return filtered[:count]
        
        # Method 1: Try Company Filings HTML page (most likely to work)
        print("[SEC] Trying HTML page method...")
        filings = self.get_filings_via_html(cik, form_type, count)
        if filings:
            return filings
        
        # Method 2: Try RSS feed
        print("[SEC] HTML failed, trying RSS...")
        filings = self.get_filings_via_rss(cik, form_type, count)
        if filings:
            return filings
        
        # Method 3: Try submissions API
        print("[SEC] RSS failed, trying submissions API...")
        subs = self.get_submissions(cik)
        if subs:
            filings = []
            recent = subs.get("filings", {}).get("recent", {})
            forms = recent.get("form", [])
            accessions = recent.get("accessionNumber", [])
            primary_docs = recent.get("primaryDocument", [])
            dates = recent.get("filingDate", [])
            
            for i, form in enumerate(forms):
                if form.startswith(form_type) and len(filings) < count:
                    acc = accessions[i].replace("-", "")
                    cik_clean = cik.lstrip("0")
                    
                    filings.append({
                        "form": form,
                        "accession": accessions[i],
                        "accession_clean": acc,
                        "primary_doc": primary_docs[i],
                        "date": dates[i],
                        "url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc}/{primary_docs[i]}",
                        "folder_url": f"https://www.sec.gov/Archives/edgar/data/{cik_clean}/{acc}/"
                    })
            
            if filings:
                return filings
        
        # Method 4: Return demo data
        print("[SEC] All methods failed, using demo data...")
        return self._get_demo_filings(cik, form_type, count)
    
    def _get_demo_filings(self, cik: str, form_type: str, count: int) -> list[dict]:
        """Return demo filing data when SEC access fails."""
        cik_clean = cik.lstrip("0")
        
        if form_type in ["10-K", "10-Q"]:
            return [
                {
                    "form": form_type,
                    "accession": "0000320193-24-000123",
                    "accession_clean": "000032019324000123",
                    "primary_doc": f"demo-{form_type.lower()}.htm",
                    "date": "2024-11-01",
                    "url": "DEMO",
                    "folder_url": "DEMO"
                },
                {
                    "form": form_type,
                    "accession": "0000320193-24-000100", 
                    "accession_clean": "000032019324000100",
                    "primary_doc": f"demo-{form_type.lower()}-prev.htm",
                    "date": "2024-08-01",
                    "url": "DEMO",
                    "folder_url": "DEMO"
                }
            ][:count]
        
        return []
    
    def download_filing(self, url: str) -> str | None:
        """Download filing HTML content and extract clean text."""
        resp = self._fetch(url)
        if not resp:
            return None
        
        try:
            import re
            from bs4 import BeautifulSoup
            
            html = resp.text
            
            # Step 1: Strip ALL XML/XBRL namespace tags using universal regex
            # This removes ANY tag with a colon (namespace prefix) like ix:, xbrli:, etc.
            html = re.sub(r'<[a-zA-Z0-9_-]+:[^>]*>.*?</[a-zA-Z0-9_-]+:[^>]*>', '', html, flags=re.DOTALL)
            html = re.sub(r'<[a-zA-Z0-9_-]+:[^/>]*/>', '', html)  # Self-closing
            
            # Step 2: Remove XML declaration and comments
            html = re.sub(r'<\?xml[^>]*\?>', '', html)
            html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
            
            # Step 3: Parse with BeautifulSoup
            soup = BeautifulSoup(html, 'html.parser')
            
            # Remove script, style, and metadata elements
            for element in soup(['script', 'style', 'head', 'meta', 'link', 'title']):
                element.decompose()
            
            # Get text with reasonable separator
            text = soup.get_text(separator='\n', strip=True)
            
            # Step 4: Clean up excessive whitespace
            text = re.sub(r'\n{3,}', '\n\n', text)  # Max 2 newlines
            text = re.sub(r'[ \t]+', ' ', text)      # Collapse spaces
            
            return text
        except Exception as e:
            print(f"[SEC] Error parsing HTML: {e}")
            return resp.text  # Fallback to raw
    
    def get_risk_factors(self, cik: str, ticker: str = None) -> dict:
        """Get risk factors (Item 1A) - tries LOCAL first, then download/extract."""
        if ticker:
            local_risks = self._load_local_json(f"data/{ticker}/risks.json")
            if local_risks:
                return local_risks
        return {}

    def get_intelligence(self, ticker: str) -> dict | None:
        """Get pre-generated LLM intelligence."""
        if ticker:
            return self._load_local_json(f"data/{ticker}/intelligence.json")
        return None

    def get_company_facts(self, cik: str, ticker: str = None) -> dict | None:
        """Get XBRL company facts - tries LOCAL first, then API."""
        if ticker:
            local_facts = self._load_local_json(f"data/{ticker}/financials.json")
            if local_facts:
                return local_facts

        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
        resp = self._fetch(url)
        return resp.json() if resp else None
    
    def get_13f_holdings(self, folder_url: str) -> str | None:
        """Get 13-F infotable.xml content."""
        # List folder to find infotable file
        resp = self._fetch(folder_url + "index.json")
        if not resp:
            return None
        
        try:
            data = resp.json()
            for item in data.get("directory", {}).get("item", []):
                name = item.get("name", "").lower()
                if "infotable" in name and name.endswith(".xml"):
                    xml_url = folder_url + item["name"]
                    xml_resp = self._fetch(xml_url)
                    return xml_resp.text if xml_resp else None
        except:
            pass
        return None


def extract_item_1a(html: str) -> str:
    """Extract Item 1A Risk Factors from 10-K/Q HTML."""
    soup = BeautifulSoup(html, 'html.parser')
    text = soup.get_text(" ", strip=True)
    text = re.sub(r'\s+', ' ', text)
    
    # Find Item 1A section
    patterns = [
        r'Item\s+1A[\.\s]+Risk\s+Factors(.*?)(?:Item\s+1B|Item\s+2[\.\s])',
        r'ITEM\s+1A(.*?)(?:ITEM\s+1B|ITEM\s+2)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match and len(match.group(1)) > 500:
            return match.group(1).strip()[:25000]
    
    # Fallback
    idx = text.lower().find("risk factors")
    if idx > 0:
        return text[idx:idx+25000]
    
    return text[:15000]
