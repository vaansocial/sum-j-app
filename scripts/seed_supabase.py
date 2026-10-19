import os, json
# pyrefly: ignore [missing-import]
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

path = os.path.join(os.path.dirname(__file__), "..", "dataset.json")
with open(path, encoding="utf-8") as f:
    data = json.load(f)

# 1. Concepts first (cases depend on them)
concepts = [{"id": c["ID"], "concept_question": c["concept_question"]} for c in data["concept"]]
supabase.table("concepts").upsert(concepts).execute()
print(f"Upserted {len(concepts)} concepts")

# 2. Cases
cases = [{
    "id": c["ID"],
    "concept_id": c["concept_ID"],
    "case_scenario": c["case_scenario"],
    "case_answer": c["case_answer"],
    "case_answer_keywords": c["case_answer_keywords"],
    "case_answer_kw_synonym": c["case_answer_kw_synonym"],
} for c in data["case"]]
supabase.table("cases").upsert(cases).execute()
print(f"Upserted {len(cases)} cases")
