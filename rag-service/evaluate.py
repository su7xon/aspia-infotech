import sys
import time
import json
sys.path.insert(0, ".")
import main as rag


GROUND_TRUTH = [
    {
        "question": "how are answers generated in the rag pipeline",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["vector", "chunk"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "what hardware is required for deployment",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["16 GB", "ram", "disk"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "what should the ai never see",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["full sop library", "chunk"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "what do the sops need to contain for good retrieval",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["heading", "topic"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "what stops the model from making things up",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["retrieval", "context"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "why use rag instead of training the model",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["retrieval", "sop"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "how much system ram is recommended",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["16", "gb"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "which operating system is the standard choice",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["linux", "ubuntu"],
        "should_answer": True,
        "category": "technical",
    },
    {
        "question": "how should sops be structured for accuracy",
        "source": "Offline_SOP_Chatbot_Whitepaper _1_.docx",
        "keywords": ["heading", "one topic", "step"],
        "should_answer": True,
        "category": "technical",
    },

    {
        "question": "kitne din baad exception auto close hota hai",
        "source": "Exception_Management_SOP.docx",
        "keywords": ["exception"],
        "should_answer": True,
        "category": "exception",
    },
    {
        "question": "what is the process for raising an exception",
        "source": "Exception_Management_SOP.docx",
        "keywords": ["exception", "raise"],
        "should_answer": True,
        "category": "exception",
    },
    {
        "question": "who can approve exceptions",
        "source": "Exception_Management_SOP.docx",
        "keywords": ["approv"],
        "should_answer": True,
        "category": "exception",
    },
    {
        "question": "what happens when an exception is rejected",
        "source": "Exception_Management_SOP.docx",
        "keywords": ["reject"],
        "should_answer": True,
        "category": "exception",
    },

    {
        "question": "what is the SOP for Risk Management objective",
        "source": "SOP_Risk_Management_Text_Only _1_.pdf",
        "keywords": ["risk"],
        "should_answer": True,
        "category": "risk",
    },
    {
        "question": "how is risk assessed and categorized",
        "source": "SOP_Risk_Management_Text_Only _1_.pdf",
        "keywords": ["risk", "assess"],
        "should_answer": True,
        "category": "risk",
    },
    {
        "question": "what are the risk mitigation strategies",
        "source": "SOP_Risk_Management_Text_Only _1_.pdf",
        "keywords": ["mitigat"],
        "should_answer": True,
        "category": "risk",
    },

    {
        "question": "what is the leave policy for employees",
        "source": "HR_Leave_Policy.txt",
        "keywords": ["leave"],
        "should_answer": True,
        "category": "hr",
    },
    {
        "question": "how many days of leave are allowed per year",
        "source": "HR_Leave_Policy.txt",
        "keywords": ["day", "leave"],
        "should_answer": True,
        "category": "hr",
    },

    {
        "question": "what is the password policy for the organization",
        "source": "IT_Security_Policy.txt",
        "keywords": ["password"],
        "should_answer": True,
        "category": "it",
    },
    {
        "question": "what is the policy on VPN usage",
        "source": "IT_Security_Policy.txt",
        "keywords": ["vpn"],
        "should_answer": True,
        "category": "it",
    },

    {
        "question": "how do I escalate a customer complaint",
        "source": "Customer_Escalation_SOP.txt",
        "keywords": ["escalat"],
        "should_answer": True,
        "category": "escalation",
    },

    {
        "question": "how does document management work in ASPIA",
        "source": "A-Policy _ Document Management Using ASPIA-080926-094114.pdf",
        "keywords": ["document"],
        "should_answer": True,
        "category": "document",
    },

    {
        "question": "what are the safety procedures for the hydraulic press",
        "source": "Hydraulic_Press_Manual.txt",
        "keywords": ["hydraulic", "safety"],
        "should_answer": True,
        "category": "equipment",
    },

    {
        "question": "risk management ka objective kya hai",
        "source": "SOP_Risk_Management_Text_Only",
        "keywords": ["risk"],
        "should_answer": True,
        "category": "hinglish",
    },
    {
        "question": "leave policy mein kitne din ki chutti milti hai",
        "source": "HR_Leave_Policy.txt",
        "keywords": ["leave"],
        "should_answer": True,
        "category": "hinglish",
    },

    {
        "question": "what is the capital of France",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
    {
        "question": "tell me a joke about programming",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
    {
        "question": "how to cook biryani",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
    {
        "question": "explain quantum computing",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
    {
        "question": "what is the stock price of Google today",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
    {
        "question": "cricket match kab hai",
        "source": None,
        "keywords": [],
        "should_answer": False,
        "category": "negative",
    },
]


def _source_match(expected_source: str, retrieved_sources: list) -> bool:
    if not expected_source:
        return False
    expected_lower = expected_source.lower()
    for src in retrieved_sources:
        if expected_lower in src.lower() or src.lower() in expected_lower:
            return True
    return False


def evaluate(use_llm: bool, verbose: bool = False):
    recall_hits = 0
    kw_hits = 0
    passed = 0
    grounding_passed = 0
    grounding_failed = 0
    source_cited = 0
    tp, fp, tn, fn = 0, 0, 0, 0
    scores = []
    reciprocal_ranks = []
    timings = []
    results_per_category = {}

    total = len(GROUND_TRUTH)
    positives = sum(1 for g in GROUND_TRUTH if g["should_answer"])
    negatives = total - positives

    print(f"\n{'='*70}")
    print(f"  RAG EVALUATION HARNESS — {total} questions ({positives} positive, {negatives} negative)")
    print(f"  Mode: {'Full Pipeline (with LLM)' if use_llm else 'Retrieval Only (no LLM)'}")
    print(f"{'='*70}\n")

    for idx, item in enumerate(GROUND_TRUTH, 1):
        t0 = time.time()
        try:
            resp = rag.ask_sop_question(rag.AskRequest(question=item["question"]))
        except Exception as e:
            print(f"  [{idx:02d}] ERROR: {e}")
            continue
        dt = time.time() - t0
        timings.append(dt)

        got_sources = [c.source_file for c in resp.chunks_retrieved]
        system_answered = resp.passed_threshold
        should_answer = item["should_answer"]

        is_grounding_fail = (
            resp.passed_threshold
            and hasattr(resp, 'grounding_passed')
            and not resp.grounding_passed
        )

        recall_ok = False
        mrr_rank = 0
        if item["source"]:
            recall_ok = _source_match(item["source"], got_sources)
            for rank, src in enumerate(got_sources, 1):
                if item["source"].lower() in src.lower() or src.lower() in item["source"].lower():
                    mrr_rank = rank
                    break

        if recall_ok:
            recall_hits += 1
        if mrr_rank > 0:
            reciprocal_ranks.append(1.0 / mrr_rank)
        elif item["source"]:
            reciprocal_ranks.append(0.0)

        if system_answered:
            passed += 1

        if is_grounding_fail:
            grounding_failed += 1
            if should_answer:
                tp += 1
                classification = "GF"
            else:
                fp += 1
                classification = "FP"
        elif should_answer and system_answered:
            tp += 1
            classification = "TP"
        elif not should_answer and system_answered:
            fp += 1
            classification = "FP"
        elif not should_answer and not system_answered:
            tn += 1
            classification = "TN"
        else:
            fn += 1
            classification = "FN"

        kw_ok = False
        has_source_citation = False
        if use_llm and system_answered and not resp.answer.startswith("This isn't covered"):
            low = resp.answer.lower()
            kw_ok = any(k.lower() in low for k in item["keywords"])
            if kw_ok:
                kw_hits += 1
            qs = resp.quality_scores or {}
            grnd = qs.get("grounding", {"passed": False})
            if grnd.get("passed", False):
                grounding_passed += 1
            has_source_citation = grnd.get("source_cited", False)
            if has_source_citation:
                source_cited += 1
        elif not system_answered:
            grounding_passed += 1

        scores.append(round(resp.confidence_score, 4))

        cat = item.get("category", "other")
        if cat not in results_per_category:
            results_per_category[cat] = {"total": 0, "tp": 0, "fp": 0, "tn": 0, "fn": 0, "gf": 0, "recall": 0}
        results_per_category[cat]["total"] += 1
        results_per_category[cat][classification.lower()] += 1
        if recall_ok:
            results_per_category[cat]["recall"] += 1

        icon = {"TP": "✅", "TN": "✅", "FP": "❌", "FN": "❌", "GF": "⚠️"}[classification]
        label = "GF(retrieval OK, grounding fail)" if classification == "GF" else classification
        print(f"  [{idx:02d}] {icon} {label:<35} | {item['question'][:45]:<47} "
              f"score={resp.confidence_score:.4f} t={dt:.1f}s"
              f"{' kw=' + str(kw_ok) if use_llm and should_answer else ''}")

        if verbose:
            for c in resp.chunks_retrieved:
                print(f"         -> {c.source_file} | {c.heading} | sim={c.similarity_score:.4f}")
            if use_llm and system_answered:
                print(f"         Answer: {resp.answer[:120]}...")

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0
    mrr = sum(reciprocal_ranks) / len(reciprocal_ranks) if reciprocal_ranks else 0

    print(f"\n{'='*70}")
    print(f"  EVALUATION RESULTS")
    print(f"{'='*70}")

    print(f"\n  📊 CONFUSION MATRIX")
    print(f"  {'':>30}{'SYSTEM ANSWERED':>18}{'SYSTEM DECLINED':>18}")
    print(f"  {'SHOULD ANSWER':>30}{'TP = ' + str(tp):>18}{'FN = ' + str(fn):>18}")
    print(f"  {'SHOULD NOT ANSWER':>30}{'FP = ' + str(fp):>18}{'TN = ' + str(tn):>18}")

    print(f"\n  📈 CLASSIFICATION METRICS")
    print(f"  {'Precision':>25}: {precision:.4f}  ({tp}/{tp+fp}) — Of answers given, how many correct?")
    print(f"  {'Recall (Sensitivity)':>25}: {recall:.4f}  ({tp}/{tp+fn}) — Of answerable Qs, how many answered?")
    print(f"  {'Specificity':>25}: {specificity:.4f}  ({tn}/{tn+fp}) — Of out-of-scope Qs, how many declined?")
    print(f"  {'F1 Score':>25}: {f1:.4f}")
    if grounding_failed > 0:
        print(f"  {'Grounding Failures':>25}: {grounding_failed}  (retrieval OK but LLM output ungrounded — NOT counted as FN)")

    print(f"\n  🔍 RETRIEVAL METRICS")
    recall_denom = sum(1 for g in GROUND_TRUTH if g["source"])
    print(f"  {'Recall@3 (source file)':>25}: {recall_hits}/{recall_denom} = {100*recall_hits/max(1,recall_denom):.1f}%")
    print(f"  {'MRR@3':>25}: {mrr:.4f}")
    print(f"  {'Threshold pass rate':>25}: {passed}/{total} = {100*passed/total:.1f}%")
    print(f"  {'Avg confidence':>25}: {sum(scores)/len(scores):.4f}")

    if use_llm:
        print(f"\n  ✍️  ANSWER QUALITY")
        print(f"  {'Keyword hit rate':>25}: {kw_hits}/{positives} = {100*kw_hits/max(1,positives):.1f}%")
        print(f"  {'Grounding pass rate':>25}: {grounding_passed}/{total} = {100*grounding_passed/total:.1f}%")
        print(f"  {'Source citation rate':>25}: {source_cited}/{passed} = {100*source_cited/max(1,passed):.1f}%")

    print(f"\n  ⏱️  PERFORMANCE")
    print(f"  {'Avg response time':>25}: {sum(timings)/len(timings):.2f}s")
    print(f"  {'Max response time':>25}: {max(timings):.2f}s")
    print(f"  {'Min response time':>25}: {min(timings):.2f}s")

    print(f"\n  📁 PER-CATEGORY BREAKDOWN")
    print(f"  {'Category':<15} {'Total':>6} {'TP':>5} {'FP':>5} {'TN':>5} {'FN':>5} {'GF':>5} {'Recall@3':>10}")
    print(f"  {'-'*58}")
    for cat, data in sorted(results_per_category.items()):
        cat_recall_denom = sum(1 for g in GROUND_TRUTH if g["category"] == cat and g["source"])
        print(f"  {cat:<15} {data['total']:>6} {data['tp']:>5} {data['fp']:>5} {data['tn']:>5} {data['fn']:>5} {data.get('gf',0):>5} "
              f"{data['recall']}/{max(1,cat_recall_denom):>3}")

    print(f"\n{'='*70}")

    return {
        "total": total,
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "specificity": round(specificity, 4),
        "mrr": round(mrr, 4),
        "recall_at_3": recall_hits,
        "avg_confidence": round(sum(scores) / len(scores), 4),
        "avg_time": round(sum(timings) / len(timings), 2),
    }


if __name__ == "__main__":
    use_llm = "--llm" in sys.argv
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    metrics = evaluate(use_llm=use_llm, verbose=verbose)

    with open("eval_results.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"\n  Results saved to eval_results.json")
