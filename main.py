import os
import json
import requests
import random

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

def generate_socratic_probe(concept_question: str, user_explanation: str) -> dict:
    system_prompt = """You are "SumJ", an intuitive and rigorous Socratic engineering mentor.
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
        "model": "openai/gpt-oss-120b",  # Fast, highly capable reasoning model on Groq
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
    
    result = response.json()
    content = result["choices"][0]["message"]["content"]
    return json.loads(content)

def evaluate_keywords(user_explanation: str, case_data: dict, min_matches: int = 2) -> dict:
    explanation_lower = user_explanation.lower()
    synonym_groups = case_data.get("case_answer_kw_synonym", [])
    
    matched_groups = []
    unmatched_groups = []

    for group in synonym_groups:
        # Check if any synonym in this cluster was mentioned
        found_words = [term for term in group if term.lower() in explanation_lower]
        if found_words:
            matched_groups.append(found_words[0])  # Record the matched term
        else:
            # Show the primary canonical keyword as the missing concept
            unmatched_groups.append(group[-1])

    passed = len(matched_groups) >= min_matches
    
    return {
        "passed": passed,
        "matched_count": len(matched_groups),
        "total_required": len(synonym_groups),
        "matched_terms": matched_groups,
        "missing_concepts": unmatched_groups
    }

def evaluate_semantic(
    scenario: str,
    correct_answer: str,
    user_explanation: str
) -> dict:
    """
    Uses Groq to judge if the user's explanation demonstrates true understanding
    of the scenario and answer, even if using different words.
    """
    
    system_prompt = """
You are a rigorous but fair Software Engineering examiner.
Your job is to determine if a student truly understands a technical scenario,
NOT if they can memorize keywords.

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

    user_prompt = f"""Scenario: {scenario}
Correct Answer: {correct_answer}
Student Explanation: {user_explanation}
"""

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
    
    result = response.json()
    content = result["choices"][0]["message"]["content"]
    return json.loads(content)


def load_dataset() -> dict:
    dataset_path = os.path.join(os.path.dirname(__file__), "dataset.json")
    with open(dataset_path, "r") as f:
        return json.load(f)

if __name__ == "__main__":
    data = load_dataset()
    concepts = data.get("concept", [])

    print("\n--- SUMJ (समझे) Concept Mastery ---\n")
    print("Choose a concept to test your understanding:")
    for idx, c in enumerate(concepts, 1):
        print(f"  [{idx}] {c['concept_question']}")

    # 1. User selects a concept
    while True:
        try:
            choice = int(input(f"\nEnter choice (1-{len(concepts)}): "))
            if 1 <= choice <= len(concepts):
                selected_concept = concepts[choice - 1]
                break
            print(f"Please enter a number between 1 and {len(concepts)}.")
        except ValueError:
            print("Please enter a valid number.")

    selected_question = selected_concept["concept_question"]
    print(f"\nTarget Concept: {selected_question}")

    # 2. User inputs their initial explanation
    user_explanation = input("\nExplain this concept in your own words:\n> ")

    # 3. Analyze for jargon / rote recitation
    print("\nAnalyzing your explanation with SumJ...")
    probe = generate_socratic_probe(selected_question, user_explanation)

    print("\n--- SumJ Feedback ---")
    if probe.get("detected_recitation"):
        print(f"Detected Jargon/Fillers: {', '.join(probe['detected_recitation'])}")
    print(f"Critique: {probe.get('critique')}")
    print(f"\nSocratic Follow-up:\n👉 {probe.get('follow_up_question')}\n")

    # User answers the Socratic follow-up
    followup_explanation = input("Your answer to the follow-up:\n> ")
    print(f"\nYour explanation:\n{followup_explanation}")

    # Filter cases matching the selected concept
    matching_cases = [
        c for c in data.get("case", []) 
        if c.get("concept_ID") == selected_concept["ID"]
    ]

    if not matching_cases:
        print("\nNo cases found for this concept.")
    else:
        selected_case = random.choice(matching_cases)
    
    print("\n" + "="*50)
    print("--- CASE CHALLENGE ---")
    print(f"Case ID: {selected_case['ID']}")
    print(f"Scenario:\n{selected_case['case_scenario']}")
    print("="*50)

    user_case_explanation = input("\nExplain the rationale / solution for this case:\n> ")
    print(f"\nYour Case Explanation:\n{user_case_explanation}")

    print("\nEvaluating your case explanation...")

    # 1. Run Evaluation A
    eval_a = evaluate_keywords(user_case_explanation, selected_case, min_matches=2)

    # 2. Run Evaluation B
    eval_b = evaluate_semantic(
        selected_case["case_scenario"],
        selected_case["case_answer"],
        user_case_explanation
    )

    # 3. Final Deterministic Verification
    final_verdict = eval_a["passed"] and eval_b["passed"]

    # 4. Display Final Scorecard
    print("\n" + "="*50)
    print("--- EVALUATION BREAKDOWN ---")
    print("="*50)
    
    # Evaluation A display
    status_a = "✅ PASSED" if eval_a["passed"] else "❌ FAILED"
    print(f"Evaluation A (Keyword/Concept Check): {status_a}")
    print(f"  Matched ({eval_a['matched_count']}/{eval_a['total_required']}): {eval_a['matched_terms']}")
    if eval_a["missing_concepts"]:
        print(f"  Missing Concept Areas: {eval_a['missing_concepts']}")

    # Evaluation B display
    status_b = "✅ PASSED" if eval_b["passed"] else "❌ FAILED"
    print(f"\nEvaluation B (Semantic Reasoning): {status_b}")
    print(f"  Examiner Notes: {eval_b.get('reasoning')}")
    if eval_b.get("missing_points"):
        print(f"  Gaps Identified: {eval_b.get('missing_points')}")

    # Final Verdict Banner
    print("\n" + "-"*50)
    if final_verdict:
        print("🏆 FINAL VERDICT: PASSED (Concept Mastered!)")
    else:
        print("❌ FINAL VERDICT: NOT YET (Review the missing points above)")
    print("-" * 50)



