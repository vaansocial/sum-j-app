# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, List
import os, json, random, requests
from datetime import datetime, timedelta

# pyrefly: ignore [missing-import]
from supabase import create_client, Client

app = FastAPI(title="SumJ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment variables
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Optional[Client] = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# Helper: Groq Socratic probe
def generate_socratic_probe(concept_question: str, user_explanation: str) -> dict:
    system_prompt = """You are "SumJ" (समझे), an intuitive and rigorous Socratic engineering mentor.
Your purpose is to test if a student genuinely understands software engineering fundamentals or is reciting from memory.

Given:
1. Concept: The fundamental question.
2. Student Answer: The student's initial explanation.

Task:
- Identify ungrounded buzzwords, rote memorization, recitations, or vague filler phrases.
- Generate a single, punchy Socratic follow-up question (1-2 sentences) challenging their explanation or asking for the underlying mechanism.
- Do NOT give away the answer.

Respond ONLY with valid JSON:
{
  "detected_recitation": ["phrase/sentence detected"],
  "critique": "short observation",
  "follow_up_question": "Socratic question here"
}"""

    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Concept: {concept_question}\nStudent Answer: {user_explanation}"}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3
    }
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    response = requests.post(GROQ_URL, headers=headers, json=payload)
    response.raise_for_status()
    return json.loads(response.json()["choices"][0]["message"]["content"])

# Helper: Evaluation A (Keywords & Synonyms unified with lenient matching)
def evaluate_keywords(user_explanation: str, case_data: dict, min_matches: int = 1) -> dict:
    explanation_lower = user_explanation.lower()
    
    canonical_keywords = case_data.get("case_answer_keywords", [])
    synonym_groups = case_data.get("case_answer_kw_synonym", [])
    
    total_groups = max(len(canonical_keywords), len(synonym_groups))
    
    matched_groups = []
    unmatched_groups = []

    def matches_term(term: str, text: str) -> bool:
        t = term.lower().strip()
        if not t:
            return False
        # Direct substring match
        if t in text:
            return True
        # Flexible multi-word token match (words can appear reordered)
        words = [w for w in t.split() if len(w) > 2]
        if len(words) >= 2 and all(w in text for w in words):
            return True
        return False

    for i in range(total_groups):
        cluster_terms = set()
        
        # Include canonical keyword
        if i < len(canonical_keywords) and canonical_keywords[i]:
            cluster_terms.add(canonical_keywords[i])
            
        # Include all synonyms
        if i < len(synonym_groups) and isinstance(synonym_groups[i], list):
            for term in synonym_groups[i]:
                cluster_terms.add(term)

        # Check for matches
        found_words = [term for term in cluster_terms if matches_term(term, explanation_lower)]
        
        canonical_label = (
            canonical_keywords[i] if i < len(canonical_keywords) 
            else (synonym_groups[i][-1] if synonym_groups[i] else f"Concept {i+1}")
        )
        
        if found_words:
            matched_groups.append(found_words[0])
        else:
            unmatched_groups.append(canonical_label)

    passed = len(matched_groups) >= min_matches if total_groups > 0 else True
    return {
        "passed": passed,
        "matched_count": len(matched_groups),
        "total_required": total_groups,
        "matched_terms": matched_groups,
        "missing_concepts": unmatched_groups
    }

# Helper: Evaluation B (Semantic LLM Judge)
def evaluate_semantic(scenario: str, correct_answer: str, user_explanation: str) -> dict:
    system_prompt = """You are a rigorous but fair Software Engineering examiner.
Your job is to determine if a student truly understands a technical scenario, NOT if they can memorize keywords.

Input:
- Scenario: The real-world problem context.
- Correct Answer: The precise engineering rationale.
- Student Explanation: How the student explained it.

Task:
1. Compare the student's explanation to the scenario and correct answer.
2. Determine if the student grasps the core logic, constraints, and implications.
3. Identify any major logical gaps or misconceptions.
4. Output a JSON object with a simple Pass/Fail verdict, a short reasoning note, and any named gap.

Respond ONLY with valid JSON:
{
  "passed": true/false,
  "reasoning": "short explanation",
  "missing_points": ["named gap 1", "named gap 2"]
}"""

    user_prompt = f"Scenario: {scenario}\nCorrect Answer: {correct_answer}\nStudent Explanation: {user_explanation}"
    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2
    }
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    response = requests.post(GROQ_URL, headers=headers, json=payload)
    response.raise_for_status()
    return json.loads(response.json()["choices"][0]["message"]["content"])


# --- API REQUEST SCHEMAS ---

class AuthRequest(BaseModel):
    user_id: str
    name: str

class StartSessionRequest(BaseModel):
    user_id: str
    concept_id: str

class ProbeRequest(BaseModel):
    session_id: str
    user_id: str
    concept_id: str
    concept_question: str
    user_explanation: str

class FollowupAnswerRequest(BaseModel):
    session_id: str
    socratic_response: str

class CaseEvalRequest(BaseModel):
    session_id: str
    user_id: str
    concept_id: str
    case_id: str
    try_number: int  # 1 for first try, 2 for second try
    user_explanation: str
    closing_gap_from_attempt_id: Optional[str] = None  # PROOF LINK: retry -> gap


# --- ENDPOINTS ---

@app.post("/api/auth")
def authenticate_user(req: AuthRequest):
    """Passwordless user registration + 24-hr rate limit check (max 3 sessions/day)."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured.")
    
    uid = req.user_id.strip().lower()
    uname = req.name.strip()
    if not uid or not uname:
        raise HTTPException(status_code=400, detail="User ID and Name are required.")

    # Upsert user record
    supabase.table("users").upsert({
        "user_id": uid,
        "name": uname,
        "last_active": datetime.utcnow().isoformat()
    }).execute()

    # Rate Limit Check: max 3 sessions in the last 24 hours
    cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
    session_check = supabase.table("review_sessions") \
        .select("id", count="exact") \
        .eq("user_id", uid) \
        .gte("created_at", cutoff) \
        .execute()

    used_today = session_check.count or 0
    max_daily = 3
    remaining = max(0, max_daily - used_today)

    if used_today >= max_daily:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit reached ({used_today}/{max_daily} sessions used). Please come back in 24 hours."
        )

    return {
        "user_id": uid,
        "name": uname,
        "sessions_used_today": used_today,
        "sessions_remaining": remaining
    }

@app.get("/api/concepts")
def get_concepts():
    """Fetch the 7 concepts from Supabase."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured.")
    res = supabase.table("concepts").select("id, concept_question").order("id").execute()
    return [{"ID": row["id"], "concept_question": row["concept_question"]} for row in res.data]

@app.post("/api/session/start")
def start_session(req: StartSessionRequest):
    """Creates a new review session row in Supabase with rate-limit check."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured.")
    
    uid = req.user_id.strip().lower()

    # Rate Limit Check: max 3 sessions in the last 24 hours
    cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
    session_check = supabase.table("review_sessions") \
        .select("id", count="exact") \
        .eq("user_id", uid) \
        .gte("created_at", cutoff) \
        .execute()

    used_today = session_check.count or 0
    max_daily = 3
    if used_today >= max_daily:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit reached ({used_today}/{max_daily} sessions used). Please come back in 24 hours."
        )

    res = supabase.table("review_sessions").insert({
        "user_id": uid,
        "concept_id": req.concept_id
    }).execute()
    return {"session_id": res.data[0]["id"]}

@app.post("/api/probe")
def probe_explanation(req: ProbeRequest):
    """Analyzes initial explanation, returns Socratic question, and logs recitations to DB."""
    probe_result = generate_socratic_probe(req.concept_question, req.user_explanation)
    
    if supabase:
        # Update session with initial explanation & Socratic question
        supabase.table("review_sessions").update({
            "initial_explanation": req.user_explanation,
            "socratic_followup": probe_result.get("follow_up_question", "")
        }).eq("id", req.session_id).execute()

        # LOG RECITATIONS: Each detected phrase is saved as its own row (Answers Q1 & Q3)
        detected = probe_result.get("detected_recitation", [])
        if detected:
            recitation_rows = [{
                "session_id": req.session_id,
                "user_id": req.user_id,
                "concept_id": req.concept_id,
                "recited_phrase": phrase
            } for phrase in detected]
            supabase.table("recitations").insert(recitation_rows).execute()

    return probe_result

@app.post("/api/session/followup")
def record_followup(req: FollowupAnswerRequest):
    """Records the learner's response to the Socratic question."""
    if supabase:
        supabase.table("review_sessions").update({
            "socratic_response": req.socratic_response
        }).eq("id", req.session_id).execute()
    return {"status": "recorded"}

@app.get("/api/cases/{concept_id}")
def get_two_cases(concept_id: str):
    """Fetches 2 distinct random cases for this concept (without leaking answers)."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured.")
    res = supabase.table("cases").select("id, concept_id, case_scenario").eq("concept_id", concept_id).execute()
    if len(res.data) < 2:
        raise HTTPException(status_code=400, detail="Not enough cases found for this concept.")

    case_1, case_2 = random.sample(res.data, 2)
    return {
        "case_1": {"ID": case_1["id"], "concept_ID": case_1["concept_id"], "case_scenario": case_1["case_scenario"]},
        "case_2": {"ID": case_2["id"], "concept_ID": case_2["concept_id"], "case_scenario": case_2["case_scenario"]}
    }

@app.post("/api/evaluate-case")
def evaluate_case(req: CaseEvalRequest):
    """
    Evaluates Case 1 or Case 2.
    Records the attempt into case_attempts, including the PROOF LINK (closing_gap_from_attempt_id).
    If try_number == 2, checks if both cases passed to compute final_verdict.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured.")

    # Fetch full case data (including answers) from Supabase
    case_query = supabase.table("cases").select("*").eq("id", req.case_id).limit(1).execute()
    if not case_query.data:
        raise HTTPException(status_code=404, detail="Case not found.")
    case_data = case_query.data[0]

    # Run Dual Evaluations
    eval_a = evaluate_keywords(req.user_explanation, case_data)
    eval_b = evaluate_semantic(case_data["case_scenario"], case_data["case_answer"], req.user_explanation)
    case_passed = eval_a["passed"] and eval_b["passed"]

    # Name the gap if failed
    gap_named = None
    if not case_passed:
        gaps = eval_b.get("missing_points", [])
        gap_named = gaps[0] if (isinstance(gaps, list) and gaps) else eval_b.get("reasoning", "Failed evaluation criteria")

    # Insert into case_attempts (WITH PROOF LINK)
    attempt_insert = {
        "session_id": req.session_id,
        "user_id": req.user_id,
        "concept_id": req.concept_id,
        "case_id": req.case_id,
        "try_number": req.try_number,
        "user_explanation": req.user_explanation,
        "eval_a_passed": eval_a["passed"],
        "eval_b_passed": eval_b["passed"],
        "passed": case_passed,
        "identified_gap": gap_named,
        "closing_gap_from_attempt_id": req.closing_gap_from_attempt_id  # PROOF LINK: retry -> gap
    }
    attempt_res = supabase.table("case_attempts").insert(attempt_insert).execute()
    new_attempt_id = attempt_res.data[0]["id"]

    # If this was Try 2, determine if the entire session passed (both cases must pass)
    final_verdict = None
    if req.try_number == 2:
        all_attempts = supabase.table("case_attempts") \
            .select("try_number, passed") \
            .eq("session_id", req.session_id) \
            .execute()
        
        passed_attempts = [a for a in all_attempts.data if a["passed"]]
        final_verdict = (len(passed_attempts) >= 2)
        
        supabase.table("review_sessions").update({
            "final_verdict": final_verdict
        }).eq("id", req.session_id).execute()

    return {
        "attempt_id": new_attempt_id,
        "case_passed": case_passed,
        "evaluation_a": eval_a,
        "evaluation_b": eval_b,
        "identified_gap": gap_named,
        "is_final": (req.try_number == 2),
        "final_verdict": final_verdict
    }

# Mount static files for local development
from fastapi.staticfiles import StaticFiles
public_dir = os.path.join(os.path.dirname(__file__), "..", "public")
if os.path.exists(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")
