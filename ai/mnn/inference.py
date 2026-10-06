"""
SmartMed AI - MNN Inference Engine
Handles prompt formatting, conversation history management,
and delegates actual generation to the ModelManager.
"""

import logging
import time
from typing import List, Dict, Optional

from .config import config
from .model_manager import model_manager
from rag.pipeline import rag_pipeline

logger = logging.getLogger("smartmed.ai")


class MNNInference:
    """
    High-level inference interface for SmartMed & MedAssist AI chat.
    Retrieves verified clinical knowledge from local EML and medical APIs,
    formats prompts with MedAssist clinical triage instructions,
    and delegates to the on-device MNN model via ModelManager.
    """

    def _get_system_prompt(self) -> str:
        return config.get_system_prompt()

    def _format_prompt(
        self,
        message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        rag_context: Optional[str] = None,
    ) -> str:
        """
        Format the prompt for the MNN-LLM model in ChatML template.
        Injects verified medical RAG context when available.
        """
        parts = []

        # System prompt
        system_prompt = self._get_system_prompt()
        parts.append(f"<|im_start|>system\n{system_prompt}<|im_end|>")

        # Conversation history (if any)
        if conversation_history:
            max_history_chars = (config.context_length - config.max_new_tokens) * 4
            total_chars = 0
            trimmed_history = []

            for msg in reversed(conversation_history):
                msg_len = len(msg.get("content", ""))
                if total_chars + msg_len > max_history_chars:
                    break
                trimmed_history.insert(0, msg)
                total_chars += msg_len

            for msg in trimmed_history:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if role == "user":
                    parts.append(f"<|im_start|>user\n{content}<|im_end|>")
                elif role == "assistant":
                    parts.append(f"<|im_start|>assistant\n{content}<|im_end|>")

        # Current user message with medical context if retrieved
        if rag_context:
            user_turn = (
                f"[Retrieved Medical Context]\n{rag_context}\n\n"
                f"{message}"
            )
        else:
            user_turn = message

        parts.append(f"<|im_start|>user\n{user_turn}<|im_end|>")

        # Start of assistant response
        parts.append("<|im_start|>assistant\n")

        return "\n".join(parts)

    def generate(
        self,
        message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        use_rag: bool = True,
    ) -> Dict:
        """
        Generate a clinically grounded response for a user message.
        
        Args:
            message: The user's input message.
            conversation_history: Previous messages in [{role, content}] format.
            use_rag: Whether to perform local EML / OpenFDA / RxNorm retrieval.
            
        Returns:
            Dict with 'success', 'response', 'model', 'offline', 'timing' keys.
        """
        if not message or not message.strip():
            return {
                "success": False,
                "error": "Message cannot be empty.",
                "model": config.model_name,
                "offline": True,
            }

        start_time = time.time()

        # 1. Retrieve RAG clinical context
        rag_context = ""
        if use_rag:
            try:
                rag_context = rag_pipeline.get_rag_context(message)
                if rag_context:
                    logger.info(f"Retrieved medical RAG context for query: {message[:40]}")
            except Exception as rag_err:
                logger.debug(f"RAG retrieval skipped: {rag_err}")

        # 2. Ensure MNN model is loaded
        if not model_manager.is_ready:
            loaded = model_manager.load_model()
            if not loaded:
                try:
                    from clinical_triage import resolve_clinical_chat
                    triage_ans = resolve_clinical_chat(message)
                    return {
                        "success": True,
                        "response": triage_ans,
                        "model": "smartmed-clinical-engine",
                        "offline": True,
                        "rag_grounded": bool(rag_context),
                        "timing": "0.01s",
                    }
                except Exception as c_err:
                    logger.debug(f"Clinical fallback error: {c_err}")
                    return {
                        "success": False,
                        "error": model_manager.error_message,
                        "model": config.model_name,
                        "offline": True,
                    }

        # 3. Format prompt
        prompt = self._format_prompt(message, conversation_history, rag_context)

        try:
            # Run inference
            response_text = model_manager.generate(prompt)

            # Clean up response
            response_text = self._clean_response(response_text)

            elapsed = round(time.time() - start_time, 2)

            return {
                "success": True,
                "response": response_text,
                "model": config.model_name,
                "offline": True,
                "rag_grounded": bool(rag_context),
                "timing": f"{elapsed}s",
            }

        except RuntimeError as e:
            return {
                "success": False,
                "error": str(e),
                "model": config.model_name,
                "offline": True,
            }
        except Exception as e:
            logger.error(f"Unexpected inference error: {e}", exc_info=True)
            return {
                "success": False,
                "error": f"Unexpected error during inference: {type(e).__name__}: {e}",
                "model": config.model_name,
                "offline": True,
            }

    def generate_voice(
        self,
        message: str,
        system_prompt: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict:
        """
        Specialized lightweight generation for real-time telephone voice calls.
        Bypasses heavy RAG documents to ensure sub-second response times,
        and enforces a natural, spoken, caring tone without markdown.
        """
        if not message or not message.strip():
            return {
                "success": False,
                "error": "Message cannot be empty.",
                "model": config.model_name,
                "offline": True,
            }

        start_time = time.time()

        if not model_manager.is_ready:
            loaded = model_manager.load_model()
            if not loaded:
                try:
                    from clinical_triage import resolve_clinical_voice
                    voice_ans = resolve_clinical_voice(message)
                    return {
                        "success": True,
                        "response": voice_ans,
                        "model": "smartmed-voice-engine",
                        "offline": True,
                        "timing": "0.01s",
                    }
                except Exception as c_err:
                    logger.debug(f"Clinical voice fallback error: {c_err}")
                    return {
                        "success": False,
                        "error": model_manager.error_message,
                        "model": config.model_name,
                        "offline": True,
                    }

        sys_prompt = system_prompt or (
            "You are SmartMed AI, a warm medical voice call assistant on the phone with the patient. "
            "Reply directly in 1 to 2 spoken sentences with clear, practical guidance. "
            "Never use markdown formatting, asterisks, bullet points, or lists."
        )

        parts = [f"<|im_start|>system\n{sys_prompt}<|im_end|>"]
        if conversation_history:
            for msg in conversation_history[-4:]:
                r = msg.get("role", "user")
                c = msg.get("content", "")
                parts.append(f"<|im_start|>{r}\n{c}<|im_end|>")
        parts.append(f"<|im_start|>user\n{message.strip()}<|im_end|>\n<|im_start|>assistant\n")
        prompt = "\n".join(parts)

        try:
            raw_text = model_manager.generate(prompt)
            clean_text = self._clean_response(raw_text)
            import re
            clean_text = re.sub(r"[*_~`#]+", "", clean_text)
            clean_text = re.sub(r"^\s*[-•*+]\s+", "", clean_text, flags=re.MULTILINE)
            clean_text = re.sub(r"\s+", " ", clean_text).strip()
            elapsed = round(time.time() - start_time, 2)
            return {
                "success": True,
                "response": clean_text,
                "model": config.model_name,
                "offline": True,
                "timing": f"{elapsed}s",
            }
        except Exception as e:
            logger.error(f"Voice inference error: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "model": config.model_name,
                "offline": True,
            }


    def _clean_response(self, text: str) -> str:
        """Clean up model output: stop tokens, remove special tokens, trim whitespace, prevent echoes."""
        if not text:
            return "I'm sorry, I couldn't generate a response. Please try again."

        import re

        # Strip echo prefix if model generated "User: ... Assistant:" or "Patient: ... Assistant:"
        echo_pattern = r"^(?:Patient|User|Human):\s*.*?(?:\n+|\s+)(?:Doctor|Assistant|SmartMed AI):\s*"
        echo_match = re.match(echo_pattern, text, re.IGNORECASE | re.DOTALL)
        if echo_match:
            text = text[echo_match.end():]
        else:
            # Strip standalone assistant prefixes at the beginning
            text = re.sub(r"^(?:Doctor|Assistant|SmartMed AI|Response):\s*", "", text, flags=re.IGNORECASE)

        # Stop token boundaries to prevent multi-turn hallucinations
        stop_sequences = [
            "<|im_end|>",
            "<|endoftext|>",
            "</s>",
            "<|im_start|>",
            "\nUser:",
            "\nPatient:",
            "\nHuman:",
            "\nDoctor:",
            "\nAssistant:",
            "\nuser:",
            "\npatient:",
        ]

        # Truncate at first occurrence of any stop sequence
        earliest_stop = len(text)
        for seq in stop_sequences:
            pos = text.find(seq)
            if pos != -1 and pos < earliest_stop:
                earliest_stop = pos
        text = text[:earliest_stop]

        # Remove any remaining special token patterns
        text = re.sub(r"<\|[^|]+\|>", "", text)

        # Truncate degenerate line/bullet-point repetition (common in small quantized models)
        lines = text.split("\n")
        deduped_lines = []
        seen_lines = {}
        for line in lines:
            line_clean = line.strip().lower()
            # Strip bullet prefixes for accurate comparison
            line_clean = re.sub(r"^[-*•\d.]+\s*", "", line_clean)
            if len(line_clean) > 8:
                count = seen_lines.get(line_clean, 0)
                if count >= 2:
                    break
                seen_lines[line_clean] = count + 1
            deduped_lines.append(line)
        text = "\n".join(deduped_lines)

        # Truncate degenerate sentence repetition within paragraphs
        sentences = re.split(r'(?<=[.!?])\s+', text)
        if len(sentences) > 3:
            deduped = []
            seen_counts = {}
            for s in sentences:
                s_clean = s.strip().lower()
                if len(s_clean) > 10:
                    count = seen_counts.get(s_clean, 0)
                    if count >= 2:
                        break
                    seen_counts[s_clean] = count + 1
                deduped.append(s)
            text = " ".join(deduped)

        text = text.strip()

        if not text:
            return "I'm sorry, I couldn't generate a response. Please try again."

        return text


# Singleton instance
inference_engine = MNNInference()
