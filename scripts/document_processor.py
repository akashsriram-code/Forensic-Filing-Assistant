"""
Document Processor - Extract text from various file formats and chunk for vectorization.
Supports: PDF, DOC, DOCX, TXT
"""
import os
import re
from typing import List, Dict

def extract_text_from_pdf(filepath: str) -> str:
    """Extract text from PDF file."""
    import pdfplumber
    text = ""
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text

def extract_text_from_docx(filepath: str) -> str:
    """Extract text from DOCX file."""
    from docx import Document
    doc = Document(filepath)
    text = ""
    for para in doc.paragraphs:
        text += para.text + "\n"
    return text

def extract_text_from_txt(filepath: str) -> str:
    """Extract text from TXT file."""
    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
        return f.read()

def extract_text(filepath: str) -> str:
    """Extract text from file based on extension."""
    ext = os.path.splitext(filepath)[1].lower()
    
    if ext == '.pdf':
        return extract_text_from_pdf(filepath)
    elif ext in ['.docx', '.doc']:
        return extract_text_from_docx(filepath)
    elif ext == '.txt':
        return extract_text_from_txt(filepath)
    else:
        raise ValueError(f"Unsupported file type: {ext}")

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[Dict]:
    """
    Split text into overlapping chunks for vectorization.
    
    Args:
        text: Full document text
        chunk_size: Target size of each chunk in characters
        overlap: Number of characters to overlap between chunks
    
    Returns:
        List of dicts with 'text' and 'position' keys
    """
    # Clean up text
    text = re.sub(r'\s+', ' ', text).strip()
    
    if not text:
        return []
    
    chunks = []
    start = 0
    chunk_num = 0
    
    while start < len(text):
        # Find end of chunk
        end = start + chunk_size
        
        # Try to break at sentence boundary
        if end < len(text):
            # Look for sentence end within a window
            window_start = max(end - 50, start)
            window_end = min(end + 50, len(text))
            window = text[window_start:window_end]
            
            # Find last sentence-ending punctuation in window
            for punct in ['. ', '! ', '? ', '\n']:
                last_punct = window.rfind(punct)
                if last_punct != -1:
                    end = window_start + last_punct + 1
                    break
        
        # Extract chunk
        chunk_text = text[start:end].strip()
        
        if chunk_text:
            chunks.append({
                'text': chunk_text,
                'position': chunk_num,
                'char_start': start,
                'char_end': end
            })
            chunk_num += 1
        
        # Move to next position with overlap
        start = end - overlap if end < len(text) else len(text)
    
    return chunks

def process_document(filepath: str, company: str, period: str) -> List[Dict]:
    """
    Full pipeline: extract text, chunk, and prepare for vectorization.
    
    Returns list of chunks with metadata.
    """
    # Extract text
    text = extract_text(filepath)
    
    if not text.strip():
        return []
    
    # Chunk the text
    chunks = chunk_text(text, chunk_size=500, overlap=100)
    
    # Add metadata to each chunk
    filename = os.path.basename(filepath)
    for chunk in chunks:
        chunk['company'] = company
        chunk['period'] = period
        chunk['source_file'] = filename
    
    return chunks


if __name__ == "__main__":
    # Test with a sample file
    import sys
    if len(sys.argv) > 1:
        filepath = sys.argv[1]
        company = sys.argv[2] if len(sys.argv) > 2 else "Test Company"
        period = sys.argv[3] if len(sys.argv) > 3 else "Q1 2026"
        
        chunks = process_document(filepath, company, period)
        print(f"Extracted {len(chunks)} chunks from {filepath}")
        
        if chunks:
            print(f"\nFirst chunk preview:")
            print(f"  Company: {chunks[0]['company']}")
            print(f"  Period: {chunks[0]['period']}")
            print(f"  Text: {chunks[0]['text'][:200]}...")
