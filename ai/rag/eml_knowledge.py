"""
WHO Essential Medicines List (EML) Local Knowledge Base.
Provides fast, offline lookup of 1,738 medicines with their indications,
formulations, ATC codes, and classifications. Used by the RAG pipeline
to ground AI responses in verified medical data.
"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional

logger = logging.getLogger("smartmed.ai.eml")

_DATA: List[Dict] = []
_LOADED = False


def _load_data():
    global _DATA, _LOADED
    if _LOADED:
        return
    
    # Locate eml_knowledge_base.json in ai/data/
    data_path = Path(__file__).resolve().parent.parent / "data" / "eml_knowledge_base.json"
    
    if not data_path.exists():
        # Fallback to alternate locations
        alt_path = Path("/home/gopikrishna/Documents/medassist ai/backend/app/rag/eml_knowledge_base.json")
        if alt_path.exists():
            data_path = alt_path

    try:
        if data_path.exists():
            with open(data_path, "r", encoding="utf-8") as f:
                _DATA = json.load(f)
            _LOADED = True
            logger.info(f"[EML Knowledge Base] Loaded {len(_DATA)} medicines from WHO Essential Medicines List.")
        else:
            logger.warning(f"[EML Knowledge Base] File not found at {data_path}")
            _DATA = []
            _LOADED = True
    except Exception as e:
        logger.error(f"[EML Knowledge Base] Warning: Could not load data: {e}")
        _DATA = []
        _LOADED = True


def search_medicines(query: str, limit: int = 5) -> List[Dict]:
    """
    Search the EML knowledge base by medicine name or indication.
    Uses fuzzy substring matching on name, indication, section, and formulations.
    Returns the top `limit` matches.
    """
    _load_data()
    if not _DATA or not query:
        return []
    
    query_lower = query.lower().strip()
    query_words = query_lower.split()
    
    scored_results = []
    
    for med in _DATA:
        # Skip removed medicines
        if med.get("status", "").lower() == "removed":
            continue
            
        name = med.get("name", "").lower()
        indication = med.get("indication", "").lower()
        section = med.get("section", "").lower()
        formulations = med.get("formulations", "").lower()
        combined = med.get("combined_with", "").lower()
        
        score = 0
        
        # Exact name match = highest priority
        if query_lower == name:
            score += 100
        # Name starts with query
        elif name.startswith(query_lower):
            score += 80
        # Query is contained in name
        elif query_lower in name:
            score += 60
        
        # Check individual words against all fields
        for word in query_words:
            if len(word) < 3:
                continue
            if word in name:
                score += 30
            if word in indication:
                score += 20
            if word in section:
                score += 10
            if word in formulations:
                score += 5
            if word in combined:
                score += 5
        
        if score > 0:
            scored_results.append((score, med))
    
    # Sort by score (descending) and return top results
    scored_results.sort(key=lambda x: x[0], reverse=True)
    return [med for _, med in scored_results[:limit]]


def get_eml_context(query: str, limit: int = 2) -> str:
    """
    Generates a compact, formatted context string from the EML knowledge base
    for injection into the LLM prompt.
    """
    results = search_medicines(query, limit=limit)
    if not results:
        return ""
    
    context_parts = []
    for med in results:
        parts = [f"[WHO Essential Medicine] {med.get('name', '')}"]
        if med.get("indication"):
            parts.append(f"  • Indication: {med['indication'][:180]}")
        if med.get("formulations"):
            parts.append(f"  • Formulations: {med['formulations'][:120]}")
        if med.get("section"):
            parts.append(f"  • Category: {med['section']}")
        if med.get("atc_codes"):
            parts.append(f"  • ATC Code: {med['atc_codes']}")
        context_parts.append("\n".join(parts))
    
    return "\n".join(context_parts)


def get_all_medicine_names() -> List[str]:
    """Returns a list of all medicine names in the knowledge base."""
    _load_data()
    return [med["name"] for med in _DATA if med.get("status", "").lower() != "removed"]
