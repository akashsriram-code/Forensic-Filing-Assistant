#!/usr/bin/env python
"""
Semantic Search CLI
Called by Next.js API to perform vector search across document chunks.
"""
import sys
import json
import os

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(__file__))

from vector_store import search_similar, get_stats, get_companies

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No query provided", "results": []}))
        sys.exit(1)
    
    query = " ".join(sys.argv[1:])
    
    try:
        results = search_similar(query, top_k=10)
        stats = get_stats()
        companies = get_companies()
        
        print(json.dumps({
            "query": query,
            "results": results,
            "total_chunks": stats["total_chunks"],
            "companies": companies
        }))
    except Exception as e:
        print(json.dumps({
            "error": str(e),
            "results": []
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
