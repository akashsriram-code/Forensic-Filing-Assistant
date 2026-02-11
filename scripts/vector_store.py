"""
Vector Store for Document Chunks
Uses a local JSON file for storage with Hugging Face Inference API for embeddings.
Supports semantic search across uploaded documents.
"""
import os
import json
import numpy as np
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv()

# File-based storage
STORE_PATH = os.path.join(os.path.dirname(__file__), "..", "vector_store.json")
_embedding_model = None

def get_embedding_model():
    """Lazy-load the sentence-transformers model."""
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        print("[VectorStore] Loading embedding model...")
        _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _embedding_model

def load_store() -> dict:
    """Load the vector store from disk."""
    if os.path.exists(STORE_PATH):
        with open(STORE_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"chunks": [], "embeddings": []}

def save_store(data: dict):
    """Save the vector store to disk."""
    with open(STORE_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def embed_text(text: str) -> list[float]:
    """Embed a single text string."""
    model = get_embedding_model()
    return model.encode(text).tolist()

def embed_batch(texts: List[str]) -> List[list]:
    """Embed multiple texts efficiently."""
    model = get_embedding_model()
    return [emb.tolist() for emb in model.encode(texts)]

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np)))

def add_chunk(chunk_id: str, company: str, period: str, text: str, 
              source_file: str = "", position: int = 0) -> bool:
    """Add a document chunk to the vector store."""
    store = load_store()
    
    # Check if already exists
    for c in store["chunks"]:
        if c["id"] == chunk_id:
            return False  # Skip duplicate
    
    # Embed the text
    embedding = embed_text(text)
    
    # Store with metadata
    store["chunks"].append({
        "id": chunk_id,
        "company": company,
        "period": period,
        "text": text,
        "source_file": source_file,
        "position": position
    })
    store["embeddings"].append(embedding)
    
    save_store(store)
    return True

def add_chunks_batch(chunks: List[Dict]) -> int:
    """Add multiple chunks efficiently with batch embedding."""
    store = load_store()
    
    # Filter out duplicates
    existing_ids = {c["id"] for c in store["chunks"]}
    new_chunks = [c for c in chunks if c.get("id") not in existing_ids]
    
    if not new_chunks:
        return 0
    
    # Batch embed all texts
    texts = [c["text"] for c in new_chunks]
    embeddings = embed_batch(texts)
    
    # Store all
    for chunk, embedding in zip(new_chunks, embeddings):
        store["chunks"].append({
            "id": chunk["id"],
            "company": chunk.get("company", "Unknown"),
            "period": chunk.get("period", "Unknown"),
            "text": chunk["text"],
            "source_file": chunk.get("source_file", ""),
            "position": chunk.get("position", 0)
        })
        store["embeddings"].append(embedding)
    
    save_store(store)
    return len(new_chunks)

def search_similar(query: str, top_k: int = 10, company_filter: Optional[str] = None) -> List[Dict]:
    """Search for similar chunks."""
    store = load_store()
    
    if not store["chunks"]:
        return []
    
    # Embed the query
    query_embedding = embed_text(query)
    
    # Calculate similarities
    similarities = []
    for i, emb in enumerate(store["embeddings"]):
        chunk = store["chunks"][i]
        
        # Apply company filter if specified
        if company_filter and chunk.get("company", "").lower() != company_filter.lower():
            continue
            
        sim = cosine_similarity(query_embedding, emb)
        similarities.append((i, sim))
    
    # Sort by similarity (descending)
    similarities.sort(key=lambda x: x[1], reverse=True)
    
    # Return top-k results
    results = []
    for i, sim in similarities[:top_k]:
        chunk = store["chunks"][i]
        results.append({
            "id": chunk["id"],
            "company": chunk.get("company"),
            "period": chunk.get("period"),
            "text": chunk.get("text"),
            "source_file": chunk.get("source_file"),
            "position": chunk.get("position"),
            "similarity": round(sim, 3)
        })
    
    return results

def get_stats() -> dict:
    """Get store statistics."""
    store = load_store()
    
    # Count unique companies
    companies = set(c.get("company", "Unknown") for c in store["chunks"])
    
    return {
        "total_chunks": len(store["chunks"]),
        "companies": list(companies),
        "company_count": len(companies)
    }

def clear_store():
    """Clear all data from the vector store."""
    save_store({"chunks": [], "embeddings": []})

def get_companies() -> List[str]:
    """Get list of all companies in the store."""
    store = load_store()
    companies = set(c.get("company", "Unknown") for c in store["chunks"])
    return sorted(list(companies))


if __name__ == "__main__":
    # Test the vector store
    print("Testing vector store...")
    
    # Clear and add test data
    clear_store()
    
    add_chunk(
        chunk_id="test_1",
        company="Apple Inc",
        period="Q4 2025",
        text="The company reported record revenue of $120 billion, driven by strong iPhone sales and services growth.",
        source_file="AAPL_10Q.pdf",
        position=0
    )
    
    add_chunk(
        chunk_id="test_2",
        company="Microsoft Corp",
        period="Q3 2025",
        text="Cloud computing revenue increased 30% year-over-year, with Azure growing faster than the overall market.",
        source_file="MSFT_10Q.pdf",
        position=0
    )
    
    print("Added test chunks.")
    
    # Search
    results = search_similar("cloud growth", top_k=5)
    print(f"\nSearch results for 'cloud growth':")
    for r in results:
        print(f"  - {r['company']} ({r['period']}): {r['text'][:80]}... [similarity: {r['similarity']}]")
    
    print(f"\nStats: {get_stats()}")
