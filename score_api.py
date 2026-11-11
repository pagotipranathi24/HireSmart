
import sys
import json
import traceback

from match import calculate_match


def main():
    if len(sys.argv) < 2:
        raise ValueError("Scoring input was not provided.")

    payload = json.loads(sys.argv[1])

    job_skills = payload.get("jobSkills", [])
    candidates = payload.get("candidates", [])

    if not job_skills:
        raise ValueError("No required job skills were received.")

    if not candidates:
        raise ValueError("No candidates were received.")

    results = []

    for candidate in candidates:
        candidate_id = candidate.get("candidateId")
        candidate_skills = candidate.get("skills", [])

        if not isinstance(candidate_skills, list):
            candidate_skills = []

        match_result = calculate_match(
            job_skills,
            candidate_skills
        )

        results.append({
            "candidateId": candidate_id,
            "score": match_result["score"],
            "skills": match_result["skills"]
        })

    results.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    return {
        "success": True,
        "message": "Candidate scores calculated successfully.",
        "totalCandidates": len(results),
        "results": results
    }


if __name__ == "__main__":
    try:
        output = main()
        print(json.dumps(output))

    except Exception as error:
        traceback.print_exc(file=sys.stderr)

        print(json.dumps({
            "success": False,
            "error": str(error)
        }))
