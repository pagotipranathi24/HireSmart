
import re
from difflib import SequenceMatcher

try:
    from sentence_transformers import SentenceTransformer
    MODEL_AVAILABLE = True
except ImportError:
    MODEL_AVAILABLE = False


MODEL_NAME = "all-MiniLM-L6-v2"
_model = None

ALIASES = {
    "js": "javascript",
    "javascript": "javascript",
    "ml": "machine learning",
    "machine learning": "machine learning",
    "ai": "artificial intelligence",
    "artificial intelligence": "artificial intelligence",
    "reactjs": "react",
    "nodejs": "node.js",
    "node js": "node.js",
    "sql database": "sql",
    "mysql database": "mysql",
    "communication skills": "communication",
    "problem solving": "problem solving",
    "problem-solving": "problem solving",
}


def clean_skill(skill):
    skill = str(skill).strip().lower()
    skill = re.sub(r"\s+", " ", skill)
    return ALIASES.get(skill, skill)


def get_model():
    global _model

    if _model is None and MODEL_AVAILABLE:
        _model = SentenceTransformer(MODEL_NAME)

    return _model


def semantic_similarity(skill_one, skill_two):
    first = clean_skill(skill_one)
    second = clean_skill(skill_two)

    if not first or not second:
        return 0.0

    if first == second:
        return 1.0

    try:
        model = get_model()

        if model is not None:
            embeddings = model.encode(
                [first, second],
                normalize_embeddings=True
            )
            similarity = float(embeddings[0] @ embeddings[1])
            return max(0.0, min(1.0, similarity))

    except Exception:
        pass

    return SequenceMatcher(None, first, second).ratio()


def calculate_match(job_skills, candidate_skills):
    """
    job_skills:
        [{"name": "Python", "weight": 40}, ...]

    candidate_skills:
        ["Python", "JavaScript", "SQL", ...]

    Returns a weighted match percentage and skill details.
    """

    if not isinstance(job_skills, list):
        raise ValueError("Job skills must be a list.")

    if not isinstance(candidate_skills, list):
        raise ValueError("Candidate skills must be a list.")

    if not job_skills:
        raise ValueError("No job skills were provided.")

    candidate_skills = [
        str(skill).strip()
        for skill in candidate_skills
        if str(skill).strip()
    ]

    total_weight = sum(float(skill.get("weight", 0)) for skill in job_skills)

    if total_weight <= 0:
        raise ValueError("Total job skill weight must be greater than zero.")

    total_score = 0.0
    skill_details = []

    for required in job_skills:
        required_name = str(required.get("name", "")).strip()
        weight = float(required.get("weight", 0))

        if not required_name:
            continue

        best_similarity = 0.0
        best_candidate_skill = ""

        for candidate_skill in candidate_skills:
            similarity = semantic_similarity(
                required_name,
                candidate_skill
            )

            if similarity > best_similarity:
                best_similarity = similarity
                best_candidate_skill = candidate_skill

        # Exact or very close matches receive full credit.
        if best_similarity >= 0.90:
            match_percentage = 100.0
        else:
            match_percentage = best_similarity * 100.0

        weighted_score = (match_percentage / 100.0) * weight
        total_score += weighted_score

        skill_details.append({
            "requiredSkill": required_name,
            "candidateSkill": best_candidate_skill or "Not found",
            "weight": weight,
            "similarity": round(match_percentage, 2),
            "weightedScore": round(weighted_score, 2),
            "matched": best_similarity >= 0.65
        })

    final_score = (total_score / total_weight) * 100

    return {
        "score": round(min(100.0, max(0.0, final_score)), 2),
        "skills": skill_details
    }
