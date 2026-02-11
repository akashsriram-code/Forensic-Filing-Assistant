#!/usr/bin/env python
"""
Ingest Document CLI
Called by Next.js API to process and vectorize uploaded documents.
"""
import sys
import os
import json
import hashlib

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(__file__))

from document_processor import process_document
from vector_store import add_chunks_batch, get_stats

def generate_chunk_id(filepath: str, position: int) -> str:
    """Generate a unique ID for a chunk."""
    file_hash = hashlib.md5(filepath.encode()).hexdigest()[:8]
    return f"{file_hash}_chunk_{position}"

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: ingest_document.py <filepath> <company> <period>"}))
        sys.exit(1)
    
    filepath = sys.argv[1]
    company = sys.argv[2]
    period = sys.argv[3]
    
    try:
        print(f"[Ingest] Processing: {filepath}")
        print(f"[Ingest] Company: {company}, Period: {period}")
        
        # Process document into chunks
        chunks = process_document(filepath, company, period)
        
        if not chunks:
            print(json.dumps({"error": "No text extracted from document", "chunks_indexed": 0}))
            sys.exit(0)
        
        print(f"[Ingest] Extracted {len(chunks)} chunks")
        
        # Add unique IDs to chunks
        for i, chunk in enumerate(chunks):
            chunk["id"] = generate_chunk_id(filepath, i)
        
        # Batch add to vector store
        indexed = add_chunks_batch(chunks)
        
        print(f"[Ingest] Indexed {indexed} new chunks")
        
        stats = get_stats()
        print(json.dumps({
            "success": True,
            "chunks_indexed": indexed,
            "total_chunks": stats["total_chunks"],
            "companies": stats["companies"]
        }))
        
    except Exception as e:
        print(f"[Ingest] Error: {e}")
        print(json.dumps({"error": str(e), "chunks_indexed": 0}))
        sys.exit(1)

if __name__ == "__main__":
    main()
