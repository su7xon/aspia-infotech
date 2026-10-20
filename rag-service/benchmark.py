import sys, time
sys.path.insert(0, ".")
import main as rag

questions = [
    "what is the escalation process for exceptions",
    "how do I change my password policy",
    "IT security rules for network access",
    "what is the SOP number for exception management",
]

for q in questions:
    t0 = time.time()
    resp = rag.ask_sop_question(rag.AskRequest(question=q))
    dt = time.time() - t0
    print(f"\nQ: {q}")
    print(f"  score={resp.confidence_score:.4f} passed={resp.passed_threshold} time={dt:.2f}s")
    for c in resp.chunks_retrieved:
        print(f"  -> {c.source_file} | {c.heading} | sim={c.similarity_score:.4f} | {c.text[:90].encode('ascii','ignore').decode()}...")

