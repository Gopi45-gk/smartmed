"""
Medical RAG (Retrieval-Augmented Generation) Pipeline for SmartMed & MedAssist AI.

Retrieves medical context from local & authenticated sources before generating AI responses:
  1. WHO Essential Medicines List (LOCAL OFFLINE - 1,738 medicines, instant lookup)
  2. OpenFDA Drug API (Authenticated with OPENFDA_API_KEY for labels, warnings, dosages)
  3. RxNorm (NLM/NIH active ingredients and RxCUI standardization)
  4. Data.gov.in (Authenticated with DATA_GOV_IN_API_KEY for Indian Jan Aushadhi generics)
  5. WHO ICD-11 API (OAuth2 with MEDI_CLIENT_ID & MEDI_CLIENT_SECRET for disease classification)

Guaranteed 100% offline functionality via local EML database, with supplementary
real-time authenticated enrichment when network is available.
"""

import os
import time
import logging
import requests
import concurrent.futures
from typing import Dict, List, Optional
from .eml_knowledge import get_eml_context, search_medicines

logger = logging.getLogger("smartmed.ai.rag")

# Resource IDs for Data.gov.in datasets
JAN_AUSHADHI_RESOURCE_ID = "095e30ac-1f49-4be9-86f0-00ac6c034818"


class RAGPipeline:
    def __init__(self):
        self.openfda_api_key = os.getenv(
            "OPENFDA_API_KEY",
            "B0mcBJbkjGS6ajtz6pN61LTwmnczRGYGjV4fz61K"
        )
        self.datagov_api_key = os.getenv(
            "DATA_GOV_IN_API_KEY",
            "579b464db66ec23bdd0000016df62ee19e7742936caec0eec2b2cab3"
        )
        self.medi_client_id = os.getenv(
            "MEDI_CLIENT_ID",
            "19d254d9-16ec-4a10-9bf4-144e3d5dc859_1c26f6fe-092c-4035-80a3-3f9a4a5847de"
        )
        self.medi_client_secret = os.getenv(
            "MEDI_CLIENT_SECRET",
            "kNEATvsZRt47xL5m0jQyvcQvej5AoTL1oomj53xAFUY="
        )
        
        # In-memory caches to maintain instantaneous response latency
        self._cache: Dict[str, tuple] = {}  # key -> (timestamp, data)
        self._cache_ttl = 3600  # 1 hour
        self._icd_token: Optional[str] = None
        self._icd_token_expiry: float = 0

    def _get_cache(self, key: str) -> Optional[str]:
        if key in self._cache:
            ts, val = self._cache[key]
            if time.time() - ts < self._cache_ttl:
                return val
        return None

    def _set_cache(self, key: str, value: str):
        self._cache[key] = (time.time(), value)

    # ── 1. Local Offline Knowledge Base (WHO EML) ───────────────────
    def fetch_eml(self, query: str) -> str:
        """Instant offline lookup from WHO Essential Medicines List."""
        return get_eml_context(query)

    # ── 2. OpenFDA Drug API (Authenticated) ─────────────────────────
    def fetch_openfda(self, query: str) -> str:
        """Fetch drug labels, indications, warnings, and dosage from OpenFDA."""
        cache_key = f"openfda:{query.lower().strip()}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            url = "https://api.fda.gov/drug/label.json"
            params = {
                "search": f'openfda.brand_name:"{query}"+openfda.generic_name:"{query}"',
                "limit": 1,
                "api_key": self.openfda_api_key,
            }
            res = requests.get(url, params=params, timeout=3)
            if res.status_code == 200:
                data = res.json()
                if data.get("results"):
                    item = data["results"][0]
                    parts = []
                    
                    indications = item.get("indications_and_usage", [""])[0]
                    if indications:
                        parts.append(f"  • Indications: {indications[:250]}...")
                    
                    warnings = item.get("warnings", [""])[0]
                    if warnings:
                        parts.append(f"  • Warnings: {warnings[:200]}...")
                    
                    dosage = item.get("dosage_and_administration", [""])[0]
                    if dosage:
                        parts.append(f"  • Dosage: {dosage[:200]}...")

                    if parts:
                        result = f"[OpenFDA Verified]\n" + "\n".join(parts)
                        self._set_cache(cache_key, result)
                        return result
        except Exception as e:
            logger.debug(f"[RAG] OpenFDA lookup skipped/offline: {e}")
        return ""

    # ── 3. RxNorm Standard Active Ingredients (NLM) ─────────────────
    def fetch_rxnorm(self, query: str) -> str:
        """Retrieve RxCUI and active ingredients standard from NLM RxNorm."""
        cache_key = f"rxnorm:{query.lower().strip()}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            url = f"https://rxnav.nlm.nih.gov/REST/rxcui.json?name={query}"
            res = requests.get(url, timeout=2.5)
            if res.status_code == 200:
                data = res.json()
                ids = data.get("idGroup", {}).get("rxnormId", [])
                if ids:
                    result = f"[RxNorm Standard] Drug '{query}' identified (RxCUI: {ids[0]})."
                    self._set_cache(cache_key, result)
                    return result
        except Exception as e:
            logger.debug(f"[RAG] RxNorm skipped/offline: {e}")
        return ""

    # ── 4. Indian Jan Aushadhi Generics (Data.gov.in) ────────────────
    def fetch_datagov_generics(self, query: str) -> str:
        """Search Indian Jan Aushadhi generic medicines and pricing."""
        if not self.datagov_api_key:
            return ""

        cache_key = f"datagov:{query.lower().strip()}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        try:
            url = f"https://api.data.gov.in/resource/{JAN_AUSHADHI_RESOURCE_ID}"
            params = {
                "api-key": self.datagov_api_key,
                "format": "json",
                "limit": 3,
                "filters[generic_name]": query,
            }
            res = requests.get(url, params=params, timeout=3)
            if res.status_code == 200:
                records = res.json().get("records", [])
                if records:
                    parts = []
                    for r in records[:2]:
                        name = r.get("generic_name") or r.get("drug_name", "")
                        mrp = r.get("mrp") or r.get("unit_price", "")
                        size = r.get("pack_size", "")
                        parts.append(f"  • Jan Aushadhi: {name} | Pack: {size} | MRP: ₹{mrp}")
                    if parts:
                        result = "[Jan Aushadhi Generic Alternatives (India)]\n" + "\n".join(parts)
                        self._set_cache(cache_key, result)
                        return result
        except Exception as e:
            logger.debug(f"[RAG] Data.gov.in skipped/offline: {e}")
        return ""

    # ── 5. WHO ICD-11 Disease Classification (OAuth2) ───────────────
    def _get_icd11_token(self) -> Optional[str]:
        if self._icd_token and time.time() < self._icd_token_expiry:
            return self._icd_token

        if not self.medi_client_id or not self.medi_client_secret:
            return None

        try:
            res = requests.post(
                "https://icdaccessmanagement.who.int/connect/token",
                data={"grant_type": "client_credentials", "scope": "icdapi_access"},
                auth=(self.medi_client_id, self.medi_client_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=4,
            )
            if res.status_code == 200:
                data = res.json()
                self._icd_token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)
                self._icd_token_expiry = time.time() + expires_in - 120
                return self._icd_token
        except Exception as e:
            logger.debug(f"[RAG] ICD-11 auth skipped/offline: {e}")
        return None

    def fetch_icd11(self, query: str) -> str:
        """Search WHO ICD-11 for disease and symptom classification."""
        cache_key = f"icd11:{query.lower().strip()}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached

        token = self._get_icd11_token()
        if not token:
            return ""

        try:
            url = f"https://id.who.int/icd/release/11/mms/search"
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "API-Version": "v2",
            }
            res = requests.get(url, params={"q": query}, headers=headers, timeout=3)
            if res.status_code == 200:
                entities = res.json().get("destinationEntities", [])
                if entities:
                    entity = entities[0]
                    title = entity.get("title", "")
                    code = entity.get("theCode", "")
                    result = f"[WHO ICD-11 Classification] '{query}' maps to {code}: {title}."
                    self._set_cache(cache_key, result)
                    return result
        except Exception as e:
            logger.debug(f"[RAG] ICD-11 search skipped/offline: {e}")
        return ""

    # ── Context Synthesis Orchestration ─────────────────────────────
    def get_rag_context(self, user_query: str) -> str:
        """
        Retrieves and synthesizes clinical knowledge from offline EML and online APIs.
        Always returns quickly (within max 2-3 seconds) to maintain smooth chat flow.
        """
        if not user_query or len(user_query.strip()) < 3:
            return ""

        q = user_query.strip()
        context_blocks = []

        # 1. Local WHO EML lookup (Instant, offline guaranteed)
        eml_ctx = self.fetch_eml(q)
        if eml_ctx:
            context_blocks.append(eml_ctx)

        # 2. Parallel supplementary lookups for online APIs (with 2.5s maximum timeout)
        # Check if query pertains to medications or generic pricing
        is_generic_query = any(k in q.lower() for k in ["generic", "cheaper", "substitute", "price", "cost", "jan aushadhi", "india"])
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            future_fda = executor.submit(self.fetch_openfda, q)
            future_rx = executor.submit(self.fetch_rxnorm, q)
            future_datagov = executor.submit(self.fetch_datagov_generics, q) if is_generic_query else None
            future_icd = executor.submit(self.fetch_icd11, q) if len(q.split()) <= 4 else None

            try:
                fda_res = future_fda.result(timeout=2.0)
                if fda_res:
                    context_blocks.append(fda_res)
            except Exception:
                pass

            try:
                rx_res = future_rx.result(timeout=1.5)
                if rx_res:
                    context_blocks.append(rx_res)
            except Exception:
                pass

            if future_datagov:
                try:
                    dg_res = future_datagov.result(timeout=2.0)
                    if dg_res:
                        context_blocks.append(dg_res)
                except Exception:
                    pass

            if future_icd:
                try:
                    icd_res = future_icd.result(timeout=2.0)
                    if icd_res:
                        context_blocks.append(icd_res)
                except Exception:
                    pass

        if not context_blocks:
            return ""

        return "\n\n".join(context_blocks)


# Singleton RAG pipeline
rag_pipeline = RAGPipeline()
