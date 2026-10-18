# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
import os, json, random, requests

app = FastAPI(title="SumJ API")

# Enable CORS for local testing and cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

def load_dataset() -> dict:
    candidates = [
        os.path.join(os.path.dirname(__file__), "dataset.json"),
        os.path.join(os.path.dirname(__file__), "..", "dataset.json"),
        "dataset.json"
    ]
    for path in candidates:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("dataset.json could not be located.")

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

    user_prompt = f"Concept: {concept_question}\nStudent Answer: {user_explanation}"

    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    response = requests.post(GROQ_URL, headers=headers, json=payload)
    response.raise_for_status()
    return json.loads(response.json()["choices"][0]["message"]["content"])

def evaluate_keywords(user_explanation: str, case_data: dict, min_matches: int = 2) -> dict:
    explanation_lower = user_explanation.lower()
    synonym_groups = case_data.get("case_answer_kw_synonym", [])
    
    matched_groups = []
    unmatched_groups = []

    for group in synonym_groups:
        found_words = [term for term in group if term.lower() in explanation_lower]
        if found_words:
            matched_groups.append(found_words[0])
        else:
            unmatched_groups.append(group[-1])

    passed = len(matched_groups) >= min_matches
    
    return {
        "passed": passed,
        "matched_count": len(matched_groups),
        "total_required": len(synonym_groups),
        "matched_terms": matched_groups,
        "missing_concepts": unmatched_groups
    }

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
4. Output a JSON object with a simple Pass/Fail verdict and a short reasoning note.

Respond ONLY with valid JSON:
{
  "passed": true/false,
  "reasoning": "short explanation",
  "missing_points": ["optional list of gaps"]
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

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    response = requests.post(GROQ_URL, headers=headers, json=payload)
    response.raise_for_status()
    return json.loads(response.json()["choices"][0]["message"]["content"])

# Request models
class ProbeRequest(BaseModel):
    concept_question: str
    user_explanation: str

class EvaluateRequest(BaseModel):
    case_id: str
    user_explanation: str

@app.get("/api/concepts")
def get_concepts():
    data = load_dataset()
    return data.get("concept", [])

@app.post("/api/probe")
def probe_explanation(req: ProbeRequest):
    return generate_socratic_probe(req.concept_question, req.user_explanation)

@app.get("/api/case/{concept_id}")
def get_case(concept_id: str):
    data = load_dataset()
    matching = [c for c in data.get("case", []) if c.get("concept_ID") == concept_id]
    if not matching:
        raise HTTPException(status_code=404, detail="No cases found for this concept")
    case = random.choice(matching)
    # Strip answers to avoid client leaks
    return {
        "ID": case["ID"],
        "concept_ID": case["concept_ID"],
        "case_scenario": case["case_scenario"]
    }

@app.post("/api/evaluate")
def evaluate_case_answer(req: EvaluateRequest):
    data = load_dataset()
    case = next((c for c in data.get("case", []) if c["ID"] == req.case_id), None)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    eval_a = evaluate_keywords(req.user_explanation, case)
    eval_b = evaluate_semantic(case["case_scenario"], case["case_answer"], req.user_explanation)
    final_verdict = eval_a["passed"] and eval_b["passed"]

    return {
        "final_verdict": final_verdict,
        "evaluation_a": eval_a,
        "evaluation_b": eval_b
    }

# Mount static files for local development
from fastapi.staticfiles import StaticFiles
public_dir = os.path.join(os.path.dirname(__file__), "..", "public")
if os.path.exists(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")

